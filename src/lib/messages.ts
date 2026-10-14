/** popup -> content (live preview while dragging the fader, not saved) */
export type SetVolume = { type: 'set-volume'; volume: number };
/** popup -> content: ask what the page currently plays at */
export type GetState = { type: 'get-state' };
export type StateReply = { volume: number; hasMedia: boolean };
/** content -> background/popup: the page volume changed */
export type VolumeChanged = { type: 'volume-changed'; volume: number };

export type Message = SetVolume | GetState | VolumeChanged;

// ---------- visualizer ----------

/** popup -> background: (re)create the offscreen document; replies once it is ready. */
export type VizStart = { type: 'viz-start' };
/** offscreen -> background: capture ended, close the offscreen document. */
export type VizStopped = { type: 'viz-stopped' };
/** Port name for popup <-> offscreen. */
export const VIZ_PORT = 'viz';
/** popup -> offscreen, first port message: capture this stream id, or `oscillator` (test-only synthetic source). */
export type VizCapture = { streamId: string } | { oscillator: true };
/** offscreen -> popup, ~30 fps: one level per bar, 0..255. */
export type VizLevels = number[];
