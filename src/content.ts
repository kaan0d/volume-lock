// Applies the resolved volume to every media element in this frame and keeps it there.
import { originOf } from './lib/origin';
import { clampVolume, emptySettings, resolveVolume } from './lib/rules';
import { loadSettings, onSettingsChanged } from './lib/storage';
import type { Message, StateReply } from './lib/messages';

// Iframes follow the tab's site, so an embedded player matches the page around it.
const ancestors = location.ancestorOrigins;
const siteOrigin = originOf(ancestors?.length ? ancestors[ancestors.length - 1] : location.href);

const EVENTS = ['play', 'loadedmetadata', 'volumechange'];

let settings = emptySettings();
let preview: number | null = null; // set-volume override until reload or settings change
let level: number | null = null; // percent; null = leave media alone
let started = false;

const observer = new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) scan(n);
});
const watched = new WeakSet<Node>();
const fights = new WeakMap<HTMLMediaElement, { n: number; since: number }>();

function apply(el: HTMLMediaElement) {
  if (level === null) return;
  const v = Math.min(level, 100) / 100;
  if (el.volume !== v) el.volume = v;
}

function watch(root: Document | ShadowRoot) {
  if (watched.has(root)) return;
  watched.add(root);
  observer.observe(root, { childList: true, subtree: true });
  // media events don't cross shadow boundaries, so the window listener can't see these
  if (root instanceof ShadowRoot) for (const t of EVENTS) root.addEventListener(t, onMediaEvent, true);
}

/** Applies to all media under root, descending into open shadow roots. */
function scan(root: Element | Document | ShadowRoot) {
  const els = root instanceof Element ? [root, ...root.querySelectorAll('*')] : root.querySelectorAll('*');
  for (const el of els) {
    if (el instanceof HTMLMediaElement) apply(el);
    if (el.shadowRoot) {
      watch(el.shadowRoot);
      scan(el.shadowRoot);
    }
  }
}

// At most 5 restores per element per second, so a page that keeps resetting can't spin us.
function mayRestore(el: HTMLMediaElement): boolean {
  const now = performance.now();
  let f = fights.get(el);
  if (!f || now - f.since > 1000) fights.set(el, (f = { n: 0, since: now }));
  return ++f.n <= 5;
}

function onMediaEvent(e: Event) {
  const el = e.target;
  if (!(el instanceof HTMLMediaElement) || level === null) return;
  // our own writes echo back with the value we set, so only a different value is the page's doing
  if (e.type === 'volumechange' && (el.volume === Math.min(level, 100) / 100 || !mayRestore(el))) return;
  apply(el);
}

function start() {
  if (started) return;
  started = true;
  for (const t of EVENTS) window.addEventListener(t, onMediaEvent, true);
  watch(document);
}

function update() {
  level = preview ?? (siteOrigin ? (resolveVolume(settings, siteOrigin)?.volume ?? null) : null);
  if (level !== null) start();
  if (started) scan(document);
}

function state(): StateReply {
  const first = document.querySelector<HTMLMediaElement>('video, audio');
  return { volume: level ?? Math.round((first?.volume ?? 1) * 100), hasMedia: first !== null };
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, reply) => {
  if (msg.type === 'set-volume') {
    preview = clampVolume(msg.volume, settings.boostEnabled);
    update();
  } else if (msg.type === 'get-state' && window === window.top) {
    reply(state()); // only the top frame answers, so the reply is the page's
  }
});

onSettingsChanged((s) => {
  settings = s;
  preview = null;
  update();
});
void loadSettings().then((s) => {
  settings = s;
  update();
});
