// PRISM Scanner Web Worker
// This runs in a separate thread and NEVER blocks the main UI

// Scanner logic - runs entirely in worker thread
const Scanner = {
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
                    // Invalid regex, skip
                }
            }
        }

        return findings;
    },

    getContext(content, matchIndex, matchLength) {
        const CONTEXT_CHARS = 40;
        const startIndex = Math.max(0, matchIndex - CONTEXT_CHARS);
        const endIndex = Math.min(content.length, matchIndex + matchLength + CONTEXT_CHARS);

        let before = content.substring(startIndex, matchIndex);
        let after = content.substring(matchIndex + matchLength, endIndex);

        before = before.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
        after = after.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');

        const prefixEllipsis = startIndex > 0 ? '...' : '';
        const suffixEllipsis = endIndex < content.length ? '...' : '';

        return {
            before: prefixEllipsis + before,
            match: content.substring(matchIndex, matchIndex + matchLength),
            after: after + suffixEllipsis
        };
    },

    getLineNumber(content, index) {
        return content.substring(0, index).split('\n').length;
    },

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

// Handle messages from main thread
self.onmessage = function (e) {
    const { type, id, content, rules, source, sourceType } = e.data;

    if (type === 'SCAN') {
        const startTime = Date.now();
        const findings = Scanner.scanContent(content, rules, source, sourceType);
        const duration = Date.now() - startTime;

        self.postMessage({
            type: 'SCAN_RESULT',
            id: id,
            findings: findings,
            duration: duration,
            source: source,
            sourceType: sourceType
        });
    } else if (type === 'SCAN_BATCH') {
        // Scan multiple items and return combined results
        const allFindings = [];
        const items = e.data.items;

        for (const item of items) {
            const findings = Scanner.scanContent(item.content, rules, item.source, item.sourceType);
            allFindings.push(...findings);
        }

        const uniqueFindings = Scanner.deduplicateFindings(allFindings);

        self.postMessage({
            type: 'BATCH_RESULT',
            id: id,
            findings: uniqueFindings
        });
    }
};
