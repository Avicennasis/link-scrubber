// entrypoints/main-world.ts
// -----------------------------------------------------------------------------
// MAIN-WORLD NAVIGATION INTERCEPTOR
//
// This script runs in the page's own JavaScript context (not in the
// extension's isolated world). It exists to catch URL changes that the
// content script can't see — specifically, programmatic navigation:
//   - history.pushState(...)
//   - history.replaceState(...)
//   - window.open(...)
//
// Single-page apps and infinite-scroll sites use these APIs all the time
// to change the URL without a full page load. If we only rewrote <a href>
// attributes, those programmatic URL changes would slip through with
// their tracking parameters intact. By monkey-patching the three APIs
// in the page's own context, we catch the URL just before navigation
// happens and rewrite it the same way the content script rewrites <a href>.
//
// HOW IT WORKS:
//   1. The content script injects this file into the page via a <script>
//      tag pointing at a web-accessible resource. That gets us into the
//      page's own JS context, which is the only place we can replace
//      `window.history.pushState` etc. (extensions live in an isolated
//      world by default and patching `window` there has no effect on
//      the page's own `window`).
//   2. The content script then sends our config over via window.postMessage.
//      We listen for it and stash it in a closure variable.
//   3. We replace the three navigation APIs with wrappers that pass any
//      URL argument through `rewriteUrl` (the same function used by the
//      content script — single source of truth) before forwarding to
//      the original implementation.
//
// PRIVACY NOTICE:
//   - This script does NOT make any network calls.
//   - It does NOT send URLs anywhere — they go straight back to the
//     navigation API as the rewriting modifies them.
//   - It does NOT log to disk or to any server.
//   - The `window.postMessage` channel only carries config IN (from the
//     content script to here); nothing goes back the other way.
//   - You can verify all of this by reading the code below.
// -----------------------------------------------------------------------------

import { rewriteUrl } from '@/utils/rewriter';
import type { ExtensionConfig } from '@/utils/storage';

export default defineContentScript({
  matches: ['<all_urls>'],
  // Run in the page's own world, not the isolated extension world.
  world: 'MAIN',
  // We need to monkey-patch the navigation APIs BEFORE any page script
  // can call them, so run as early as possible.
  runAt: 'document_start',

  main() {
    // The user's saved config. Starts null and gets populated when the
    // content script sends it via postMessage. Until then, we're a no-op.
    let config: ExtensionConfig | null = null;

    // -------------------------------------------------------------------------
    // RECEIVE CONFIG FROM CONTENT SCRIPT
    // The content script (which has access to extension storage) reads
    // the config and forwards it to us via window.postMessage. We only
    // accept messages with our specific `type` — any other message on
    // the same channel is ignored.
    // -------------------------------------------------------------------------
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'link-scrubber-config') {
        config = event.data.config;
      }
    });

    /**
     * Rewrite a URL string the same way the content script does, but
     * defensively. Returns the original string if anything goes wrong
     * or if the extension is disabled — we never want to break the
     * page's navigation by throwing.
     *
     * This wraps the shared `rewriteUrl` so that this file can be
     * dropped into a navigation API as a one-liner without callers
     * needing to know about RewriteResult.
     *
     * @param urlString - The URL the page is trying to navigate to.
     * @returns The rewritten URL, or the original if no config or no match.
     */
    function rewrite(urlString: string): string {
      if (!config || !config.enabled) return urlString;
      try {
        const result = rewriteUrl(
          urlString,
          config.params,
          config.globalMode,
          config.globalRewriteValue,
        );
        return result.url;
      } catch {
        // If anything in the rewriter throws (it shouldn't, but defense-
        // in-depth matters when we're in the navigation hot path), fall
        // back to the original URL. Better to leak a tracker than to
        // break the user's browsing.
        return urlString;
      }
    }

    // -------------------------------------------------------------------------
    // MONKEY-PATCH history.pushState
    // Pages call this to push a new URL into the address bar without
    // doing a real navigation. SPAs do this constantly. We rewrite the
    // URL argument (if any) before passing it through.
    // -------------------------------------------------------------------------
    const originalPushState = history.pushState.bind(history);
    history.pushState = function (data: any, title: string, url?: string | URL | null) {
      if (typeof url === 'string') {
        url = rewrite(url);
      } else if (url instanceof URL) {
        // URL object arguments used to pass through unrewritten, so a site
        // calling pushState(..., new URL('?utm_source=fb', ...)) bypassed the
        // scrubber (FR-264/FR-272). Rewrite and re-wrap to keep the type.
        url = new URL(rewrite(url.toString()));
      }
      return originalPushState(data, title, url);
    };

    // -------------------------------------------------------------------------
    // MONKEY-PATCH history.replaceState
    // Same idea as pushState, but replaces the current history entry
    // instead of pushing a new one. Both APIs need the same treatment.
    // -------------------------------------------------------------------------
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function (data: any, title: string, url?: string | URL | null) {
      if (typeof url === 'string') {
        url = rewrite(url);
      } else if (url instanceof URL) {
        // Same URL-object bypass as pushState (FR-264/FR-272).
        url = new URL(rewrite(url.toString()));
      }
      return originalReplaceState(data, title, url);
    };

    // -------------------------------------------------------------------------
    // MONKEY-PATCH window.open
    // Pages use this to open new tabs/windows. Without rewriting, a click
    // handler that calls `window.open('https://example.com?utm_source=site')`
    // would open the new tab with the tracker intact.
    //
    // The original signature accepts the URL as either a string or a URL
    // object, so we handle both. If it's a URL object, we re-parse the
    // rewritten string into a new URL to keep the type consistent.
    // -------------------------------------------------------------------------
    const originalOpen = window.open.bind(window);
    window.open = function (url?: string | URL, target?: string, features?: string) {
      if (url && typeof url === 'string') {
        url = rewrite(url);
      } else if (url instanceof URL) {
        const rewritten = rewrite(url.toString());
        url = new URL(rewritten);
      }
      return originalOpen(url, target, features);
    } as typeof window.open;
  },
});
