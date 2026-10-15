// Popup side of tab capture. Capture and analysis run in the offscreen document, so the tab's
// audio is untouched when the popup closes. When the tab has media only capture can boost, the
// capture is an override instead: gain applied, tab output replaced, and it outlives the popup.
import { VIZ_PORT, type VizCapture, type VizLevels, type VizStart, type VizStartReply, type VizStopped } from '../lib/messages';

/**
 * Streams the tab's levels (24 numbers, 0..255, ~30 fps) to `onLevels`. On failure or when the
 * capture ends (chrome:// page, no permission, tab closed) `onLevels([])` is called once: show idle.
 * Returns a stop function; calling it (or closing the popup) ends a visualizer-only capture.
 */
export function connectAudio(tabId: number, onLevels: (levels: number[]) => void): () => void {
  let port: chrome.runtime.Port | undefined;
  let stopped = false;
  let idle = false;
  let gen: number | undefined;
  const end = () => !idle && !stopped && ((idle = true), onLevels([]));

  void (async () => {
    try {
      const reply = await chrome.runtime.sendMessage<VizStart, VizStartReply>({ type: 'viz-start', tabId });
      if (!reply) return end();
      gen = reply.gen;
      // test-only seam: a synthetic tone instead of tab capture, which needs a real toolbar click
      const synthetic = new URLSearchParams(location.search).has('vizTest');
      const source = reply.attach
        ? { attach: true as const }
        : synthetic
          ? { oscillator: true as const }
          : { streamId: await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }) };
      if (stopped) throw new Error('stopped');
      const msg: VizCapture = { ...source, tabId, gain: reply.gain, gen };
      port = chrome.runtime.connect({ name: VIZ_PORT });
      port.onMessage.addListener((levels: VizLevels) => !stopped && onLevels(levels));
      port.onDisconnect.addListener(end);
      port.postMessage(msg);
    } catch {
      end();
      const msg: VizStopped = { type: 'viz-stopped', gen }; // no port was opened, so close the document here
      void chrome.runtime.sendMessage(msg).catch(() => {});
    }
  })();

  return () => {
    stopped = true;
    port?.disconnect();
  };
}
