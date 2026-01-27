// Shared constants for PRISM extension

export const STORAGE_KEYS = {
  SETTINGS: 'prism_settings',
  RULES: 'prism_rules',
  SCAN_RESULTS: 'prism_results',
  SCAN_HISTORY: 'prism_history',
  FALSE_POSITIVES: 'prism_false_positives'
};

export const MESSAGE_TYPES = {
  START_SCAN: 'START_SCAN',
  SCAN_STARTED: 'SCAN_STARTED',
  SCAN_PROGRESS: 'SCAN_PROGRESS',
  SCAN_COMPLETE: 'SCAN_COMPLETE',
  SCAN_ERROR: 'SCAN_ERROR',
  SHOW_IN_PAGE_NOTIFICATION: 'SHOW_IN_PAGE_NOTIFICATION',
  GET_RESULTS: 'GET_RESULTS',
  CLEAR_RESULTS: 'CLEAR_RESULTS',
  GET_HISTORY: 'GET_HISTORY',
  CLEAR_HISTORY: 'CLEAR_HISTORY'
};

export const DEFAULT_SETTINGS = {
  scanCurrentDomainOnly: false,
  scanThirdPartyResources: true,
  autoScanOnLoad: false,
  showNotifications: true,
  historyExpirationDays: 7,
  excludedDomains: []
};

export const RESOURCE_TYPES = {
  HTML: 'html',
  INLINE_SCRIPT: 'inline-script',
  INLINE_STYLE: 'inline-style',
  EXTERNAL_JS: 'external-js',
  EXTERNAL_CSS: 'external-css'
};
