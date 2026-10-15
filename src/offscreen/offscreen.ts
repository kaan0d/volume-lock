// Tab capture for the popup visualizer and, as a last resort, for boosting what in-page code can't
// reach. Captured tab audio stops reaching the speakers, so it is always played back here.
import {
  VIZ_PORT,
  type CaptureGain,
  type CaptureStarted,
  type CaptureStop,
  type VizCapture,
  type VizStopped,
} from '../lib/messages';

const BARS = 24;
const FPS = 30;

type Capture = { stream: MediaStream; ctx: AudioContext; gain: GainNode; analyser: AnalyserNode; override: boolean; gen?: number };

/** Keyed by tab id; -1 when the popup didn't say which tab (one viz-only capture). */
const captures = new Map<number, Capture>();

/** Test-only source: a 440 Hz tone as a MediaStream, so the same capture path runs without tabCapture. */
function oscillatorStream(ctx: AudioContext): MediaStream {
  const osc = ctx.createOscillator();
  const out = ctx.createMediaStreamDestination();
  osc.connect(out);
  osc.start();
  return out.stream;
}

async function start(msg: VizCapture, id: number): Promise<Capture> {
  const ctx = new AudioContext();
  let stream: MediaStream;
  try {
    if ('oscillator' in msg) stream = oscillatorStream(ctx);
    else if ('streamId' in msg) {
      // Chrome-only constraint shape for tab capture
      const audio = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId } } as MediaTrackConstraints;
      stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } else throw new Error('nothing to attach to');
  } catch (e) {
    void ctx.close().catch(() => {});
    throw e;
  }
  const gain = ctx.createGain();
  gain.gain.value = msg.gain ?? 1; // viz-only: 1, so in-page boost is not doubled
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  ctx.createMediaStreamSource(stream).connect(gain).connect(ctx.destination);
  gain.connect(analyser); // bars show what is heard
  void ctx.resume().catch(() => {});
  const c: Capture = { stream, ctx, gain, analyser, override: msg.gain !== undefined, gen: msg.gen };
  captures.get(id) && stop(id); // a leftover viz capture of the same tab
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
  const msg: VizStopped = { type: 'viz-stopped', tabId: id < 0 ? undefined : id, remaining: captures.size, gen: c.gen };
  void chrome.runtime.sendMessage(msg).catch(() => {});
}

/** Averages frequency bins into `BARS` levels (0..255). */
function levels(data: Uint8Array): number[] {
  const per = data.length / BARS;
  return Array.from({ length: BARS }, (_, i) => {
    const start = Math.floor(i * per);
    const end = Math.max(start + 1, Math.floor((i + 1) * per));
    let sum = 0;
    for (let b = start; b < end; b++) sum += data[b];
    return Math.round(sum / (end - start));
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== VIZ_PORT) return;
  let id = -1;
  let timer = 0;
  let gone = false;
  let started = false;

  // An override capture outlives the popup; a viz-only one ends with it.
  const close = () => {
    gone = true;
    clearInterval(timer);
    if (captures.get(id)?.override === false) stop(id);
  };
  port.onDisconnect.addListener(close);

  port.onMessage.addListener(async (msg: VizCapture) => {
    if (started || gone) return;
    started = true;
    id = msg.tabId ?? -1;
    let c = 'attach' in msg ? captures.get(id) : undefined;
    if (!c) {
      try {
        c = await start(msg, id);
      } catch {
        port.disconnect(); // popup falls back to idle bars
        if (!captures.size) void chrome.runtime.sendMessage({ type: 'viz-stopped', remaining: 0, gen: msg.gen } satisfies VizStopped).catch(() => {});
        return;
      }
      if (gone) return close(); // popup closed while capture started
    }
    const { analyser } = c;
    const data = new Uint8Array(analyser.frequencyBinCount);
    timer = setInterval(() => {
      if (!captures.has(id)) return close(), port.disconnect(); // capture ended under us (tab closed)
      analyser.getByteFrequencyData(data);
      port.postMessage(levels(data));
    }, 1000 / FPS) as unknown as number;
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
