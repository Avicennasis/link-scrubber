import type { ExtensionConfig } from '@/utils/storage';

export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    let config: ExtensionConfig | null = null;

    // Receive config from content script
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'link-scrubber-config') {
        config = event.data.config;
      }
    });

    function rewriteUrl(urlString: string): string {
      if (!config || !config.enabled) return urlString;
      if (!urlString || urlString.startsWith('javascript:') || urlString.startsWith('mailto:')) {
        return urlString;
      }

      try {
        const url = new URL(urlString, document.baseURI);
        let changed = false;
        const keys = Array.from(url.searchParams.keys());

        for (const key of keys) {
          const rule = config.params[key];
          if (!rule) continue;
          const values = url.searchParams.getAll(key);
          url.searchParams.delete(key);
          if (rule.action === 'rewrite' && rule.value !== undefined) {
            for (let i = 0; i < values.length; i++) {
              url.searchParams.append(key, rule.value);
            }
          }
          changed = true;
        }

        return changed ? url.toString() : urlString;
      } catch {
        return urlString;
      }
    }

    // Monkey-patch history.pushState
    const originalPushState = history.pushState.bind(history);
    history.pushState = function (data: any, title: string, url?: string | URL | null) {
      if (url && typeof url === 'string') {
        url = rewriteUrl(url);
      }
      return originalPushState(data, title, url);
    };

    // Monkey-patch history.replaceState
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function (data: any, title: string, url?: string | URL | null) {
      if (url && typeof url === 'string') {
        url = rewriteUrl(url);
      }
      return originalReplaceState(data, title, url);
    };

    // Wrap window.open
    const originalOpen = window.open.bind(window);
    window.open = function (url?: string | URL, target?: string, features?: string) {
      if (url && typeof url === 'string') {
        url = rewriteUrl(url);
      } else if (url instanceof URL) {
        const rewritten = rewriteUrl(url.toString());
        url = new URL(rewritten);
      }
      return originalOpen(url, target, features);
    } as typeof window.open;
  },
});
