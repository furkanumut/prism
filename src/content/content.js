// Content script - Page scanning orchestrator for PRISM
// Uses Web Worker for 100% non-blocking scanning

(function () {
    'use strict';

    // Prevent multiple injections
    if (window.__secretScannerInjected) {
        return;
    }
    window.__secretScannerInjected = true;

    // Performance constants
    const CONCURRENT_FETCH_LIMIT = 10; // Increased from 5
    const INITIAL_SCAN_DELAY = 500;
    const WORKER_POOL_SIZE = 8 // Number of parallel workers

    // Inline worker code as string (to bypass cross-origin restrictions)
    let workerPool = [];
    let workerBlobUrl = null;
    let pendingScans = new Map();
    let scanIdCounter = 0;
    let nextWorkerIndex = 0;

    const WORKER_CODE = `
// PRISM Scanner Web Worker - Inline Version
const Scanner = {
    scanContent(content, rules, source, sourceType) {
        const findings = [];
        if (!content || typeof content !== 'string') return findings;

        for (const rule of rules) {
            if (!rule.enabled) continue;
            const patterns = Array.isArray(rule.patterns) ? rule.patterns : [rule.patterns];

            for (const pattern of patterns) {
                try {
                    const regex = new RegExp(pattern, 'gi');
                    let match;

                    while ((match = regex.exec(content)) !== null) {
                        if (match.index === regex.lastIndex) regex.lastIndex++;

                        const value = match[0];
                        const matchIndex = match.index;
                        const CONTEXT_CHARS = 40;
                        
                        // Get context
                        const startIndex = Math.max(0, matchIndex - CONTEXT_CHARS);
                        const endIndex = Math.min(content.length, matchIndex + value.length + CONTEXT_CHARS);
                        let before = content.substring(startIndex, matchIndex).replace(/[\\r\\n\\t]+/g, ' ').replace(/\\s+/g, ' ');
                        let after = content.substring(matchIndex + value.length, endIndex).replace(/[\\r\\n\\t]+/g, ' ').replace(/\\s+/g, ' ');

                        findings.push({
                            ruleId: rule.id,
                            ruleName: rule.name,
                            value: value,
                            context: {
                                before: (startIndex > 0 ? '...' : '') + before,
                                match: value,
                                after: after + (endIndex < content.length ? '...' : '')
                            },
                            source: source,
                            sourceType: sourceType,
                            lineNumber: content.substring(0, matchIndex).split('\\n').length
                        });
                    }
                } catch (e) {}
            }
        }
        return findings;
    }
};

self.onmessage = function(e) {
    const { type, id, content, rules, source, sourceType } = e.data;
    if (type === 'SCAN') {
        const startTime = Date.now();
        const findings = Scanner.scanContent(content, rules, source, sourceType);
        self.postMessage({
            type: 'SCAN_RESULT',
            id: id,
            findings: findings,
            duration: Date.now() - startTime,
            sourceType: sourceType
        });
    }
};
`;

    /**
     * Create a single worker instance
     */
    function createWorker() {
        if (!workerBlobUrl) {
            const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
            workerBlobUrl = URL.createObjectURL(blob);
        }

        const worker = new Worker(workerBlobUrl);

        worker.onmessage = function (e) {
            const { type, id, findings, duration, sourceType } = e.data;

            if (type === 'SCAN_RESULT') {
                const callback = pendingScans.get(id);
                if (callback) {
                    callback(findings);
                    pendingScans.delete(id);
                }
                console.log(Date.now() + ` [PRISM Worker] Scan done: ${findings.length} findings, ${duration}ms (${sourceType})`);
            }
        };

        worker.onerror = function (error) {
            console.error('[PRISM] Worker error:', error);
        };

        return worker;
    }

    /**
     * Initialize worker pool
     */
    function initWorkerPool() {
        if (workerPool.length > 0) return;

        try {
            for (let i = 0; i < WORKER_POOL_SIZE; i++) {
                workerPool.push(createWorker());
            }
            console.log(`[PRISM] Worker pool initialized: ${WORKER_POOL_SIZE} workers`);
        } catch (error) {
            console.error('[PRISM] Failed to create worker pool:', error);
        }
    }

    /**
     * Get next worker from pool (round-robin)
     */
    function getNextWorker() {
        if (workerPool.length === 0) {
            initWorkerPool();
        }
        const worker = workerPool[nextWorkerIndex];
        nextWorkerIndex = (nextWorkerIndex + 1) % workerPool.length;
        return worker;
    }

    /**
     * Scan content using Web Worker pool (non-blocking, parallel)
     */
    function scanWithWorker(content, rules, source, sourceType) {
        return new Promise((resolve) => {
            const worker = getNextWorker();
            if (!worker) {
                resolve([]);
                return;
            }

            const id = ++scanIdCounter;
            pendingScans.set(id, resolve);

            worker.postMessage({
                type: 'SCAN',
                id: id,
                content: content,
                rules: rules,
                source: source,
                sourceType: sourceType
            });
        });
    }

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

        document.querySelectorAll('script[src]').forEach(script => {
            const src = script.src;
            if (src && !src.startsWith('data:')) {
                resources.scripts.push(src);
            }
        });

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
                return null;
            }

            return await response.text();
        } catch (error) {
            return null;
        }
    }

    /**
     * Fetch multiple URLs with concurrency limit
     */
    async function fetchWithConcurrencyLimit(urls, limit, processContent) {
        const results = [];
        let index = 0;

        async function fetchNext() {
            if (index >= urls.length) return;

            const currentIndex = index++;
            const url = urls[currentIndex];

            const content = await fetchResource(url);
            if (content) {
                results[currentIndex] = await processContent(url, content);
            } else {
                results[currentIndex] = [];
            }

            await fetchNext();
        }

        const workers = [];
        for (let i = 0; i < Math.min(limit, urls.length); i++) {
            workers.push(fetchNext());
        }

        await Promise.all(workers);
        return results;
    }

    /**
     * Deduplicate findings
     */
    function deduplicateFindings(findings) {
        const seen = new Set();
        return findings.filter(finding => {
            const key = `${finding.ruleName}|${finding.value}|${finding.source}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Execute the scan with provided settings and rules
     * Uses Web Worker for 100% non-blocking operation
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

        const pageUrl = window.location.href;

        // Initialize worker pool
        initWorkerPool();

        // 1. Scan HTML content (in worker - non-blocking)
        console.log('[PRISM] Starting HTML content extraction...');
        const htmlContent = document.documentElement.outerHTML;
        console.log(Date.now() + `[PRISM] Scanning HTML content (${Math.round(htmlContent.length / 1024)}KB) via Worker`);

        const htmlFindings = await scanWithWorker(htmlContent, rules, pageUrl, 'html');
        findings.push(...htmlFindings);
        stats.htmlScanned = true;

        // 2. Scan inline scripts - combine and scan via worker
        const inlineScripts = collectInlineScripts();
        if (inlineScripts.length > 0) {
            const combinedScripts = inlineScripts.map(s => s.content).join('\n\n/* --- SEPARATOR --- */\n\n');
            console.log(Date.now() + ` [PRISM] Scanning ${inlineScripts.length} inline scripts (${Math.round(combinedScripts.length / 1024)}KB) via Worker`);

            const scriptFindings = await scanWithWorker(combinedScripts, rules, 'inline-scripts', 'inline-script');
            findings.push(...scriptFindings);
            stats.inlineScriptsScanned = inlineScripts.length;
        }

        // 3. Scan inline styles - combine and scan via worker
        const inlineStyles = collectInlineStyles();
        if (inlineStyles.length > 0) {
            const combinedStyles = inlineStyles.map(s => s.content).join('\n\n/* --- SEPARATOR --- */\n\n');
            console.log(Date.now() + ` [PRISM] Scanning ${inlineStyles.length} inline styles (${Math.round(combinedStyles.length / 1024)}KB) via Worker`);

            const styleFindings = await scanWithWorker(combinedStyles, rules, 'inline-styles', 'inline-style');
            findings.push(...styleFindings);
            stats.inlineStylesScanned = inlineStyles.length;
        }

        // 4. Collect and filter external resources
        const resources = collectResourceUrls();

        let scriptsToScan = resources.scripts;
        let stylesToScan = resources.stylesheets;

        if (settings.scanCurrentDomainOnly) {
            scriptsToScan = scriptsToScan.filter(url => isSameDomain(url));
            stylesToScan = stylesToScan.filter(url => isSameDomain(url));
        } else if (!settings.scanThirdPartyResources) {
            scriptsToScan = scriptsToScan.filter(url => isSameDomain(url));
            stylesToScan = stylesToScan.filter(url => isSameDomain(url));
        }

        console.log(Date.now() + `[PRISM] Fetching ${scriptsToScan.length} scripts and ${stylesToScan.length} stylesheets`);

        // Get max file size from settings (in bytes, default 500KB)
        const maxFileSize = (settings.maxFileSizeKB || 500) * 1024;

        // 5. Fetch and scan external scripts via worker (skip large files)
        const scriptResults = await fetchWithConcurrencyLimit(
            scriptsToScan,
            CONCURRENT_FETCH_LIMIT,
            async (url, content) => {
                // Skip very large files - they slow down scanning significantly
                if (maxFileSize > 0 && content.length > maxFileSize) {
                    console.log(Date.now() + ` [PRISM] Skipping large file (${Math.round(content.length / 1024)}KB > ${settings.maxFileSizeKB}KB limit): ${url.substring(0, 60)}...`);
                    return [];
                }
                const scriptFindings = await scanWithWorker(content, rules, url, 'external-js');
                stats.externalScriptsScanned++;
                return scriptFindings;
            }
        );

        // 6. Fetch and scan external stylesheets via worker
        const styleResults = await fetchWithConcurrencyLimit(
            stylesToScan,
            CONCURRENT_FETCH_LIMIT,
            async (url, content) => {
                const styleFindings = await scanWithWorker(content, rules, url, 'external-css');
                stats.externalStylesScanned++;
                return styleFindings;
            }
        );

        // Flatten and add findings
        scriptResults.forEach(result => findings.push(...(result || [])));
        styleResults.forEach(result => findings.push(...(result || [])));

        // Deduplicate findings
        const uniqueFindings = deduplicateFindings(findings);

        console.log(Date.now() + `[PRISM] Scan complete: ${uniqueFindings.length} findings`);

        return {
            findings: uniqueFindings,
            stats: stats
        };
    }

    /**
     * Delay helper
     */
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Listen for scan requests from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'EXECUTE_SCAN') {
            console.log(Date.now() + `[PRISM] Scan requested, waiting ${INITIAL_SCAN_DELAY}ms for page to stabilize...`);

            delay(INITIAL_SCAN_DELAY)
                .then(() => executeScan(message.settings, message.rules))
                .then(result => {
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

    console.log('PRISM content script loaded (Web Worker mode).');
})();
