# Link Scrubber

A cross-browser extension that automatically strips or rewrites tracking parameters from URLs on every page you visit.

## What it does

When you browse the web, links are often decorated with tracking parameters like `utm_source`, `fbclid`, `gclid`, and others. These let trackers follow you across sites and attribute your clicks. Link Scrubber removes or rewrites them automatically, giving you clean URLs.

**Before:**
```
https://example.com/article?utm_source=facebook&utm_medium=social&fbclid=abc123
```

**After (default — rewrite to custom value):**
```
https://example.com/article?utm_source=donttrackme&utm_medium=donttrackme&fbclid=donttrackme
```

**Or remove them entirely:**
```
https://example.com/article
```

## Features

- **Global rule by default** — one toggle to rewrite all tracking params to a custom string, or remove them all at once
- **Per-param overrides** — expand the detail view to customize individual parameters
- **Per-param counts** — see how many times each parameter was rewritten on the current page
- **Automatic on page load** — links are rewritten instantly, no interaction needed
- **Dynamic content support** — MutationObserver catches links added by JavaScript (SPAs, infinite scroll)
- **JavaScript navigation interception** — monkey-patches `history.pushState`, `history.replaceState`, and `window.open`
- **Badge counter** — extension icon shows how many links were rewritten on the current tab
- **Cross-browser** — works on Chrome and Firefox
- **Configurable** — add, remove, or customize any tracking parameter

## Default tracking parameters

Link Scrubber ships with these 17 parameters pre-configured:

| Parameter | Source |
|-----------|--------|
| `utm_source` | Google Analytics (Urchin) |
| `utm_medium` | Google Analytics (Urchin) |
| `utm_campaign` | Google Analytics (Urchin) |
| `utm_term` | Google Analytics (Urchin) |
| `utm_content` | Google Analytics (Urchin) |
| `fbclid` | Facebook |
| `fbid` | Facebook |
| `gclid` | Google Ads |
| `gad_source` | Google Ads |
| `msclkid` | Microsoft Advertising |
| `mc_eid` | Mailchimp |
| `mc_cid` | Mailchimp |
| `_ga` | Google Analytics |
| `_gl` | Google Analytics |
| `igshid` | Instagram |
| `spm` | AliExpress / Alibaba |
| `scm` | AliExpress / Alibaba |

All default to the global rewrite rule. Add your own parameters through the popup UI.

## Installation

### From source

```bash
git clone https://github.com/YOUR_USERNAME/link-scrubber.git
cd link-scrubber
npm install
npm run build        # Chrome
npm run build:firefox # Firefox
```

### Loading in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3/` directory

### Loading in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file in the `.output/firefox-mv2/` directory

## Development

```bash
npm install
npm run dev            # Chrome dev server with hot reload
npm run dev:firefox    # Firefox dev server with hot reload
```

### Building for distribution

```bash
npm run zip            # Chrome .zip for Web Store
npm run zip:firefox    # Firefox .xpi for AMO
```

## Architecture

Link Scrubber uses three layers to cover all URL rewriting paths:

1. **Content Script** — scans all `<a>` tags on page load and rewrites matching hrefs. A MutationObserver catches dynamically added links (SPAs, infinite scroll).

2. **Main World Script** — injected into the page's JavaScript context to intercept programmatic navigation. Monkey-patches `history.pushState`, `history.replaceState`, and `window.open` to rewrite URLs before navigation occurs.

3. **Background Service Worker** — coordinates messaging between the content script and popup, manages badge counts, and broadcasts config changes to all open tabs.

Built with [WXT](https://wxt.dev/) (Web Extension Tools) for cross-browser Manifest V3 support.

## Configuration

All settings are managed through the popup:

- **Global on/off** — master toggle to disable the extension without losing config
- **Global rule** — "Remove all" strips tracking params entirely; "Rewrite all to [value]" replaces their values with your custom string
- **Per-param customization** — expand to override individual parameters with their own remove/rewrite rules
- **Add/remove parameters** — add any parameter name to track, or delete ones you don't need
- **Reset to defaults** — restore the original 17-parameter list and global rewrite mode

Settings sync across sessions via `chrome.storage.sync`.

## License

MIT
