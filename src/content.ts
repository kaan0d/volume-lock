// Isolated-world half of the override: resolves this frame's level from storage and pushes it to
// the MAIN-world script (inject.ts), which applies it. Also answers the popup and reports media
// only tab capture can boost.
import { originOf } from './lib/origin';
import { clampVolume, emptySettings, resolveVolume } from './lib/rules';
import { loadSettings, onSettingsChanged } from './lib/storage';
import type { CaptureState, LevelChanged, LevelReply, Message, NeedsCapture, StateReply } from './lib/messages';

// Iframes follow the tab's site, so an embedded player matches the page around it.
const ancestors = location.ancestorOrigins;
const siteOrigin = originOf(ancestors?.length ? ancestors[ancestors.length - 1] : location.href);

let settings = emptySettings();
let preview: number | null = null; // set-volume override until reload or settings change
let level: number | null = null; // percent; null = leave media alone
let captured = false; // tab capture applies the boost, so in-page stays at 100 or below

// ---------- private channel to the MAIN world ----------
// Both scripts run at document_start before any page script, in either order: each side announces
// itself and the key is handed over once. Events on the key's name are invisible to a page that
// doesn't know it, and MAIN stops listening for keys after the first.

const key = crypto.randomUUID();
const toMain = (data: unknown) => window.dispatchEvent(new CustomEvent(key, { detail: JSON.stringify(data) }));
const sendKey = () => window.dispatchEvent(new CustomEvent('svs:key', { detail: key }));
let probeReply: unknown;
let resolved = false; // nothing is sent until storage answered, so MAIN keeps holding instead of passing through
const push = (sync = false) => resolved && toMain({ level: level === null || !captured ? level : Math.min(level, 100), sync });

window.addEventListener('svs:hello', sendKey);
window.addEventListener(key + ':up', (e) => {
  const msg = JSON.parse((e as CustomEvent<string>).detail);
  if (msg.ready) {
    window.removeEventListener('svs:hello', sendKey);
    push();
  }
  if (msg.needsCapture) void chrome.runtime.sendMessage({ type: 'needs-capture' } satisfies NeedsCapture).catch(() => {});
  if (msg.probe) probeReply = msg.probe;
});
// After an extension update this copy is orphaned (no runtime) and the new copy's key arrives here:
// the MAIN script, which can't be replaced in a running page, switches to it. A page can't trigger this.
window.addEventListener('svs:key', (e) => {
  if (!chrome.runtime?.id) toMain({ rekey: (e as CustomEvent<string>).detail });
});
sendKey();

/** Test seam: MAIN's view of every tracked element and master gain (only reachable from the extension). */
(globalThis as unknown as { svsProbe: () => unknown }).svsProbe = () => {
  toMain({ probe: true }); // MAIN answers synchronously
  return probeReply;
};

// ---------- level ----------

async function reportLevel() {
  // The background only cares while capture boosts this tab, or might start to.
  if (!captured && (level === null || level <= 100)) return;
  const msg: LevelChanged = { type: 'level', volume: level };
  const reply = await chrome.runtime.sendMessage<LevelChanged, LevelReply>(msg).catch(() => null);
  if (reply && reply.captured !== captured) {
    captured = reply.captured;
    push();
  }
}

function update(sync = false) {
  resolved = true;
  level = preview ?? (siteOrigin ? (resolveVolume(settings, siteOrigin)?.volume ?? null) : null);
  push(sync);
  void reportLevel();
}

function state(): StateReply {
  const first = document.querySelector<HTMLMediaElement>('video, audio');
  // this world sees the real element volume, which equals the page's own value when we leave it alone
  return { volume: level ?? Math.round((first?.volume ?? 1) * 100) };
}

chrome.runtime.onMessage.addListener((msg: Message | CaptureState, _sender, reply) => {
  if (msg.type === 'set-volume') {
    preview = clampVolume(msg.volume, settings.boostEnabled);
    update(true);
  } else if (msg.type === 'get-state' && window === window.top) {
    reply(state()); // only the top frame answers, so the reply is the page's
  } else if (msg.type === 'capture-state') {
    captured = msg.active;
    push();
  }
});

onSettingsChanged((s) => {
  settings = s;
  preview = null;
  update();
});
// Always answer, even when storage fails: an explicit "no level" lets MAIN pass through at once
// instead of holding the page silent until its 1.5 s fallback.
void loadSettings()
  .then((s) => void (settings = s))
  .catch(() => {})
  .finally(update);
