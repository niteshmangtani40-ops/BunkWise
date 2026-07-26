/**
 * notifications.js — Toast & Alert Notification System
 *
 * Provides showToast() for in-app notifications and
 * showConfirm() for confirmation dialogs.
 */

/* ─────────────────────────────────────────────────────────────
   TOAST NOTIFICATION
   ───────────────────────────────────────────────────────────── */

const DEFAULT_DURATION = 4000; // ms

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {string} title
 * @param {number} duration  ms (0 = persistent)
 */
export function showToast(message, type = 'info', title = '', duration = DEFAULT_DURATION) {
  const container = getOrCreateContainer();

  const icons = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info:    'fa-circle-info',
  };

  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${type}`;
  toastEl.innerHTML = `
    <div class="toast-icon"><i class="fa-solid ${icons[type] || icons.info}"></i></div>
    <div class="toast-content">
      ${title ? `<div class="toast-title">${escHtml(title)}</div>` : ''}
      <div class="toast-message">${escHtml(message)}</div>
    </div>
    <button class="toast-close" aria-label="Dismiss">
      <i class="fa-solid fa-xmark"></i>
    </button>
    ${duration > 0 ? `<div class="toast-progress" style="animation-duration:${duration}ms"></div>` : ''}
  `;

  // Dismiss on close button
  toastEl.querySelector('.toast-close').addEventListener('click', () => dismissToast(toastEl));

  container.appendChild(toastEl);

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => dismissToast(toastEl), duration);
  }

  return toastEl;
}

function dismissToast(el) {
  el.classList.add('toast-out');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400); // fallback
}

function getOrCreateContainer() {
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

/* ─────────────────────────────────────────────────────────────
   CONVENIENCE WRAPPERS
   ───────────────────────────────────────────────────────────── */

export const toast = {
  success: (msg, title = 'Success')  => showToast(msg, 'success', title),
  error:   (msg, title = 'Error')    => showToast(msg, 'error', title, 6000),
  warning: (msg, title = 'Warning')  => showToast(msg, 'warning', title),
  info:    (msg, title = '')         => showToast(msg, 'info', title),
};

/* ─────────────────────────────────────────────────────────────
   CONFIRM DIALOG
   ───────────────────────────────────────────────────────────── */

/**
 * Show a confirmation modal and return a Promise<boolean>.
 * @param {string} title
 * @param {string} message
 * @param {string} confirmText  Button label
 * @param {'danger'|'primary'} confirmType
 */
export function showConfirm(title, message, confirmText = 'Confirm', confirmType = 'primary') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">${escHtml(title)}</h3>
        </div>
        <div class="modal-body">
          <p style="color:var(--text-secondary);line-height:1.6">${escHtml(message)}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
          <button class="btn btn-${confirmType}" id="confirm-ok">${escHtml(confirmText)}</button>
        </div>
      </div>
    `;

    function cleanup(result) {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 300);
      resolve(result);
    }

    overlay.querySelector('#confirm-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('#confirm-ok').addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });

    document.body.appendChild(overlay);
    // Trigger open animation
    requestAnimationFrame(() => overlay.querySelector('.modal').style.transform = 'scale(1) translateY(0)');
  });
}

/* ─────────────────────────────────────────────────────────────
   PROMPT DIALOG
   ───────────────────────────────────────────────────────────── */

/**
 * Show a text input prompt and return Promise<string|null>
 */
export function showPrompt(title, placeholder = '', defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h3 class="modal-title">${escHtml(title)}</h3>
        </div>
        <div class="modal-body">
          <input
            class="form-input"
            id="prompt-input"
            type="text"
            placeholder="${escHtml(placeholder)}"
            value="${escHtml(defaultValue)}"
            autocomplete="off"
          />
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="prompt-cancel">Cancel</button>
          <button class="btn btn-primary" id="prompt-ok">OK</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('#prompt-input');

    function cleanup(result) {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 300);
      resolve(result);
    }

    overlay.querySelector('#prompt-cancel').addEventListener('click', () => cleanup(null));
    overlay.querySelector('#prompt-ok').addEventListener('click', () => cleanup(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  cleanup(input.value.trim());
      if (e.key === 'Escape') cleanup(null);
    });

    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 100);
  });
}

/* ─────────────────────────────────────────────────────────────
   LOADING OVERLAY
   ───────────────────────────────────────────────────────────── */

let _loadingOverlay = null;

export function showLoading(message = 'Loading…') {
  if (_loadingOverlay) return;
  _loadingOverlay = document.createElement('div');
  _loadingOverlay.id = 'loading-overlay';
  _loadingOverlay.style.cssText = `
    position: fixed; inset: 0;
    background: var(--bg-overlay);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 9997;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    animation: fadeIn 0.2s ease;
  `;
  _loadingOverlay.innerHTML = `
    <div class="loading-spinner"></div>
    <p style="color:var(--text-secondary);font-size:14px">${escHtml(message)}</p>
  `;
  document.body.appendChild(_loadingOverlay);
}

export function hideLoading() {
  if (_loadingOverlay) {
    _loadingOverlay.remove();
    _loadingOverlay = null;
  }
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────── */

function escHtml(str = '') {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
