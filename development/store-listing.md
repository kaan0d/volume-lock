# Chrome Web Store listing

## Name

Simple Volume Saver

## Short description (132 characters max)

Remembers the volume for each site and applies it automatically, with an optional boost up to 200%.

## Detailed description

Simple Volume Saver sets the volume of audio and video on a web page and remembers it for that site. The next time you open the site, the saved level is applied, including to media that starts later.

- Set the volume with a draggable fader, the arrow keys, Home and End, or keyboard shortcuts.
- Save a level per site, per wildcard domain such as *.example.com, or as a default for sites without a saved level.
- Keep a list of sites the extension never touches.
- Mute the current tab or all other tabs.
- Optional boost up to 200%, off by default.
- A toolbar badge shows the saved level for the current site.
- A live visualizer shows the level of the tab's audio.
- Export your settings to a JSON file and import them later.

The extension changes only the volume of media elements on the page. It does not change the site's own player controls, and it does not read, record or send any page content.

## Single purpose

Set and remember the audio volume of each website.

## Permission justifications

- **storage:** Saves your per-site levels, rules and settings in the browser's sync storage. Theme choice is stored locally on the device.
- **tabs:** Reads the URL of the active tab to know which site to apply a level to, mutes tabs, finds audible tabs for "mute other tabs", and updates the toolbar badge.
- **scripting:** Injects the content script into tabs that were already open when the extension was installed or updated, so their saved levels apply without a reload.
- **tabCapture:** Used only by the visualizer. The tab's audio is analyzed in memory and played back unchanged. Nothing is recorded or stored.
- **offscreen:** Creates a hidden page that runs the visualizer's audio analysis, so the audio is not interrupted when the popup closes.
- **Host access to all sites (`<all_urls>`):** The content script runs on pages at document start so a saved volume applies before media plays. Any site can have a saved volume, so access cannot be limited to a fixed list of sites.

## Data usage

- Does the extension collect or transmit user data? **No.**
- Saved settings (site levels, rules, default level, boost setting) are stored only in the browser's own sync storage (`chrome.storage.sync`).
- The extension makes no network requests of its own and has no analytics, accounts or remote servers.
- Page content is not read, recorded or sent anywhere.
