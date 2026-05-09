// entrypoints/background.ts
// -----------------------------------------------------------------------------
// BACKGROUND SERVICE WORKER
//
// This is the coordinator. It does three things:
//   1. Tracks how many links got rewritten on each tab, and shows the
//      number on the toolbar badge.
//   2. Answers questions from the popup about per-tab counts.
//   3. Broadcasts config changes from extension storage out to every
//      open tab so their content scripts can pick up new rules.
//
// HOW IT WORKS:
//   - Content scripts running on each tab post `rewriteCount` messages
//     here whenever they finish a scan or process new mutations. We
//     keep a per-tab map of those counts and update the badge.
//   - The popup, when it opens, asks us "what was rewritten on the
//     active tab?" — we look it up in the map and reply.
//   - When extension storage changes (because the popup wrote new
//     config), we re-read the config and push it out to every tab.
//
// PRIVACY NOTICE:
//   - This script does NOT make any network calls.
//   - The per-tab data we keep is just integers (counts) and strings
//     (the parameter names like "utm_source"). No URLs, no page text,
//     no browsing history.
//   - When a tab closes, its data is deleted immediately.
//   - You can verify all of this by reading the code below.
// -----------------------------------------------------------------------------

import { getConfig } from '@/utils/storage';

/**
 * Per-tab data we track in memory only (lost on extension restart).
 *
 * @property count - Total number of links rewritten on this tab in the
 *                   current page session.
 * @property paramCounts - Per-parameter breakdown of which trackers were
 *                         touched. Used by the popup to show a badge
 *                         beside each parameter in the customize view.
 */
interface TabData {
  count: number;
  paramCounts: Record<string, number>;
}

export default defineBackground(() => {
  // The in-memory per-tab data store. Keyed by browser tab ID.
  // Cleared when the tab closes (see browser.tabs.onRemoved below).
  const tabData: Record<number, TabData> = {};

  // -------------------------------------------------------------------------
  // INSTALLATION HANDLER
  // Runs once when the extension is first installed or updated. The
  // `getConfig()` call seeds default settings if there's no saved
  // config yet — that way the user gets a working setup without having
  // to open the popup first.
  // -------------------------------------------------------------------------
  browser.runtime.onInstalled.addListener(async () => {
    await getConfig();
  });

  // -------------------------------------------------------------------------
  // MESSAGE BUS
  // Two kinds of messages come in:
  //   1. `rewriteCount` from content scripts after they scan a page.
  //      We update the per-tab counter and the toolbar badge.
  //   2. `getTabCounts` from the popup when it opens. We reply with
  //      the count + per-parameter breakdown for the requested tab.
  // -------------------------------------------------------------------------
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message.type === 'rewriteCount') {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        tabData[tabId] = {
          count: message.count,
          paramCounts: message.paramCounts ?? {},
        };

        // Show the count on the toolbar badge. An empty string clears
        // the badge entirely (when there's nothing to rewrite, we don't
        // want a "0" sitting there). A blue badge color matches the
        // popup's accent color for visual continuity.
        const text = message.count > 0 ? String(message.count) : '';
        browser.action.setBadgeText({ text, tabId });
        browser.action.setBadgeBackgroundColor({ color: '#4A90D9', tabId });
      }
    }

    if (message.type === 'getTabCounts') {
      // The popup queries this when it opens. Default to zero/empty
      // if we have no record for the tab (e.g. tab predates the
      // extension being loaded, or the page has no links).
      return Promise.resolve(
        tabData[message.tabId] ?? { count: 0, paramCounts: {} },
      );
    }
  });

  // -------------------------------------------------------------------------
  // TAB CLEANUP
  // When a tab closes, drop its entry from the in-memory store. Without
  // this, the map would grow over the lifetime of the browser session.
  // -------------------------------------------------------------------------
  browser.tabs.onRemoved.addListener((tabId) => {
    delete tabData[tabId];
  });

  // -------------------------------------------------------------------------
  // STORAGE-CHANGE BROADCAST
  // When the popup writes a new config (toggling the master switch,
  // adding a parameter, etc.), browser.storage.onChanged fires here.
  // We re-read the merged config and push it out to every open tab so
  // their content scripts can update without the user reloading pages.
  //
  // The .catch on sendMessage is because not every tab will have our
  // content script — extension pages, internal browser pages, etc. don't
  // and `sendMessage` rejects with "Receiving end does not exist" for
  // those. That's expected; we silently ignore.
  // -------------------------------------------------------------------------
  browser.storage.onChanged.addListener(async () => {
    const config = await getConfig();
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        browser.tabs.sendMessage(tab.id, {
          type: 'configUpdated',
          config,
        }).catch(() => {});
      }
    }
  });
});
