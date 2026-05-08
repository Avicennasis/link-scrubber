import type { ParamConfig, GlobalMode } from './storage';

export interface RewriteResult {
  url: string;
  changed: boolean;
  paramCounts: Record<string, number>;
}

export function rewriteUrl(
  urlString: string,
  params: Record<string, ParamConfig>,
  globalMode: GlobalMode,
  globalRewriteValue: string,
): RewriteResult {
  const result: RewriteResult = { url: urlString, changed: false, paramCounts: {} };

  if (!urlString || urlString.startsWith('javascript:') || urlString.startsWith('mailto:')) {
    return result;
  }

  let url: URL;
  try {
    url = new URL(urlString, document.baseURI);
  } catch {
    return result;
  }

  const keys = Array.from(url.searchParams.keys());

  for (const key of keys) {
    const rule = params[key];
    if (!rule) continue;

    // Resolve effective action: per-param action if set, otherwise global
    const perParamOverride = rule.action !== undefined && rule._custom;
    const effectiveAction = perParamOverride ? rule.action : globalMode;
    const effectiveValue = perParamOverride && rule.action === 'rewrite'
      ? (rule.value ?? globalRewriteValue)
      : globalRewriteValue;

    const values = url.searchParams.getAll(key);
    url.searchParams.delete(key);

    if (effectiveAction === 'rewrite') {
      for (let i = 0; i < values.length; i++) {
        url.searchParams.append(key, effectiveValue);
      }
    }

    result.changed = true;
    result.paramCounts[key] = (result.paramCounts[key] ?? 0) + values.length;
  }

  if (result.changed) {
    result.url = url.toString();
  }

  return result;
}
