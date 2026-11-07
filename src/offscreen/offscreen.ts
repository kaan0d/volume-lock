// Tab capture, the last resort for boosting what in-page code can't reach. Captured tab audio stops reaching the speakers, so it is always played back here.
import {
  CAPTURE_PORT,
  type CaptureGain,
  type CaptureStarted,
  type CaptureStop,
  type CaptureRequest,
  type CaptureClosed,
} from '../lib/messages';

type Capture = { stream: MediaStream; ctx: AudioContext; gain: GainNode; override: boolean; gen?: number };

/** Keyed by tab id; -1 when the popup didn't say which tab. */
const captures = new Map<number, Capture>();

/** Test-only source: a 440 Hz tone as a MediaStream, so the same capture path runs without tabCapture. */
function oscillatorStream(ctx: AudioContext): MediaStream {
  const osc = ctx.createOscillator();
  const out = ctx.createMediaStreamDestination();
  osc.connect(out);
  osc.start();
  return out.stream;
}

async function start(msg: CaptureRequest, id: number): Promise<Capture> {
  const ctx = new AudioContext();
  let stream: MediaStream;
  try {
    if ('oscillator' in msg) stream = oscillatorStream(ctx);
    else {
      // Chrome-only constraint shape for tab capture
      const audio = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId } } as MediaTrackConstraints;
      stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    }
  } catch (e) {
    void ctx.close().catch(() => {});
    throw e;
  }
  const gain = ctx.createGain();
  gain.gain.value = msg.gain ?? 1;
  ctx.createMediaStreamSource(stream).connect(gain).connect(ctx.destination);
  void ctx.resume().catch(() => {});
  const c: Capture = { stream, ctx, gain, override: msg.gain !== undefined, gen: msg.gen };
  captures.get(id) && stop(id); // a leftover capture of the same tab
  captures.set(id, c);
  stream.getTracks().forEach((t) => t.addEventListener('ended', () => captures.get(id) === c && stop(id))); // tab closed
  if (c.override) void chrome.runtime.sendMessage({ type: 'capture-started', tabId: id } satisfies CaptureStarted).catch(() => {});
  return c;
}

function stop(id: number) {
  const c = captures.get(id);
  if (!c) return;
  captures.delete(id);
  c.stream.getTracks().forEach((t) => t.stop());
  void c.ctx.close().catch(() => {});
  const msg: CaptureClosed = { type: 'capture-closed', tabId: id < 0 ? undefined : id, remaining: captures.size, gen: c.gen };
  void chrome.runtime.sendMessage(msg).catch(() => {});
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CAPTURE_PORT) return;
  let started = false;
  port.onMessage.addListener(async (msg: CaptureRequest) => {
    if (started) return;
    started = true;
    const id = msg.tabId ?? -1;
    try {
      await start(msg, id);
    } catch {
      port.disconnect(); // the popup sees the port drop
      if (!captures.size) void chrome.runtime.sendMessage({ type: 'capture-closed', remaining: 0, gen: msg.gen } satisfies CaptureClosed).catch(() => {});
      return;
    }
    port.postMessage('started'); // an override capture outlives the popup, so there is nothing to keep open
  });
});

chrome.runtime.onMessage.addListener((msg: CaptureGain | CaptureStop, _sender, reply) => {
  if (msg?.type === 'capture-gain') {
    const c = captures.get(msg.tabId);
    if (c?.override) c.gain.gain.value = msg.gain;
  } else if (msg?.type === 'capture-stop') {
    reply(captures.has(msg.tabId));
    stop(msg.tabId);
  }
});
