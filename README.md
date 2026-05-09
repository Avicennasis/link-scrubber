# Link Scrubber

[![CI](https://github.com/Avicennasis/link-scrubber/actions/workflows/test.yml/badge.svg)](https://github.com/Avicennasis/link-scrubber/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Avicennasis/link-scrubber/badge)](https://scorecard.dev/viewer/?uri=github.com/Avicennasis/link-scrubber)

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
- **Dynamic content support** — MutationObserver catches links added by JavaScript (SPAs, infinite scroll), and `attributeFilter: ['href']` catches in-place href mutations
- **JavaScript navigation interception** — monkey-patches `history.pushState`, `history.replaceState`, and `window.open`
- **Single source of truth for rewrites** — the same `rewriteUrl` function powers both the DOM-anchor path and the programmatic-navigation path, so clicking a link and a JS-pushed URL get identical treatment
- **Badge counter** — extension icon shows how many links were rewritten on the current tab
- **Cross-browser** — works on Chrome and Firefox
- **Configurable** — add, remove, or customize any tracking parameter

## Privacy & Transparency

Link Scrubber is a privacy tool, so it's built to be auditable:

- **No network calls.** The extension never contacts any server. CI verifies this on every commit by scanning `entrypoints/` and `utils/` for `http(s)://` URLs in non-comment code.
- **Settings are local to your browser.** Configuration is stored in `browser.storage.sync`, which is the BROWSER syncing across your own signed-in devices — not us syncing it anywhere. We have no servers.
- **No telemetry, no analytics, no logging.** The extension only computes URL rewrites and counts how many it did per tab. The counts never leave your browser.
- **Production builds are unminified, with source maps.** You can open the deployed JavaScript from `chrome://extensions` (or the equivalent in your browser) and read code that closely matches the source. DevTools "Sources" panel maps it back to the original TypeScript. We don't ask you to trust the build chain.
- **Plain-English code comments.** Every source file starts with a banner block in plain English explaining what it does, how it works, and what it intentionally does NOT do. You can audit the extension by reading the source — no JavaScript fluency required.
- **Open source under MIT.** Read the code, fork it, modify it.

The CI pipeline enforces these properties — see `.github/workflows/test.yml`.

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
git clone https://github.com/Avicennasis/link-scrubber.git
cd link-scrubber
npm install
npm run build         # Chrome
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

### Running the tests

```bash
npm test               # vitest unit suite (fast, no browser)
npm run test:watch     # watch mode
```

### Building for distribution

```bash
npm run zip            # Chrome .zip for Web Store
npm run zip:firefox    # Firefox .xpi for AMO
```

## Architecture

Link Scrubber uses three layers to cover all URL rewriting paths:

1. **Content Script** (`entrypoints/content.ts`) — scans all `<a>` tags on page load and rewrites matching hrefs. A MutationObserver with `attributeFilter: ['href']` catches both newly-added links (SPAs, infinite scroll) and in-place href mutations.

2. **Main World Script** (`entrypoints/main-world.ts`) — injected into the page's JavaScript context to intercept programmatic navigation. Monkey-patches `history.pushState`, `history.replaceState`, and `window.open` to rewrite URLs before navigation occurs.

3. **Background Service Worker** (`entrypoints/background.ts`) — coordinates messaging between the content script and popup, manages badge counts, and broadcasts config changes to all open tabs.

Both the content script and main-world script share a single rewriting function: `rewriteUrl` in `utils/rewriter.ts`. That guarantees clicking a link and a JavaScript-pushed URL get identical treatment — divergence between the two would be a real correctness bug.

Built with [WXT](https://wxt.dev/) (Web Extension Tools) for cross-browser Manifest V3 support.

## Configuration

All settings are managed through the popup:

- **Global on/off** — master toggle to disable the extension without losing config
- **Global rule** — "Remove all" strips tracking params entirely; "Rewrite all to [value]" replaces their values with your custom string
- **Per-param customization** — expand to override individual parameters with their own remove/rewrite rules
- **Add/remove parameters** — add any parameter name to track, or delete ones you don't need
- **Reset to defaults** — restore the original 17-parameter list and global rewrite mode

Settings sync across sessions via `chrome.storage.sync`.

When a new release adds default tracker parameters, existing users automatically pick them up without losing their customizations (deep-merge, see `utils/storage.ts`). The one edge case: if you've explicitly *deleted* a default parameter from your list, it'll reappear after such an upgrade. Delete it again and you're back to your preferred state.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, project conventions, and the PR checklist. Bug reports and small improvements are welcome; security issues should be emailed (see [SECURITY.md](SECURITY.md)).

## License

[MIT](LICENSE)
