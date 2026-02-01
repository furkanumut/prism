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

            // Limit stored results to last 20 tabs to prevent quota issues
            const tabIds = Object.keys(allResults);
            if (tabIds.length > 20) {
                // Remove oldest entries (first ones in the object)
                const toRemove = tabIds.slice(0, tabIds.length - 20);
                toRemove.forEach(id => delete allResults[id]);
                console.log('[PRISM] Cleaned up', toRemove.length, 'old tab results');
            }

            allResults[tabId] = results;
            chrome.storage.local.set({ [STORAGE_KEYS.SCAN_RESULTS]: allResults }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[PRISM] Failed to save results:', chrome.runtime.lastError.message);
                    // Try to clear all results and save just this one
                    chrome.storage.local.set({ [STORAGE_KEYS.SCAN_RESULTS]: { [tabId]: results } }, () => {
                        if (chrome.runtime.lastError) {
                            console.error('[PRISM] Still failed after cleanup:', chrome.runtime.lastError.message);
                        }
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
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
 * Get false positives from storage
 * @returns {Promise<Array>} Array of false positive objects
 */
export async function getFalsePositives() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.FALSE_POSITIVES], (result) => {
            resolve(result[STORAGE_KEYS.FALSE_POSITIVES] || []);
        });
    });
}

/**
 * Save false positives to storage
 * @param {Array} falsePositives - Array of false positive objects
 * @returns {Promise<void>}
 */
export async function saveFalsePositives(falsePositives) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.FALSE_POSITIVES]: falsePositives }, resolve);
    });
}

/**
 * Generate hash for a finding (ruleName + value)
 * Uses a simple string hash instead of crypto.subtle for Service Worker compatibility
 * @param {string} ruleName - Rule name
 * @param {string} value - Detected value
 * @returns {string} Hash string
 */
function generateFindingHash(ruleName, value) {
    const text = `${ruleName}:${value}`;
    // Simple djb2 hash algorithm
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }
    return 'fp_' + Math.abs(hash).toString(16);
}

/**
 * Add a finding to false positives
 * @param {Object} finding - Finding object with ruleName, value, source, sourceType, context
 * @returns {Promise<Object>} The created false positive entry
 */
export async function addFalsePositive(finding) {
    const falsePositives = await getFalsePositives();
    const hash = generateFindingHash(finding.ruleName, finding.value || finding.context?.match);

    // Check if already exists
    const existing = falsePositives.find(fp => fp.hash === hash);
    if (existing) {
        return existing;
    }

    const newFP = {
        id: generateId(),
        ruleName: finding.ruleName,
        value: finding.value || finding.context?.match,
        hash: hash,
        markedAt: Date.now(),
        source: finding.source,
        sourceType: finding.sourceType
    };

    falsePositives.push(newFP);
    await saveFalsePositives(falsePositives);
    return newFP;
}

/**
 * Remove a false positive by ID
 * @param {string} fpId - False positive ID
 * @returns {Promise<boolean>} True if removed, false if not found
 */
export async function removeFalsePositive(fpId) {
    const falsePositives = await getFalsePositives();
    const index = falsePositives.findIndex(fp => fp.id === fpId);
    if (index === -1) return false;

    falsePositives.splice(index, 1);
    await saveFalsePositives(falsePositives);
    return true;
}

/**
 * Check if a finding is a false positive
 * @param {Object} finding - Finding object with ruleName and value
 * @returns {Promise<boolean>} True if it's a false positive
 */
export async function isFalsePositive(finding) {
    const falsePositives = await getFalsePositives();
    const hash = generateFindingHash(finding.ruleName, finding.value || finding.context?.match);
    return falsePositives.some(fp => fp.hash === hash);
}

/**
 * Filter out false positives from findings array
 * @param {Array} findings - Array of finding objects
 * @returns {Promise<Array>} Filtered findings array
 */
export async function filterFalsePositives(findings) {
    if (!findings || findings.length === 0) return findings;

    // Load false positives once
    const falsePositives = await getFalsePositives();

    // If no false positives, return all findings
    if (!falsePositives || falsePositives.length === 0) {
        console.log('[PRISM] No false positives in storage, returning all', findings.length, 'findings');
        return findings;
    }

    // Create a set of hashes for faster lookup
    const fpHashes = new Set(falsePositives.map(fp => fp.hash));

    const filtered = findings.filter(finding => {
        const hash = generateFindingHash(finding.ruleName, finding.value || finding.context?.match);
        return !fpHashes.has(hash);
    });

    console.log('[PRISM] Filtered', findings.length - filtered.length, 'false positives, returning', filtered.length, 'findings');
    return filtered;
}

/**
 * Generate a unique ID
 * @returns {string} Unique ID
 */
function generateId() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Generate hash for a finding (for seen tracking)
 * @param {Object} finding - Finding object
 * @returns {string} Hash string
 */
function generateSeenHash(finding) {
    const text = `${finding.ruleName}:${finding.value || finding.context?.match || ''}`;
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash & hash;
    }
    return 'seen_' + Math.abs(hash).toString(16);
}

/**
 * Get seen findings from storage
 * @returns {Promise<Object>} Object mapping URL to Set of seen hashes
 */
export async function getSeenFindings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SEEN_FINDINGS], (result) => {
            resolve(result[STORAGE_KEYS.SEEN_FINDINGS] || {});
        });
    });
}

/**
 * Mark findings as seen (based on finding's source URL, not page URL)
 * @param {Array} findings - Array of findings to mark as seen
 * @returns {Promise<void>}
 */
export async function markFindingsAsSeen(url, findings) {
    if (!findings || findings.length === 0) return;

    const seenFindings = await getSeenFindings();

    // Group findings by their source URL (external script URL)
    for (const finding of findings) {
        // Use the finding's source (external script URL) as the key
        let sourceKey;
        try {
            if (finding.source && finding.source.startsWith('http')) {
                const urlObj = new URL(finding.source);
                sourceKey = urlObj.hostname + urlObj.pathname;
            } else {
                // For inline scripts, use page URL
                const urlObj = new URL(url);
                sourceKey = urlObj.hostname + urlObj.pathname;
            }
        } catch {
            sourceKey = finding.source || url;
        }

        // Initialize array for this source if doesn't exist
        if (!seenFindings[sourceKey]) {
            seenFindings[sourceKey] = [];
        }

        const hash = generateSeenHash(finding);
        if (!seenFindings[sourceKey].includes(hash)) {
            seenFindings[sourceKey].push(hash);
        }

        // Limit to last 500 entries per source
        if (seenFindings[sourceKey].length > 500) {
            seenFindings[sourceKey] = seenFindings[sourceKey].slice(-500);
        }
    }

    // Limit to last 200 sources
    const sources = Object.keys(seenFindings);
    if (sources.length > 200) {
        const toRemove = sources.slice(0, sources.length - 200);
        toRemove.forEach(s => delete seenFindings[s]);
    }

    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.SEEN_FINDINGS]: seenFindings }, resolve);
    });
}

/**
 * Filter findings to get only NEW ones (not seen before in their source)
 * @param {string} pageUrl - The page URL (used for inline scripts)
 * @param {Array} findings - Array of findings
 * @returns {Promise<Array>} Array of NEW findings only
 */
export async function getNewFindings(pageUrl, findings) {
    if (!findings || findings.length === 0) return [];

    const seenFindings = await getSeenFindings();

    const newFindings = findings.filter(finding => {
        // Determine the source key for this finding
        let sourceKey;
        try {
            if (finding.source && finding.source.startsWith('http')) {
                const urlObj = new URL(finding.source);
                sourceKey = urlObj.hostname + urlObj.pathname;
            } else {
                // For inline scripts, use page URL
                const urlObj = new URL(pageUrl);
                sourceKey = urlObj.hostname + urlObj.pathname;
            }
        } catch {
            sourceKey = finding.source || pageUrl;
        }

        const seenHashes = new Set(seenFindings[sourceKey] || []);
        const hash = generateSeenHash(finding);
        return !seenHashes.has(hash);
    });

    console.log('[PRISM] Found', newFindings.length, 'new findings out of', findings.length, 'total (source-based tracking)');
    return newFindings;
}
