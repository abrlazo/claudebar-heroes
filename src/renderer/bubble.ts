// The floating bubble's page. No React, no game engine, no app state: it only draws the badge main sends and reports
// press / release / right-click. Main decides what a gesture means (click, drag, menu). The page has no access to the
// app's `window.bar`; its own preload (src/main/bubble-preload.js) exposes just these four functions.
import './styles/bubble.css';

const BADGES = ['ask', 'failed', 'done', 'running', 'none'];
const LABEL = /^(\d|9\+)?$/;

const bubbleEl = document.getElementById('bubble') as HTMLElement;
const badgeEl = document.getElementById('badge') as HTMLElement;
const api = window.bubble;

let pressed = false;
const release = () => {
  if (!pressed) return;
  pressed = false;
  api?.release();
};

bubbleEl.addEventListener('pointerdown', (e) => {
  // The primary button only; a ctrl-click (the macOS right-click) comes as a contextmenu instead.
  if (e.button !== 0 || e.ctrlKey || pressed) return;
  pressed = true;
  try { bubbleEl.setPointerCapture(e.pointerId); } catch { /* the release events below still end the gesture */ }
  api?.press();
});
bubbleEl.addEventListener('pointerup', release);
bubbleEl.addEventListener('pointercancel', release);
bubbleEl.addEventListener('lostpointercapture', release);
bubbleEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  pressed = false; // main cancels any gesture in progress
  api?.menu();
});
bubbleEl.addEventListener('dragstart', (e) => e.preventDefault());

// Everything from main is checked before it touches the page.
api?.onState((state) => {
  if (!state || typeof state !== 'object') return;
  const { badge, label, theme } = state as { badge?: unknown; label?: unknown; theme?: unknown };
  if (typeof badge !== 'string' || !BADGES.includes(badge)) return;
  if (typeof label !== 'string' || !LABEL.test(label)) return;
  const t = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = t;
  document.body.className = `theme-${t}`;
  bubbleEl.dataset.badge = badge;
  badgeEl.textContent = label;
  badgeEl.hidden = badge === 'none' || badge === 'running';
  bubbleEl.setAttribute('aria-label', badge === 'ask' ? 'Open Claudebar Heroes: waiting for your OK'
    : badge === 'failed' ? 'Open Claudebar Heroes: something failed'
    : badge === 'done' ? 'Open Claudebar Heroes: work finished'
    : badge === 'running' ? 'Open Claudebar Heroes: working' : 'Open Claudebar Heroes');
});
