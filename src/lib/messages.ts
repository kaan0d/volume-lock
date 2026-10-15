/** popup -> content (live preview while dragging the fader, not saved) */
export type SetVolume = { type: 'set-volume'; volume: number };
/** popup -> content: ask what the page currently plays at */
export type GetState = { type: 'get-state' };
export type StateReply = { volume: number; hasMedia: boolean };

export type Message = SetVolume | GetState;

// ---------- capture fallback ----------

/** content -> background: this frame has media only tab capture can boost (another origin without CORS, DRM). */
export type NeedsCapture = { type: 'needs-capture' };
/** content -> background: level changed while it is above 100 or the tab is captured. */
export type LevelChanged = { type: 'level'; volume: number | null };
/** background -> content, reply to LevelChanged: whether tab capture applies the boost. */
export type LevelReply = { captured: boolean };
/** background -> content (all frames): capture started or ended; in-page caps at 100 while active. */
export type CaptureState = { type: 'capture-state'; active: boolean };
/** offscreen -> background: an override capture (with gain) is running for this tab. */
export type CaptureStarted = { type: 'capture-started'; tabId: number };
/** background -> offscreen: new gain for a tab's override capture. */
export type CaptureGain = { type: 'capture-gain'; tabId: number; gain: number };
/** background -> offscreen: stop the tab's capture (tab closed or changed origin). */
export type CaptureStop = { type: 'capture-stop'; tabId: number };

// ---------- visualizer ----------

/** popup -> background: make sure the offscreen document exists; replies once it is ready. */
export type VizStart = { type: 'viz-start'; tabId?: number };
/**
 * false: no offscreen document. `attach`: the tab is already captured, join it instead of capturing.
 * `gain`: start the capture as an override (tab output replaced by the stream at this gain, survives the popup).
 */
export type VizStartReply = false | { attach: boolean; gain?: number };
/** offscreen -> background: a capture ended; `remaining` 0 closes the document. Also popup -> background when no port was opened. */
export type VizStopped = { type: 'viz-stopped'; tabId?: number; remaining?: number };
/** Port name for popup <-> offscreen. */
export const VIZ_PORT = 'viz';
/**
 * popup -> offscreen, first port message: capture this stream id, `oscillator` (test-only synthetic
 * source), or `attach` to a running capture of `tabId`. With `gain` the capture is an override.
 */
export type VizCapture = ({ streamId: string } | { oscillator: true } | { attach: true }) & { tabId?: number; gain?: number };
/** offscreen -> popup, ~30 fps: one level per bar, 0..255. */
export type VizLevels = number[];
