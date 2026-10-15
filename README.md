# Volume Lock

Chrome extension (Manifest V3, TypeScript, Vite) that sets and remembers the volume of each site, with an optional boost up to 200%. Chrome only.

<table>
  <tr>
    <td><img src="screenshots/popup-dark.png" width="200" alt="Popup, dark theme"></td>
    <td><img src="screenshots/popup-light.png" width="200" alt="Popup, light theme with boost"></td>
    <td><img src="screenshots/options.png" width="320" alt="Options page, Sites"></td>
  </tr>
</table>

## Features

- **Popup:** rotary knob with drag, mouse wheel and keyboard control, presets at 25, 50 and 100, and a boost switch. The knob ring shows the tab's live audio levels.
- **Saving:** Save/Unsave stores the level for the whole domain (a wildcard such as `*.example.com`). The site menu saves a level for this URL only or excludes the site ("Never touch"). Exact origin beats wildcard, wildcard beats default, excluded beats all.
- **Mute:** mute the current tab or all other audible tabs. Muted tabs are listed in the popup with an Unmute button each.
- **Override:** page writes to `volume` are virtualized, so the page reads back its own value while the real level is ours. Moving the level from the extension also updates the page's own volume (YouTube's slider follows). Web Audio output follows the level through a master gain. Covers `new Audio()` and closed shadow roots.
- **Tab capture fallback:** media that in-page code cannot reach (another origin without CORS, DRM) is boosted through `tabCapture`. It starts when the popup is opened on that tab.
- **Options page:** two tabs. Sites: table with sort, filter and inline level edit, wildcard and never-touch rules. General: default level, boost, export, import and delete all (each with confirmation), theme.
- **Theme:** System, Light or Dark.
- **Shortcuts:** `Alt+Shift+Up` and `Alt+Shift+Down` change the volume by 5%, `Alt+Shift+M` mutes the tab, `Alt+Shift+S` saves the site. Rebind at `chrome://extensions/shortcuts`.
- **Badge:** the level for saved and wildcard sites, empty otherwise. Blue for saved, violet for wildcards, red while the tab is muted.
- **Visualizer:** audio is analyzed in memory and played back unchanged. Nothing is recorded or sent; the extension makes no network requests.
- **Import/export:** all settings as one JSON file, validated before they replace the current ones.

## Install

Build from source (Node 22 or later):

1. `npm install`
2. `npm run build`
3. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select `dist/`.

## Commands

```bash
npm run build         # bundle src/ into dist/
npm run dev           # rebuild on change
npm run typecheck     # tsc --noEmit
npm test              # build, then Playwright (Chromium)
npm run icons         # regenerate toolbar PNGs from public/icons/icon.svg
npm run store         # zip + screenshots + store images into webstore/
npm run zip           # build, then webstore/volume-lock-<version>.zip
```

## Permissions

| Permission | Why |
|---|---|
| `storage` | Saved levels, rules and settings in `chrome.storage.sync`; theme and first-run hint in `storage.local`; tab state in `storage.session` |
| `tabs` | Reads the active tab's URL, mutes tabs, finds audible tabs for "mute other tabs", updates the badge |
| `scripting` | Injects the content scripts into tabs already open when the extension is installed or updated |
| `tabCapture` | Visualizer, and the boost fallback for media the page cannot reach. Audio is analyzed in memory and played back; nothing is recorded |
| `offscreen` | Hosts the capture and analysis page, so audio is not cut when the popup closes |
| `<all_urls>` | The content scripts run on every page at `document_start`, so a saved level applies before media plays. The MAIN-world override script needs no permission beyond this host access |

## Verification

81 Playwright tests run the built extension in Chromium against local pages with media. No network access is needed.

| Spec | Tests | Covers |
|---|---|---|
| `content`, `override` | 17 | Apply at `document_start`, media added later, detached media, shadow DOM, iframes, boost, cross-origin cap, capture flag |
| `popup`, `knob`, `theme` | 23 | Knob keys and drag, presets, save and reset, rules, import/export, sync quota errors, theme |
| `options` | 16 | Sites table, rules, audio, backup with confirmation, appearance, screenshots in both themes |
| `background`, `visualizer` | 13 | Badge, shortcuts, tab mute, content script injection, capture and offscreen lifecycle |
| `flows` | 6 | End-to-end: popup and shortcuts, badge, import, boost, default volume |
| `lib`, `smoke`, `storage` | 6 | Origin parsing, rule precedence, import validation, worker start, storage wrapper and migration |

## Limits

- Cross-origin media without CORS and DRM media cannot be boosted in the page. The tab capture fallback handles them only after the popup is opened once on that tab. The capture ends when the tab closes or navigates to another origin. DRM capture has not been verified.
- A detached element that autoplays without `play()` or volume access (for example a `new Audio()` with `autoplay` that is never inserted) is not covered.
- Web Audio contexts created before the extension script was injected (tabs open during install or update) need a reload.
- Volume controls, the visualizer and the boost do not work on browser-internal pages such as `chrome://` and the Chrome Web Store.
- An exact-origin level (menu, shortcut) covers that origin only. `https://example.com` does not cover `https://www.example.com` unless a wildcard is saved.
- Saved sites sync through `chrome.storage.sync`, which holds 512 items and 100 KB in total. Saves and imports over that quota show an error, and a failed import keeps the old settings.

## Layout

```
src/
  lib/          origin, rules, storage, transfer, messages (shared pure logic)
  background.ts service worker: badge, shortcuts, tab mute, capture coordination
  content.ts    isolated script: resolves the level per frame, talks to the popup
  inject.ts     MAIN-world script: volume override, master gain, shadow roots
  popup/        popup.html, popup.ts, popup.css, capture.ts (visualizer and capture port)
  options/      options page: Sites, Rules, Audio, Backup, Appearance
  ui/           shared tokens, base styles, Inter, knob, theme
  offscreen/    capture and analysis document
public/         manifest.json, icons
scripts/        icon generation and store images
webstore/       Web Store upload kit: listing.md, images/, zip
tests/          Playwright specs and fixtures
dist/           build output (generated)
```

## License

MIT. See [LICENSE.md](LICENSE.md).
