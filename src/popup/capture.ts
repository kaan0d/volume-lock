// Placeholder wrapping the old visualizer handshake; replaced by the override agent's version.
import { VIZ_PORT, type VizCapture, type VizLevels, type VizStart, type VizStopped } from '../lib/messages';

export function connectAudio(tabId: number, onLevels: (levels: number[]) => void): () => void {
  let port: chrome.runtime.Port | undefined;
  let stopped = false;
  void (async () => {
    try {
      const synthetic = new URLSearchParams(location.search).has('vizTest');
      const start: VizStart = { type: 'viz-start' };
      if (!(await chrome.runtime.sendMessage(start)) || stopped) return;
      const msg: VizCapture = synthetic ? { oscillator: true } : { streamId: await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }) };
      port = chrome.runtime.connect({ name: VIZ_PORT });
      port.onMessage.addListener((l: VizLevels) => onLevels(l));
      port.postMessage(msg);
    } catch {
      const s: VizStopped = { type: 'viz-stopped' };
      void chrome.runtime.sendMessage(s).catch(() => {});
    }
  })();
  return () => { stopped = true; port?.disconnect(); };
}
