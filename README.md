# Volume Lock

Your volume. Your rules.

Volume Lock remembers your preferred volume for each website and applies it whenever you return. Boost up to 600%, shape the sound with an equalizer and night mode, and control audio across tabs. Browser extension (Manifest V3) for Chrome, Edge, Brave and Firefox.

[Chrome Web Store](https://chromewebstore.google.com/detail/volume-lock/hfpdohjhnfgkhnangkecmkhochllhifb) · [Download for Edge, Brave and Firefox](https://github.com/kaan0d/volume-lock/releases/latest)

<table>
  <tr>
    <td><img src="screenshots/popup-dark.png" width="200" alt="Popup, dark theme"></td>
    <td><img src="screenshots/popup-light.png" width="200" alt="Popup, light theme with boost"></td>
    <td><img src="screenshots/options.png" width="320" alt="Options page, Sites"></td>
  </tr>
</table>

## Features

- **Simple and smart:** save a level for one page or a whole site and it applies automatically, even to media that loads later. Set a default volume or exclude sites. Adjust with presets, shortcuts or the mouse wheel.
- **Boost:** up to 200, 300, 400 or 600% with an optional limiter. The popup shows the live gain (for example +6.0 dB).
- **Sound:** five-band equalizer, night mode, mono and left/right balance.
- **Tabs and mute:** list of other audible tabs with their own volume and mute. Mute one tab or all others, timed mute for 15 minutes or an hour, and sites that start muted.
- **Safe listening:** warning when the level gets loud, and quiet hours that cap the level during a set time window.
- **Shortcuts:** `Alt+Shift+Up/Down` volume, `Alt+Shift+M` mute, `Alt+Shift+S` save.
- **Backup:** export and import settings as JSON. The import shows what it adds, removes and changes first.
- **Personal:** 12 popup designs with light and dark themes. English, German, Spanish, French, Brazilian Portuguese and Turkish.
- **Private:** no tracking, no analytics, no network requests. Audio is analyzed in memory and never recorded. Saved sites stay in your browser's sync storage.

## Install

- **Chrome:** [Chrome Web Store](https://chromewebstore.google.com/detail/volume-lock/hfpdohjhnfgkhnangkecmkhochllhifb).
- **Edge, Brave, Firefox:** download the ZIP from the [latest release](https://github.com/kaan0d/volume-lock/releases/latest).
  - `volume-lock-chrome-<version>.zip` and `volume-lock-edge-<version>.zip` are the same Chromium build. Unzip, open `edge://extensions` (or `brave://extensions`), turn on Developer mode, choose Load unpacked and select the folder.
  - `volume-lock-firefox-<version>.zip` is the Firefox build (128 or later, without tab capture). Open `about:debugging#/runtime/this-firefox` and choose Load Temporary Add-on, then select the ZIP. Firefox asks for site access separately: allow all sites on the add-on's permissions tab. Not tested in a real Firefox yet.

Rebind shortcuts on the `shortcuts` page of your browser (for example `chrome://extensions/shortcuts`).

## Limits

- Browsers restrict extensions on internal pages (`chrome://`, `edge://`, `brave://`) and the extension stores.
- DRM-protected and some cross-origin media are boosted through tab capture. It starts when you open the popup on that tab above 100% and can briefly interrupt audio. Use Reset tab in the site menu if fullscreen breaks.
- Tabs open during install or update need a reload.
- The styled dropdown needs Chromium 135 or later. Older versions show the native list.
- Saved sites sync through `chrome.storage.sync` (512 items, 100 KB).

## Development

Node 22 or later.

```bash
npm install
npm run dev           # watch build into dist/
npm run build         # dist/
npm run zip           # development/webstore/volume-lock-<version>.zip
npm run zip:firefox   # dist-firefox/ and volume-lock-firefox-<version>.zip
npm run typecheck
```

```
src/popup, src/options     popup and options page
src/ui                     knob, 12 designs, shared styles
src/lib                    settings, rules, storage, i18n
src/background.ts          tab capture, shortcuts, offscreen audio
src/content.ts, inject.ts  page-side audio graph
store/<lang>/              Chrome Web Store images per language
screenshots/               images used in this README
```

## License

Source-available, not open source. You can read, build, run and modify it for personal use, and fork it to propose changes. Uploading it (modified or not) to the Chrome Web Store or any other store, redistributing it as "Volume Lock", and commercial use are not allowed without permission. See [LICENSE.md](LICENSE.md).

Bundled fonts are under the SIL Open Font License, see [public/FONT-LICENSES.txt](public/FONT-LICENSES.txt).
