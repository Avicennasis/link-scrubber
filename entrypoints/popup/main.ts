import {
  getConfig, updateParam, removeParam, resetDefaults,
  setEnabled, setGlobalMode, setGlobalRewriteValue,
  type ExtensionConfig,
} from '@/utils/storage';

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

let expanded = false;
let currentParamCounts: Record<string, number> = {};

async function loadStats() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    // Get per-param counts from background
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

function updateGlobalToggleUI(config: ExtensionConfig) {
  const isRemove = config.globalMode === 'remove';
  globalRemove.className = isRemove ? 'active' : '';
  globalRewrite.className = isRemove ? '' : 'active';
  globalValue.style.display = isRemove ? 'none' : 'block';
  globalValue.value = config.globalRewriteValue;
}

function renderParams(config: ExtensionConfig) {
  while (paramList.firstChild) {
    paramList.removeChild(paramList.firstChild);
  }

  const entries = Object.entries(config.params).sort(([a], [b]) => a.localeCompare(b));

  for (const [name, paramConfig] of entries) {
    const row = document.createElement('div');
    row.className = 'param-row';

    // Param name
    const nameEl = document.createElement('span');
    nameEl.className = 'param-name';
    nameEl.textContent = name;
    nameEl.title = name;

    // Per-param count badge
    const countEl = document.createElement('span');
    const count = currentParamCounts[name] ?? 0;
    countEl.className = 'param-count' + (count === 0 ? ' zero' : '');
    countEl.textContent = String(count);

    // Action toggle
    const toggle = document.createElement('div');
    toggle.className = 'action-toggle';

    // Effective action for display
    const isCustom = paramConfig._custom === true;
    const effectiveAction = isCustom ? paramConfig.action : config.globalMode;

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className = effectiveAction === 'remove' ? 'active' : '';
    removeBtn.addEventListener('click', () => {
      updateParam(name, { action: 'remove', _custom: true }).then(reload);
    });

    const rewriteBtn = document.createElement('button');
    rewriteBtn.textContent = 'Rewrite';
    rewriteBtn.className = effectiveAction === 'rewrite' ? 'active' : '';
    rewriteBtn.addEventListener('click', () => {
      updateParam(name, { action: 'rewrite', value: paramConfig.value ?? config.globalRewriteValue, _custom: true }).then(reload);
    });

    toggle.appendChild(removeBtn);
    toggle.appendChild(rewriteBtn);

    // Rewrite value input
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'rewrite-value';
    valueInput.placeholder = config.globalRewriteValue;
    valueInput.value = paramConfig.value ?? '';
    valueInput.style.display = effectiveAction === 'rewrite' ? 'block' : 'none';
    valueInput.addEventListener('change', () => {
      updateParam(name, { action: 'rewrite', value: valueInput.value, _custom: true }).then(reload);
    });

    // Delete button
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

function toggleExpand() {
  expanded = !expanded;
  paramList.className = expanded ? 'param-list visible' : 'param-list';
  addParamSection.className = expanded ? 'add-param visible' : 'add-param';
  expandBtn.textContent = expanded ? 'Collapse ▾' : 'Customize per-param ▾';
  expandBtn.className = expanded ? 'expand-btn expanded' : 'expand-btn';
}

async function reload() {
  const config = await getConfig();
  enabledToggle.checked = config.enabled;
  updateGlobalToggleUI(config);
  await loadStats();
  renderParams(config);
}

// Global toggle buttons
globalRemove.addEventListener('click', () => {
  setGlobalMode('remove').then(reload);
});

globalRewrite.addEventListener('click', () => {
  setGlobalMode('rewrite').then(reload);
});

globalValue.addEventListener('change', () => {
  setGlobalRewriteValue(globalValue.value).then(reload);
});

// Other event listeners
enabledToggle.addEventListener('change', () => {
  setEnabled(enabledToggle.checked);
});

expandBtn.addEventListener('click', toggleExpand);

addBtn.addEventListener('click', () => {
  const name = newParamInput.value.trim();
  if (!name) return;
  updateParam(name, { action: 'remove' }).then(() => {
    newParamInput.value = '';
    reload();
  });
});

newParamInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBtn.click();
});

resetBtn.addEventListener('click', () => {
  resetDefaults().then(reload);
});

// Init
reload();
