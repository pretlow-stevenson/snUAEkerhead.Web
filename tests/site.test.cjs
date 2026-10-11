'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const servedDirectory = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(servedDirectory, 'site.js'), 'utf8');

// This deliberately small DOM model exercises asynchronous handlers and state.
// Native dialog behavior, browser validation and responsive layout need UI checks.
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
      this.customError = '';
    }
    addEventListener(type, handler) { (this.handlers[type] ??= []).push(handler); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    get href() { return this.attributes.href; }
    set href(value) { this.attributes.href = value; }
    focus() { document.activeElement = this; }
    select() { this.selected = true; }
    setCustomValidity(value) { this.customError = value; }
    contains(element) {
      return element !== body && element !== elements.get('menu-open') && element !== elements.get('hero-explore') && element !== elements.get('motion-toggle');
    }
    querySelector(selector) {
      return elements.get(selector === '.panel-scroll' ? 'panel-scroll' : 'first-menu-link');
    }
    querySelectorAll() { return ['menu', 'about', 'exploration', 'enquiries'].map(route => elements.get('pane-' + route)); }
    getBoundingClientRect() { return { left: 600, right: 1000, top: 0, bottom: 720 }; }
    reportValidity() {
      return !elements.get('enquiry-name').customError && !elements.get('enquiry-message').customError;
    }
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
    'hero-explore', 'menu-title', 'about-title', 'exploration-title', 'enquiries-title', 'enquiry-form',
    'prepare-enquiry', 'draft-actions', 'draft-status', 'draft-link', 'draft-copy', 'copy-enquiry',
    'enquiry-name', 'enquiry-email', 'enquiry-type', 'enquiry-message', 'copy-address', 'address-status', 'address-copy',
    'motion-toggle', 'motion-label'
  ]) elements.set(id, new Element(id));
  for (const route of ['menu', 'about', 'exploration', 'enquiries']) {
    const pane = new Element('pane-' + route);
    pane.dataset.pane = route;
    elements.set(pane.id, pane);
  }
  for (const id of ['menu-open', 'motion-toggle', 'draft-actions', 'draft-copy', 'address-copy', 'address-status']) elements.get(id).hidden = true;

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
    },
    FormData: class { get(name) { return elements.get('enquiry-' + name).value; } }
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
    click(id) { const element = elements.get(id); element.focus(); return element.dispatch('click'); },
    async prepare(message = 'A considered enquiry.') {
      elements.get('enquiry-name').value = 'A Visitor';
      elements.get('enquiry-email').value = 'visitor@example.ae';
      elements.get('enquiry-type').value = 'General enquiry';
      elements.get('enquiry-message').value = message;
      await elements.get('enquiry-form').dispatch('submit', { preventDefault() {} });
    }
  };
}

test('mail draft keeps its receiver and topic fixed while preserving encoded Unicode text', () => {
  const site = createSite();
  const draft = site.evaluate("buildEnquiryDraft('محمد & Léa', 'visitor@example.ae', '?bcc=other@example.com', 'العربية % &body=ignored\\nSecond line')");
  const address = new URL(draft.href);
  assert.equal(address.pathname, 'enquiries@snuaekerhead.ae');
  assert.equal(address.searchParams.get('subject'), 'snUAEkerhead — General enquiry');
  assert.equal(address.searchParams.get('bcc'), null);
  assert.match(address.searchParams.get('body'), /محمد & Léa/);
  assert.match(address.searchParams.get('body'), /العربية % &body=ignored\r\nSecond line/);
  assert.equal(draft.needsCopy, false);
});

test('all line endings normalize and an isolated UTF-16 surrogate does not throw', () => {
  const site = createSite();
  const draft = site.evaluate("buildEnquiryDraft('A\\uD800B😀', 'a@example.ae', 'Press', 'one\\rtwo\\nthree\\r\\nfour')");
  assert.match(draft.body, /A�B😀/);
  assert.ok(draft.body.endsWith('one\r\ntwo\r\nthree\r\nfour'));
  assert.equal(new URL(draft.href).searchParams.get('subject'), 'snUAEkerhead — Press');
});

test('long Unicode messages remain complete through the copy fallback', () => {
  const site = createSite();
  const draft = site.evaluate("buildEnquiryDraft('A', 'a@example.ae', 'Collaboration', '旅'.repeat(1500))");
  assert.equal(draft.needsCopy, true);
  assert.equal(new URL(draft.href).searchParams.get('body'), null);
  assert.ok(draft.href.length < 1800);
  assert.ok(draft.body.endsWith('旅'.repeat(1500)));
});

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

for (const action of ['copy-address', 'copy-enquiry']) {
  test(action + ': a rejection after close/reopen does not steal focus or reveal stale fallback', async () => {
    const site = createSite('#enquiries');
    if (action === 'copy-enquiry') await site.prepare();
    const pending = site.click(action);
    site.dismiss();
    site.flushCloses();
    site.route('enquiries');
    site.requests[0].reject(new Error('Permission denied'));
    await pending;
    assert.equal(site.document.activeElement.id, 'enquiries-title');
    assert.equal(site.elements.get(action === 'copy-address' ? 'address-copy' : 'draft-copy').hidden, true);
  });

  test(action + ': completion after leaving and returning to the view is ignored', async () => {
    const site = createSite('#enquiries');
    if (action === 'copy-enquiry') await site.prepare();
    const previousStatus = site.elements.get(action === 'copy-address' ? 'address-status' : 'draft-status').textContent;
    const pending = site.click(action);
    site.route('about');
    site.route('enquiries');
    site.requests[0].resolve();
    await pending;
    assert.equal(site.document.activeElement.id, 'enquiries-title');
    assert.equal(site.elements.get(action === 'copy-address' ? 'address-status' : 'draft-status').textContent, previousStatus);
  });

  test(action + ': older overlapping requests cannot override a newer successful copy', async () => {
    const site = createSite('#enquiries');
    if (action === 'copy-enquiry') await site.prepare();
    const first = site.click(action);
    const second = site.click(action);
    site.requests[1].resolve();
    await second;
    const status = site.elements.get(action === 'copy-address' ? 'address-status' : 'draft-status').textContent;
    site.requests[0].reject(new Error('Older permission response'));
    await first;
    assert.equal(site.elements.get(action === 'copy-address' ? 'address-status' : 'draft-status').textContent, status);
    assert.equal(site.elements.get(action === 'copy-address' ? 'address-copy' : 'draft-copy').hidden, true);
    assert.equal(site.document.activeElement.id, action);
  });

  test(action + ': current clipboard failure supports manual selection', async () => {
    const site = createSite('#enquiries');
    if (action === 'copy-enquiry') await site.prepare();
    site.context.navigator.clipboard = undefined;
    await site.click(action);
    const fallback = site.elements.get(action === 'copy-address' ? 'address-copy' : 'draft-copy');
    assert.equal(fallback.hidden, false);
    assert.equal(fallback.selected, true);
    assert.equal(site.document.activeElement, fallback);
  });

  test(action + ': a failure does not move focus after the visitor continues editing', async () => {
    const site = createSite('#enquiries');
    if (action === 'copy-enquiry') await site.prepare();
    const pending = site.click(action);
    site.elements.get('enquiry-name').focus();
    site.requests[0].reject(new Error('Permission denied'));
    await pending;
    assert.equal(site.document.activeElement.id, 'enquiry-name');
  });
}

test('editing invalidates a pending enquiry copy and removes the old draft URL', async () => {
  const site = createSite('#enquiries');
  await site.prepare();
  const pending = site.click('copy-enquiry');
  site.elements.get('enquiry-message').value = 'A revised enquiry.';
  await site.elements.get('enquiry-form').dispatch('input');
  site.requests[0].reject(new Error('Permission denied'));
  await pending;
  assert.equal(site.elements.get('draft-actions').hidden, true);
  assert.equal(site.elements.get('draft-copy').hidden, true);
  assert.equal(site.elements.get('draft-copy').value, '');
  assert.equal(site.elements.get('draft-link').href, undefined);
  assert.equal(site.elements.get('prepare-enquiry').hidden, false);
  assert.equal(site.elements.get('enquiry-message').value, 'A revised enquiry.');
});

test('a pending old copy cannot label a newly prepared enquiry as copied', async () => {
  const site = createSite('#enquiries');
  await site.prepare();
  const pending = site.click('copy-enquiry');
  await site.elements.get('enquiry-form').dispatch('input');
  await site.prepare('The replacement enquiry.');
  const status = site.elements.get('draft-status').textContent;
  site.requests[0].resolve();
  await pending;
  assert.equal(site.elements.get('copy-enquiry').textContent, 'Copy enquiry');
  assert.equal(site.elements.get('draft-status').textContent, status);
  assert.ok(site.elements.get('draft-copy').value.endsWith('The replacement enquiry.'));
});

test('whitespace-only name and message do not produce a prepared draft', async () => {
  const site = createSite('#enquiries');
  site.elements.get('enquiry-name').value = '   ';
  site.elements.get('enquiry-message').value = '\n\t ';
  await site.elements.get('enquiry-form').dispatch('submit', { preventDefault() {} });
  assert.notEqual(site.elements.get('enquiry-name').customError, '');
  assert.notEqual(site.elements.get('enquiry-message').customError, '');
  assert.equal(site.elements.get('draft-actions').hidden, true);
});

test('no-JS menu trigger starts hidden and local dependencies exist', () => {
  const html = fs.readFileSync(path.join(servedDirectory, 'index.html'), 'utf8');
  assert.match(html, /<button\b[^>]*\bid="menu-open"[^>]*\bhidden(?:\s|>)/);
  assert.match(html, /<noscript>[\s\S]*mailto:enquiries@snuaekerhead\.ae[\s\S]*<\/noscript>/);
  for (const match of html.matchAll(/<(?:img|script|image|source|link)\b[^>]*\b(?:src|href)="([^"#]+)"/g)) {
    assert.ok(fs.existsSync(path.join(servedDirectory, match[1])), 'Missing dependency: ' + match[1]);
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
