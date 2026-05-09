// entrypoints/popup/main.ts
// -----------------------------------------------------------------------------
// POPUP UI CONTROLLER
//
// This is the JavaScript that powers the toolbar popup — the small panel
// that shows up when you click the Link Scrubber icon. It:
//   - Shows a master on/off toggle
//   - Shows a count of links rewritten on the current tab
//   - Lets the user pick "Remove all" or "Rewrite all to [value]"
//   - In an expandable section, shows every tracker parameter in the
//     config and lets the user customize each one individually
//   - Lets the user add or remove tracker parameters from the list
//   - Has a "Reset to defaults" link that wipes customizations
//
// HOW IT WORKS:
//   - The popup HTML (index.html) defines the structure and gives every
//     interactive element an `id`. This script reads those ids, attaches
//     click/change handlers, and renders the param list dynamically.
//   - All state lives in extension storage (via utils/storage.ts). When
//     the user clicks something, this script updates storage and then
//     calls `reload()` to re-render with the new state.
//   - Per-page rewrite counts come from the background service worker
//     (which receives them from the content script). The popup asks
//     the background for the active tab's counts on every render.
//
// PRIVACY NOTICE:
//   - This script does NOT make any network calls.
//   - It only reads/writes the config in extension storage and queries
//     per-tab counts from the background script.
//   - You can verify all of this by reading the code below.
// -----------------------------------------------------------------------------

import {
  getConfig, updateParam, removeParam, resetDefaults,
  setEnabled, setGlobalMode, setGlobalRewriteValue,
  type ExtensionConfig,
} from '@/utils/storage';

// -----------------------------------------------------------------------------
// DOM HANDLES
// Cache references to all interactive elements upfront. Each element is
// guaranteed to exist because index.html defines them all with these ids.
// The `as` casts narrow the generic Element type to the specific subtype
// so TypeScript knows about element-specific properties (.value, .checked).
// -----------------------------------------------------------------------------
const enabledToggle = document.getElementById('enabledToggle') as HTMLInputElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;
const paramList = document.getElementById('paramList') as HTMLDivElement;
const newParamInput = document.getElementById('newParam') as HTMLInputElement;
const addBtn = document.getElementById('addBtn') as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
const expandBtn = document.getElementById('expandBtn') as HTMLButtonElement;
const addParamSection = document.getElementById('addParamSection') as HTMLDivElement;
const globalRemove = document.getElementById('globalRemove') as HTMLButtonElement;
const globalRewrite = document.getElementById('globalRewrite') as HTMLButtonElement;
const globalValue = document.getElementById('globalValue') as HTMLInputElement;

// -----------------------------------------------------------------------------
// LOCAL UI STATE
// Two pieces of state live only in the popup process:
//   - `expanded`: whether the per-param section is currently visible.
//     Closes back to "collapsed" each time the popup is reopened.
//   - `currentParamCounts`: the per-parameter counts for the active
//     tab, fetched from the background. Used to render the badge
//     numbers next to each parameter in the customize view.
// -----------------------------------------------------------------------------
let expanded = false;
let currentParamCounts: Record<string, number> = {};

/**
 * Ask the background script how many links got rewritten on the
 * currently-active tab and update the stats label.
 *
 * Wrapped in try/catch because querying tabs or messaging the background
 * can fail in odd cases (extension reload, tab gone, etc.). On any
 * failure, just clear the stats display rather than crash.
 */
async function loadStats() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Round-trip to the background script for the per-tab data.
    const data = await browser.runtime.sendMessage({ type: 'getTabCounts', tabId: tab.id });
    const count = data?.count ?? 0;
    currentParamCounts = data?.paramCounts ?? {};

    statsEl.textContent = count > 0
      ? `${count} link${count !== 1 ? 's' : ''} rewritten on this page`
      : 'No links rewritten on this page';
  } catch {
    statsEl.textContent = '';
  }
}

/**
 * Update the global "Remove all" / "Rewrite all to [value]" toggle UI to
 * reflect the current config. The active button gets the `active` class
 * (which the CSS styles in blue), and the rewrite-value input only
 * shows when the active mode is "rewrite".
 *
 * @param config - The current config to render from.
 */
function updateGlobalToggleUI(config: ExtensionConfig) {
  const isRemove = config.globalMode === 'remove';
  globalRemove.className = isRemove ? 'active' : '';
  globalRewrite.className = isRemove ? '' : 'active';
  globalValue.style.display = isRemove ? 'none' : 'block';
  globalValue.value = config.globalRewriteValue;
}

/**
 * Re-render the per-parameter customization list. Each row shows:
 *   - the parameter name
 *   - a count badge for how many times it was touched on this page
 *   - the active action (Remove / Rewrite) — clicking either toggles it
 *   - if Rewrite is active, a text input for the per-param value
 *   - a delete button (×) to remove the parameter from the list
 *
 * Entries are sorted alphabetically so the list is stable as users edit.
 *
 * @param config - The current config to render from.
 */
function renderParams(config: ExtensionConfig) {
  // Clear the existing rows. Using removeChild rather than innerHTML to
  // avoid any chance of HTML injection through parameter names. (Param
  // names are user-editable strings, so we treat them as untrusted.)
  while (paramList.firstChild) {
    paramList.removeChild(paramList.firstChild);
  }

  // Stable, alphabetical order — predictable for the user.
  const entries = Object.entries(config.params).sort(([a], [b]) => a.localeCompare(b));

  for (const [name, paramConfig] of entries) {
    const row = document.createElement('div');
    row.className = 'param-row';

    // Parameter name (monospace, ellipsized if it's very long).
    const nameEl = document.createElement('span');
    nameEl.className = 'param-name';
    nameEl.textContent = name;
    nameEl.title = name;

    // Per-param count badge. Greyed out when the count is zero.
    const countEl = document.createElement('span');
    const count = currentParamCounts[name] ?? 0;
    countEl.className = 'param-count' + (count === 0 ? ' zero' : '');
    countEl.textContent = String(count);

    // Action toggle (Remove / Rewrite). The displayed action is the
    // *effective* one — if the user has explicitly customized this
    // param, use its action; otherwise show the global mode.
    const toggle = document.createElement('div');
    toggle.className = 'action-toggle';

    const isCustom = paramConfig._custom === true;
    const effectiveAction = isCustom ? paramConfig.action : config.globalMode;

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className = effectiveAction === 'remove' ? 'active' : '';
    // Clicking Remove pins this param to "remove" via _custom: true.
    removeBtn.addEventListener('click', () => {
      updateParam(name, { action: 'remove', _custom: true }).then(reload);
    });

    const rewriteBtn = document.createElement('button');
    rewriteBtn.textContent = 'Rewrite';
    rewriteBtn.className = effectiveAction === 'rewrite' ? 'active' : '';
    // Clicking Rewrite pins this param to "rewrite". If the user hasn't
    // typed a per-param value yet, fall back to the global one so the
    // result is always meaningful.
    rewriteBtn.addEventListener('click', () => {
      updateParam(name, {
        action: 'rewrite',
        value: paramConfig.value ?? config.globalRewriteValue,
        _custom: true,
      }).then(reload);
    });

    toggle.appendChild(removeBtn);
    toggle.appendChild(rewriteBtn);

    // Per-param rewrite-value input. Only visible when this param's
    // effective action is "rewrite". Editing it pins the param to
    // _custom: true and saves the new value.
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'rewrite-value';
    valueInput.placeholder = config.globalRewriteValue;
    valueInput.value = paramConfig.value ?? '';
    valueInput.style.display = effectiveAction === 'rewrite' ? 'block' : 'none';
    valueInput.addEventListener('change', () => {
      updateParam(name, {
        action: 'rewrite',
        value: valueInput.value,
        _custom: true,
      }).then(reload);
    });

    // Delete button — removes the parameter from the user's tracker
    // list entirely. The "×" character is rendered as an icon by the
    // CSS; on hover it turns red to telegraph the destructive action.
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Remove parameter';
    deleteBtn.addEventListener('click', () => {
      removeParam(name).then(reload);
    });

    row.appendChild(nameEl);
    row.appendChild(countEl);
    row.appendChild(toggle);
    row.appendChild(valueInput);
    row.appendChild(deleteBtn);
    paramList.appendChild(row);
  }
}

/**
 * Toggle the per-param customize section's visibility. The section
 * starts hidden and only opens when the user explicitly clicks
 * "Customize per-param ▾" — that keeps the popup compact for the
 * common case where the global rule is enough.
 */
function toggleExpand() {
  expanded = !expanded;
  paramList.className = expanded ? 'param-list visible' : 'param-list';
  addParamSection.className = expanded ? 'add-param visible' : 'add-param';
  expandBtn.textContent = expanded ? 'Collapse ▾' : 'Customize per-param ▾';
  expandBtn.className = expanded ? 'expand-btn expanded' : 'expand-btn';
}

/**
 * Re-fetch everything from storage and re-render the whole popup.
 * Called once at startup and after any user action that changes
 * config — keeping the UI a pure function of storage state means we
 * don't have to track partial updates.
 */
async function reload() {
  const config = await getConfig();
  enabledToggle.checked = config.enabled;
  updateGlobalToggleUI(config);
  await loadStats();
  renderParams(config);
}

// -----------------------------------------------------------------------------
// EVENT WIRING
// Hook every interactive element to its action. Each handler updates
// storage and then triggers a reload so the UI reflects the new state.
// -----------------------------------------------------------------------------

// Global "Remove all" button — clears any rewrite mode and switches
// the global rule to "remove".
globalRemove.addEventListener('click', () => {
  setGlobalMode('remove').then(reload);
});

// Global "Rewrite all to [value]" button — switches the global rule
// to "rewrite". The value input below it becomes visible.
globalRewrite.addEventListener('click', () => {
  setGlobalMode('rewrite').then(reload);
});

// Saving a new global rewrite value (typed into the text input).
globalValue.addEventListener('change', () => {
  setGlobalRewriteValue(globalValue.value).then(reload);
});

// Master on/off toggle.
enabledToggle.addEventListener('change', () => {
  setEnabled(enabledToggle.checked);
});

// Expand/collapse the per-param section.
expandBtn.addEventListener('click', toggleExpand);

// Add a new tracker parameter to the list. Defaults to "remove" — the
// user can switch it to "rewrite" with the per-row toggle if they want.
addBtn.addEventListener('click', () => {
  const name = newParamInput.value.trim();
  if (!name) return;
  updateParam(name, { action: 'remove' }).then(() => {
    newParamInput.value = '';
    reload();
  });
});

// Pressing Enter in the "add new parameter" input is the same as
// clicking the Add button.
newParamInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBtn.click();
});

// Reset everything to the shipped defaults. (No confirm dialog —
// undo is one click on the popup so the destruction is recoverable.)
resetBtn.addEventListener('click', () => {
  resetDefaults().then(reload);
});

// -----------------------------------------------------------------------------
// INITIAL RENDER
// Triggered as soon as the popup opens. Everything the user sees flows
// from this single call.
// -----------------------------------------------------------------------------
reload();
