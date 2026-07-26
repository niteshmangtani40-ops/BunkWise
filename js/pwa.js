/**
 * pwa.js — PWA Features
 *
 * Service worker registration, install prompt handling,
 * update detection, and PWA status checks.
 */

/* ─────────────────────────────────────────────────────────────
   SERVICE WORKER REGISTRATION
   ───────────────────────────────────────────────────────────── */

let _swRegistration = null;
let _installPrompt  = null;
let _updatePollTimer = null;

/** Register the service worker */
export async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[PWA] Service Workers not supported');
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.register('./service-worker.js', {
      scope: './'
    });
    _swRegistration = reg;

    console.log('[PWA] Service worker registered:', reg.scope);
    setupUpdatePolling(reg);

    // Listen for updates
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available
          _notifyUpdate();
        }
      });
    });

    // Listen for controller change (after skipWaiting)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });

    return reg;
  } catch (err) {
    console.error('[PWA] Service worker registration failed:', err);
    return null;
  }
}

/** Capture the beforeinstallprompt event */
export function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _installPrompt = e;
    // Show custom install button
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) installBtn.classList.remove('d-none');
    console.log('[PWA] Install prompt captured');
  });

  window.addEventListener('appinstalled', () => {
    _installPrompt = null;
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) installBtn.classList.add('d-none');
    console.log('[PWA] App installed');
    import('./utils.js').then(({ lsSet }) => lsSet('pwaInstalled', true));
  });
}

function setupUpdatePolling(reg) {
  if (_updatePollTimer) {
    clearInterval(_updatePollTimer);
  }

  const poll = async () => {
    try {
      await reg.update();
    } catch (error) {
      console.warn('[PWA] update poll failed:', error);
    }
  };

  _updatePollTimer = window.setInterval(poll, 30 * 60 * 1000);
  void poll();
}

/** Trigger the native install prompt */
export async function showInstallPrompt() {
  if (!_installPrompt) return false;
  _installPrompt.prompt();
  const { outcome } = await _installPrompt.userChoice;
  _installPrompt = null;
  return outcome === 'accepted';
}

/** Check if app is running as installed PWA */
export function isPWA() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://')
  );
}

/* ─────────────────────────────────────────────────────────────
   UPDATE NOTIFICATION
   ───────────────────────────────────────────────────────────── */

function _notifyUpdate() {
  // Show a toast/banner to the user
  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-card);
    border: 1px solid var(--border-color-strong);
    border-radius: var(--radius-lg);
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 9999;
    box-shadow: var(--shadow-xl);
    font-size: 14px;
    color: var(--text-primary);
    white-space: nowrap;
  `;
  banner.innerHTML = `
    <i class="fa-solid fa-arrows-rotate" style="color: var(--color-primary)"></i>
    <span>New version available!</span>
    <button onclick="window.location.reload()" style="
      background: var(--gradient-primary);
      color: white;
      border: none;
      padding: 6px 14px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
    ">Update</button>
    <button onclick="this.parentElement.remove()" style="
      background: none;
      border: none;
      color: var(--text-tertiary);
      cursor: pointer;
      font-size: 18px;
    ">×</button>
  `;
  document.body.appendChild(banner);

  // Auto-hide after 30s
  setTimeout(() => banner.remove(), 30000);
}

/* ─────────────────────────────────────────────────────────────
   CACHE UTILITIES
   ───────────────────────────────────────────────────────────── */

/** Send message to service worker */
export function sendSWMessage(message) {
  if (_swRegistration?.active) {
    _swRegistration.active.postMessage(message);
  }
}

/** Clear all caches (for debugging/reset) */
export async function clearAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  console.log('[PWA] All caches cleared');
}

/** Get cache storage size (approximate) */
export async function getCacheSize() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usage, quota, usageMB: (usage / 1024 / 1024).toFixed(2) };
}

/* ─────────────────────────────────────────────────────────────
   NOTIFICATIONS
   ───────────────────────────────────────────────────────────── */

/** Request notification permission */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  const result = await Notification.requestPermission();
  return result;
}

/** Show a local notification */
export function showLocalNotification(title, options = {}) {
  if (Notification.permission !== 'granted') return;
  const opts = {
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-72.png',
    ...options
  };
  if (_swRegistration) {
    _swRegistration.showNotification(title, opts);
  } else {
    new Notification(title, opts);
  }
}

/** Schedule a local notification (using setTimeout — not persistent) */
export function scheduleNotification(title, body, delayMs) {
  setTimeout(() => showLocalNotification(title, { body }), delayMs);
}

/* ─────────────────────────────────────────────────────────────
   NETWORK STATUS
   ───────────────────────────────────────────────────────────── */

export function isOnline() {
  return navigator.onLine;
}

export function onNetworkChange(callback) {
  window.addEventListener('online',  () => callback(true));
  window.addEventListener('offline', () => callback(false));
}

/** Show offline/online indicator */
export function setupNetworkIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'network-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%) translateY(-100px);
    background: var(--color-warning);
    color: white;
    padding: 6px 16px;
    border-radius: var(--radius-full);
    font-size: 13px;
    font-weight: 600;
    z-index: 9998;
    transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  `;
  indicator.innerHTML = `<i class="fa-solid fa-wifi-slash"></i> You're offline — data saved locally`;
  document.body.appendChild(indicator);

  function updateIndicator(online) {
    if (!online) {
      indicator.style.transform = 'translateX(-50%) translateY(0)';
    } else {
      indicator.style.background = 'var(--color-success)';
      indicator.innerHTML = `<i class="fa-solid fa-wifi"></i> Back online!`;
      indicator.style.transform = 'translateX(-50%) translateY(0)';
      setTimeout(() => {
        indicator.style.transform = 'translateX(-50%) translateY(-100px)';
        setTimeout(() => {
          indicator.style.background = 'var(--color-warning)';
          indicator.innerHTML = `<i class="fa-solid fa-wifi-slash"></i> You're offline — data saved locally`;
        }, 500);
      }, 3000);
    }
  }

  if (!navigator.onLine) updateIndicator(false);
  onNetworkChange(updateIndicator);
}
