# Changelog

All notable changes to `link-scrubber` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-05-08

Triggered by full review at `docs/2026-05-08-review.md`.

### Fixed
- **Two-rewriter logic divergence (high).** The main-world script (which
  intercepts programmatic navigation: `history.pushState`, `replaceState`,
  `window.open`) was using its own simpler URL-rewriting function that
  did NOT honor the `_custom` per-param flag or `globalMode`. So clicking
  a link rewrote `utm_source` to `donttrackme`, but a JavaScript-pushed
  URL with `utm_source` got it stripped entirely instead. Both paths
  now route through the single `rewriteUrl` in `utils/rewriter.ts`.
- **Storage merge dropped new default params on upgrade (high).**
  `getConfig()` was doing a shallow `{...DEFAULT_CONFIG, ...stored.config}`
  spread, which replaced the whole `params` map with the stored one.
  When a future release adds a new tracker param to defaults, existing
  users would never see it. Now deep-merges the params field so new
  defaults reach existing users without overwriting customizations.
- **Redundant MutationObserver full-rescan (medium).** The observer was
  calling `scheduleScan()` after every mutation, which queued a
  `requestIdleCallback` to re-scan every link on the page — even though
  the inline loop above already processed the new and changed nodes.
  On heavy SPA pages this added a 350ms-cadence full-document re-scan
  for no benefit. Replaced with `attributeFilter: ['href']` on the
  observer so href mutations on existing nodes are caught inline.
- **README placeholder URL (medium).** `git clone YOUR_USERNAME` is now
  the real `Avicennasis/link-scrubber` URL.

### Added
- **vitest unit suite** at `tests/rewriter.test.ts`. Covers core
  behavior, per-param `_custom` overrides, safety/edge cases (empty,
  `javascript:`, `mailto:`, malformed URLs), and parity between the
  content-script and main-world rewriting paths.
- **Repo plumbing** matching the SimmonsSystems standard:
  `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `.editorconfig`, `.gitattributes`, `.github/CODEOWNERS`,
  `.github/dependabot.yml`, `.github/FUNDING.yml`,
  `.github/release-drafter.yml`, issue templates, PR template, and
  CI workflows for tests, scorecard, release-drafter, and stale.
- **Privacy & Transparency** section in README plus file-header banner
  blocks throughout the source. Comments are written for non-technical
  auditors — explain the *why*, not just the *what*.
- **Auditable production builds.** `wxt.config.ts` now sets
  `vite.build.minify: false` and `vite.build.sourcemap: true`, so the
  shipped JavaScript is human-readable and maps back to the original
  TypeScript in DevTools.

### Notes
- A user who has explicitly *deleted* a default parameter will see it
  reappear after upgrading to a release that adds new defaults. The
  fix for that user: delete it again. Tracking deletions explicitly
  would require a schema field that's not worth carrying for this
  edge case.

## [1.0.0] — 2026-05-08

Initial release. WXT-based cross-browser extension for Chrome MV3 and
Firefox MV2. Three-layer URL rewriting (content script + main-world
monkey-patches + background coordinator), 17 default tracker params,
per-param customization, `browser.storage.sync` for cross-device
config sync.
