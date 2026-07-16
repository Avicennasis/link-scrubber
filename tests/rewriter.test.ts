// tests/rewriter.test.ts
// -----------------------------------------------------------------------------
// REWRITER UNIT TESTS
//
// These tests cover the pure URL-rewriting logic in `utils/rewriter.ts`.
// The rewriter is the single source of truth used by both the content
// script (DOM <a href> rewrites) and the main-world script (programmatic
// navigation interception), so getting it right matters for both paths.
//
// All tests run in node with happy-dom (see vitest.config.ts) — no
// browser, no extension runtime, no network. The rewriter only needs
// `new URL(...)` and `document.baseURI`, both of which happy-dom provides.
// -----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { rewriteUrl } from '../utils/rewriter';
import type { ParamConfig, GlobalMode } from '../utils/storage';

// -----------------------------------------------------------------------------
// TEST HELPERS
// -----------------------------------------------------------------------------

/**
 * A minimal config-with-defaults helper so individual tests don't have
 * to repeat boilerplate. Returns a params map with one tracker by name
 * (matching the typical 17-default shape).
 */
function makeParams(...names: string[]): Record<string, ParamConfig> {
  const params: Record<string, ParamConfig> = {};
  for (const n of names) {
    params[n] = { action: 'remove' };
  }
  return params;
}

const REWRITE_VALUE = 'donttrackme';

// -----------------------------------------------------------------------------
// CORE BEHAVIOR
// -----------------------------------------------------------------------------

describe('rewriteUrl — core behavior', () => {
  it('returns the original URL unchanged when there are no matching params', () => {
    const params = makeParams('utm_source');
    const r = rewriteUrl('https://example.com/path?foo=1&bar=2', params, 'rewrite', REWRITE_VALUE);
    expect(r.changed).toBe(false);
    expect(r.url).toBe('https://example.com/path?foo=1&bar=2');
    expect(r.paramCounts).toEqual({});
  });

  it('returns the original URL unchanged when the URL has no query string', () => {
    const params = makeParams('utm_source');
    const r = rewriteUrl('https://example.com/path', params, 'rewrite', REWRITE_VALUE);
    expect(r.changed).toBe(false);
    expect(r.url).toBe('https://example.com/path');
  });

  it('rewrites a tracking parameter to the global rewrite value when globalMode=rewrite', () => {
    const params = makeParams('utm_source');
    const r = rewriteUrl('https://example.com/?utm_source=fb', params, 'rewrite', REWRITE_VALUE);
    expect(r.changed).toBe(true);
    expect(new URL(r.url).searchParams.get('utm_source')).toBe(REWRITE_VALUE);
    expect(r.paramCounts).toEqual({ utm_source: 1 });
  });

  it('removes a tracking parameter entirely when globalMode=remove', () => {
    const params = makeParams('utm_source');
    const r = rewriteUrl('https://example.com/?utm_source=fb', params, 'remove', REWRITE_VALUE);
    expect(r.changed).toBe(true);
    expect(new URL(r.url).searchParams.has('utm_source')).toBe(false);
    expect(r.paramCounts).toEqual({ utm_source: 1 });
  });

  it('counts each occurrence when the same key appears multiple times', () => {
    const params = makeParams('utm_source');
    const r = rewriteUrl('https://example.com/?utm_source=a&utm_source=b', params, 'remove', REWRITE_VALUE);
    expect(r.changed).toBe(true);
    expect(r.paramCounts).toEqual({ utm_source: 2 });
    expect(new URL(r.url).searchParams.has('utm_source')).toBe(false);
  });

  it('preserves non-tracking parameters', () => {
    const params = makeParams('utm_source');
    const r = rewriteUrl('https://example.com/?keep=this&utm_source=fb', params, 'remove', REWRITE_VALUE);
    const u = new URL(r.url);
    expect(u.searchParams.get('keep')).toBe('this');
    expect(u.searchParams.has('utm_source')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// PER-PARAM CUSTOMIZATION (THE _custom FLAG)
// -----------------------------------------------------------------------------

describe('rewriteUrl — per-param overrides', () => {
  it('honors a _custom override that says rewrite when global is remove', () => {
    const params: Record<string, ParamConfig> = {
      utm_source: { action: 'rewrite', value: 'OVERRIDE', _custom: true },
    };
    const r = rewriteUrl('https://example.com/?utm_source=fb', params, 'remove', REWRITE_VALUE);
    expect(r.changed).toBe(true);
    expect(new URL(r.url).searchParams.get('utm_source')).toBe('OVERRIDE');
  });

  it('honors a _custom override that says remove when global is rewrite', () => {
    const params: Record<string, ParamConfig> = {
      utm_source: { action: 'remove', _custom: true },
    };
    const r = rewriteUrl('https://example.com/?utm_source=fb', params, 'rewrite', REWRITE_VALUE);
    expect(r.changed).toBe(true);
    expect(new URL(r.url).searchParams.has('utm_source')).toBe(false);
  });

  it('falls back to global rewrite value when _custom override has no value', () => {
    const params: Record<string, ParamConfig> = {
      utm_source: { action: 'rewrite', _custom: true },
    };
    const r = rewriteUrl('https://example.com/?utm_source=fb', params, 'remove', REWRITE_VALUE);
    expect(new URL(r.url).searchParams.get('utm_source')).toBe(REWRITE_VALUE);
  });

  it('ignores rule.action when _custom is not set (uses global instead)', () => {
    // Default config has action: 'remove' but no _custom flag — global rule wins.
    const params: Record<string, ParamConfig> = {
      utm_source: { action: 'remove' },
    };
    const r = rewriteUrl('https://example.com/?utm_source=fb', params, 'rewrite', REWRITE_VALUE);
    expect(new URL(r.url).searchParams.get('utm_source')).toBe(REWRITE_VALUE);
  });
});

// -----------------------------------------------------------------------------
// SAFETY & EDGE CASES
// -----------------------------------------------------------------------------

describe('rewriteUrl — safety & edge cases', () => {
  it.each([
    ['empty string', ''],
    ['javascript: URI', 'javascript:alert(1)'],
    ['mailto: URI', 'mailto:test@example.com?utm_source=fb'],
  ])('returns the input untouched for %s', (_label, input) => {
    const params = makeParams('utm_source');
    const r = rewriteUrl(input, params, 'remove', REWRITE_VALUE);
    expect(r.changed).toBe(false);
    expect(r.url).toBe(input);
    expect(r.paramCounts).toEqual({});
  });

  it('returns the original input on malformed URL', () => {
    const params = makeParams('utm_source');
    const r = rewriteUrl('not a url at all', params, 'remove', REWRITE_VALUE);
    expect(r.changed).toBe(false);
    expect(r.url).toBe('not a url at all');
  });

  it('processes multiple different tracking parameters in the same URL', () => {
    const params = makeParams('utm_source', 'fbclid', 'gclid');
    const url = 'https://example.com/?utm_source=fb&fbclid=abc&gclid=xyz&keep=1';
    const r = rewriteUrl(url, params, 'remove', REWRITE_VALUE);
    expect(r.changed).toBe(true);
    expect(r.paramCounts).toEqual({ utm_source: 1, fbclid: 1, gclid: 1 });
    const u = new URL(r.url);
    expect(u.searchParams.has('utm_source')).toBe(false);
    expect(u.searchParams.has('fbclid')).toBe(false);
    expect(u.searchParams.has('gclid')).toBe(false);
    expect(u.searchParams.get('keep')).toBe('1');
  });
});

// -----------------------------------------------------------------------------
// PARITY GUARANTEE
//
// These tests guarantee the rewriter behaves the same across the two
// places it's called from — content script and main-world script.
// They both use this same function, so the parity check is literally
// "does the function behave consistently for the inputs each path
// would feed it?"
// -----------------------------------------------------------------------------

describe('rewriteUrl — parity between content script and main-world paths', () => {
  it.each<[string, GlobalMode, string, string]>([
    // [name, globalMode, input, expected substring]
    ['content-script-style with default rewrite global', 'rewrite', 'https://example.com/?utm_source=fb', 'utm_source=donttrackme'],
    ['main-world-style with default rewrite global', 'rewrite', 'https://example.com/p?utm_source=fb', 'utm_source=donttrackme'],
    ['content-script-style with remove global', 'remove', 'https://example.com/?utm_source=fb', 'example.com/'],
    ['main-world-style with remove global', 'remove', 'https://example.com/p?utm_source=fb', 'example.com/p'],
  ])('%s yields a URL containing %s', (_label, mode, input, expected) => {
    const params = makeParams('utm_source');
    const r = rewriteUrl(input, params, mode, REWRITE_VALUE);
    expect(r.changed).toBe(true);
    expect(r.url).toContain(expected);
  });
});

// -----------------------------------------------------------------------------
// EXPLICIT baseUrl (service-worker safety, FR-269)
// -----------------------------------------------------------------------------

describe('rewriteUrl — explicit baseUrl parameter', () => {
  it('resolves a relative URL against an explicit baseUrl', () => {
    const params = makeParams('utm_source');
    const r = rewriteUrl('/path?utm_source=fb', params, 'remove', REWRITE_VALUE, 'https://example.com/');
    expect(r.changed).toBe(true);
    expect(r.url).toBe('https://example.com/path');
  });

  it('rewrites absolute URLs regardless of baseUrl', () => {
    const params = makeParams('utm_source');
    const r = rewriteUrl('https://site.test/p?utm_source=fb', params, 'remove', REWRITE_VALUE, 'https://other.example/');
    expect(r.changed).toBe(true);
    expect(r.url).toBe('https://site.test/p');
  });

  it('passes an unresolvable relative URL through unchanged when no base is usable', () => {
    // Simulate a service-worker-like context: no baseUrl and no document.
    const params = makeParams('utm_source');
    const originalDoc = globalThis.document;
    // @ts-expect-error - deliberately removing document to mimic a worker
    delete globalThis.document;
    try {
      const r = rewriteUrl('/rel?utm_source=fb', params, 'remove', REWRITE_VALUE);
      expect(r.changed).toBe(false);
      expect(r.url).toBe('/rel?utm_source=fb');
    } finally {
      globalThis.document = originalDoc;
    }
  });
});
