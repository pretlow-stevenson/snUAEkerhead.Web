'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const servedDirectory = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(servedDirectory, 'site.js'), 'utf8');

// This deliberately small DOM model exercises asynchronous handlers and state.
// Native dialog behavior and responsive layout need UI checks.
function createSite(initialHash = '', options = {}) {
  const elements = new Map();
  const queuedCloses = [];
  const timers = new Map();
  const animations = [];
  let timerId = 0;
  let clock = 0;
  const schedule = (handler, delay) => { const id = ++timerId; timers.set(id, { handler, at: clock + delay }); return id; };
  const clear = id => timers.delete(id);
  function flushTransitions() {
    let remaining = 30;
    while (timers.size && remaining-- > 0) {
      const [id, timer] = Array.from(timers).sort((left, right) => left[1].at - right[1].at)[0];
      clock = timer.at;
      timers.delete(id);
      timer.handler();
    }
    assert.ok(remaining > 0, 'Transitions must settle without a timer loop');
  }
  const body = { isConnected: true, classList: new Set(), dataset: {} };
  body.classList.remove = body.classList.delete;
  const documentHandlers = {};
  const document = {
    body, activeElement: body, hidden: options.hidden ?? false,
    getElementById: id => elements.get(id),
    addEventListener(type, handler) { documentHandlers[type] = handler; }
  };
  const mediaHandlers = {};
  const reducedMotion = {
    matches: options.reducedMotion ?? false,
    addEventListener(type, handler) { mediaHandlers[type] = handler; }
  };

  class Element {
    constructor(id) {
      this.id = id;
      this.hidden = false;
      this.isConnected = true;
      this.open = false;
      this.dataset = {};
      this.attributes = {};
      this.handlers = {};
      this.textContent = '';
    }
    addEventListener(type, handler) { (this.handlers[type] ??= []).push(handler); }
    removeEventListener(type, handler) { this.handlers[type] = (this.handlers[type] ?? []).filter(item => item !== handler); }
    animate(keyframes, timing) {
      let resolve;
      let reject;
      const animation = {
        element: this, keyframes, timing, cancelled: false,
        finished: { then(success, failure) { resolve = success; reject = failure; } },
        finish() { if (animation.cancelled) return; clear(timeout); if (resolve) resolve(); },
        notifyFinished() { if (resolve) resolve(); },
        cancel() { animation.cancelled = true; clear(timeout); if (reject) reject(); }
      };
      const timeout = schedule(() => animation.finish(), timing.duration);
      animations.push(animation);
      return animation;
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    get href() { return this.attributes.href; }
    set href(value) { this.attributes.href = value; }
    focus() { document.activeElement = this; }
    contains(element) {
      return element !== body && element !== elements.get('menu-open') && element !== elements.get('hero-explore');
    }
    querySelector(selector) {
      return elements.get(selector === '.panel-scroll' ? 'panel-scroll' : 'first-menu-link');
    }
    querySelectorAll() { return ['menu', 'about', 'exploration', 'enquiries'].map(route => elements.get('pane-' + route)); }
    getBoundingClientRect() { return { left: 600, right: 1000, top: 0, bottom: 720 }; }
    showModal() { this.previousFocus = document.activeElement; this.open = true; }
    close() {
      this.open = false;
      document.activeElement = this.previousFocus ?? body;
      queuedCloses.push(() => this.dispatch('close'));
    }
    dispatch(type, event = {}) { return Promise.all((this.handlers[type] ?? []).map(handler => handler(event))); }
  }

  for (const id of [
    'site-menu', 'menu-open', 'menu-close', 'panel-back', 'panel-brand', 'panel-scroll', 'first-menu-link',
    'hero-explore', 'menu-title', 'about-title', 'exploration-title', 'enquiries-title'
  ]) elements.set(id, new Element(id));
  for (const route of ['menu', 'about', 'exploration', 'enquiries']) {
    const pane = new Element('pane-' + route);
    pane.dataset.pane = route;
    elements.set(pane.id, pane);
  }
  elements.get('menu-open').hidden = true;

  const location = { hash: initialHash, pathname: '/preview/', search: '?locale=en' };
  const windowHandlers = {};
  const context = {
    document, location, setTimeout: schedule, clearTimeout: clear,
    history: {
      replaceState(_state, _unused, address) {
        location.hash = new URL(address, 'https://preview.test').hash;
        context.lastReplacedAddress = address;
      }
    },
    window: {
      addEventListener(type, handler) { windowHandlers[type] = handler; },
      matchMedia(query) {
        assert.equal(query, '(prefers-reduced-motion: reduce)');
        return reducedMotion;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const evaluate = code => vm.runInContext(code, context);
  if (!options.manualTransitions) flushTransitions();
  return {
    elements, document, body, context, evaluate, animations, flushTransitions,
    route(name) { location.hash = '#' + name; windowHandlers.hashchange(); if (!options.manualTransitions) flushTransitions(); },
    setHidden(value) { document.hidden = value; documentHandlers.visibilitychange(); },
    setReducedMotion(value) { reducedMotion.matches = value; mediaHandlers.change(); },
    dismiss() { evaluate('dismissMenu()'); if (!options.manualTransitions) flushTransitions(); },
    flushCloses() { if (!options.manualTransitions) flushTransitions(); while (queuedCloses.length) queuedCloses.shift()(); },
    click(id) { const element = elements.get(id); element.focus(); return element.dispatch('click'); }
  };
}

test('opening focuses the menu heading and repeated same-route rendering preserves focus', () => {
  const site = createSite('#menu');
  assert.equal(site.elements.get('menu-open').hidden, false);
  assert.equal(site.document.activeElement.id, 'menu-title');
  site.elements.get('menu-close').focus();
  site.route('menu');
  assert.equal(site.document.activeElement.id, 'menu-close');
});

test('closing restores the exploration link and retains path and query', () => {
  const site = createSite();
  site.elements.get('hero-explore').focus();
  site.route('exploration');
  site.dismiss();
  site.flushCloses();
  assert.equal(site.document.activeElement.id, 'hero-explore');
  assert.equal(site.context.lastReplacedAddress, '/preview/?locale=en');
  assert.equal(site.body.classList.has('menu-is-open'), false);
  assert.equal(site.elements.get('menu-open').attributes['aria-expanded'], 'false');
});

test('a queued close event cannot undo a reopened dialog', () => {
  const site = createSite('#about');
  site.dismiss();
  site.route('menu');
  site.flushCloses();
  assert.equal(site.elements.get('site-menu').open, true);
  assert.equal(site.body.classList.has('menu-is-open'), true);
  assert.equal(site.elements.get('menu-open').attributes['aria-expanded'], 'true');
  assert.equal(site.document.activeElement.id, 'menu-title');
});

test('the legacy invitation URL opens public Exploration and preserves its path and query', () => {
  const site = createSite('#by-invitation');
  assert.equal(site.context.lastReplacedAddress, '/preview/?locale=en#exploration');
  assert.equal(site.context.location.hash, '#exploration');
  assert.equal(site.elements.get('site-menu').dataset.view, 'exploration');
  assert.equal(site.elements.get('pane-exploration').hidden, false);
  assert.equal(site.document.activeElement.id, 'exploration-title');
  assert.equal(site.body.dataset.motion, 'paused');
});

test('unknown URLs close the panel and restore the trigger without rewriting the destination', () => {
  const site = createSite('#about');
  site.route('an-unknown-anchor');
  site.flushCloses();
  assert.equal(site.elements.get('site-menu').open, false);
  assert.equal(site.elements.get('menu-open').attributes['aria-expanded'], 'false');
  assert.equal(site.document.activeElement.id, 'menu-open');
  assert.equal(site.context.location.hash, '#an-unknown-anchor');
  assert.equal(site.body.dataset.motion, 'playing');
});

test('Escape closes the panel through the same route and focus cleanup', async () => {
  const site = createSite('#exploration');
  let prevented = false;
  await site.elements.get('site-menu').dispatch('cancel', { preventDefault() { prevented = true; } });
  site.flushCloses();
  assert.equal(prevented, true);
  assert.equal(site.elements.get('site-menu').open, false);
  assert.equal(site.body.classList.has('menu-is-open'), false);
  assert.equal(site.context.location.hash, '');
  assert.equal(site.document.activeElement.id, 'menu-open');
});

test('a disconnected opener falls back to the menu trigger', () => {
  const site = createSite();
  site.elements.get('hero-explore').focus();
  site.route('exploration');
  site.elements.get('hero-explore').isConnected = false;
  site.dismiss();
  site.flushCloses();
  assert.equal(site.document.activeElement.id, 'menu-open');
});

test('inside dialog padding does not dismiss it but a backdrop click does', async () => {
  const site = createSite('#menu');
  const menu = site.elements.get('site-menu');
  await menu.dispatch('click', { target: menu, clientX: 700, clientY: 300 });
  assert.equal(menu.open, true);
  await menu.dispatch('click', { target: menu, clientX: 500, clientY: 300 });
  site.flushCloses();
  assert.equal(menu.open, false);
  assert.equal(site.context.location.hash, '');
  assert.equal(site.document.activeElement.id, 'menu-open');
});

test('clicking a child inside the dialog does not enter backdrop dismissal', async () => {
  const site = createSite('#menu');
  const menu = site.elements.get('site-menu');
  await menu.dispatch('click', { target: site.elements.get('menu-title'), clientX: 500, clientY: 300 });
  assert.equal(menu.open, true);
});

test('hero motion starts automatically on the landing page', () => {
  const site = createSite();
  assert.equal(site.body.dataset.motion, 'playing');
});

test('reduced motion is static on first render', () => {
  const site = createSite('', { reducedMotion: true });
  assert.equal(site.body.dataset.motion, 'paused');
});

test('a reduced-motion preference change suspends and restores a running image', () => {
  const site = createSite();
  site.setReducedMotion(true);
  assert.equal(site.body.dataset.motion, 'paused');
  site.setReducedMotion(false);
  assert.equal(site.body.dataset.motion, 'playing');
});

test('hidden documents suspend motion and initial background loads do not animate', () => {
  const site = createSite('', { hidden: true });
  assert.equal(site.body.dataset.motion, 'paused');
  site.setHidden(false);
  assert.equal(site.body.dataset.motion, 'playing');
  site.setHidden(true);
  assert.equal(site.body.dataset.motion, 'paused');
});

test('dialog suspension and queued close/reopen cannot restart background motion', () => {
  const site = createSite('#about');
  assert.equal(site.body.dataset.motion, 'paused');
  site.dismiss();
  site.route('menu');
  site.flushCloses();
  assert.equal(site.elements.get('site-menu').open, true);
  assert.equal(site.body.dataset.motion, 'paused');
  site.dismiss();
  site.flushCloses();
  assert.equal(site.body.dataset.motion, 'playing');
});

test('closing the menu while the document is hidden does not restart motion', () => {
  const site = createSite('#menu');
  site.setHidden(true);
  site.dismiss();
  site.flushCloses();
  assert.equal(site.body.dataset.motion, 'paused');
  site.setHidden(false);
  assert.equal(site.body.dataset.motion, 'playing');
});

test('dismissal keeps the modal and background pause until its actual exit completes', async () => {
  const site = createSite('#about', { manualTransitions: true });
  site.flushTransitions();
  const menu = site.elements.get('site-menu');
  site.dismiss();
  assert.equal(menu.open, true);
  assert.equal(menu.dataset.phase, 'closing');
  assert.equal(site.body.classList.has('menu-is-open'), true);
  assert.equal(site.body.dataset.motion, 'paused');
  assert.equal(site.elements.get('menu-open').attributes['aria-expanded'], 'true');
  await menu.dispatch('transitionend', { target: menu, propertyName: 'opacity' });
  assert.equal(menu.open, true);
  await menu.dispatch('transitionend', { target: site.elements.get('panel-scroll'), propertyName: 'transform' });
  assert.equal(menu.open, true);
  await menu.dispatch('transitionend', { target: menu, propertyName: 'transform' });
  assert.equal(menu.open, false);
  assert.equal(site.document.activeElement.id, 'menu-open');
  assert.equal(site.body.dataset.motion, 'playing');
  site.flushTransitions();
  site.flushCloses();
  assert.equal(menu.open, false);
});

test('a missing panel transition event still completes dismissal and focus restoration', () => {
  const site = createSite('#about', { manualTransitions: true });
  site.flushTransitions();
  site.dismiss();
  assert.equal(site.elements.get('site-menu').open, true);
  site.flushTransitions();
  site.flushCloses();
  assert.equal(site.elements.get('site-menu').open, false);
  assert.equal(site.document.activeElement.id, 'menu-open');
});

test('reopening during exit reverses dismissal and ignores its stale completion', () => {
  const site = createSite('#about', { manualTransitions: true });
  site.flushTransitions();
  const menu = site.elements.get('site-menu');
  site.dismiss();
  const oldExit = menu.handlers.transitionend[0];
  site.route('exploration');
  oldExit({ target: menu, propertyName: 'transform' });
  assert.equal(menu.open, true);
  assert.equal(menu.dataset.view, 'exploration');
  assert.equal(menu.dataset.phase, 'opening');
  assert.equal(site.document.activeElement.id, 'exploration-title');
  assert.equal(site.body.dataset.motion, 'paused');
  site.flushTransitions();
  site.flushCloses();
  assert.equal(menu.open, true);
  assert.equal(menu.dataset.phase, 'open');
  assert.equal(site.elements.get('menu-open').attributes['aria-expanded'], 'true');
});

test('route changes hide the outgoing pane before focusing the incoming heading', () => {
  const site = createSite('#about', { manualTransitions: true });
  site.flushTransitions();
  site.route('exploration');
  const scroll = site.elements.get('panel-scroll');
  assert.equal(scroll.inert, true);
  assert.equal(scroll.attributes['aria-busy'], 'true');
  assert.equal(site.elements.get('pane-about').hidden, false);
  assert.equal(site.document.activeElement.id, 'about-title');
  site.animations.at(-1).finish();
  assert.equal(site.elements.get('pane-about').hidden, true);
  assert.equal(site.elements.get('pane-exploration').hidden, false);
  assert.equal(site.document.activeElement.id, 'exploration-title');
  assert.equal(scroll.inert, false);
  assert.equal(scroll.attributes['aria-busy'], undefined);
  site.flushTransitions();
  assert.equal(site.elements.get('site-menu').dataset.contentPhase, 'idle');
});

for (const { initialRoute, destination, control } of [
  { initialRoute: 'menu', destination: 'about', control: 'menu-close' },
  { initialRoute: 'about', destination: 'exploration', control: 'panel-back' }
]) {
  test('route fades preserve a visitor moving focus to the visible ' + control + ' control', () => {
    const site = createSite('#' + initialRoute, { manualTransitions: true });
    site.flushTransitions();
    site.route(destination);
    site.elements.get(control).focus();
    site.animations.at(-1).finish();
    assert.equal(site.elements.get('site-menu').dataset.view, destination);
    assert.equal(site.document.activeElement.id, control);
    site.flushTransitions();
    assert.equal(site.document.activeElement.id, control);
  });
}

for (const { initialRoute, destination, control } of [
  { initialRoute: 'menu', destination: 'about', control: 'panel-brand' },
  { initialRoute: 'about', destination: 'menu', control: 'panel-back' }
]) {
  test('route fades replace focus on the outgoing ' + control + ' control when it becomes hidden', () => {
    const site = createSite('#' + initialRoute, { manualTransitions: true });
    site.flushTransitions();
    site.route(destination);
    site.elements.get(control).focus();
    site.animations.at(-1).finish();
    assert.equal(site.elements.get(control).hidden, true);
    assert.equal(site.document.activeElement.id, destination + '-title');
  });
}

test('route fades do not preserve a disconnected header control or an unchanged focus origin', () => {
  const site = createSite('#menu', { manualTransitions: true });
  site.flushTransitions();
  site.route('about');
  site.elements.get('menu-close').focus();
  site.elements.get('menu-close').isConnected = false;
  site.animations.at(-1).finish();
  assert.equal(site.document.activeElement.id, 'about-title');
  site.flushTransitions();
  site.elements.get('menu-close').isConnected = true;
  site.elements.get('menu-close').focus();
  site.route('exploration');
  site.animations.at(-1).finish();
  assert.equal(site.document.activeElement.id, 'exploration-title');
});

test('reduced-motion settlement preserves focus deliberately moved to visible header navigation', () => {
  const site = createSite('#about', { manualTransitions: true });
  site.flushTransitions();
  site.route('exploration');
  site.elements.get('panel-back').focus();
  site.setReducedMotion(true);
  assert.equal(site.elements.get('site-menu').dataset.view, 'exploration');
  assert.equal(site.document.activeElement.id, 'panel-back');
  assert.equal(site.elements.get('panel-scroll').inert, false);
});

test('reduced-motion settlement replaces focus on navigation hidden by the requested route', () => {
  const site = createSite('#about', { manualTransitions: true });
  site.flushTransitions();
  site.route('menu');
  site.elements.get('panel-back').focus();
  site.setReducedMotion(true);
  assert.equal(site.elements.get('panel-back').hidden, true);
  assert.equal(site.document.activeElement.id, 'menu-title');
});

test('settling an incoming view preserves its current focus and reading position', () => {
  const site = createSite('#menu', { manualTransitions: true });
  site.flushTransitions();
  site.route('about');
  site.animations.at(-1).finish();
  site.elements.get('panel-scroll').scrollTop = 180;
  site.elements.get('menu-close').focus();
  site.setReducedMotion(true);
  assert.equal(site.document.activeElement.id, 'menu-close');
  assert.equal(site.elements.get('panel-scroll').scrollTop, 180);
  assert.equal(site.elements.get('site-menu').dataset.contentPhase, 'idle');
});

test('rapid route requests reveal only the latest destination despite queued animation work', () => {
  const site = createSite('#menu', { manualTransitions: true });
  site.flushTransitions();
  site.route('about');
  const firstDeparture = site.animations.at(-1);
  site.route('exploration');
  const secondDeparture = site.animations.at(-1);
  site.route('enquiries');
  firstDeparture.notifyFinished();
  secondDeparture.notifyFinished();
  assert.equal(site.elements.get('pane-menu').hidden, false);
  site.flushTransitions();
  assert.equal(site.elements.get('site-menu').dataset.view, 'enquiries');
  assert.equal(site.elements.get('pane-enquiries').hidden, false);
  assert.equal(site.elements.get('pane-about').hidden, true);
  assert.equal(site.elements.get('pane-exploration').hidden, true);
  assert.equal(site.document.activeElement.id, 'enquiries-title');
});

test('dismissal during a route fade cannot reveal or focus the cancelled destination', () => {
  const site = createSite('#menu', { manualTransitions: true });
  site.flushTransitions();
  site.route('about');
  const departure = site.animations.at(-1);
  site.dismiss();
  departure.notifyFinished();
  site.flushTransitions();
  site.flushCloses();
  assert.equal(site.elements.get('site-menu').open, false);
  assert.equal(site.elements.get('pane-about').hidden, true);
  assert.equal(site.document.activeElement.id, 'menu-open');
});

test('reduced-motion changes settle content navigation and dismissal immediately', () => {
  const site = createSite('#menu', { manualTransitions: true });
  site.flushTransitions();
  site.route('about');
  site.setReducedMotion(true);
  assert.equal(site.elements.get('site-menu').dataset.view, 'about');
  assert.equal(site.elements.get('site-menu').dataset.contentPhase, 'idle');
  assert.equal(site.document.activeElement.id, 'about-title');
  site.dismiss();
  assert.equal(site.elements.get('site-menu').open, false);
  assert.equal(site.document.activeElement.id, 'menu-open');
  site.flushTransitions();
  assert.equal(site.elements.get('site-menu').open, false);
});

test('hidden documents settle pending navigation and exit without waiting for throttled timers', () => {
  const site = createSite('#menu', { manualTransitions: true });
  site.flushTransitions();
  site.route('exploration');
  site.setHidden(true);
  assert.equal(site.elements.get('site-menu').dataset.view, 'exploration');
  assert.equal(site.document.activeElement.id, 'exploration-title');
  site.setHidden(false);
  site.dismiss();
  assert.equal(site.elements.get('site-menu').open, true);
  site.setHidden(true);
  assert.equal(site.elements.get('site-menu').open, false);
  assert.equal(site.body.dataset.motion, 'paused');
  site.setHidden(false);
  assert.equal(site.body.dataset.motion, 'playing');
});

test('no-JS menu trigger starts hidden and local dependencies exist', () => {
  const html = fs.readFileSync(path.join(servedDirectory, 'index.html'), 'utf8');
  assert.match(html, /<button\b[^>]*\bid="menu-open"[^>]*\bhidden(?:\s|>)/);
  assert.match(html, /<noscript>[\s\S]*mailto:enquiries@snuaekerhead\.ae[\s\S]*<\/noscript>/);
  for (const match of html.matchAll(/<(?:img|script|image|source|link)\b[^>]*\b(?:src|href)="([^"#]+)"/g)) {
    if (/\brel="canonical"/.test(match[0])) continue;
    const file = match[1].split(/[?#]/)[0];
    assert.ok(fs.existsSync(path.join(servedDirectory, file)), 'Missing dependency: ' + match[1]);
  }
  for (const match of html.matchAll(/\b(?:imagesrcset|srcset)="([^"]+)"/g)) {
    for (const candidate of match[1].split(',')) {
      const file = candidate.trim().split(/\s+/)[0];
      assert.ok(fs.existsSync(path.join(servedDirectory, file)), 'Missing responsive dependency: ' + file);
    }
  }
  assert.doesNotMatch(html, /id="(?:motion-toggle|motion-label|copy-address|address-status|address-copy)"/);
  assert.match(html, /<noscript>[\s\S]*id="exploration"[\s\S]*<\/noscript>/);
  assert.doesNotMatch(html, /By Invitation|invitation-only|by-invitation|TEPHRA/i);
});

test('every explicitly queried element and pane focus target exists in the delivered document', () => {
  const html = fs.readFileSync(path.join(servedDirectory, 'index.html'), 'utf8');
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  for (const match of source.matchAll(/getElementById\('([^']+)'\)/g)) {
    assert.ok(ids.has(match[1]), 'Missing queried element: ' + match[1]);
  }
  for (const match of html.matchAll(/\bdata-pane="([^"]+)"/g)) {
    assert.ok(ids.has(match[1] + '-title'), 'Missing pane focus target: ' + match[1]);
  }
});
