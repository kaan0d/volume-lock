import { VIZ_PORT, type VizCapture, type VizStopped } from '../lib/messages';

const BARS = 24;
const FPS = 30;

/** Test-only source: a 440 Hz tone as a MediaStream, so the same capture path runs without tabCapture. */
function oscillatorStream(): MediaStream {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const out = ctx.createMediaStreamDestination();
  osc.connect(out);
  osc.start();
  return out.stream;
}

function capture(msg: VizCapture): Promise<MediaStream> {
  if ('oscillator' in msg) return Promise.resolve(oscillatorStream());
  // Chrome-only constraint shape for tab capture
  const audio = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId } } as MediaTrackConstraints;
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
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
  let stream: MediaStream | undefined;
  let ctx: AudioContext | undefined;
  let timer = 0;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
    const msg: VizStopped = { type: 'viz-stopped' };
    void chrome.runtime.sendMessage(msg).catch(() => {});
  };
  const fail = () => {
    port.disconnect(); // popup falls back to idle bars
    stop();
  };
  port.onDisconnect.addListener(stop);

  port.onMessage.addListener(async (msg: VizCapture) => {
    if (stream || stopped) return;
    try {
      stream = await capture(msg);
    } catch {
      return fail();
    }
    if (stopped) return void stream.getTracks().forEach((t) => t.stop()); // popup closed while capture started
    stream.getTracks().forEach((t) => t.addEventListener('ended', fail)); // tab closed
    ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    // Captured tab audio stops reaching the speakers unless played back here; gain 1 so boost is not doubled.
    source.connect(ctx.destination);
    void ctx.resume().catch(() => {});
    const data = new Uint8Array(analyser.frequencyBinCount);
    timer = setInterval(() => {
      analyser.getByteFrequencyData(data);
      port.postMessage(levels(data));
    }, 1000 / FPS) as unknown as number;
  });
});
