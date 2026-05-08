import { getConfig } from '@/utils/storage';

export default defineBackground(() => {
  const tabData: Record<number, { count: number; paramCounts: Record<string, number> }> = {};

  browser.runtime.onInstalled.addListener(async () => {
    await getConfig();
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message.type === 'rewriteCount') {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        tabData[tabId] = { count: message.count, paramCounts: message.paramCounts ?? {} };
        const text = message.count > 0 ? String(message.count) : '';
        browser.action.setBadgeText({ text, tabId });
        browser.action.setBadgeBackgroundColor({ color: '#4A90D9', tabId });
      }
    }

    if (message.type === 'getTabCounts') {
      return Promise.resolve(tabData[message.tabId] ?? { count: 0, paramCounts: {} });
    }
  });

  // Clean up tab data when tabs close
  browser.tabs.onRemoved.addListener((tabId) => {
    delete tabData[tabId];
  });

  browser.storage.onChanged.addListener(async () => {
    const config = await getConfig();
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        browser.tabs.sendMessage(tab.id, { type: 'configUpdated', config }).catch(() => {});
      }
    }
  });
});
