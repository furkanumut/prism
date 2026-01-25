// Scanner module - Core scanning logic for PRISM

/**
 * Scan content against provided rules
 * @param {string} content - Text content to scan
 * @param {Array} rules - Array of rule objects with patterns
 * @param {string} source - Source identifier (URL or type)
 * @param {string} sourceType - Type of source (html, inline-script, etc.)
 * @returns {Array} Array of findings
 */
function scanContent(content, rules, source, sourceType) {
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
                    // Avoid infinite loops on zero-length matches
                    if (match.index === regex.lastIndex) {
                        regex.lastIndex++;
                    }

                    const value = match[0];
                    const lineNumber = getLineNumber(content, match.index);

                    findings.push({
                        ruleId: rule.id,
                        ruleName: rule.name,
                        value: value,
                        maskedValue: maskValue(value),
                        source: source,
                        sourceType: sourceType,
                        lineNumber: lineNumber,
                        matchIndex: match.index
                    });
                }
            } catch (error) {
                console.warn(`Invalid regex pattern in rule "${rule.name}":`, pattern, error);
            }
        }
    }

    return findings;
}

/**
 * Mask a sensitive value for display
 * @param {string} value - Value to mask
 * @returns {string} Masked value
 */
function maskValue(value) {
    if (!value || value.length <= 8) {
        return '*'.repeat(value ? value.length : 0);
    }

    const visibleChars = 4;
    const start = value.substring(0, visibleChars);
    const end = value.substring(value.length - visibleChars);
    const middle = '*'.repeat(Math.min(value.length - (visibleChars * 2), 20));

    return start + middle + end;
}

/**
 * Get line number for a match index
 * @param {string} content - Full content
 * @param {number} index - Character index
 * @returns {number} Line number (1-indexed)
 */
function getLineNumber(content, index) {
    const lines = content.substring(0, index).split('\n');
    return lines.length;
}

/**
 * Deduplicate findings by value and source
 * @param {Array} findings - Array of findings
 * @returns {Array} Deduplicated findings
 */
function deduplicateFindings(findings) {
    const seen = new Set();
    return findings.filter(finding => {
        const key = `${finding.ruleName}|${finding.value}|${finding.source}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

// Export for use in content script
if (typeof window !== 'undefined') {
    window.PRISM = {
        scanContent,
        maskValue,
        deduplicateFindings
    };
}
