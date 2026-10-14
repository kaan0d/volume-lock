# Rebuild plan

Rewrite of Simple Volume Saver in place on `main`. Same job: remember a volume level per site and apply it automatically. The old extension in `simple-volume-saver/` is the reference until the new popup reaches parity, then it is deleted.

## Spec

- **Scope:** per origin (`https://example.com`), as today. A global default volume applies to origins that are not saved.
- **Site rules:** an entry may be a subdomain wildcard (`*.example.com`). An exclude list holds origins that are never touched. Exact origin beats wildcard beats default. Excluded beats everything.
- **Apply timing:** content script at `document_start`, `all_frames: true`, covers media added later (MutationObserver, shadow roots where reachable) and re-applies when the page itself resets `volume` (YouTube and similar). User changes made through the extension must not be fought.
- **Boost:** optional, off by default, setting unlocks up to 200% via Web Audio `GainNode`. Max 100% when off. Must not break fullscreen or playback on DRM media; skip boost on elements where it cannot work.
- **Audio FX:** none beyond volume.
- **Features:** import/export of all settings as JSON (validated on import), per-tab mute and "mute other tabs", search in the saved list.
- **Popup:** same draggable fader and two tabs (Volume / Saved Sites), polished. The live visualizer stays; tab capture moves to an offscreen document so audio does not glitch or cut when the popup closes. Dark/light theme.
- **Badge:** volume % on the toolbar icon for saved sites.
- **Shortcuts (manifest `commands`):** volume up, volume down, mute/unmute tab, save current site.
- **Platform:** Chrome only, Manifest V3. `<all_urls>` host access kept and justified in README and store listing.
- **Storage:** `chrome.storage.sync`. The site list is split across items (one key per site, prefixed) so no single item hits the 8 KB cap. Theme and other per-device UI state in `storage.local`.
- **Stack:** TypeScript, Vite (or esbuild) build to `dist/`, which is what gets loaded unpacked and zipped for the store.
- **Tests:** Playwright end-to-end with the built extension loaded in Chromium, against local test pages with media. Pure logic (origin parsing, rule matching, storage split, import validation) is tested through the same Playwright runner.
- **Publishing:** Chrome Web Store.

## Layout

```
src/
  lib/          shared pure logic and types (origin, rules, storage, messages)
  background.ts service worker: badge, commands, tab mute, offscreen lifecycle
  content.ts    applies volume and boost in pages
  popup/        popup.html, popup.ts, popup.css
  offscreen/    offscreen.html, offscreen.ts (tab capture + analyser for visualizer)
public/         manifest.json, icons
tests/          Playwright specs, fixtures, local media pages
dist/           build output, gitignored
```

## Work order and model tiers

| # | Task | Model |
|---|------|-------|
| 1 | TS + Vite scaffold, manifest, build script, Playwright installed with one smoke test that loads `dist/` | Sonnet |
| 2 | `src/lib`: origin parsing, rule matching, split sync storage, settings, import/export validation, with tests | Sonnet |
| 3 | Content script: apply at document_start, re-apply against page resets, iframes and shadow DOM, boost gain | Opus |
| 4 | Background: badge, commands, per-tab mute and mute others | Sonnet |
| 5 | Popup: fader, tabs, saved list with search, rules, default volume, boost toggle, import/export UI | Sonnet |
| 6 | Visualizer via offscreen document | Opus |
| 7 | Full Playwright E2E suite and harness hardening | Opus |
| 8 | CSS polish, theme, icons, README, store listing text, permission justification | Haiku |

Bug escalation: a task that fails its build or tests gets one retry, then goes one tier up (Haiku to Sonnet, Sonnet to Opus).
