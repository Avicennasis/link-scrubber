// utils/rewriter.ts
// -----------------------------------------------------------------------------
// URL REWRITER (THE PURE FUNCTION)
//
// This is the single source of truth for "given a URL string and the user's
// configuration, what should the URL become?" Both the content script (which
// rewrites <a href> attributes on the page) and the main-world script (which
// intercepts programmatic navigation like history.pushState) call this same
// function. That guarantees clicking a link and a JavaScript-pushed URL get
// identical treatment — no surprises.
//
// HOW IT WORKS:
//   1. Parse the input string as a URL. Skip if it's not a real URL (empty,
//      "javascript:", "mailto:", or otherwise unparseable).
//   2. For each query parameter in the URL, look it up in the user's config:
//        - If the user has explicitly customized this parameter (the _custom
//          flag is set), use its action ("remove" or "rewrite") and value.
//        - Otherwise fall back to the global rule (globalMode + globalRewriteValue).
//   3. Apply the action: either drop the parameter, or replace its value
//      with the configured replacement string.
//   4. Return the rewritten URL string and a count of which parameters
//      were touched (for the per-page badge and per-param popup display).
//
// PRIVACY NOTICE:
//   - This function does NOT make any network calls.
//   - It does NOT log, persist, or transmit URLs anywhere.
//   - It is a pure function: same input always produces the same output.
//   - You can verify all of this by reading the code below — it is short.
// -----------------------------------------------------------------------------

import type { ParamConfig, GlobalMode } from './storage';

/**
 * The result of rewriting a single URL.
 *
 * @property url - The (possibly rewritten) URL string. If `changed` is false,
 *                 this is the same string that was passed in.
 * @property changed - True if any parameter was removed or rewritten.
 * @property paramCounts - For each parameter that was touched, how many
 *                         occurrences were touched. (Some URLs include a key
 *                         multiple times, e.g. `?utm_source=a&utm_source=b`.)
 */
export interface RewriteResult {
  url: string;
  changed: boolean;
  paramCounts: Record<string, number>;
}

/**
 * Take a URL string and the user's tracking-parameter configuration, and
 * return either the rewritten URL or the original (if nothing matched).
 *
 * The function is *pure*: it does not read from storage, write to storage,
 * make network calls, or touch the DOM. Every input/output pair is fully
 * determined by the arguments.
 *
 * @param urlString - The raw URL to rewrite. Can be absolute or relative;
 *                    relative URLs are resolved against `document.baseURI`.
 * @param params - The map of "parameter name → action". Comes straight from
 *                 the user's saved config.
 * @param globalMode - The fallback behavior for parameters that are listed
 *                     in `params` but don't have a user override. Either
 *                     "remove" (drop them entirely) or "rewrite" (replace
 *                     the value).
 * @param globalRewriteValue - The replacement value to use when the global
 *                             rule says "rewrite" (e.g. "donttrackme").
 * @returns A `RewriteResult` describing the new URL and what changed.
 */
export function rewriteUrl(
  urlString: string,
  params: Record<string, ParamConfig>,
  globalMode: GlobalMode,
  globalRewriteValue: string,
): RewriteResult {
  // The default return for "nothing changed" — the URL passes through and
  // both `changed` and `paramCounts` indicate that no work was done.
  const result: RewriteResult = { url: urlString, changed: false, paramCounts: {} };

  // Skip URLs we shouldn't touch. `javascript:` URIs are inline scripts and
  // rewriting them would break their semantics. `mailto:` is an email
  // address, not a HTTP-style URL with query parameters. Empty strings are
  // not URLs at all.
  if (!urlString || urlString.startsWith('javascript:') || urlString.startsWith('mailto:')) {
    return result;
  }

  // Try to parse the input as a URL. Relative URLs get resolved against
  // the page's base URL. If parsing fails (e.g. the input contains
  // characters that aren't valid in a URL at all), bail out — leaving the
  // original string untouched is the safe choice.
  let url: URL;
  try {
    url = new URL(urlString, document.baseURI);
  } catch {
    return result;
  }

  // Snapshot the keys before we start mutating searchParams. Iterating over
  // a live searchParams object while modifying it can skip entries.
  const keys = Array.from(url.searchParams.keys());

  for (const key of keys) {
    const rule = params[key];
    // Parameter is not in the user's tracker list — leave it alone.
    if (!rule) continue;

    // Decide what action to take for this parameter:
    //   - If the user has explicitly customized this parameter (the
    //     `_custom` flag is true), use the per-parameter action and value.
    //   - Otherwise, fall back to the global rule.
    //
    // The `_custom` flag is what makes the popup's "Customize per-param"
    // section feel intuitive: defaults follow the global toggle, but any
    // parameter you click on becomes pinned to your override.
    const perParamOverride = rule.action !== undefined && rule._custom === true;
    const effectiveAction = perParamOverride ? rule.action : globalMode;
    const effectiveValue = perParamOverride && rule.action === 'rewrite'
      ? (rule.value ?? globalRewriteValue)
      : globalRewriteValue;

    // Capture all values for this key (a URL can have ?key=a&key=b), then
    // delete every occurrence. We'll re-add them below if the action is
    // "rewrite" rather than "remove".
    const values = url.searchParams.getAll(key);
    url.searchParams.delete(key);

    if (effectiveAction === 'rewrite') {
      // Re-add the same number of occurrences, but with the replacement
      // value. This preserves the URL's "shape" (number of params with
      // this key) without leaking the original tracking value.
      for (let i = 0; i < values.length; i++) {
        url.searchParams.append(key, effectiveValue);
      }
    }
    // For "remove", we already deleted the key above and we don't add anything back.

    result.changed = true;
    result.paramCounts[key] = (result.paramCounts[key] ?? 0) + values.length;
  }

  // Only build the new URL string if we actually changed something — saves
  // a tiny amount of work in the common "URL had no tracking params" case.
  if (result.changed) {
    result.url = url.toString();
  }

  return result;
}
