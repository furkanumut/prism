// In-page notification overlay for PRISM
// Shows a notification when secrets are found

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__prismNotificationLoaded) return;
  window.__prismNotificationLoaded = true;

  /**
   * Show in-page notification
   */
  function showNotification(findingsCount) {
    // Remove existing notification if any
    const existing = document.getElementById('prism-notification');
    if (existing) {
      existing.remove();
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'prism-notification';

    // Build notification content safely using DOM API
    const iconDiv = document.createElement('div');
    iconDiv.className = 'prism-notif-icon';
    iconDiv.textContent = '🔐';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'prism-notif-content';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'prism-notif-title';
    titleDiv.textContent = 'PRISM Alert';

    const messageDiv = document.createElement('div');
    messageDiv.className = 'prism-notif-message';
    messageDiv.textContent = `Found ${findingsCount} potential secret${findingsCount > 1 ? 's' : ''}`;

    contentDiv.appendChild(titleDiv);
    contentDiv.appendChild(messageDiv);

    const closeDiv = document.createElement('div');
    closeDiv.className = 'prism-notif-close';
    closeDiv.textContent = '×';

    notification.appendChild(iconDiv);
    notification.appendChild(contentDiv);
    notification.appendChild(closeDiv);

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      #prism-notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        color: #ffffff;
        padding: 16px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        gap: 12px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        animation: prism-slide-in 0.3s ease-out;
        min-width: 300px;
        max-width: 400px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 215, 0, 0.3);
      }

      @keyframes prism-slide-in {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes prism-slide-out {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }

      #prism-notification.prism-closing {
        animation: prism-slide-out 0.3s ease-in forwards;
      }

      #prism-notification:hover {
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 215, 0, 0.5);
        border-color: rgba(255, 215, 0, 0.5);
      }

      .prism-notif-icon {
        font-size: 32px;
        filter: drop-shadow(0 2px 8px rgba(255, 215, 0, 0.5));
      }

      .prism-notif-content {
        flex: 1;
      }

      .prism-notif-title {
        font-weight: 700;
        font-size: 14px;
        margin-bottom: 4px;
        color: #ffd700;
      }

      .prism-notif-message {
        font-size: 13px;
        color: #e0e0e0;
      }

      .prism-notif-close {
        font-size: 24px;
        line-height: 20px;
        opacity: 0.6;
        transition: opacity 0.2s;
        padding: 0 4px;
        cursor: pointer;
      }

      .prism-notif-close:hover {
        opacity: 1;
      }
    `;

    // Append to document
    if (document.head) {
      document.head.appendChild(style);
    }
    if (document.body) {
      document.body.appendChild(notification);
    } else {
      // If body not ready, wait for it
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(notification);
      });
    }

    // Click to open popup (if possible)
    notification.addEventListener('click', (e) => {
      if (!e.target.classList.contains('prism-notif-close')) {
        // Send message to open popup
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {
          // Fallback: just close notification
          closeNotification(notification);
        });
      }
    });

    // Close button
    const closeBtn = notification.querySelector('.prism-notif-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeNotification(notification);
    });

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      closeNotification(notification);
    }, 5000);
  }

  /**
   * Close notification with animation
   */
  function closeNotification(notification) {
    if (!notification || !notification.parentNode) return;

    notification.classList.add('prism-closing');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 300);
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SHOW_IN_PAGE_NOTIFICATION') {
      showNotification(message.findingsCount);
      sendResponse({ success: true });
    }
  });

})();
