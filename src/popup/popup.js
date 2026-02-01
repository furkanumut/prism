// PRISM Popup Logic

document.addEventListener('DOMContentLoaded', () => {
  const scanBtn = document.getElementById('scan-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const statusCard = document.getElementById('status-card');
  const statusIcon = document.getElementById('status-icon');
  const statusLabel = document.getElementById('status-label');
  const statusDetail = document.getElementById('status-detail');
  const resultsSection = document.getElementById('results-section');
  const resultsList = document.getElementById('results-list');
  const findingsCount = document.getElementById('findings-count');
  const statsSection = document.getElementById('stats-section');
  const loadingOverlay = document.getElementById('loading-overlay');

  // SVG icons
  const icons = {
    ready: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
      <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    clean: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
      <path d="M8 12L11 15L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    risky: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 9V13M12 17H12.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="2"/>
    </svg>`
  };

  // State
  let currentTabId = null;

  // Initialize
  initialize();

  async function initialize() {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      loadResults();
    }
  }

  // Scan button click
  scanBtn.addEventListener('click', startScan);

  // Settings button click
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  /**
   * Start a new scan
   */
  async function startScan() {
    if (!currentTabId) return;

    showLoading(true);
    scanBtn.disabled = true;

    // Set scanning state
    updateStatus(false, 0, true); // true = scanning

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_SCAN',
        tabId: currentTabId
      });

      if (response.error) {
        showError(response.error);
        showLoading(false);
        scanBtn.disabled = false;
        return;
      }

      // No more polling! Results will come via runtime.onMessage listener

    } catch (error) {
      console.error('Scan error:', error);
      showError(error.message);
      showLoading(false);
      scanBtn.disabled = false;
    }
  }

  /**
   * Load existing results from storage (for this tab)
   */
  async function loadResults() {
    if (!currentTabId) return;

    try {
      const results = await chrome.runtime.sendMessage({
        type: 'GET_RESULTS',
        tabId: currentTabId
      });

      if (results && results.findings !== undefined) {
        displayResults(results);
      } else {
        // Clear UI if no results for this tab
        updateFindingsList([]);
        updateStatus(true, 0); // Default to clean state
        updateStats({});
      }
    } catch (error) {
      console.error('Failed to load results:', error);
    }
  }

  /**
   * Display scan results
   */
  function displayResults(results) {
    const findings = results.findings || [];
    const stats = results.stats || {};
    const isClean = findings.length === 0;

    // Update status
    updateStatus(isClean, findings.length);

    // Update stats
    updateStats(stats);

    // Update findings list
    updateFindingsList(findings);
  }

  /**
   * Update status display
   */
  function updateStatus(isClean, count, isScanning = false) {
    statusCard.classList.remove('clean', 'risky');

    if (isScanning) {
      statusIcon.textContent = '';
      statusIcon.insertAdjacentHTML('beforeend', icons.ready);
      statusLabel.textContent = 'Scanning...';
      statusDetail.textContent = 'Analyzing page resources';
    } else if (isClean) {
      statusCard.classList.add('clean');
      statusIcon.textContent = '';
      statusIcon.insertAdjacentHTML('beforeend', icons.clean);
      statusLabel.textContent = 'Clean';
      statusDetail.textContent = 'No secrets found on this page';
    } else {
      statusCard.classList.add('risky');
      statusIcon.textContent = '';
      statusIcon.insertAdjacentHTML('beforeend', icons.risky);
      statusLabel.textContent = 'Secrets Found';
      statusDetail.textContent = `${count} potential secret${count > 1 ? 's' : ''} detected`;
    }
  }

  /**
   * Update stats display
   */
  function updateStats(stats) {
    statsSection.style.display = 'block';

    const scriptsScanned = (stats.externalScriptsScanned || 0);
    const stylesScanned = (stats.externalStylesScanned || 0);
    const inlineScanned = (stats.inlineScriptsScanned || 0) + (stats.inlineStylesScanned || 0);

    document.getElementById('stat-scripts').textContent = scriptsScanned;
    document.getElementById('stat-styles').textContent = stylesScanned;
    document.getElementById('stat-inline').textContent = inlineScanned;
  }

  /**
   * Update findings list with context display
   */
  function updateFindingsList(findings) {
    resultsSection.style.display = 'block';
    findingsCount.textContent = findings.length;
    findingsCount.classList.toggle('clean', findings.length === 0);

    if (findings.length === 0) {
      resultsList.textContent = '';
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '10');
      circle.setAttribute('stroke', 'currentColor');
      circle.setAttribute('stroke-width', '2');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M8 12L11 15L16 9');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(circle);
      svg.appendChild(path);
      const p = document.createElement('p');
      p.textContent = 'No secrets detected';
      emptyDiv.appendChild(svg);
      emptyDiv.appendChild(p);
      resultsList.appendChild(emptyDiv);
      return;
    }

    // Show findings with context
    resultsList.innerHTML = findings.map((finding, index) => {
      // Build context display
      let contextHtml = '';
      if (finding.context) {
        const fullMatch = finding.context.match;
        const truncatedMatch = fullMatch.length > 150 ? fullMatch.substring(0, 150) : fullMatch;
        const isTruncated = fullMatch.length > 150;

        contextHtml = `
          <div class="finding-context">
            <span class="context-before">${escapeHtml(finding.context.before)}</span>
            <span class="context-match">
                ${escapeHtml(truncatedMatch)}
                ${isTruncated ? `<span class="expand-ellipsis" data-full="${escapeHtml(fullMatch)}">......</span>` : ''}
            </span>
            <span class="context-after">${escapeHtml(finding.context.after)}</span>
          </div>
        `;
      } else {
        // Fallback if no context (old data)
        const fullMatch = finding.value;
        const truncatedMatch = fullMatch.length > 150 ? fullMatch.substring(0, 150) : fullMatch;
        const isTruncated = fullMatch.length > 150;

        contextHtml = `
          <div class="finding-context">
            <span class="context-match">
                ${escapeHtml(truncatedMatch)}
                ${isTruncated ? `<span class="expand-ellipsis" data-full="${escapeHtml(fullMatch)}">......</span>` : ''}
            </span>
          </div>
        `;
      }

      return `
        <div class="finding-item" data-finding-index="${index}">
          <div class="finding-header">
            <span class="finding-rule">${escapeHtml(finding.ruleName)}</span>
            <span class="finding-type">${escapeHtml(finding.sourceType)}</span>
          </div>
          ${contextHtml}
          <div class="finding-source clickable" 
               title="Click to open and highlight"
               data-source-url="${escapeHtml(finding.source)}"
               data-match="${escapeHtml(finding.value || finding.context?.match || '')}">
            🔗 ${escapeHtml(truncateUrl(finding.source))}
          </div>
          <div class="finding-actions">
            <button class="fp-btn" data-mark-fp="${index}">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              False Positive
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Store findings data for later retrieval
    resultsList.dataset.findings = JSON.stringify(findings);
  }

  /**
   * Show loading overlay
   */
  function showLoading(show) {
    loadingOverlay.style.display = show ? 'flex' : 'none';
  }

  /**
   * Show error state
   */
  function showError(message) {
    statusCard.classList.remove('clean', 'risky');
    statusCard.classList.add('risky');
    statusIcon.textContent = '';
    statusIcon.insertAdjacentHTML('beforeend', icons.risky);
    statusLabel.textContent = 'Error';
    statusDetail.textContent = message;
  }

  /**
   * Escape HTML to prevent XSS
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
    if (!url || url.length <= 50) return url;

    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      const filename = path.split('/').pop() || path;
      return `${urlObj.hostname}/.../${filename}`;
    } catch {
      return url.substring(0, 47) + '...';
    }
  }

  // Event delegation for ellipsis expansion and false positive marking
  resultsList.addEventListener('click', async (e) => {
    // Handle ellipsis expansion
    if (e.target.classList.contains('expand-ellipsis')) {
      const fullText = e.target.getAttribute('data-full');
      const parent = e.target.parentElement;
      parent.textContent = fullText;
      return;
    }

    // Handle source URL click - open in new tab with text highlight
    const sourceEl = e.target.closest('.finding-source.clickable');
    if (sourceEl) {
      const sourceUrl = sourceEl.getAttribute('data-source-url');
      const matchText = sourceEl.getAttribute('data-match');

      if (sourceUrl && sourceUrl.startsWith('http')) {
        // For external scripts, open with text fragment to highlight
        // Take first 50 chars of match for the text fragment
        const searchText = matchText ? matchText.substring(0, 50) : '';

        // Open URL in new tab
        chrome.tabs.create({ url: sourceUrl }, (tab) => {
          // After tab loads, inject script to find and highlight the text
          if (searchText) {
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
              if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);

                // Send message to trigger browser's find feature
                chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: (textToFind) => {
                    // Try to find and scroll to the text
                    const text = textToFind.substring(0, 30);
                    if (window.find) {
                      window.find(text, false, false, true, false, true, false);
                    }
                  },
                  args: [searchText]
                }).catch(() => {
                  // Script injection might fail on some pages, that's okay
                });
              }
            });
          }
        });
      } else {
        // For inline scripts, just show an alert
        alert('This is an inline script. The match was found in the page source.');
      }
      return;
    }

    // Handle false positive marking
    const fpBtn = e.target.closest('button[data-mark-fp]');
    if (fpBtn) {
      const findingIndex = parseInt(fpBtn.getAttribute('data-mark-fp'));
      const findingsData = JSON.parse(resultsList.dataset.findings || '[]');
      const finding = findingsData[findingIndex];

      if (!finding) return;

      try {
        // Send message to background to add to false positives
        await chrome.runtime.sendMessage({
          type: 'ADD_FALSE_POSITIVE',
          finding: finding
        });

        // Remove the finding from current display
        const findingItem = fpBtn.closest('.finding-item');
        if (findingItem) {
          findingItem.style.opacity = '0';
          findingItem.style.transition = 'opacity 0.3s';
          setTimeout(() => {
            // Update the findings array
            findingsData.splice(findingIndex, 1);
            updateFindingsList(findingsData);

            // Update the count
            const isClean = findingsData.length === 0;
            updateStatus(isClean, findingsData.length);
          }, 300);
        }
      } catch (error) {
        console.error('Failed to mark as false positive:', error);
      }
    }
  });

  // Listen for real-time messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only listen to messages for the current tab
    if (message.tabId && currentTabId && message.tabId !== currentTabId) {
      return;
    }

    if (message.type === 'SCAN_STARTED') {
      // Scan has started
      updateStatus(false, 0, true);
      showLoading(true);
      scanBtn.disabled = true;
    } else if (message.type === 'SCAN_COMPLETE') {
      // Scan completed with results
      if (message.results) {
        displayResults(message.results);
        showLoading(false);
        scanBtn.disabled = false;
      }
    }
  });

});
