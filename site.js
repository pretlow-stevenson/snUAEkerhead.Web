'use strict';

const ENQUIRY_ADDRESS = 'enquiries@snuaekerhead.ae';
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

const copyAddressButton = document.getElementById('copy-address');
const addressStatus = document.getElementById('address-status');
const addressCopy = document.getElementById('address-copy');
let addressCopyAttempt = 0;

copyAddressButton.addEventListener('click', async () => {
  const view = viewRevision;
  const attempt = ++addressCopyAttempt;
  // Ignore clipboard permission responses after navigation or a newer request.
  const isCurrent = () => view === viewRevision && attempt === addressCopyAttempt && menu.open && activeRoute === 'enquiries';
  try {
    await navigator.clipboard.writeText(ENQUIRY_ADDRESS);
    if (!isCurrent()) return;
    copyAddressButton.textContent = 'Copied';
    addressCopy.hidden = true;
    addressStatus.textContent = 'Email address copied.';
  } catch {
    if (!isCurrent()) return;
    copyAddressButton.textContent = 'Copy address';
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
