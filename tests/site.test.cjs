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
  const requests = [];
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
      this.value = '';
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
    select() { this.selected = true; }
    contains(element) {
      return element !== body && element !== elements.get('menu-open') && element !== elements.get('hero-explore') && element !== elements.get('motion-toggle');
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
    'hero-explore', 'menu-title', 'about-title', 'exploration-title', 'enquiries-title',
    'copy-address', 'address-status', 'address-copy',
    'motion-toggle', 'motion-label'
  ]) elements.set(id, new Element(id));
  for (const route of ['menu', 'about', 'exploration', 'enquiries']) {
    const pane = new Element('pane-' + route);
    pane.dataset.pane = route;
    elements.set(pane.id, pane);
  }
  for (const id of ['menu-open', 'motion-toggle', 'address-copy', 'address-status']) elements.get(id).hidden = true;

  const location = { hash: initialHash, pathname: '/preview/', search: '?locale=en' };
  const windowHandlers = {};
  const navigator = {
    clipboard: {
      writeText(text) {
        return new Promise((resolve, reject) => { requests.push({ text, resolve, reject }); });
      }
    }
  };
  const context = {
    document, location, navigator, setTimeout: schedule, clearTimeout: clear,
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
    elements, document, body, requests, context, evaluate, animations, flushTransitions,
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

test('motion starts controlled and the visitor can pause and resume it', async () => {
  const site = createSite();
  assert.equal(site.body.dataset.motion, 'playing');
  assert.equal(site.elements.get('motion-toggle').hidden, false);
  assert.equal(site.elements.get('motion-label').textContent, 'Pause motion');
  await site.click('motion-toggle');
  assert.equal(site.body.dataset.motion, 'paused');
  assert.equal(site.elements.get('motion-label').textContent, 'Resume motion');
  await site.click('motion-toggle');
  assert.equal(site.body.dataset.motion, 'playing');
  assert.equal(site.elements.get('motion-label').textContent, 'Pause motion');
});

test('reduced motion is static on first render and the redundant control is hidden', () => {
  const site = createSite('', { reducedMotion: true });
  assert.equal(site.body.dataset.motion, 'paused');
  assert.equal(site.elements.get('motion-toggle').hidden, true);
});

test('a reduced-motion preference change suspends and restores a running image', () => {
  const site = createSite();
  site.setReducedMotion(true);
  assert.equal(site.body.dataset.motion, 'paused');
  assert.equal(site.elements.get('motion-toggle').hidden, true);
  site.setReducedMotion(false);
  assert.equal(site.body.dataset.motion, 'playing');
  assert.equal(site.elements.get('motion-toggle').hidden, false);
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

test('manual pause survives hidden documents, dialog navigation and preference changes', async () => {
  const site = createSite();
  await site.click('motion-toggle');
  site.setHidden(true);
  site.setHidden(false);
  site.route('menu');
  site.route('exploration');
  site.dismiss();
  site.flushCloses();
  site.setReducedMotion(true);
  site.setReducedMotion(false);
  assert.equal(site.body.dataset.motion, 'paused');
  assert.equal(site.elements.get('motion-label').textContent, 'Resume motion');
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

test('copy-address: a response during the exit cannot change status or focus', async () => {
  const site = createSite('#enquiries', { manualTransitions: true });
  site.flushTransitions();
  const pending = site.click('copy-address');
  site.dismiss();
  assert.equal(site.elements.get('site-menu').open, true);
  site.requests[0].reject(new Error('Permission denied'));
  await pending;
  assert.equal(site.elements.get('address-copy').hidden, true);
  assert.equal(site.elements.get('address-status').hidden, true);
  site.flushTransitions();
  site.flushCloses();
  assert.equal(site.document.activeElement.id, 'menu-open');
});

test('copy-address: success copies the address and keeps the control available for reuse', async () => {
  const site = createSite('#enquiries');
  const pending = site.click('copy-address');
  assert.equal(site.requests[0].text, 'enquiries@snuaekerhead.ae');
  site.requests[0].resolve();
  await pending;
  assert.equal(site.elements.get('copy-address').hidden, false);
  assert.equal(site.elements.get('copy-address').textContent, 'Copied');
  assert.equal(site.document.activeElement.id, 'copy-address');
  const again = site.click('copy-address');
  assert.equal(site.requests[1].text, 'enquiries@snuaekerhead.ae');
  site.requests[1].resolve();
  await again;
});

test('copy-address: a rejection after close/reopen does not steal focus or reveal stale fallback', async () => {
  const site = createSite('#enquiries');
  const pending = site.click('copy-address');
  site.dismiss();
  site.flushCloses();
  site.route('enquiries');
  site.requests[0].reject(new Error('Permission denied'));
  await pending;
  assert.equal(site.document.activeElement.id, 'enquiries-title');
  assert.equal(site.elements.get('address-copy').hidden, true);
});

test('copy-address: completion after leaving and returning to the view is ignored', async () => {
  const site = createSite('#enquiries');
  const previousStatus = site.elements.get('address-status').textContent;
  const pending = site.click('copy-address');
  site.route('about');
  site.route('enquiries');
  site.requests[0].resolve();
  await pending;
  assert.equal(site.document.activeElement.id, 'enquiries-title');
  assert.equal(site.elements.get('address-status').textContent, previousStatus);
});

test('copy-address: older overlapping requests cannot override a newer successful copy', async () => {
  const site = createSite('#enquiries');
  const first = site.click('copy-address');
  const second = site.click('copy-address');
  site.requests[1].resolve();
  await second;
  const status = site.elements.get('address-status').textContent;
  site.requests[0].reject(new Error('Older permission response'));
  await first;
  assert.equal(site.elements.get('address-status').textContent, status);
  assert.equal(site.elements.get('address-copy').hidden, true);
  assert.equal(site.document.activeElement.id, 'copy-address');
});

test('copy-address: current clipboard failure supports manual selection', async () => {
  const site = createSite('#enquiries');
  site.context.navigator.clipboard = undefined;
  await site.click('copy-address');
  const fallback = site.elements.get('address-copy');
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.selected, true);
  assert.equal(site.document.activeElement, fallback);
});

test('copy-address: a failure does not move focus after the visitor focuses menu navigation', async () => {
  const site = createSite('#enquiries');
  const pending = site.click('copy-address');
  site.elements.get('panel-back').focus();
  site.requests[0].reject(new Error('Permission denied'));
  await pending;
  assert.equal(site.document.activeElement.id, 'panel-back');
});

test('no-JS menu trigger starts hidden and local dependencies exist', () => {
  const html = fs.readFileSync(path.join(servedDirectory, 'index.html'), 'utf8');
  assert.match(html, /<button\b[^>]*\bid="menu-open"[^>]*\bhidden(?:\s|>)/);
  assert.match(html, /<noscript>[\s\S]*mailto:enquiries@snuaekerhead\.ae[\s\S]*<\/noscript>/);
  for (const match of html.matchAll(/<(?:img|script|image|source|link)\b[^>]*\b(?:src|href)="([^"#]+)"/g)) {
    const file = match[1].split(/[?#]/)[0];
    assert.ok(fs.existsSync(path.join(servedDirectory, file)), 'Missing dependency: ' + match[1]);
  }
  for (const match of html.matchAll(/\b(?:imagesrcset|srcset)="([^"]+)"/g)) {
    for (const candidate of match[1].split(',')) {
      const file = candidate.trim().split(/\s+/)[0];
      assert.ok(fs.existsSync(path.join(servedDirectory, file)), 'Missing responsive dependency: ' + file);
    }
  }
  assert.match(html, /<button\b[^>]*\bid="motion-toggle"[^>]*\bhidden(?:\s|>)/);
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
