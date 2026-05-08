export interface ParamConfig {
  action: 'remove' | 'rewrite';
  value?: string;
  _custom?: boolean; // true when user explicitly set this param's action (overrides global)
}

export type GlobalMode = 'remove' | 'rewrite';

export interface ExtensionConfig {
  params: Record<string, ParamConfig>;
  enabled: boolean;
  globalMode: GlobalMode;
  globalRewriteValue: string;
}

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

export async function getConfig(): Promise<ExtensionConfig> {
  const stored = await browser.storage.sync.get('config');
  if (!stored.config) {
    await browser.storage.sync.set({ config: DEFAULT_CONFIG });
    return { ...DEFAULT_CONFIG };
  }
  // Merge with defaults so new fields get values when upgrading
  return {
    ...DEFAULT_CONFIG,
    ...stored.config,
  };
}

export async function updateParam(name: string, config: ParamConfig): Promise<void> {
  const full = await getConfig();
  full.params[name] = config;
  await browser.storage.sync.set({ config: full });
}

export async function removeParam(name: string): Promise<void> {
  const full = await getConfig();
  delete full.params[name];
  await browser.storage.sync.set({ config: full });
}

export async function resetDefaults(): Promise<void> {
  await browser.storage.sync.set({ config: { ...DEFAULT_CONFIG } });
}

export async function setEnabled(enabled: boolean): Promise<void> {
  const full = await getConfig();
  full.enabled = enabled;
  await browser.storage.sync.set({ config: full });
}

export async function setGlobalMode(mode: GlobalMode): Promise<void> {
  const full = await getConfig();
  full.globalMode = mode;
  await browser.storage.sync.set({ config: full });
}

export async function setGlobalRewriteValue(value: string): Promise<void> {
  const full = await getConfig();
  full.globalRewriteValue = value;
  await browser.storage.sync.set({ config: full });
}
