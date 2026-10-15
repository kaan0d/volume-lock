# UI overhaul and audio override plan

Complete UI redesign plus a stronger audio override. Behavior from `rebuild-plan.md` stays unless this file says otherwise. Six agents work in parallel, each in its own git worktree and branch, and the branches are merged into `main` in this order: theme, knob, icon, options, override, popup. An integration pass and a docs pass follow.

## Design spec

- **Mood:** glassy modern native. Translucent layers, soft blur, feels like a Chrome or OS panel.
- **Palette:** grayscale glass surfaces plus one signal color, electric blue, used only for the level, the ring and the primary action.
- **Type:** Inter, bundled as local woff2 files (no network fonts, extension CSP).
- **Theme:** System / Light / Dark, System by default, stored in `chrome.storage.local` under `theme`.
- **Motion:** rich. Springy knob, animated number, glow. Use CSS `linear()` spring easing and the Web Animations API, no animation library. With `prefers-reduced-motion`, everything is instant and the ring is static.
- **Density:** balanced, 40px targets.
- **Popup (420px wide):** current site and its source; rotary knob with the visualizer as a ring of 24 radial bars around it; one Save/Saved toggle (saved = click to remove); Mute tab and Mute other tabs; a site menu with "Never touch this site" (exclude) and "Save for *.domain" (wildcard); preset chips 25 / 50 / 100; an inline boost toggle; friendly empty, unreachable and first-run states with a clear next step (e.g. Reload); a gear button that opens the options page; a small GitHub link at the bottom.
- **Options page (full tab):** sections Sites, Rules, Audio, Backup, Appearance. Sites is a table (Site | Type | Level | delete) with sort and filter and inline level edit. Rules = wildcards and the exclude list. Audio = default volume and boost. Backup = export, import with confirm, delete all with confirm. Appearance = theme.
- **Icon and badge:** new speaker icon in the new style. Badge color by state: saved, wildcard, default, muted.
- **Accessibility:** no extra targets beyond basics. Keep the knob as `role="slider"` with keyboard control and visible focus.

## Audio override spec

The extension's level must win over anything the page does.
- A MAIN-world script at `document_start` intercepts page writes to `HTMLMediaElement.prototype.volume` (and `muted` only if needed). The page reads back its own virtual value; the real element volume is ours. No fight-back loop.
- Catches media that never enters the DOM (`new Audio()`, `play()` on detached elements) and closed shadow roots (`attachShadow` patch).
- Web Audio: every `AudioContext` gets a master `GainNode` in front of the real destination, so games and custom players follow the level.
- Boost works on media hosted on another origin through the master gain where possible.
- Last resort for what in-page code cannot reach (another-origin media without CORS, DRM): tab capture through the offscreen document with gain applied, original tab output replaced by the processed stream. Chrome only allows capture after a user gesture, so it starts when the popup is opened on that tab and keeps running until the tab closes or navigates to another origin. The visualizer reads from the same capture.

## Interfaces (contracts between agents)

**Theme agent → everyone**
- `src/ui/tokens.css`: custom properties on `:root` for both themes via `[data-theme="light"|"dark"]` (system resolved by `theme.ts`): `--bg`, `--glass`, `--glass-strong`, `--glass-border`, `--text`, `--text-muted`, `--accent`, `--accent-glow`, `--danger`, `--radius-s|m|l`, `--space-1..6`, `--font`, `--ease-spring`, `--ease-out`, `--dur-fast|med|slow`, `--blur`.
- `src/ui/base.css`: `@font-face` for Inter, resets, and shared classes `.glass`, `.btn`, `.btn-primary`, `.icon-btn`, `.chip`, `.switch`, `.menu`, `.field`.
- `src/ui/theme.ts`: `initTheme(): Promise<void>`, `getTheme(): Promise<'system'|'light'|'dark'>`, `setTheme(t): Promise<void>`. Applies `data-theme` on `<html>` and follows OS changes while on system.

**Knob agent → popup**
- `src/ui/knob.ts` + `src/ui/knob.css`:
  `createKnob(host: HTMLElement, opts: { value: number; max: number; step?: number; onInput(v: number): void; onChange(v: number): void }): { setValue(v: number, animate?: boolean): void; setMax(max: number): void; setLevels(levels: number[]): void; setIdle(): void; setDisabled(d: boolean): void; destroy(): void }`.
  `levels` are 24 numbers 0-255. Drag (pointer, circular), mouse wheel, keys (arrows ±step, PageUp/PageDown ±10, Home, End), `role="slider"`, `aria-valuenow/min/max`. A visible mark at 100 when max is 200.

**Override agent → popup**
- `src/popup/capture.ts`: `connectAudio(tabId: number, onLevels: (levels: number[]) => void): () => void`. Moves today's visualizer handshake out of `popup.ts` and adds the capture fallback. Keeps the `vizTest` seam.

**Options agent**
- `src/options/options.html|ts|css`, manifest `options_ui { page, open_in_tab: true }`, build entry. The popup gear calls `chrome.runtime.openOptionsPage()`.

## Ownership (do not edit files you don't own; ask the owner)

| Agent | Model | Owns |
|---|---|---|
| theme | Sonnet | `src/ui/tokens.css`, `src/ui/base.css`, `src/ui/theme.ts`, `src/ui/fonts/*` |
| knob | Opus | `src/ui/knob.ts`, `src/ui/knob.css`, `tests/knob.spec.ts` |
| icon | Haiku | `public/icons/*`, badge color code in `src/background.ts` |
| options | Sonnet | `src/options/*`, `tests/options.spec.ts`, manifest `options_ui`, its build entry |
| override | Opus | `src/content.ts`, `src/inject.ts`, `src/offscreen/*`, `src/popup/capture.ts`, `src/lib/messages.ts`, capture code in `src/background.ts`, `tests/content.spec.ts`, `tests/override.spec.ts`, `tests/visualizer.spec.ts`, manifest `content_scripts`, its build entry |
| popup | Sonnet | `src/popup/popup.html|ts|css`, `tests/popup.spec.ts`, `tests/smoke.spec.ts` |
| integration | Opus | merges, `tests/flows.spec.ts`, conflicts in `build.mjs`, `manifest.json`, `background.ts` |
| docs | Haiku | README, screenshots, store images |
