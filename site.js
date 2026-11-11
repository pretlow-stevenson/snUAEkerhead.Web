'use strict';

const menu = document.getElementById('site-menu');
const openButton = document.getElementById('menu-open');
const closeButton = document.getElementById('menu-close');
const backLink = document.getElementById('panel-back');
const panelScroll = menu.querySelector('.panel-scroll');
const panes = Array.from(menu.querySelectorAll('[data-pane]'));
const routes = new Set(panes.map(pane => pane.dataset.pane));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let activeRoute = null;
let requestedRoute = null;
let returnFocus = openButton;
let viewRevision = 0;
let panelTransition = null;
let contentTransition = null;

function canAnimate() {
  return !reducedMotion.matches && !document.hidden;
}

function updateMotion() {
  const isPlaying = canAnimate() && !menu.open;
  document.body.dataset.motion = isPlaying ? 'playing' : 'paused';
}

function cancelPanelTransition() {
  if (!panelTransition) return;
  clearTimeout(panelTransition.timeout);
  menu.removeEventListener('transitionend', panelTransition.listener);
  panelTransition = null;
}

function waitForPanel(phase, complete) {
  cancelPanelTransition();
  menu.dataset.phase = phase;
  if (!canAnimate()) {
    complete();
    return;
  }
  const transition = {};
  const finish = () => {
    if (panelTransition !== transition) return;
    cancelPanelTransition();
    complete();
  };
  transition.listener = event => {
    if (event.target === menu && event.propertyName === 'transform') finish();
  };
  // The fallback also covers a disabled transition or a browser missing its end event.
  transition.timeout = setTimeout(finish, phase === 'closing' ? 460 : 600);
  panelTransition = transition;
  menu.addEventListener('transitionend', transition.listener);
}

function cancelContentTransition() {
  const previous = contentTransition;
  contentTransition = null;
  if (previous) previous.animation.cancel();
  menu.dataset.contentPhase = 'idle';
  panelScroll.inert = false;
  panelScroll.removeAttribute('aria-busy');
}

function focusRoute(route, previousFocus) {
  const currentFocus = document.activeElement;
  // A visitor can move to the persistent header while content is fading out.
  const movedToHeader = previousFocus && currentFocus !== previousFocus &&
    [closeButton, backLink].includes(currentFocus) && currentFocus.isConnected && !currentFocus.hidden;
  if (movedToHeader) return;
  document.getElementById(route === 'menu' ? 'menu-title' : route + '-title').focus({ preventScroll: true });
}

function showRoute(route) {
  activeRoute = route;
  panes.forEach(pane => { pane.hidden = pane.dataset.pane !== route; });
  const isMenu = route === 'menu';
  backLink.hidden = isMenu;
  menu.dataset.view = route;
  menu.setAttribute('aria-labelledby', isMenu ? 'menu-title' : route + '-title');
  panelScroll.scrollTop = 0;
}

function transitionRoute(route) {
  const previousFocus = document.activeElement;
  const previousStyle = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(panelScroll) : null;
  const from = { opacity: previousStyle ? previousStyle.opacity : '1', transform: previousStyle ? previousStyle.transform : 'none' };
  cancelContentTransition();
  if (!canAnimate() || typeof panelScroll.animate !== 'function' || activeRoute === route) {
    showRoute(route);
    focusRoute(route);
    return;
  }
  const revision = viewRevision;
  const leaving = panelScroll.animate([from, { opacity: 0, transform: 'translateY(-5px)' }], {
    duration: 160, easing: 'ease-in', fill: 'both'
  });
  contentTransition = { animation: leaving, route, previousFocus };
  menu.dataset.contentPhase = 'leaving';
  panelScroll.inert = true;
  panelScroll.setAttribute('aria-busy', 'true');
  leaving.finished.then(() => {
    if (!contentTransition || contentTransition.animation !== leaving || revision !== viewRevision || requestedRoute !== route || !menu.open) return;
    showRoute(route);
    const entering = panelScroll.animate([
      { opacity: 0, transform: 'translateY(7px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
    contentTransition = { animation: entering, route, previousFocus };
    leaving.cancel();
    menu.dataset.contentPhase = 'entering';
    panelScroll.inert = false;
    panelScroll.removeAttribute('aria-busy');
    focusRoute(route, previousFocus);
    entering.finished.then(() => {
      if (contentTransition && contentTransition.animation === entering) cancelContentTransition();
    }, () => {});
  }, () => {});
}

function cleanUpDialog() {
  cancelPanelTransition();
  cancelContentTransition();
  viewRevision += 1;
  requestedRoute = null;
  activeRoute = null;
  menu.dataset.phase = 'closed';
  document.body.classList.remove('menu-is-open');
  openButton.setAttribute('aria-expanded', 'false');
  (returnFocus.isConnected ? returnFocus : openButton).focus({ preventScroll: true });
  updateMotion();
}

function finishClose() {
  if (!menu.open) return;
  menu.close();
  cleanUpDialog();
}

function beginClose() {
  cancelContentTransition();
  if (!menu.open || menu.dataset.phase === 'closing') return;
  // Keep the native modal, scroll lock and background pause until the exit ends.
  waitForPanel('closing', finishClose);
}

function beginOpen() {
  if (!menu.open) {
    const origin = document.activeElement;
    returnFocus = origin && origin !== document.body && !menu.contains(origin) ? origin : openButton;
    menu.dataset.phase = 'closed';
    menu.showModal();
    // Establish the off-screen starting position before the opening transition.
    menu.getBoundingClientRect();
  }
  document.body.classList.add('menu-is-open');
  openButton.setAttribute('aria-expanded', 'true');
  waitForPanel('opening', () => { menu.dataset.phase = 'open'; });
  updateMotion();
}

function settleMotionPreference() {
  if (!canAnimate()) {
    if (contentTransition) {
      const route = requestedRoute;
      const previousFocus = contentTransition.previousFocus;
      cancelContentTransition();
      if (menu.open && routes.has(route) && activeRoute !== route) {
        showRoute(route);
        focusRoute(route, previousFocus);
      }
    }
    if (panelTransition) {
      const isClosing = menu.dataset.phase === 'closing';
      cancelPanelTransition();
      if (isClosing) finishClose();
      else menu.dataset.phase = 'open';
    }
  }
  updateMotion();
}

reducedMotion.addEventListener('change', settleMotionPreference);
document.addEventListener('visibilitychange', settleMotionPreference);

function renderRoute() {
  let route = location.hash.slice(1);
  if (route === 'by-invitation') {
    route = 'exploration';
    history.replaceState(null, '', location.pathname + location.search + '#exploration');
  }
  if (!routes.has(route)) {
    if (requestedRoute !== null) viewRevision += 1;
    requestedRoute = null;
    beginClose();
    updateMotion();
    return;
  }
  if (route === requestedRoute && menu.open && menu.dataset.phase !== 'closing') return;
  viewRevision += 1;
  requestedRoute = route;
  if (!menu.open || menu.dataset.phase === 'closing') {
    cancelContentTransition();
    showRoute(route);
    beginOpen();
    focusRoute(route);
  } else {
    transitionRoute(route);
  }
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
  if (menu.open || activeRoute === null) return;
  cleanUpDialog();
});
menu.addEventListener('click', event => {
  if (event.target !== menu) return;
  const bounds = menu.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismissMenu();
});
window.addEventListener('hashchange', renderRoute);

// Reveal the trigger only once the complete interactive path is ready.
openButton.hidden = false;
renderRoute();
