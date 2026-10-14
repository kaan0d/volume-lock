/** popup -> content (live preview while dragging the fader, not saved) */
export type SetVolume = { type: 'set-volume'; volume: number };
/** popup -> content: ask what the page currently plays at */
export type GetState = { type: 'get-state' };
export type StateReply = { volume: number; hasMedia: boolean };
/** content -> background/popup: the page volume changed */
export type VolumeChanged = { type: 'volume-changed'; volume: number };

export type Message = SetVolume | GetState | VolumeChanged;
