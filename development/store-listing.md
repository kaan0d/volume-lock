# Chrome Web Store listing

## Name

Simple Volume Saver

## Short description (132 characters max)

Sets and remembers the volume of each site and applies it automatically, with an optional boost up to 200%.

## Detailed description

Simple Volume Saver sets the volume of audio and video on a web page and remembers it for that site. The next time you open the site, the saved level is applied, including to media that starts later.

- Turn the volume knob in the popup, or use the 25, 50 and 100 presets, the arrow keys, or keyboard shortcuts.
- Save a level per site, per wildcard domain such as *.example.com, or as a default for sites without a saved level.
- Optional boost up to 200%, off by default. Boost also reaches audio played through the Web Audio API.
- Keep a list of sites the extension never touches.
- Mute the current tab or all other tabs.
- A toolbar badge shows the saved level for the current site.
- A live ring around the knob shows the level of the tab's audio.
- An options page lists every saved site, with sorting, filtering and inline editing, plus rules, defaults, backup and theme (System, Light or Dark).
- Export your settings to a JSON file and import them later.

The extension changes only the volume of media on the page. It does not change the site's own player controls, and it does not read, record or send any page content.

## Single purpose

Set and remember the audio volume of each website.

## Permission justifications

- **storage:** Saves your per-site levels, rules and settings in the browser's sync storage. The theme choice and a one-time first-run hint are stored locally on the device.
- **tabs:** Reads the URL of the active tab to know which site to apply a level to, mutes tabs, finds audible tabs for "mute other tabs", and updates the toolbar badge.
- **scripting:** Injects the extension's scripts into tabs that were already open when the extension was installed or updated, so their saved levels apply without a reload.
- **tabCapture:** Used for two things. The popup's live level ring analyzes the tab's audio in memory. For media the page cannot boost itself (another site's media without CORS, or DRM-protected media), the tab's audio is captured after you open the popup on that tab, so the boost can be applied. The audio is played back unchanged or with the boost applied. Nothing is recorded or stored.
- **offscreen:** Creates a hidden page that runs the audio analysis and the boost fallback, so the audio is not interrupted when the popup closes.
- **Host access to all sites (`<all_urls>`):** The extension's scripts run on pages at document start so a saved volume applies before media plays. One of them runs in the page's own context to control media volume that the page sets, and needs no permission of its own. Any site can have a saved volume, so access cannot be limited to a fixed list of sites.

## Data usage

- Does the extension collect or transmit user data? **No.**
- Saved settings (site levels, rules, default level, boost setting) are stored only in the browser's own sync storage (`chrome.storage.sync`).
- The extension makes no network requests of its own and has no analytics, accounts or remote servers.
- Page content is not read, recorded or sent anywhere.
