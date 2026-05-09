// utils/storage.ts
// -----------------------------------------------------------------------------
// EXTENSION CONFIG STORAGE
//
// This file owns the data model and the read/write API for the user's
// saved configuration. Everything else in the extension goes through these
// functions to read settings and to persist changes.
//
// HOW IT WORKS:
//   - Settings live in `browser.storage.sync`. That's a per-user, browser-
//     provided storage area that automatically syncs across the user's
//     signed-in browsers (when they have sync turned on). It is NOT a
//     server we run — Chrome and Firefox each provide their own sync
//     backend. We never see the data.
//   - The single object stored under the key `config` carries everything:
//     the on/off toggle, the global rule, the global rewrite value, and
//     the map of tracker parameters with their per-parameter overrides.
//   - On first run (no stored config exists yet), we seed the defaults
//     and return them. Subsequent reads merge the saved config with the
//     defaults so that adding a new tracker to the default list ships to
//     existing users without overwriting their customizations.
//
// PRIVACY NOTICE:
//   - The storage area is browser-managed and local to the user's profile.
//   - This script does NOT send config to any external server.
//   - The "sync" in `browser.storage.sync` refers to the BROWSER syncing
//     across the user's own devices, not us syncing it anywhere.
//   - You can verify all of this by reading the code below — there are no
//     fetch calls, no XHR, no WebSockets, nothing networked.
// -----------------------------------------------------------------------------

/**
 * Configuration for a single tracking parameter.
 *
 * @property action - "remove" drops the parameter from the URL entirely.
 *                    "rewrite" replaces its value with `value` (or the
 *                    global rewrite value if `value` is unset).
 * @property value - The replacement string for "rewrite". Optional; when
 *                   absent, the per-parameter rule falls back to the
 *                   global rewrite value (e.g. "donttrackme").
 * @property _custom - True when the user has explicitly clicked Remove or
 *                     Rewrite for this parameter in the popup. When true,
 *                     this parameter ignores the global rule and uses its
 *                     own action. When false or absent, the parameter
 *                     follows the global rule. This is what makes the
 *                     popup's per-param overrides feel intuitive.
 */
export interface ParamConfig {
  action: 'remove' | 'rewrite';
  value?: string;
  _custom?: boolean;
}

/**
 * Either remove all tracker params, or rewrite their values to a custom
 * string. The "global" rule applies to every tracker parameter that the
 * user hasn't explicitly customized.
 */
export type GlobalMode = 'remove' | 'rewrite';

/**
 * The full saved configuration object.
 *
 * @property params - Map of "tracker parameter name" → per-param config.
 * @property enabled - Master on/off toggle. When false, the extension
 *                     does nothing — links pass through untouched.
 * @property globalMode - Fallback action for any non-customized parameter.
 * @property globalRewriteValue - The replacement value used when
 *                                globalMode is "rewrite".
 */
export interface ExtensionConfig {
  params: Record<string, ParamConfig>;
  enabled: boolean;
  globalMode: GlobalMode;
  globalRewriteValue: string;
}

// -----------------------------------------------------------------------------
// DEFAULT TRACKING PARAMETERS
//
// This is the "ships out of the box" list. Every entry uses the global
// rule by default (no `_custom` flag), so flipping the global toggle
// between "remove" and "rewrite" affects them all. Users can add their
// own parameters or remove these via the popup.
//
// Sources:
//   utm_*       — Google Analytics (Urchin Tracking Module)
//   fbclid/fbid — Facebook
//   gclid       — Google Ads
//   gad_source  — Google Ads
//   msclkid     — Microsoft Advertising
//   mc_eid/cid  — Mailchimp
//   _ga/_gl     — Google Analytics
//   igshid      — Instagram
//   spm/scm     — AliExpress / Alibaba
// -----------------------------------------------------------------------------
const DEFAULT_PARAMS: Record<string, ParamConfig> = {
  utm_source: { action: 'remove' },
  utm_medium: { action: 'remove' },
  utm_campaign: { action: 'remove' },
  utm_term: { action: 'remove' },
  utm_content: { action: 'remove' },
  fbclid: { action: 'remove' },
  fbid: { action: 'remove' },
  gclid: { action: 'remove' },
  gad_source: { action: 'remove' },
  msclkid: { action: 'remove' },
  mc_eid: { action: 'remove' },
  mc_cid: { action: 'remove' },
  _ga: { action: 'remove' },
  _gl: { action: 'remove' },
  igshid: { action: 'remove' },
  spm: { action: 'remove' },
  scm: { action: 'remove' },
};

const DEFAULT_CONFIG: ExtensionConfig = {
  params: DEFAULT_PARAMS,
  enabled: true,
  globalMode: 'rewrite',
  globalRewriteValue: 'donttrackme',
};

/**
 * Load the user's configuration from `browser.storage.sync`.
 *
 * On first run (no saved config), seeds the defaults into storage and
 * returns them. On subsequent runs, merges the saved config with the
 * defaults — this way any new default parameters added in a new release
 * reach existing users without forcing a "Reset to defaults" that would
 * wipe their customizations.
 *
 * KNOWN BEHAVIOR: if a user has explicitly *deleted* a default parameter
 * via the popup (which removes it from `stored.config.params`), it will
 * reappear after a release that adds new defaults — because the merge
 * layers DEFAULT_PARAMS underneath the stored params. The simplest fix
 * for that user is to delete it again. Tracking deletions explicitly
 * would require a schema field for "params the user removed", which is
 * complexity not worth carrying for this edge case.
 *
 * @returns The merged `ExtensionConfig`. Never throws — falls back to
 *          defaults on any storage error.
 */
export async function getConfig(): Promise<ExtensionConfig> {
  const stored = await browser.storage.sync.get('config');
  if (!stored.config) {
    // First run on this profile — seed the defaults and return them.
    await browser.storage.sync.set({ config: DEFAULT_CONFIG });
    return { ...DEFAULT_CONFIG };
  }
  // Deep-merge the params field so new defaults reach existing users.
  // Top-level fields (enabled, globalMode, globalRewriteValue) always
  // come from the stored config because the user's choices for those
  // are what they expect to see.
  return {
    ...DEFAULT_CONFIG,
    ...stored.config,
    params: {
      ...DEFAULT_PARAMS,
      ...stored.config.params,
    },
  };
}

/**
 * Add or update a single parameter's configuration. Used by the popup
 * when the user clicks Remove/Rewrite for a specific parameter or types
 * a custom rewrite value.
 *
 * @param name - The parameter name (e.g. "utm_source").
 * @param config - The new config for that parameter.
 */
export async function updateParam(name: string, config: ParamConfig): Promise<void> {
  const full = await getConfig();
  full.params[name] = config;
  await browser.storage.sync.set({ config: full });
}

/**
 * Delete a parameter from the user's tracker list entirely. The parameter
 * will no longer be touched on any URL until the user adds it back.
 *
 * @param name - The parameter name to remove.
 */
export async function removeParam(name: string): Promise<void> {
  const full = await getConfig();
  delete full.params[name];
  await browser.storage.sync.set({ config: full });
}

/**
 * Reset everything back to the shipped defaults. Wipes any user
 * customizations.
 */
export async function resetDefaults(): Promise<void> {
  await browser.storage.sync.set({ config: { ...DEFAULT_CONFIG } });
}

/**
 * Toggle the master on/off switch. When false, the rest of the
 * extension is a no-op until the user turns it back on.
 *
 * @param enabled - Whether the extension should be active.
 */
export async function setEnabled(enabled: boolean): Promise<void> {
  const full = await getConfig();
  full.enabled = enabled;
  await browser.storage.sync.set({ config: full });
}

/**
 * Switch the global rule between "remove" and "rewrite". This affects
 * every parameter that doesn't have its own `_custom` override.
 *
 * @param mode - The new global rule.
 */
export async function setGlobalMode(mode: GlobalMode): Promise<void> {
  const full = await getConfig();
  full.globalMode = mode;
  await browser.storage.sync.set({ config: full });
}

/**
 * Update the replacement string used by the global "rewrite" rule.
 * Default is "donttrackme" but users can choose anything.
 *
 * @param value - The new global rewrite value.
 */
export async function setGlobalRewriteValue(value: string): Promise<void> {
  const full = await getConfig();
  full.globalRewriteValue = value;
  await browser.storage.sync.set({ config: full });
}
