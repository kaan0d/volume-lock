// Popup side of tab capture, used only when the tab has media that nothing but capture can boost.
// The capture is an override: gain applied, tab output replaced, and it outlives the popup. It
// runs in the offscreen document, so the tab's audio keeps playing when the popup closes.
import { CAPTURE_PORT, type CaptureClosed, type CaptureOpen, type CaptureOpenReply, type CaptureRequest } from '../lib/messages';

/** Starts (or joins) the override capture of `tabId`. A failure (chrome:// page, no permission) leaves the tab as it was. */
export async function startCapture(tabId: number): Promise<void> {
  let gen: number | undefined;
  try {
    const reply = await chrome.runtime.sendMessage<CaptureOpen, CaptureOpenReply>({ type: 'capture-open', tabId });
    if (!reply || reply.attach) return; // not needed, or already running
    gen = reply.gen;
    // test-only seam: a synthetic tone instead of tab capture, which needs a real toolbar click
    const source = new URLSearchParams(location.search).has('captureTest')
      ? { oscillator: true as const }
      : { streamId: await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }) };
    const port = chrome.runtime.connect({ name: CAPTURE_PORT });
    port.onMessage.addListener(() => port.disconnect()); // 'started': nothing more to say, the capture goes on
    const msg: CaptureRequest = { ...source, tabId, gain: reply.gain, gen };
    port.postMessage(msg);
  } catch {
    const msg: CaptureClosed = { type: 'capture-closed', gen }; // no port was opened, so close the document here
    void chrome.runtime.sendMessage(msg).catch(() => {});
  }
}
