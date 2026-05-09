// entrypoints/content.ts
// -----------------------------------------------------------------------------
// CONTENT SCRIPT
//
// This script runs on every page you visit. It's the workhorse that finds
// <a href> elements and rewrites them to strip tracking parameters. It
// also coordinates the main-world script (which handles programmatic
// navigation) and reports the per-page rewrite count to the background
// service worker so the toolbar badge can show the number.
//
// HOW IT WORKS:
//   1. On page load, read the user's config from extension storage.
//   2. Inject the main-world script into the page's own JavaScript
//      context (it needs to monkey-patch `history.pushState` etc., and
//      the isolated extension world can't reach the page's `window`).
//      Send the config to the main-world script via window.postMessage.
//   3. Scan the DOM for <a href> elements and rewrite their href
//      attributes. Report the total count of rewrites to the background.
//   4. Set up a MutationObserver to watch for two things:
//        - New <a> elements added by JavaScript (SPAs, infinite scroll)
//        - href ATTRIBUTE changes on existing <a> elements (some sites
//          mutate hrefs in place rather than replacing the element)
//      For each new or mutated link, run it through the rewriter
//      immediately — no full-page rescans needed.
//   5. Listen for config changes broadcast by the background script
//      (e.g. when the user toggles a parameter in the popup). Re-scan
//      and forward the new config to the main-world script.
//
// PRIVACY NOTICE:
//   - This script does NOT make any network calls.
//   - It does NOT log URLs anywhere — it only sends an aggregate count
//     of rewrites (and which parameter names were touched, for the
//     badge popup display) to the background service worker.
//   - It does NOT read page text content, form values, or anything
//     else — only the `href` attribute of <a> elements.
//   - You can verify all of this by reading the code below.
// -----------------------------------------------------------------------------

import { getConfig } from '@/utils/storage';
import { rewriteUrl } from '@/utils/rewriter';

export default defineContentScript({
  matches: ['<all_urls>'],
  // Run after the DOM is mostly settled but before idle work, so links
  // get rewritten before the user has a chance to click them.
  runAt: 'document_idle',

  async main(ctx) {
    // The user's current configuration. Loaded once at startup and
    // refreshed when the background script broadcasts a change.
    let config = await getConfig();

    // Per-page totals. These get reset on a full re-scan and accumulate
    // as new links arrive via MutationObserver. The background service
    // worker uses them to drive the toolbar badge and the popup display.
    let rewriteCount = 0;
    let paramCounts: Record<string, number> = {};

    /**
     * Rewrite a single <a> element's href attribute, in place, if any
     * tracking parameters match. Updates the running per-page totals.
     *
     * @param a - The anchor element to process.
     */
    function processLink(a: HTMLAnchorElement) {
      // If the user has the master toggle off, do nothing.
      if (!config.enabled) return;

      const result = rewriteUrl(
        a.href,
        config.params,
        config.globalMode,
        config.globalRewriteValue,
      );

      if (result.changed) {
        a.href = result.url;
        rewriteCount++;
        for (const [param, count] of Object.entries(result.paramCounts)) {
          paramCounts[param] = (paramCounts[param] ?? 0) + count;
        }
      }
    }

    /**
     * Walk every <a href> element on the page and rewrite as needed.
     * Resets the running totals first, so this is a fresh count.
     * Used at startup and after the user changes config.
     */
    function scanAllLinks() {
      rewriteCount = 0;
      paramCounts = {};
      const links = document.querySelectorAll<HTMLAnchorElement>('a[href]');
      links.forEach(processLink);
      reportCount();
    }

    /**
     * Send the current per-page rewrite totals to the background script.
     * The background uses this to update the toolbar badge for this tab
     * and to answer "what got rewritten on this page?" requests from
     * the popup.
     *
     * Wrapped in a `.catch(() => {})` because `sendMessage` rejects when
     * the receiver isn't there (e.g. during extension reload). That's
     * not an error worth surfacing.
     */
    function reportCount() {
      // ctx.isValid is false when the extension has been reloaded or
      // updated mid-session. In that state, browser.runtime is gone
      // and any message we'd send would throw.
      if (!ctx.isValid) return;
      browser.runtime.sendMessage({
        type: 'rewriteCount',
        count: rewriteCount,
        paramCounts,
      }).catch(() => {});
    }

    // -------------------------------------------------------------------------
    // INJECT MAIN-WORLD SCRIPT
    // The main-world script monkey-patches navigation APIs in the page's
    // own JS context. We inject it via a <script> tag pointing at the
    // web-accessible resource, then send it the current config so it
    // knows what to rewrite.
    //
    // The script removes itself from the DOM after loading — there's no
    // benefit to leaving the tag around once the patches are installed.
    // -------------------------------------------------------------------------
    const script = document.createElement('script');
    script.src = browser.runtime.getURL('/main-world.js');
    script.onload = () => {
      script.remove();
      // Wildcard target ('*') is safe here because the message contains
      // only public config (no secrets), and the main-world script
      // filters incoming messages by `event.data?.type === 'link-scrubber-config'`.
      window.postMessage({ type: 'link-scrubber-config', config }, '*');
    };
    (document.head || document.documentElement).appendChild(script);

    // -------------------------------------------------------------------------
    // INITIAL SCAN
    // Process every <a href> already in the DOM at this point.
    // -------------------------------------------------------------------------
    scanAllLinks();

    // -------------------------------------------------------------------------
    // MUTATION OBSERVER
    // Watch for two kinds of changes that the initial scan misses:
    //
    //   1. Newly-added DOM nodes (from JavaScript adding links to the
    //      page — common in SPAs, infinite scroll, comment threads).
    //      We process anchor nodes directly, and for any other element
    //      we querySelectorAll for descendants with href.
    //
    //   2. href attribute changes on EXISTING <a> elements. Some sites
    //      mutate hrefs in place after analytics has finished decorating
    //      them. Without `attributeFilter: ['href']`, we'd miss these
    //      and the link would still carry tracking params at click time.
    //
    // The previous implementation also scheduled a full-document re-scan
    // via requestIdleCallback after every mutation. That was redundant
    // — the inline processing above already handles all the new and
    // mutated links — and on heavy SPA pages it added 350ms-cadence
    // full-page rescans for no benefit. The attribute filter replaces it.
    // -------------------------------------------------------------------------
    const observer = new MutationObserver((mutations) => {
      // If the extension has been reloaded mid-session, stop processing
      // — `browser.runtime` is gone and any further work would throw.
      if (!ctx.isValid) {
        observer.disconnect();
        return;
      }

      let touched = false;

      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'href') {
          // An existing <a>'s href just changed. Re-rewrite it.
          if (mutation.target instanceof HTMLAnchorElement) {
            processLink(mutation.target);
            touched = true;
          }
          continue;
        }

        // For childList mutations: process anchors and any anchor
        // descendants of newly-added subtrees.
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLAnchorElement) {
            processLink(node);
            touched = true;
          } else if (node instanceof HTMLElement) {
            const links = node.querySelectorAll<HTMLAnchorElement>('a[href]');
            if (links.length > 0) {
              links.forEach(processLink);
              touched = true;
            }
          }
        }
      }

      if (touched) {
        reportCount();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      // Watch for href attribute changes on existing <a> elements.
      // Without this, a page that does `link.href = url + '?utm_source=foo'`
      // after our initial scan would slip the tracker through.
      attributes: true,
      attributeFilter: ['href'],
    });

    // -------------------------------------------------------------------------
    // CLEANUP ON EXTENSION RELOAD
    // When the extension is reloaded or updated, this script's "context"
    // becomes invalid — but the MutationObserver and any other listeners
    // would keep firing. Disconnect them so we don't pile up dead handlers.
    // -------------------------------------------------------------------------
    ctx.onInvalidated(() => {
      observer.disconnect();
    });

    // -------------------------------------------------------------------------
    // CONFIG UPDATES FROM BACKGROUND
    // When the user changes a setting in the popup, the background
    // script broadcasts a `configUpdated` message to every tab. We
    // refresh our local config, forward it to the main-world script,
    // and re-scan the page so existing links pick up the new rules.
    // -------------------------------------------------------------------------
    browser.runtime.onMessage.addListener((message) => {
      if (!ctx.isValid) return;
      if (message.type === 'configUpdated') {
        config = message.config;
        window.postMessage({ type: 'link-scrubber-config', config }, '*');
        scanAllLinks();
      }
    });
  },
});
