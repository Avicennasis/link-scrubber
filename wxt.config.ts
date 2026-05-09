// wxt.config.ts
// -----------------------------------------------------------------------------
// WXT FRAMEWORK CONFIGURATION
//
// WXT is the build system. It takes the TypeScript source in `entrypoints/`,
// auto-generates a manifest from this config, bundles everything for both
// Chromium and Firefox targets, and outputs the loadable extension to
// `.output/<browser>-<version>/`.
//
// Two production-only choices made here are deliberately auditability-
// friendly for a privacy tool:
//
//   1. Minification is OFF in production builds. Without minification,
//      anyone who installs the built extension can open `dist/.../*.js`
//      and read code that closely matches the source. Privacy-minded
//      users (the audience of a tracker-stripping extension) can verify
//      that no telemetry was added during the build.
//
//   2. Source maps are ON. DevTools "Sources" panel will show the
//      original TypeScript when debugging the deployed extension, so
//      reviewers and curious users can step through the actual source.
//
// PRIVACY NOTICE:
//   - The manifest below requests broad host permissions (<all_urls>),
//     which is required so the content script can rewrite URLs on every
//     page. The extension makes no network calls of its own — verify by
//     grepping the `entrypoints/` and `utils/` directories for `fetch`,
//     `XMLHttpRequest`, `WebSocket`, or `navigator.sendBeacon`.
// -----------------------------------------------------------------------------

import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Link Scrubber',
    description: 'Automatically strip or rewrite tracking parameters from URLs',
    permissions: [
      'storage',     // For browser.storage.sync — saves user config
      'scripting',   // Reserved for future MV3 dynamic content-script needs
      'activeTab',   // Lets the popup query the active tab's per-page count
      'tabs',        // For tab tracking and config-change broadcast
    ],
    // <all_urls> is required: the content script needs to scan every page
    // the user visits to rewrite tracker links. Without this, the extension
    // can't do its core job.
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        // The main-world script needs to be loadable from a page context
        // (it gets injected via a <script src=...> tag), so it must be
        // declared as a web-accessible resource.
        resources: ['/main-world.js'],
        matches: ['<all_urls>'],
      },
    ],
  },

  vite: () => ({
    build: {
      // Ship readable JavaScript so users can audit what the extension
      // actually does. Slightly larger build artifacts are an acceptable
      // tradeoff for a privacy-conscious user base.
      minify: false,
      // Ship source maps so DevTools shows the original TypeScript when
      // anyone steps through the extension's code.
      sourcemap: true,
    },
  }),
});
