// Storage utilities for PRISM extension

import { STORAGE_KEYS, DEFAULT_SETTINGS } from './constants.js';

/**
 * Get current settings from storage
 * @returns {Promise<Object>} Settings object
 */
export async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS], (result) => {
            resolve({ ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] });
        });
    });
}

/**
 * Save settings to storage
 * @param {Object} settings - Settings object to save
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings }, resolve);
    });
}

/**
 * Get rules from storage, or load defaults if none exist
 * @returns {Promise<Array>} Array of rule objects
 */
export async function getRules() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.RULES], async (result) => {
            if (result[STORAGE_KEYS.RULES] && result[STORAGE_KEYS.RULES].length > 0) {
                resolve(result[STORAGE_KEYS.RULES]);
            } else {
                // Load default rules
                try {
                    const response = await fetch(chrome.runtime.getURL('rules/default-rules.json'));
                    const data = await response.json();
                    const rules = data.rules || [];
                    await saveRules(rules);
                    resolve(rules);
                } catch (error) {
                    console.error('Failed to load default rules:', error);
                    resolve([]);
                }
            }
        });
    });
}

/**
 * Save rules to storage
 * @param {Array} rules - Array of rule objects
 * @returns {Promise<void>}
 */
export async function saveRules(rules) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.RULES]: rules }, resolve);
    });
}

/**
 * Add a new rule
 * @param {Object} rule - Rule object (without id)
 * @returns {Promise<Object>} The created rule with id
 */
export async function addRule(rule) {
    const rules = await getRules();
    const newRule = {
        ...rule,
        id: generateId(),
        enabled: rule.enabled !== undefined ? rule.enabled : true
    };
    rules.push(newRule);
    await saveRules(rules);
    return newRule;
}

/**
 * Update an existing rule
 * @param {string} id - Rule ID
 * @param {Object} updates - Properties to update
 * @returns {Promise<Object|null>} Updated rule or null if not found
 */
export async function updateRule(id, updates) {
    const rules = await getRules();
    const index = rules.findIndex(r => r.id === id);
    if (index === -1) return null;

    rules[index] = { ...rules[index], ...updates };
    await saveRules(rules);
    return rules[index];
}

/**
 * Delete a rule
 * @param {string} id - Rule ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
export async function deleteRule(id) {
    const rules = await getRules();
    const index = rules.findIndex(r => r.id === id);
    if (index === -1) return false;

    rules.splice(index, 1);
    await saveRules(rules);
    return true;
}

/**
 * Toggle a rule's enabled state
 * @param {string} id - Rule ID
 * @returns {Promise<boolean|null>} New enabled state or null if not found
 */
export async function toggleRule(id) {
    const rules = await getRules();
    const rule = rules.find(r => r.id === id);
    if (!rule) return null;

    rule.enabled = !rule.enabled;
    await saveRules(rules);
    return rule.enabled;
}

/**
 * Reset rules to defaults
 * @returns {Promise<Array>} Default rules
 */
export async function resetRulesToDefaults() {
    try {
        const response = await fetch(chrome.runtime.getURL('rules/default-rules.json'));
        const data = await response.json();
        const rules = data.rules || [];
        await saveRules(rules);
        return rules;
    } catch (error) {
        console.error('Failed to reset rules:', error);
        return [];
    }
}

/**
 * Get scan results from storage for a specific tab
 * @param {number} tabId - Tab ID to get results for
 * @returns {Promise<Object|null>} Scan results or null
 */
export async function getScanResults(tabId) {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SCAN_RESULTS], (result) => {
            const allResults = result[STORAGE_KEYS.SCAN_RESULTS] || {};
            resolve(allResults[tabId] || null);
        });
    });
}

/**
 * Save scan results to storage for a specific tab
 * @param {Object} results - Scan results object
 * @param {number} tabId - Tab ID to save results for
 * @returns {Promise<void>}
 */
export async function saveScanResults(results, tabId) {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SCAN_RESULTS], (result) => {
            const allResults = result[STORAGE_KEYS.SCAN_RESULTS] || {};
            allResults[tabId] = results;
            chrome.storage.local.set({ [STORAGE_KEYS.SCAN_RESULTS]: allResults }, resolve);
        });
    });
}

/**
 * Clear scan results from storage
 * @param {number} [tabId] - Optional tab ID to clear specific results. If omitted, clears all.
 * @returns {Promise<void>}
 */
export async function clearScanResults(tabId) {
    return new Promise((resolve) => {
        if (tabId) {
            chrome.storage.local.get([STORAGE_KEYS.SCAN_RESULTS], (result) => {
                const allResults = result[STORAGE_KEYS.SCAN_RESULTS] || {};
                delete allResults[tabId];
                chrome.storage.local.set({ [STORAGE_KEYS.SCAN_RESULTS]: allResults }, resolve);
            });
        } else {
            chrome.storage.local.remove([STORAGE_KEYS.SCAN_RESULTS], resolve);
        }
    });
}

/**
 * Get scan history from storage
 * @returns {Promise<Array>} Array of historical scan results
 */
export async function getScanHistory() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SCAN_HISTORY], (result) => {
            resolve(result[STORAGE_KEYS.SCAN_HISTORY] || []);
        });
    });
}

/**
 * Add scan result to history
 * @param {Object} scanResult - Scan result to add
 * @returns {Promise<void>}
 */
export async function addToHistory(scanResult) {
    const settings = await getSettings();
    const history = await getScanHistory();

    // Add new entry with timestamp
    const historyEntry = {
        ...scanResult,
        id: generateId(),
        timestamp: Date.now()
    };

    history.unshift(historyEntry);

    // Clean up expired entries
    const expirationMs = settings.historyExpirationDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - expirationMs;
    const filteredHistory = history.filter(entry => entry.timestamp > cutoffTime);

    await saveHistory(filteredHistory);
}

/**
 * Save history to storage
 * @param {Array} history - History array
 * @returns {Promise<void>}
 */
export async function saveHistory(history) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.SCAN_HISTORY]: history }, resolve);
    });
}

/**
 * Clear all scan history
 * @returns {Promise<void>}
 */
export async function clearHistory() {
    return new Promise((resolve) => {
        chrome.storage.local.remove([STORAGE_KEYS.SCAN_HISTORY], resolve);
    });
}

/**
 * Clean up expired history entries
 * @returns {Promise<void>}
 */
export async function cleanupExpiredHistory() {
    const settings = await getSettings();
    const history = await getScanHistory();

    const expirationMs = settings.historyExpirationDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - expirationMs;
    const filteredHistory = history.filter(entry => entry.timestamp > cutoffTime);

    if (filteredHistory.length !== history.length) {
        await saveHistory(filteredHistory);
    }
}

/**
 * Generate a unique ID
 * @returns {string} Unique ID
 */
function generateId() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}
