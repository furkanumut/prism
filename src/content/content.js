// Content script - Page scanning orchestrator for PRISM

(function () {
    'use strict';

    // Prevent multiple injections
    if (window.__secretScannerInjected) {
        return;
    }
    window.__secretScannerInjected = true;

    // Context characters to capture before and after match
    const CONTEXT_CHARS = 40;

    // Scanner functions (inline to avoid module loading issues in content scripts)
    const Scanner = {
        /**
         * Scan content against provided rules
         */
        scanContent(content, rules, source, sourceType) {
            const findings = [];

            if (!content || typeof content !== 'string') {
                return findings;
            }

            for (const rule of rules) {
                if (!rule.enabled) continue;

                const patterns = Array.isArray(rule.patterns) ? rule.patterns : [rule.patterns];

                for (const pattern of patterns) {
                    try {
                        const regex = new RegExp(pattern, 'gi');
                        let match;

                        while ((match = regex.exec(content)) !== null) {
                            if (match.index === regex.lastIndex) {
                                regex.lastIndex++;
                            }

                            const value = match[0];
                            const lineNumber = this.getLineNumber(content, match.index);
                            const context = this.getContext(content, match.index, value.length);

                            findings.push({
                                ruleId: rule.id,
                                ruleName: rule.name,
                                value: value,
                                context: context,
                                source: source,
                                sourceType: sourceType,
                                lineNumber: lineNumber
                            });
                        }
                    } catch (error) {
                        console.warn(`Invalid regex in rule "${rule.name}":`, error);
                    }
                }
            }

            return findings;
        },

        /**
         * Get context around match (fixed character count before and after)
         */
        getContext(content, matchIndex, matchLength) {
            const startIndex = Math.max(0, matchIndex - CONTEXT_CHARS);
            const endIndex = Math.min(content.length, matchIndex + matchLength + CONTEXT_CHARS);

            let before = content.substring(startIndex, matchIndex);
            let after = content.substring(matchIndex + matchLength, endIndex);

            // Clean up: replace newlines and multiple spaces with single space
            before = before.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
            after = after.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');

            // Add ellipsis if truncated
            const prefixEllipsis = startIndex > 0 ? '...' : '';
            const suffixEllipsis = endIndex < content.length ? '...' : '';

            return {
                before: prefixEllipsis + before,
                match: content.substring(matchIndex, matchIndex + matchLength),
                after: after + suffixEllipsis
            };
        },

        /**
         * Get line number for match index
         */
        getLineNumber(content, index) {
            return content.substring(0, index).split('\n').length;
        },

        /**
         * Deduplicate findings
         */
        deduplicateFindings(findings) {
            const seen = new Set();
            return findings.filter(finding => {
                const key = `${finding.ruleName}|${finding.value}|${finding.source}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }
    };

    /**
     * Get the current page's domain
     */
    function getCurrentDomain() {
        return window.location.hostname;
    }

    /**
     * Check if a URL is from the current domain
     */
    function isSameDomain(url) {
        try {
            const urlObj = new URL(url, window.location.href);
            return urlObj.hostname === getCurrentDomain();
        } catch {
            return false;
        }
    }

    /**
     * Collect all resource URLs from the page
     */
    function collectResourceUrls() {
        const resources = {
            scripts: [],
            stylesheets: []
        };

        // External scripts
        document.querySelectorAll('script[src]').forEach(script => {
            const src = script.src;
            if (src && !src.startsWith('data:')) {
                resources.scripts.push(src);
            }
        });

        // External stylesheets
        document.querySelectorAll('link[rel="stylesheet"][href]').forEach(link => {
            const href = link.href;
            if (href && !href.startsWith('data:')) {
                resources.stylesheets.push(href);
            }
        });

        return resources;
    }

    /**
     * Collect inline scripts content
     */
    function collectInlineScripts() {
        const scripts = [];
        document.querySelectorAll('script:not([src])').forEach((script, index) => {
            if (script.textContent && script.textContent.trim()) {
                scripts.push({
                    content: script.textContent,
                    source: `inline-script-${index + 1}`
                });
            }
        });
        return scripts;
    }

    /**
     * Collect inline styles content
     */
    function collectInlineStyles() {
        const styles = [];
        document.querySelectorAll('style').forEach((style, index) => {
            if (style.textContent && style.textContent.trim()) {
                styles.push({
                    content: style.textContent,
                    source: `inline-style-${index + 1}`
                });
            }
        });
        return styles;
    }

    /**
     * Fetch external resource content
     */
    async function fetchResource(url) {
        try {
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'omit',
                cache: 'force-cache'
            });

            if (!response.ok) {
                console.warn(`Failed to fetch ${url}: ${response.status}`);
                return null;
            }

            return await response.text();
        } catch (error) {
            console.warn(`Error fetching ${url}:`, error.message);
            return null;
        }
    }

    /**
     * Execute the scan with provided settings and rules
     */
    async function executeScan(settings, rules) {
        const findings = [];
        const stats = {
            htmlScanned: false,
            inlineScriptsScanned: 0,
            inlineStylesScanned: 0,
            externalScriptsScanned: 0,
            externalStylesScanned: 0,
            externalScriptsFailed: 0,
            externalStylesFailed: 0
        };

        const currentDomain = getCurrentDomain();
        const pageUrl = window.location.href;

        // 1. Scan HTML content
        const htmlContent = document.documentElement.outerHTML;
        const htmlFindings = Scanner.scanContent(htmlContent, rules, pageUrl, 'html');
        findings.push(...htmlFindings);
        stats.htmlScanned = true;

        // 2. Scan inline scripts
        const inlineScripts = collectInlineScripts();
        for (const script of inlineScripts) {
            const scriptFindings = Scanner.scanContent(script.content, rules, script.source, 'inline-script');
            findings.push(...scriptFindings);
            stats.inlineScriptsScanned++;
        }

        // 3. Scan inline styles
        const inlineStyles = collectInlineStyles();
        for (const style of inlineStyles) {
            const styleFindings = Scanner.scanContent(style.content, rules, style.source, 'inline-style');
            findings.push(...styleFindings);
            stats.inlineStylesScanned++;
        }

        // 4. Collect and filter external resources
        const resources = collectResourceUrls();

        // Filter based on settings
        let scriptsToScan = resources.scripts;
        let stylesToScan = resources.stylesheets;

        if (settings.scanCurrentDomainOnly) {
            scriptsToScan = scriptsToScan.filter(url => isSameDomain(url));
            stylesToScan = stylesToScan.filter(url => isSameDomain(url));
        } else if (!settings.scanThirdPartyResources) {
            scriptsToScan = scriptsToScan.filter(url => isSameDomain(url));
            stylesToScan = stylesToScan.filter(url => isSameDomain(url));
        }

        // 5. Fetch and scan external scripts (parallel)
        const scriptPromises = scriptsToScan.map(async (url) => {
            const content = await fetchResource(url);
            if (content) {
                const scriptFindings = Scanner.scanContent(content, rules, url, 'external-js');
                stats.externalScriptsScanned++;
                return scriptFindings;
            } else {
                stats.externalScriptsFailed++;
                return [];
            }
        });

        // 6. Fetch and scan external stylesheets (parallel)
        const stylePromises = stylesToScan.map(async (url) => {
            const content = await fetchResource(url);
            if (content) {
                const styleFindings = Scanner.scanContent(content, rules, url, 'external-css');
                stats.externalStylesScanned++;
                return styleFindings;
            } else {
                stats.externalStylesFailed++;
                return [];
            }
        });

        // Wait for all fetches to complete
        const [scriptResults, styleResults] = await Promise.all([
            Promise.all(scriptPromises),
            Promise.all(stylePromises)
        ]);

        // Flatten and add findings
        scriptResults.forEach(result => findings.push(...result));
        styleResults.forEach(result => findings.push(...result));

        // Deduplicate findings
        const uniqueFindings = Scanner.deduplicateFindings(findings);

        return {
            findings: uniqueFindings,
            stats: stats
        };
    }

    // Listen for scan requests from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'EXECUTE_SCAN') {
            executeScan(message.settings, message.rules)
                .then(result => {
                    // Send results back to background script
                    chrome.runtime.sendMessage({
                        type: 'SCAN_COMPLETE',
                        url: window.location.href,
                        findings: result.findings,
                        stats: result.stats
                    });
                })
                .catch(error => {
                    console.error('Scan error:', error);
                    chrome.runtime.sendMessage({
                        type: 'SCAN_ERROR',
                        error: error.message
                    });
                });

            sendResponse({ received: true });
        }
        return true;
    });

    console.log('PRISM content script loaded.');
})();
