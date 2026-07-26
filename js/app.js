/**
 * app.js — Application Entry Point
 *
 * Bootstraps the app:
 * 1. Initialize IndexedDB
 * 2. Check setup completion
 * 3. Inject shared nav
 * 4. Register service worker
 * 5. Setup PWA events
 * 6. Route to correct page if needed
 */

import { initStore, isSetupComplete, getState } from './store.js';
import { registerSW, setupInstallPrompt, setupNetworkIndicator } from './pwa.js';
import { showToast } from './notifications.js';
import { startDateWatcher } from "./services/datewatcher.js";
const initializedPages = new Set();
/* ─────────────────────────────────────────────────────────────
   BOOT
   ───────────────────────────────────────────────────────────── */

async function boot() {
  try {
    // Initialize state (opens IndexedDB, loads data)
    await initStore();

    const state = getState();
    const currentPage = getCurrentPage();

    // Setup guard: redirect to wizard if not set up
    const wizardPage = 'index.html';
    const isWizard   = currentPage === wizardPage || currentPage === '' || currentPage === '/';

    if (!state.setupComplete && !isWizard) {
      window.location.href = './index.html';
      return;
    }

    if (state.setupComplete && isWizard) {
      window.location.href = './dashboard.html';
      return;
    }

    // Inject shared components
    await injectSharedComponents();

    // Mark active nav item
    markActiveNav(currentPage);

    // Register service worker
    registerSW().catch(console.warn);

    // Setup install prompt
    setupInstallPrompt();

    // Setup network indicator
    setupNetworkIndicator();

    // Initialize page-specific module
    await initPage(currentPage);

    startDateWatcher(async () => {
    console.log("Date changed. Refreshing page...");

    await initPage(getCurrentPage());

    showToast("Date updated", "info");
});

    // Add page enter animation
    const main = document.querySelector('.main-content, .wizard-container, main');
    if (main) main.classList.add('page-enter');

  } catch (err) {
    console.error('[App] Boot failed:', err);
    showError('App failed to initialize. Please refresh.');
  }
}

/* ─────────────────────────────────────────────────────────────
   CURRENT PAGE DETECTION
   ───────────────────────────────────────────────────────────── */

function getCurrentPage() {
  const path = window.location.pathname;
  const file = path.split('/').pop() || 'index.html';
  return file || 'index.html';
}

/* ─────────────────────────────────────────────────────────────
   PAGE ROUTER
   ───────────────────────────────────────────────────────────── */

async function initPage(page) {
  const pageMap = {
    'index.html':      () => import('./pages/wizard.js'),
    '':                () => import('./pages/wizard.js'),
    'dashboard.html':  () => import('./pages/dashboard.js'),
    'subjects.html':   () => import('./pages/subjects.js'),
    'timetable.html':  () => import('./pages/timetable.js'),
    'attendance.html': () => import('./pages/attendance.js'),
    'history.html':    () => import('./pages/history.js'),
    'calendar.html':   () => import('./pages/calendar.js'),
    'reports.html':    () => import('./pages/reports.js'),
    'calculator.html': () => import('./pages/calculator.js'),
    'profile.html':    () => import('./pages/profile.js'),
    'settings.html':   () => import('./pages/settings.js'),
    'about.html':      () => import('./pages/about.js'),
  };

  const loader = pageMap[page];
  if (!loader) return;

  try {
const module = await loader();

if (!initializedPages.has(page)) {
    if (module.init) {
        await module.init();
    }
    initializedPages.add(page);
} else {
    if (module.refresh) {
        await module.refresh();
    } else if (module.init) {
        await module.init();
    }
}
  } catch (err) {
    console.error(`[App] Failed to load page module: ${page}`, err);
    showToast(`Could not load ${page}. Redirecting to dashboard.`, 'error');
    if (page !== 'dashboard.html') {
      setTimeout(() => { window.location.href = './dashboard.html'; }, 800);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   SHARED COMPONENT INJECTION
   ───────────────────────────────────────────────────────────── */

async function injectSharedComponents() {
  // Inject sidebar and bottom nav into pages that need it (not wizard)
  const navContainer = document.getElementById('nav-container');
  const bottomNavContainer = document.getElementById('bottom-nav-container');

  if (navContainer) {
    navContainer.innerHTML = buildSidebar();
    setupSidebarEvents();
  }

  if (bottomNavContainer) {
    bottomNavContainer.innerHTML = buildBottomNav();
  }

  // Inject toast container
  if (!document.getElementById('toast-container')) {
    const tc = document.createElement('div');
    tc.id = 'toast-container';
    document.body.appendChild(tc);
  }
}

/* ─────────────────────────────────────────────────────────────
   SIDEBAR BUILDER
   ───────────────────────────────────────────────────────────── */

function buildSidebar() {
  const profile = getState('profile');
  const name    = profile?.name || 'Student';
  const college = profile?.college || 'My College';

  return `
    <aside class="sidebar" id="sidebar">
      <a href="./dashboard.html" class="sidebar-logo">
        <div class="sidebar-logo-icon">
          <i class="fa-solid fa-graduation-cap"></i>
        </div>
        <div class="sidebar-logo-text">
          <span class="sidebar-logo-name">BunkWise</span>
          <span class="sidebar-logo-tagline">Smart Attendance</span>
        </div>
      </a>

      <nav class="sidebar-nav">
        <div class="sidebar-section">
          <div class="sidebar-section-label">Main</div>
          <a href="./dashboard.html"  class="nav-item" data-page="dashboard.html">
            <i class="fa-solid fa-house"></i>
            <span class="nav-label">Dashboard</span>
          </a>
          <a href="./attendance.html" class="nav-item" data-page="attendance.html">
            <i class="fa-solid fa-clipboard-check"></i>
            <span class="nav-label">Attendance</span>
          </a>
          <a href="./subjects.html"   class="nav-item" data-page="subjects.html">
            <i class="fa-solid fa-book-open"></i>
            <span class="nav-label">Subjects</span>
          </a>
          <a href="./timetable.html"  class="nav-item" data-page="timetable.html">
            <i class="fa-solid fa-calendar-days"></i>
            <span class="nav-label">Timetable</span>
          </a>
        </div>

        <div class="sidebar-section">
          <div class="sidebar-section-label">Analytics</div>
          <a href="./history.html"    class="nav-item" data-page="history.html">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <span class="nav-label">History</span>
          </a>
          <a href="./calendar.html"   class="nav-item" data-page="calendar.html">
            <i class="fa-solid fa-calendar"></i>
            <span class="nav-label">Calendar</span>
          </a>
          <a href="./reports.html"    class="nav-item" data-page="reports.html">
            <i class="fa-solid fa-chart-bar"></i>
            <span class="nav-label">Reports</span>
          </a>
          <a href="./calculator.html" class="nav-item" data-page="calculator.html">
            <i class="fa-solid fa-calculator"></i>
            <span class="nav-label">Bunk Calculator</span>
          </a>
        </div>

        <div class="sidebar-section">
          <div class="sidebar-section-label">Account</div>
          <a href="./profile.html"    class="nav-item" data-page="profile.html">
            <i class="fa-solid fa-user-circle"></i>
            <span class="nav-label">Profile</span>
          </a>
          <a href="./settings.html"   class="nav-item" data-page="settings.html">
            <i class="fa-solid fa-gear"></i>
            <span class="nav-label">Settings</span>
          </a>
          <a href="./about.html"      class="nav-item" data-page="about.html">
            <i class="fa-solid fa-circle-info"></i>
            <span class="nav-label">About</span>
          </a>
        </div>
      </nav>

      <div class="sidebar-footer">
        <a href="./profile.html" class="sidebar-user" style="text-decoration:none">
          <div class="avatar" style="width:36px;height:36px;font-size:14px">
            ${getInitialsChar(name)}
          </div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${sanitizeStr(name)}</div>
            <div class="sidebar-user-role">${sanitizeStr(college)}</div>
          </div>
          <i class="fa-solid fa-chevron-right" style="color:var(--text-tertiary);font-size:12px;margin-left:auto"></i>
        </a>
      </div>
    </aside>
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
  `;
}

function buildBottomNav() {
  return `
    <nav class="bottom-nav mobile-only">
      <a href="./dashboard.html"  class="bottom-nav-item" data-page="dashboard.html">
        <div class="bottom-nav-icon-wrapper">
          <i class="fa-solid fa-house"></i>
        </div>
        <span class="bottom-nav-label">Home</span>
      </a>
      <a href="./attendance.html" class="bottom-nav-item" data-page="attendance.html">
        <div class="bottom-nav-icon-wrapper">
          <i class="fa-solid fa-clipboard-check"></i>
        </div>
        <span class="bottom-nav-label">Attend</span>
      </a>
      <a href="./calculator.html" class="bottom-nav-item" data-page="calculator.html">
        <div class="bottom-nav-icon-wrapper">
          <i class="fa-solid fa-calculator"></i>
        </div>
        <span class="bottom-nav-label">Bunk</span>
      </a>
      <a href="./reports.html"    class="bottom-nav-item" data-page="reports.html">
        <div class="bottom-nav-icon-wrapper">
          <i class="fa-solid fa-chart-bar"></i>
        </div>
        <span class="bottom-nav-label">Reports</span>
      </a>
      <a href="./settings.html"   class="bottom-nav-item" data-page="settings.html">
        <div class="bottom-nav-icon-wrapper">
          <i class="fa-solid fa-gear"></i>
        </div>
        <span class="bottom-nav-label">Settings</span>
      </a>
    </nav>
  `;
}

/* ─────────────────────────────────────────────────────────────
   MARK ACTIVE NAV
   ───────────────────────────────────────────────────────────── */

function markActiveNav(currentPage) {
  document.querySelectorAll('[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === currentPage);
  });
}

/* ─────────────────────────────────────────────────────────────
   SIDEBAR EVENTS
   ───────────────────────────────────────────────────────────── */

function setupSidebarEvents() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const menuBtn  = document.getElementById('menu-toggle');

  function openSidebar() {
    sidebar?.classList.add('open');
    overlay?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('open');
    document.body.style.overflow = '';
  }

  menuBtn?.addEventListener('click', () => {
    if (sidebar?.classList.contains('open')) closeSidebar();
    else openSidebar();
  });

  overlay?.addEventListener('click', closeSidebar);

  // Desktop collapse toggle
  const collapseBtn = document.getElementById('sidebar-collapse');
  collapseBtn?.addEventListener('click', () => {
    sidebar?.classList.toggle('collapsed');
    const main = document.querySelector('.main-content');
    main?.classList.toggle('sidebar-collapsed');
  });
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────── */

function getInitialsChar(name = '') {
  return name.split(' ').filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('');
}

function sanitizeStr(str = '') {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showError(msg) {
  document.body.innerHTML += `
    <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
      background:var(--bg-body);z-index:9999;padding:20px">
      <div style="text-align:center;max-width:400px">
        <i class="fa-solid fa-circle-exclamation" style="font-size:48px;color:var(--color-danger);margin-bottom:16px"></i>
        <h2 style="color:var(--text-primary);margin-bottom:8px">Something went wrong</h2>
        <p style="color:var(--text-secondary)">${msg}</p>
        <button onclick="window.location.reload()" style="margin-top:20px;padding:12px 24px;
          background:var(--gradient-primary);color:white;border:none;border-radius:12px;
          font-size:15px;cursor:pointer">Refresh App</button>
      </div>
    </div>
  `;
}

/* ─────────────────────────────────────────────────────────────
   START
   ───────────────────────────────────────────────────────────── */

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { getCurrentPage, markActiveNav };
