// PRISM Options Page Logic

// Storage keys (duplicated to avoid module import issues in options page)
const STORAGE_KEYS = {
    SETTINGS: 'prism_settings',
    RULES: 'prism_rules',
    SCAN_HISTORY: 'prism_history',
    FALSE_POSITIVES: 'prism_false_positives'
};

const DEFAULT_SETTINGS = {
    scanCurrentDomainOnly: false,
    scanThirdPartyResources: true,
    autoScanOnLoad: false,
    showNotifications: true,
    historyExpirationDays: 7,
    maxFileSizeKB: 1000
};

// DOM Elements
const elements = {
    // Settings
    scanCurrentDomainOnly: document.getElementById('scanCurrentDomainOnly'),
    scanThirdPartyResources: document.getElementById('scanThirdPartyResources'),
    autoScanOnLoad: document.getElementById('autoScanOnLoad'),
    showNotifications: document.getElementById('showNotifications'),
    historyExpirationDays: document.getElementById('historyExpirationDays'),
    maxFileSizeKB: document.getElementById('maxFileSizeKB'),
    excludedDomains: document.getElementById('excludedDomains'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),
    viewLogsBtn: document.getElementById('view-logs-btn'),

    // Rules
    rulesList: document.getElementById('rules-list'),
    rulesSearch: document.getElementById('rules-search'),
    addRuleBtn: document.getElementById('add-rule-btn'),
    resetRulesBtn: document.getElementById('reset-rules-btn'),
    filterBtns: document.querySelectorAll('.filter-btn'),

    // Rule Modal
    modal: document.getElementById('rule-modal'),
    modalTitle: document.getElementById('modal-title'),
    modalClose: document.getElementById('modal-close'),
    modalCancel: document.getElementById('modal-cancel'),
    modalSave: document.getElementById('modal-save'),
    ruleId: document.getElementById('rule-id'),
    ruleName: document.getElementById('rule-name'),
    rulePatterns: document.getElementById('rule-patterns'),
    ruleEnabled: document.getElementById('rule-enabled'),

    // Logs Modal
    logsModal: document.getElementById('logs-modal'),
    logsContainer: document.getElementById('logs-container'),
    logsModalClose: document.getElementById('logs-modal-close'),
    logsModalCloseBtn: document.getElementById('logs-modal-close-btn'),
    refreshLogsBtn: document.getElementById('refresh-logs-btn'),

    // False Positives Modal
    fpModal: document.getElementById('fp-modal'),
    fpContainer: document.getElementById('fp-container'),
    fpModalClose: document.getElementById('fp-modal-close'),
    fpModalCloseBtn: document.getElementById('fp-modal-close-btn'),
    refreshFpBtn: document.getElementById('refresh-fp-btn'),
    viewFpBtn: document.getElementById('view-fp-btn'),

    // Toast
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toast-message')
};

// State
let allRules = [];
let currentFilter = 'all';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    await loadRules();
    setupEventListeners();
});

/**
 * Load settings from storage
 */
async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS], (result) => {
            const settings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };

            elements.scanCurrentDomainOnly.checked = settings.scanCurrentDomainOnly;
            elements.scanThirdPartyResources.checked = settings.scanThirdPartyResources;
            elements.autoScanOnLoad.checked = settings.autoScanOnLoad;
            elements.showNotifications.checked = settings.showNotifications;
            elements.historyExpirationDays.value = settings.historyExpirationDays;
            elements.maxFileSizeKB.value = settings.maxFileSizeKB;
            elements.excludedDomains.value = settings.excludedDomains ? settings.excludedDomains.join('\n') : '';

            resolve();
        });
    });
}

/**
 * Save settings to storage
 */
async function saveSettings() {
    // Parse excluded domains
    const excludedDomains = elements.excludedDomains.value
        .split('\n')
        .map(d => d.trim())
        .filter(d => d.length > 0);

    const settings = {
        scanCurrentDomainOnly: elements.scanCurrentDomainOnly.checked,
        scanThirdPartyResources: elements.scanThirdPartyResources.checked,
        autoScanOnLoad: elements.autoScanOnLoad.checked,
        showNotifications: elements.showNotifications.checked,
        historyExpirationDays: parseInt(elements.historyExpirationDays.value) || 7,
        maxFileSizeKB: parseInt(elements.maxFileSizeKB.value) || 500,
        excludedDomains: excludedDomains
    };

    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings }, () => {
            showToast('Settings saved');
            resolve();
        });
    });
}

/**
 * Load rules from storage
 */
async function loadRules() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.RULES], async (result) => {
            if (result[STORAGE_KEYS.RULES] && result[STORAGE_KEYS.RULES].length > 0) {
                allRules = result[STORAGE_KEYS.RULES];
            } else {
                // Load defaults
                try {
                    const response = await fetch(chrome.runtime.getURL('rules/default-rules.json'));
                    const data = await response.json();
                    allRules = data.rules || [];
                    await saveRules();
                } catch (error) {
                    console.error('Failed to load default rules:', error);
                    allRules = [];
                }
            }
            renderRules();
            resolve();
        });
    });
}

/**
 * Save rules to storage
 */
async function saveRules() {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.RULES]: allRules }, resolve);
    });
}

/**
 * Render rules list
 */
function renderRules() {
    const searchTerm = elements.rulesSearch.value.toLowerCase();

    let filteredRules = allRules;

    // Apply search filter
    if (searchTerm) {
        filteredRules = filteredRules.filter(rule =>
            rule.name.toLowerCase().includes(searchTerm) ||
            rule.patterns.some(p => p.toLowerCase().includes(searchTerm))
        );
    }

    // Apply status filter
    if (currentFilter === 'enabled') {
        filteredRules = filteredRules.filter(rule => rule.enabled);
    } else if (currentFilter === 'disabled') {
        filteredRules = filteredRules.filter(rule => !rule.enabled);
    }

    if (filteredRules.length === 0) {
        elements.rulesList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
          <path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p>No rules found</p>
      </div>
    `;
        return;
    }

    elements.rulesList.innerHTML = filteredRules.map(rule => `
    <div class="rule-item ${rule.enabled ? '' : 'disabled'}" data-id="${rule.id}">
      <div class="rule-toggle">
        <label class="toggle">
          <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-toggle-id="${rule.id}">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="rule-info">
        <div class="rule-name">${escapeHtml(rule.name)}</div>
        <div class="rule-patterns">${escapeHtml(rule.patterns.slice(0, 2).join(' | '))}${rule.patterns.length > 2 ? ' ...' : ''}</div>
      </div>
      <div class="rule-actions">
        <button class="btn btn-secondary btn-small" data-edit-id="${rule.id}">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Edit
        </button>
        <button class="btn btn-danger btn-small" data-delete-id="${rule.id}">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Delete
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * Load and display logs
 */
async function loadLogs() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SCAN_HISTORY], (result) => {
            const history = result[STORAGE_KEYS.SCAN_HISTORY] || [];
            renderLogs(history);
            resolve();
        });
    });
}

/**
 * Render logs grouped by date
 */
function renderLogs(history) {
    if (history.length === 0) {
        elements.logsContainer.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>No scan history available</p>
      </div>
    `;
        return;
    }

    // Group by date
    const groupedLogs = {};
    history.forEach(entry => {
        const date = new Date(entry.timestamp).toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        if (!groupedLogs[date]) {
            groupedLogs[date] = [];
        }
        groupedLogs[date].push(entry);
    });

    elements.logsContainer.innerHTML = Object.entries(groupedLogs).map(([date, entries]) => `
    <div class="log-date-group">
      <div class="log-date-header">${date}</div>
      ${entries.map(entry => `
        <div class="log-entry">
          <div class="log-header">
            <div class="log-url" title="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</div>
            <div class="log-meta">
              <span class="log-time">${new Date(entry.timestamp).toLocaleTimeString()}</span>
              <span class="log-findings-count">${entry.findings.length} findings</span>
            </div>
          </div>
          <div class="log-findings">
            ${entry.findings.map(finding => {
        // Build context display
        let contextHtml = '';
        if (finding.context) {
            const fullMatch = finding.context.match;
            const truncatedMatch = fullMatch.length > 150 ? fullMatch.substring(0, 150) : fullMatch;
            const isTruncated = fullMatch.length > 150;

            contextHtml = `
                  <div class="log-context">
                    <span class="context-around">${escapeHtml(finding.context.before)}</span>
                    <span class="context-match">
                      ${escapeHtml(truncatedMatch)}
                      ${isTruncated ? `<span class="expand-ellipsis" data-full="${escapeHtml(fullMatch)}">......</span>` : ''}
                    </span>
                    <span class="context-around">${escapeHtml(finding.context.after)}</span>
                  </div>
                `;
        } else {
            const fullMatch = finding.value;
            const truncatedMatch = fullMatch.length > 150 ? fullMatch.substring(0, 150) : fullMatch;
            const isTruncated = fullMatch.length > 150;

            contextHtml = `
                    <div class="log-context">
                        <span class="context-match">
                            ${escapeHtml(truncatedMatch)}
                            ${isTruncated ? `<span class="expand-ellipsis" data-full="${escapeHtml(fullMatch)}">......</span>` : ''}
                        </span>
                    </div>
                `;
        }

        return `
                <div class="log-finding">
                  <div class="log-finding-header">
                    <span class="log-finding-rule">${escapeHtml(finding.ruleName)}</span>
                    <span class="log-finding-type">${escapeHtml(finding.sourceType)}</span>
                  </div>
                  ${contextHtml}
                  <div class="log-source" title="${escapeHtml(finding.source)}">Source: ${escapeHtml(truncateUrl(finding.source))}</div>
                </div>
              `;
    }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

/**
 * Load and display false positives
 */
async function loadFalsePositives() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.FALSE_POSITIVES], (result) => {
            const falsePositives = result[STORAGE_KEYS.FALSE_POSITIVES] || [];
            renderFalsePositives(falsePositives);
            resolve();
        });
    });
}

/**
 * Render false positives list
 */
function renderFalsePositives(falsePositives) {
    if (falsePositives.length === 0) {
        elements.fpContainer.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p>No false positives marked</p>
      </div>
    `;
        return;
    }

    elements.fpContainer.innerHTML = falsePositives.map(fp => {
        const markedDate = new Date(fp.markedAt).toLocaleString();
        const truncatedValue = fp.value.length > 100 ? fp.value.substring(0, 100) : fp.value;
        const isTruncated = fp.value.length > 100;

        return `
      <div class="fp-item" style="padding: 14px; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 10px;">
        <div class="fp-header" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span class="fp-rule" style="font-weight: 600; color: var(--accent-secondary);">${escapeHtml(fp.ruleName)}</span>
          <span class="fp-type" style="font-size: 10px; padding: 2px 6px; background: var(--bg-tertiary); color: var(--text-muted); border-radius: 4px; text-transform: uppercase;">${escapeHtml(fp.sourceType)}</span>
        </div>
        <div class="fp-value" style="font-family: 'Consolas', monospace; font-size: 11px; color: var(--text-secondary); padding: 8px; background: var(--bg-secondary); border-radius: 4px; word-break: break-all; margin-bottom: 8px;">
          ${escapeHtml(truncatedValue)}
          ${isTruncated ? `<span class="expand-ellipsis" data-full="${escapeHtml(fp.value)}">......</span>` : ''}
        </div>
        <div class="fp-meta" style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); margin-bottom: 8px;">
          <span class="fp-source" title="${escapeHtml(fp.source)}">Source: ${escapeHtml(truncateUrl(fp.source))}</span>
          <span class="fp-date">Marked: ${markedDate}</span>
        </div>
        <div class="fp-actions" style="display: flex; justify-content: flex-end;">
          <button class="btn btn-danger btn-small" data-restore-fp="${fp.id}">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M3 3v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Restore
          </button>
        </div>
      </div>
    `;
    }).join('');
}

/**
 * Restore (remove) a false positive
 */
async function restoreFalsePositive(fpId) {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.FALSE_POSITIVES], (result) => {
            const falsePositives = result[STORAGE_KEYS.FALSE_POSITIVES] || [];
            const filtered = falsePositives.filter(fp => fp.id !== fpId);

            chrome.storage.local.set({ [STORAGE_KEYS.FALSE_POSITIVES]: filtered }, () => {
                loadFalsePositives();
                showToast('False positive restored');
                resolve();
            });
        });
    });
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Settings toggles
    elements.scanCurrentDomainOnly.addEventListener('change', saveSettings);
    elements.scanThirdPartyResources.addEventListener('change', saveSettings);
    elements.autoScanOnLoad.addEventListener('change', saveSettings);
    elements.showNotifications.addEventListener('change', saveSettings);
    elements.historyExpirationDays.addEventListener('change', saveSettings);
    elements.maxFileSizeKB.addEventListener('change', saveSettings);
    elements.excludedDomains.addEventListener('input', saveSettings); // Save on input for text area

    // Expand/collapse ellipsis click handler for Logs
    elements.logsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('expand-ellipsis')) {
            const fullText = e.target.getAttribute('data-full');
            // Replace the parent element's content or just the part before it?
            // Easiest is to replace the text node before the ellipsis + ellipsis itself with full text.
            // Actually, let's just replace the parent's innerHTML or textContent.
            // The parent is <span class="context-match">
            const parent = e.target.parentElement;
            parent.textContent = fullText;
            // Note: we lose the highlighting if we just set textContent because fullText is raw.
            // But renderLogs escaped it. wait, data-full is attribute, so it is just string.
            // When we injected `escapeHtml(fullMatch)`, it was safe.
            // So we can just set textContent to fullText (which is unescaped by getAttribute?).
            // No, getAttribute returns the attribute value. If we put it in attribute, it was HTML attribute encoded.
            // Let's assume fullText is the raw string.
            // Setting textContent will display it as plain text (safe).
        }
    });

    // Clear history button (also refreshes logs view if open)
    elements.clearHistoryBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all scan history?')) {
            await new Promise((resolve) => {
                chrome.storage.local.remove([STORAGE_KEYS.SCAN_HISTORY], resolve);
            });
            loadLogs(); // Refresh logs if modal is open
            showToast('Scan history cleared');
        }
    });

    // View Logs button
    elements.viewLogsBtn.addEventListener('click', () => {
        loadLogs();
        elements.logsModal.style.display = 'flex';
    });

    // Logs Modal actions
    elements.refreshLogsBtn.addEventListener('click', loadLogs);
    elements.logsModalClose.addEventListener('click', () => elements.logsModal.style.display = 'none');
    elements.logsModalCloseBtn.addEventListener('click', () => elements.logsModal.style.display = 'none');
    elements.logsModal.addEventListener('click', (e) => {
        if (e.target === elements.logsModal) elements.logsModal.style.display = 'none';
    });

    // False Positives Modal actions
    elements.viewFpBtn.addEventListener('click', () => {
        loadFalsePositives();
        elements.fpModal.style.display = 'flex';
    });
    elements.refreshFpBtn.addEventListener('click', loadFalsePositives);
    elements.fpModalClose.addEventListener('click', () => elements.fpModal.style.display = 'none');
    elements.fpModalCloseBtn.addEventListener('click', () => elements.fpModal.style.display = 'none');
    elements.fpModal.addEventListener('click', (e) => {
        if (e.target === elements.fpModal) elements.fpModal.style.display = 'none';
    });

    // False Positives container event delegation
    elements.fpContainer.addEventListener('click', async (e) => {
        // Handle ellipsis expansion
        if (e.target.classList.contains('expand-ellipsis')) {
            const fullText = e.target.getAttribute('data-full');
            const parent = e.target.parentElement;
            parent.textContent = fullText;
            return;
        }

        // Handle restore button
        const restoreBtn = e.target.closest('button[data-restore-fp]');
        if (restoreBtn) {
            const fpId = restoreBtn.getAttribute('data-restore-fp');
            if (confirm('Are you sure you want to restore this false positive? It will appear in future scans.')) {
                await restoreFalsePositive(fpId);
            }
        }
    });

    // Rules search
    elements.rulesSearch.addEventListener('input', renderRules);

    // Filter buttons
    elements.filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderRules();
        });
    });

    // Add rule button
    elements.addRuleBtn.addEventListener('click', () => {
        openModal(null);
    });

    // Reset rules button
    elements.resetRulesBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to reset all rules to defaults? This will delete any custom rules.')) {
            try {
                const response = await fetch(chrome.runtime.getURL('rules/default-rules.json'));
                const data = await response.json();
                allRules = data.rules || [];
                await saveRules();
                renderRules();
                showToast('Rules reset to defaults');
            } catch (error) {
                console.error('Failed to reset rules:', error);
                showToast('Failed to reset rules');
            }
        }
    });

    // Modal close buttons (Rule Modal)
    elements.modalClose.addEventListener('click', closeModal);
    elements.modalCancel.addEventListener('click', closeModal);
    elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) closeModal();
    });

    // Modal save button
    elements.modalSave.addEventListener('click', saveRule);

    // Rules list delegation
    elements.rulesList.addEventListener('click', (e) => {
        const toggleInput = e.target.closest('input[data-toggle-id]');
        if (toggleInput) {
            toggleRuleEnabled(toggleInput.dataset.toggleId);
            return;
        }

        const editBtn = e.target.closest('button[data-edit-id]');
        if (editBtn) {
            const rule = allRules.find(r => r.id === editBtn.dataset.editId);
            if (rule) openModal(rule);
            return;
        }

        const deleteBtn = e.target.closest('button[data-delete-id]');
        if (deleteBtn) {
            deleteRule(deleteBtn.dataset.deleteId);
        }
    });
}

/**
 * Toggle rule enabled state
 */
async function toggleRuleEnabled(id) {
    const rule = allRules.find(r => r.id === id);
    if (rule) {
        rule.enabled = !rule.enabled;
        await saveRules();
        renderRules();
    }
}

/**
 * Open modal for add/edit (Rules)
 */
function openModal(rule) {
    if (rule) {
        elements.modalTitle.textContent = 'Edit Rule';
        elements.ruleId.value = rule.id;
        elements.ruleName.value = rule.name;
        elements.rulePatterns.value = rule.patterns.join('\n');
        elements.ruleEnabled.checked = rule.enabled;
    } else {
        elements.modalTitle.textContent = 'Add New Rule';
        elements.ruleId.value = '';
        elements.ruleName.value = '';
        elements.rulePatterns.value = '';
        elements.ruleEnabled.checked = true;
    }

    elements.modal.style.display = 'flex';
    elements.ruleName.focus();
}

/**
 * Close modal (Rules)
 */
function closeModal() {
    elements.modal.style.display = 'none';
}

/**
 * Save rule from modal
 */
async function saveRule() {
    const name = elements.ruleName.value.trim();
    const patternsText = elements.rulePatterns.value.trim();
    const enabled = elements.ruleEnabled.checked;
    const id = elements.ruleId.value;

    if (!name) {
        showToast('Please enter a rule name');
        return;
    }

    if (!patternsText) {
        showToast('Please enter at least one pattern');
        return;
    }

    const patterns = patternsText.split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);

    // Validate patterns
    for (const pattern of patterns) {
        try {
            new RegExp(pattern);
        } catch (e) {
            showToast(`Invalid regex: ${pattern}`);
            return;
        }
    }

    if (id) {
        // Update existing rule
        const index = allRules.findIndex(r => r.id === id);
        if (index !== -1) {
            allRules[index] = { ...allRules[index], name, patterns, enabled };
        }
    } else {
        // Add new rule
        allRules.push({
            id: 'rule_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9),
            name,
            patterns,
            enabled
        });
    }

    await saveRules();
    renderRules();
    closeModal();
    showToast(id ? 'Rule updated' : 'Rule added');
}

/**
 * Delete rule
 */
async function deleteRule(id) {
    const rule = allRules.find(r => r.id === id);
    if (!rule) return;

    if (confirm(`Are you sure you want to delete the rule "${rule.name}"?`)) {
        allRules = allRules.filter(r => r.id !== id);
        await saveRules();
        renderRules();
        showToast('Rule deleted');
    }
}

/**
 * Show toast notification
 */
function showToast(message) {
    elements.toastMessage.textContent = message;
    elements.toast.style.display = 'block';

    setTimeout(() => {
        elements.toast.style.display = 'none';
    }, 3000);
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Truncate long URLs
 */
function truncateUrl(url) {
    if (!url || url.length <= 80) return url;

    try {
        const urlObj = new URL(url);
        const path = urlObj.pathname;
        const filename = path.split('/').pop() || path;
        const origin = urlObj.origin;
        if (path === '/') return origin;
        return `${origin}/.../${filename}`;
    } catch {
        return url.substring(0, 77) + '...';
    }
}
