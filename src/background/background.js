// Background script - shared logic for PRISM

import { MESSAGE_TYPES } from '../shared/constants.js';
import {
    getSettings,
    getRules,
    saveScanResults,
    clearScanResults,
    getScanResults,
    getScanHistory,
    addToHistory,
    clearHistory,
    cleanupExpiredHistory,
    filterFalsePositives,
    addFalsePositive
} from '../shared/storage.js';

// Initialize extension on install
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        console.log('PRISM installed. Loading default rules...');
        // Trigger rules loading (will load defaults if none exist)
        await getRules();
        console.log('PRISM ready.');
    }

    // Clean up old data on install/update to prevent quota issues
    await forceCleanupStorage();
});

// Force cleanup on every service worker start to prevent quota issues
forceCleanupStorage();

/**
 * Force cleanup storage to recover from quota exceeded
 */
async function forceCleanupStorage() {
    // Clear scan results and history to free up space
    chrome.storage.local.remove(['prism_results', 'prism_history'], () => {
        if (chrome.runtime.lastError) {
            console.error('[PRISM] Cleanup error:', chrome.runtime.lastError.message);
        } else {
            console.log('[PRISM] Cleaned up scan results and history');
        }
    });
}

// Cleanup expired history on startup
cleanupExpiredHistory();

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true; // Keep the message channel open for async response
});

/**
 * Handle incoming messages
 */
/**
 * Handle incoming messages
 */
async function handleMessage(message, sender) {
    // If message comes from a tab, use that tabId (for content scripts)
    const senderTabId = sender.tab ? sender.tab.id : null;

    switch (message.type) {
        case MESSAGE_TYPES.START_SCAN:
            return await startScan(message.tabId);

        case MESSAGE_TYPES.GET_RESULTS:
            // If requested from popup, message.tabId should be provided
            // If checking from content script, use senderTabId
            const targetTabId = message.tabId || senderTabId;
            const scanResults = await getScanResults(targetTabId);
            console.log('[PRISM] GET_RESULTS for tab', targetTabId, 'returned:', scanResults ? scanResults.findings?.length + ' findings' : 'null');
            return scanResults;

        case MESSAGE_TYPES.CLEAR_RESULTS:
            await clearScanResults(message.tabId);
            return { success: true };

        case MESSAGE_TYPES.GET_HISTORY:
            await cleanupExpiredHistory();
            return await getScanHistory();

        case MESSAGE_TYPES.CLEAR_HISTORY:
            await clearHistory();
            return { success: true };

        case 'ADD_FALSE_POSITIVE':
            // Add finding to false positives
            if (!message.finding) {
                return { error: 'No finding provided' };
            }
            await addFalsePositive(message.finding);
            return { success: true };

        case MESSAGE_TYPES.SCAN_COMPLETE:
            // Content script finished scanning
            // Use the sender tab ID for saving results
            if (!senderTabId) {
                console.error('Received SCAN_COMPLETE from unknown source');
                return { error: 'Unknown source' };
            }

            console.log('[PRISM] SCAN_COMPLETE received for tab', senderTabId, 'with', message.findings?.length, 'findings');

            // Filter out false positives from findings
            const filteredFindings = await filterFalsePositives(message.findings || []);

            console.log('[PRISM] After filtering:', filteredFindings.length, 'findings remain');

            // Truncate findings to reduce storage size
            const truncatedFindings = filteredFindings.map(f => ({
                ruleName: f.ruleName,
                sourceType: f.sourceType,
                source: f.source?.substring(0, 200) || '',
                value: (f.value || f.context?.match || '').substring(0, 300),
                context: f.context ? {
                    before: (f.context.before || '').substring(0, 50),
                    match: (f.context.match || '').substring(0, 300),
                    after: (f.context.after || '').substring(0, 50)
                } : null
            }));

            const results = {
                url: message.url,
                timestamp: Date.now(),
                findings: truncatedFindings,
                stats: message.stats
            };

            // Save results specifically for this tab
            await saveScanResults(results, senderTabId);
            console.log('[PRISM] Results saved for tab', senderTabId);

            // Broadcast SCAN_COMPLETE to all extension contexts (popup, options, etc.)
            chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.SCAN_COMPLETE,
                results: results,
                tabId: senderTabId
            }).catch(() => {
                // Popup might be closed, ignore
            });

            // Add to history if there are findings (after filtering)
            if (filteredFindings && filteredFindings.length > 0) {
                await addToHistory(results);

                // Show notification (browser + in-page) if enabled
                const settings = await getSettings();
                if (settings.showNotifications) {
                    await showNotification(filteredFindings.length, message.url);

                    // Show in-page notification
                    try {
                        const tab = sender.tab;
                        if (tab && tab.id) {
                            // Inject notification script if not already injected
                            await chrome.scripting.executeScript({
                                target: { tabId: tab.id },
                                files: ['src/content/notification.js']
                            }).catch(() => {
                                // Script might already be injected, that's okay
                            });

                            // Send message to show notification
                            await chrome.tabs.sendMessage(tab.id, {
                                type: MESSAGE_TYPES.SHOW_IN_PAGE_NOTIFICATION,
                                findingsCount: filteredFindings.length
                            }).catch(() => {
                                // Tab might be closed or restricted, ignore
                            });
                        }
                    } catch (error) {
                        console.error('Failed to show in-page notification:', error);
                    }
                }
            }

            return { success: true };

        default:
            console.warn('Unknown message type:', message.type);
            return { error: 'Unknown message type' };
    }
}

/**
 * Show browser notification for found secrets
 */
async function showNotification(count, url) {
    try {
        let hostname = 'unknown';
        try {
            hostname = new URL(url).hostname;
        } catch (e) {
            hostname = url;
        }

        const notificationId = 'prism_' + Date.now();

        await chrome.notifications.create(notificationId, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: '💎 PRISM Alert',
            message: `Found ${count} potential secret${count > 1 ? 's' : ''} on ${hostname}`,
            priority: 2,
            requireInteraction: false
        });

        console.log('PRISM notification sent:', notificationId);

        // Auto-close notification after 5 seconds
        setTimeout(() => {
            chrome.notifications.clear(notificationId);
        }, 5000);

    } catch (error) {
        console.error('Failed to show notification:', error);
    }
}

/**
 * Check if the URL is a restricted browser internal page
 */
function isRestrictedUrl(url) {
    const restrictedProtocols = [
        'chrome:',
        'about:',
        'edge:',
        'view-source:',
        'chrome-extension:',
        'chrome-search:'
    ];
    return restrictedProtocols.some(protocol => url.startsWith(protocol));
}

/**
 * Check if the current URL matches any excluded domains
 */
function isDomainExcluded(url, excludedDomains) {
    if (!url || isRestrictedUrl(url)) return true;
    if (!excludedDomains || excludedDomains.length === 0) return false;

    try {
        const hostname = new URL(url).hostname;
        return excludedDomains.some(pattern => {
            try {
                // Convert wildcard patterns to regex if pattern contains *
                let regexPattern = pattern;
                if (pattern.includes('*') && !pattern.startsWith('^') && !pattern.includes('(')) {
                    // Simple wildcard pattern, convert * to .*
                    regexPattern = pattern.replace(/\*/g, '.*');
                    // If it doesn't start with ^, make it match anywhere or at domain boundaries
                    if (!regexPattern.startsWith('^') && !regexPattern.startsWith('.*')) {
                        regexPattern = '(^|\\.)' + regexPattern;
                    }
                } else if (!pattern.startsWith('^') && !pattern.includes('*') && !pattern.includes('(') && !pattern.includes('[')) {
                    // Simple domain name without regex special chars
                    // Match if hostname equals the pattern or ends with .pattern
                    regexPattern = '(^|\\.)' + pattern.replace(/\./g, '\\.') + '$';
                }

                return new RegExp(regexPattern, 'i').test(hostname);
            } catch (e) {
                // Fallback: simple case-insensitive string match
                // Check if hostname ends with the pattern (for domain matching)
                const lowerHostname = hostname.toLowerCase();
                const lowerPattern = pattern.toLowerCase().replace(/\*/g, '');
                return lowerHostname.includes(lowerPattern) ||
                    lowerHostname.endsWith('.' + lowerPattern) ||
                    lowerHostname === lowerPattern;
            }
        });
    } catch (e) {
        return false;
    }
}

/**
 * Start scanning the current tab
 */
async function startScan(tabId) {
    try {
        // Get current tab if not provided
        if (!tabId) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                return { error: 'No active tab found' };
            }
            tabId = tab.id;
        }

        // Get tab info to check exclusions
        const tab = await chrome.tabs.get(tabId);

        // Get settings and rules
        const settings = await getSettings();

        // Check for restricted URLs
        if (isRestrictedUrl(tab.url)) {
            return { error: 'Scanning is not allowed on browser internal pages' };
        }

        // Check excluded domains
        if (isDomainExcluded(tab.url, settings.excludedDomains)) {
            return { error: 'Scanning is disabled for this domain in settings' };
        }

        const rules = await getRules();
        const enabledRules = rules.filter(r => r.enabled);

        if (enabledRules.length === 0) {
            return { error: 'No enabled rules found' };
        }

        // Clear previous results FOR THIS TAB
        await clearScanResults(tabId);

        // Inject and execute content script
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['src/content/content.js']
        });

        // Send scan configuration to content script
        await chrome.tabs.sendMessage(tabId, {
            type: 'EXECUTE_SCAN',
            settings,
            rules: enabledRules
        });

        // Broadcast SCAN_STARTED to popup and other extension contexts
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.SCAN_STARTED,
            tabId: tabId
        }).catch(() => {
            // Popup might be closed, ignore
        });

        return { success: true, message: 'Scan started' };
    } catch (error) {
        console.error('Failed to start scan:', error);
        return { error: error.message };
    }
}

// Listen for tab updates (for auto-scan feature)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && !isRestrictedUrl(tab.url)) {
        const settings = await getSettings();

        // Check excluded domains
        if (isDomainExcluded(tab.url, settings.excludedDomains)) {
            return;
        }

        if (settings.autoScanOnLoad) {
            // Auto-scan is enabled, start scan
            await startScan(tabId);
        }
    }
});

// Clean up results when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await clearScanResults(tabId);
});

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith('prism_')) {
        // Open popup or focus the extension
        chrome.action.openPopup().catch(() => {
            // If popup can't be opened, just clear the notification
            chrome.notifications.clear(notificationId);
        });
    }
});
