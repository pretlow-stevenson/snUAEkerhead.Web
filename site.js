'use strict';

const ENQUIRY_ADDRESS = 'enquiries@snuaekerhead.ae';
const enquiryTopics = new Set(['General enquiry', 'Collaboration', 'Press']);

function wellFormedText(value) {
  return Array.from(String(value), character => {
    const code = character.charCodeAt(0);
    return character.length === 1 && code >= 0xD800 && code <= 0xDFFF ? '\uFFFD' : character;
  }).join('');
}

function buildEnquiryDraft(name, email, topic, message) {
  const subject = 'snUAEkerhead — ' + (enquiryTopics.has(topic) ? topic : 'General enquiry');
  const body = wellFormedText('Name: ' + name + '\r\nReply email: ' + email + '\r\n\r\n' + message.replace(/\r\n?|\n/g, '\r\n'));
  const base = 'mailto:' + ENQUIRY_ADDRESS + '?subject=' + encodeURIComponent(subject);
  const full = base + '&body=' + encodeURIComponent(body);
  // Long messages stay available in full without relying on email-client URL limits.
  const needsCopy = full.length > 1800;
  return { body, href: needsCopy ? base : full, needsCopy };
}

const menu = document.getElementById('site-menu');
const openButton = document.getElementById('menu-open');
const closeButton = document.getElementById('menu-close');
const backLink = document.getElementById('panel-back');
const panelBrand = document.getElementById('panel-brand');
const panelScroll = menu.querySelector('.panel-scroll');
const panes = Array.from(menu.querySelectorAll('[data-pane]'));
const routes = new Set(panes.map(pane => pane.dataset.pane));
const motionButton = document.getElementById('motion-toggle');
const motionLabel = document.getElementById('motion-label');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let activeRoute = null;
let returnFocus = openButton;
let viewRevision = 0;
let motionPaused = false;

function updateMotion() {
  const isPlaying = !motionPaused && !reducedMotion.matches && !document.hidden && !menu.open;
  document.body.dataset.motion = isPlaying ? 'playing' : 'paused';
  motionButton.hidden = reducedMotion.matches;
  motionLabel.textContent = motionPaused ? 'Resume motion' : 'Pause motion';
}

motionButton.addEventListener('click', () => {
  motionPaused = !motionPaused;
  updateMotion();
});
reducedMotion.addEventListener('change', updateMotion);
document.addEventListener('visibilitychange', updateMotion);

function renderRoute() {
  let route = location.hash.slice(1);
  if (route === 'by-invitation') {
    route = 'exploration';
    history.replaceState(null, '', location.pathname + location.search + '#exploration');
  }
  if (!routes.has(route)) {
    if (activeRoute !== null) viewRevision += 1;
    activeRoute = null;
    if (menu.open) menu.close();
    updateMotion();
    return;
  }
  if (route === activeRoute && menu.open) return;
  viewRevision += 1;
  activeRoute = route;
  panes.forEach(pane => { pane.hidden = pane.dataset.pane !== route; });
  const isMenu = route === 'menu';
  backLink.hidden = isMenu;
  panelBrand.hidden = !isMenu;
  menu.dataset.view = route;
  menu.setAttribute('aria-labelledby', isMenu ? 'menu-title' : route + '-title');
  if (!menu.open) {
    const origin = document.activeElement;
    returnFocus = origin && origin !== document.body && !menu.contains(origin) ? origin : openButton;
    menu.showModal();
  }
  document.body.classList.add('menu-is-open');
  openButton.setAttribute('aria-expanded', 'true');
  panelScroll.scrollTop = 0;
  const focusTarget = document.getElementById(isMenu ? 'menu-title' : route + '-title');
  focusTarget.focus({ preventScroll: true });
  updateMotion();
}

function dismissMenu() {
  history.replaceState(null, '', location.pathname + location.search);
  renderRoute();
}

openButton.addEventListener('click', () => {
  if (location.hash === '#menu') renderRoute();
  else location.hash = 'menu';
});
closeButton.addEventListener('click', dismissMenu);
menu.addEventListener('cancel', event => { event.preventDefault(); dismissMenu(); });
menu.addEventListener('close', () => {
  // A queued close event must not undo a newly reopened dialog.
  if (menu.open) return;
  viewRevision += 1;
  activeRoute = null;
  document.body.classList.remove('menu-is-open');
  openButton.setAttribute('aria-expanded', 'false');
  (returnFocus.isConnected ? returnFocus : openButton).focus({ preventScroll: true });
  updateMotion();
});
menu.addEventListener('click', event => {
  if (event.target !== menu) return;
  const bounds = menu.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismissMenu();
});
window.addEventListener('hashchange', renderRoute);

const enquiryForm = document.getElementById('enquiry-form');
const prepareButton = document.getElementById('prepare-enquiry');
const draftActions = document.getElementById('draft-actions');
const draftStatus = document.getElementById('draft-status');
const draftLink = document.getElementById('draft-link');
const draftCopy = document.getElementById('draft-copy');
const copyButton = document.getElementById('copy-enquiry');
const nameInput = document.getElementById('enquiry-name');
const messageInput = document.getElementById('enquiry-message');
const copyAddressButton = document.getElementById('copy-address');
const addressStatus = document.getElementById('address-status');
const addressCopy = document.getElementById('address-copy');
let preparedBody = '';
let draftRevision = 0;
let enquiryCopyAttempt = 0;
let addressCopyAttempt = 0;

enquiryForm.addEventListener('input', () => {
  nameInput.setCustomValidity('');
  messageInput.setCustomValidity('');
  draftRevision += 1;
  preparedBody = '';
  draftActions.hidden = true;
  draftCopy.hidden = true;
  draftCopy.value = '';
  draftLink.removeAttribute('href');
  prepareButton.hidden = false;
  copyButton.textContent = 'Copy enquiry';
});

enquiryForm.addEventListener('submit', event => {
  event.preventDefault();
  nameInput.setCustomValidity(nameInput.value.trim() ? '' : 'Please enter your name.');
  messageInput.setCustomValidity(messageInput.value.trim() ? '' : 'Please enter a message.');
  if (!enquiryForm.reportValidity()) return;
  const fields = new FormData(enquiryForm);
  const draft = buildEnquiryDraft(fields.get('name').trim(), fields.get('email').trim(), fields.get('type'), fields.get('message').trim());
  draftRevision += 1;
  preparedBody = draft.body;
  draftLink.href = draft.href;
  draftCopy.value = draft.body;
  draftActions.hidden = false;
  prepareButton.hidden = true;
  draftStatus.textContent = draft.needsCopy
    ? 'Copy your enquiry, open the email draft, and paste the message before sending.'
    : 'Your draft is ready. Open it in your email app to send your enquiry.';
  draftLink.focus();
});

copyButton.addEventListener('click', async () => {
  const bodyToCopy = preparedBody;
  const revision = draftRevision;
  if (!bodyToCopy) return;
  const view = viewRevision;
  const attempt = ++enquiryCopyAttempt;
  // Clipboard permissions can resolve after the visitor has changed views.
  const isCurrent = () => view === viewRevision && attempt === enquiryCopyAttempt && menu.open && activeRoute === 'enquiries' && revision === draftRevision && !draftActions.hidden;
  try {
    await navigator.clipboard.writeText(bodyToCopy);
    if (!isCurrent()) return;
    copyButton.textContent = 'Copied';
    draftStatus.textContent = 'Enquiry copied. Paste it into your email draft before sending.';
  } catch {
    if (!isCurrent()) return;
    draftCopy.hidden = false;
    if (document.activeElement === copyButton) {
      draftCopy.focus();
      draftCopy.select();
    }
    draftStatus.textContent = 'Select and copy the enquiry below, then paste it into your email draft.';
  }
});

copyAddressButton.addEventListener('click', async () => {
  const view = viewRevision;
  const attempt = ++addressCopyAttempt;
  const isCurrent = () => view === viewRevision && attempt === addressCopyAttempt && menu.open && activeRoute === 'enquiries';
  try {
    await navigator.clipboard.writeText(ENQUIRY_ADDRESS);
    if (!isCurrent()) return;
    addressCopy.hidden = true;
    addressStatus.textContent = 'Email address copied.';
  } catch {
    if (!isCurrent()) return;
    addressCopy.hidden = false;
    if (document.activeElement === copyAddressButton) {
      addressCopy.focus();
      addressCopy.select();
    }
    addressStatus.textContent = 'Select and copy the email address below.';
  }
  addressStatus.hidden = false;
});

// Reveal the trigger only once the complete interactive path is ready.
openButton.hidden = false;
renderRoute();
