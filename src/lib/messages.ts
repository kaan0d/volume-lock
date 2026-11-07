/** popup -> content (live preview while dragging the fader, not saved) */
export type SetVolume = { type: 'set-volume'; volume: number };
/** popup -> content: ask what the page currently plays at */
export type GetState = { type: 'get-state' };
/** `idle`: boost or effects are wanted but the page audio is not routed yet (Chrome waits for a click). */
/** `needsCapture`: media here can only be boosted through tab capture. */
export type StateReply = { volume: number; idle?: boolean; needsCapture?: boolean; media?: boolean };

export type Message = SetVolume | GetState;

/** content (top frame) -> background: remember this tab's own level across reloads (`volume` null forgets it); without `volume` it only asks. Replies with the stored level. */
export type TabLevel = { type: 'tab-level'; volume?: number | null };
export type TabLevelReply = { volume: number | null };
/** Alarm name prefix of a timed mute; the tab id follows. */
export const UNMUTE_ALARM = 'unmute:';

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
/** popup -> background: drop the tab's capture and boost state (the popup then reloads the tab). */
export type ResetTab = { type: 'reset-tab'; tabId: number };
/** background -> offscreen: stop the tab's capture (tab closed or changed origin). */
export type CaptureStop = { type: 'capture-stop'; tabId: number };

// ---------- capture fallback ----------

/** popup -> background: a tab with media only capture can boost is open; make sure the offscreen document exists. */
export type CaptureOpen = { type: 'capture-open'; tabId?: number };
/**
 * false: nothing to do (the tab does not need capture). `attach`: the tab is already captured, nothing to start.
 * `gain`: start the capture as an override (tab output replaced by the stream at this gain, survives the popup).
 * `gen`: counts opens; a close from an older one can't close the document a newer one uses.
 */
export type CaptureOpenReply = false | { attach: boolean; gain?: number; gen: number };
/** offscreen -> background: a capture ended; `remaining` 0 closes the document. Also popup -> background when no port was opened. */
export type CaptureClosed = { type: 'capture-closed'; tabId?: number; remaining?: number; gen?: number };
/** Port name for popup <-> offscreen. */
export const CAPTURE_PORT = 'capture';
/**
 * popup -> offscreen, first port message: capture this stream id, or `oscillator` (test-only synthetic
 * source), as an override at `gain`. The offscreen document answers 'started'.
 */
export type CaptureRequest = ({ streamId: string } | { oscillator: true }) & { tabId?: number; gain?: number; gen?: number };
