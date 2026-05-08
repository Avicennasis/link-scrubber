import { getConfig, type ExtensionConfig } from '@/utils/storage';
import { rewriteUrl } from '@/utils/rewriter';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  async main(ctx) {
    let config = await getConfig();
    let rewriteCount = 0;
    let paramCounts: Record<string, number> = {};

    function processLink(a: HTMLAnchorElement) {
      if (!config.enabled) return;
      const result = rewriteUrl(a.href, config.params, config.globalMode, config.globalRewriteValue);
      if (result.changed) {
        a.href = result.url;
        rewriteCount++;
        for (const [param, count] of Object.entries(result.paramCounts)) {
          paramCounts[param] = (paramCounts[param] ?? 0) + count;
        }
      }
    }

    function scanAllLinks() {
      rewriteCount = 0;
      paramCounts = {};
      const links = document.querySelectorAll<HTMLAnchorElement>('a[href]');
      links.forEach(processLink);
      reportCount();
    }

    function reportCount() {
      if (!ctx.isValid) return;
      browser.runtime.sendMessage({ type: 'rewriteCount', count: rewriteCount, paramCounts }).catch(() => {});
    }

    // Inject main world script for navigation interception
    const script = document.createElement('script');
    script.src = browser.runtime.getURL('/main-world.js');
    script.onload = () => {
      script.remove();
      window.postMessage({ type: 'link-scrubber-config', config }, '*');
    };
    (document.head || document.documentElement).appendChild(script);

    // Initial scan
    scanAllLinks();

    // MutationObserver for dynamically added links
    let idleCallbackId: number | null = null;

    function scheduleScan() {
      if (idleCallbackId !== null || !ctx.isValid) return;
      idleCallbackId = requestIdleCallback(() => {
        idleCallbackId = null;
        if (!ctx.isValid) return;
        const links = document.querySelectorAll<HTMLAnchorElement>('a[href]');
        links.forEach(processLink);
        reportCount();
      });
    }

    const observer = new MutationObserver((mutations) => {
      if (!ctx.isValid) {
        observer.disconnect();
        return;
      }
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLAnchorElement) {
            processLink(node);
          } else if (node instanceof HTMLElement) {
            const links = node.querySelectorAll<HTMLAnchorElement>('a[href]');
            links.forEach(processLink);
          }
        }
      }
      reportCount();
      scheduleScan();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Clean up observer when extension context is invalidated (reload/update)
    ctx.onInvalidated(() => {
      observer.disconnect();
      if (idleCallbackId !== null) {
        cancelIdleCallback(idleCallbackId);
        idleCallbackId = null;
      }
    });

    // Listen for config updates from background
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
