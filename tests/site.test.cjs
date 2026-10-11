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
    document, location, navigator,
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
  return {
    elements, document, body, requests, context, evaluate,
    route(name) { location.hash = '#' + name; windowHandlers.hashchange(); },
    setHidden(value) { document.hidden = value; documentHandlers.visibilitychange(); },
    setReducedMotion(value) { reducedMotion.matches = value; mediaHandlers.change(); },
    dismiss() { evaluate('dismissMenu()'); },
    flushCloses() { while (queuedCloses.length) queuedCloses.shift()(); },
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
