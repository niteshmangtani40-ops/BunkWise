import { getAllSubjects, getAllAttendance, getAllTimetable, getProfile } from '../db.js';
import { formatDateShort, formatTime, calcPercentage } from '../utils.js';
import { showToast } from '../notifications.js';

let _overlay = null;
let _results = [];
let _debounceTimer = null;

export function registerGlobalSearch(triggerSelector = '#search-btn') {
  const trigger = document.querySelector(triggerSelector);
  if (!trigger) return;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.addEventListener('click', openSearch);
}

export function openSearch() {
  if (_overlay) {
    _overlay.classList.add('open');
    const input = _overlay.querySelector('#global-search-input');
    input?.focus();
    return;
  }

  _overlay = document.createElement('div');
  _overlay.className = 'modal-overlay open';
  _overlay.innerHTML = `
    <div class="modal" style="max-width:860px;width:min(860px,calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column" role="dialog" aria-modal="true" aria-label="Global search">
      <div class="modal-header" style="border-bottom:1px solid var(--border-color)">
        <h3 class="modal-title">Search BunkWise</h3>
        <button class="btn-icon" id="global-search-close" aria-label="Close search"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-4);overflow:hidden">
        <input id="global-search-input" class="form-input" type="search" placeholder="Search subjects, teachers, timetable, history, reports…" aria-label="Search" />
        <div id="global-search-hints" style="font-size:13px;color:var(--text-tertiary)">Type to search across your local data.</div>
        <div id="global-search-results" style="overflow:auto;max-height:60vh;display:grid;gap:var(--space-3)"></div>
      </div>
    </div>
  `;

  const close = () => {
    _overlay?.classList.remove('open');
    setTimeout(() => {
      _overlay?.remove();
      _overlay = null;
    }, 240);
  };

  _overlay.querySelector('#global-search-close').addEventListener('click', close);
  _overlay.addEventListener('click', (event) => { if (event.target === _overlay) close(); });
  document.body.appendChild(_overlay);

  const input = _overlay.querySelector('#global-search-input');
  input.addEventListener('input', () => {
    window.clearTimeout(_debounceTimer);
    _debounceTimer = window.setTimeout(() => void runSearch(input.value), 120);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') void runSearch(input.value);
  });
  setTimeout(() => input.focus(), 50);
  void runSearch('');
}

async function runSearch(query) {
  const term = String(query || '').trim().toLowerCase();
  const resultsEl = _overlay?.querySelector('#global-search-results');
  if (!resultsEl) return;

  const [subjects, attendance, timetable, profile] = await Promise.all([
    getAllSubjects(),
    getAllAttendance(),
    getAllTimetable(),
    getProfile(),
  ]);

  const items = [];

  subjects.forEach((subject) => {
    const haystack = `${subject.name} ${subject.code || ''} ${subject.faculty || ''}`.toLowerCase();
    if (!term || fuzzyMatch(term, haystack)) {
      const pct = calcPercentage(subject.attendedClasses || 0, subject.totalClasses || 0);
      items.push({
        title: subject.name,
        subtitle: `${subject.faculty || 'No faculty'} • ${pct}% attendance`,
        href: './subjects.html',
        badge: 'Subject',
      });
    }
  });

  attendance.slice().reverse().slice(0, 40).forEach((record) => {
    const haystack = `${record.date} ${record.status} ${record.note || ''}`.toLowerCase();
    if (!term || fuzzyMatch(term, haystack)) {
      items.push({
        title: `${record.status.charAt(0).toUpperCase()}${record.status.slice(1)} • ${formatDateShort(record.date)}`,
        subtitle: record.note || 'Attendance history',
        href: './attendance.html',
        badge: 'History',
      });
    }
  });

  timetable.forEach((slot) => {
    const haystack = `${slot.day} ${slot.room || ''} ${slot.startTime} ${slot.endTime}`.toLowerCase();
    if (!term || fuzzyMatch(term, haystack)) {
      items.push({
        title: `Day ${slot.day} • ${formatTime(slot.startTime)} - ${formatTime(slot.endTime)}`,
        subtitle: slot.room || 'Timetable slot',
        href: './timetable.html',
        badge: 'Timetable',
      });
    }
  });

  if (profile && (!term || fuzzyMatch(term, `${profile.name || ''} ${profile.college || ''}`.toLowerCase()))) {
    items.unshift({
      title: profile.name || 'Student Profile',
      subtitle: `${profile.college || 'My College'} • Target ${profile.attendanceTarget || 75}%`,
      href: './profile.html',
      badge: 'Profile',
    });
  }

  _results = items.slice(0, 12);
  renderResults(resultsEl, _results, term);
}

function renderResults(container, items, term) {
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
        <h3>No matches</h3>
        <p>${term ? 'Try a different keyword.' : 'Start typing to search.'}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((item) => `
    <a href="${item.href}" class="card card-hover" style="padding:var(--space-4);text-decoration:none;display:block">
      <div style="display:flex;justify-content:space-between;gap:var(--space-3);align-items:flex-start">
        <div>
          <div style="font-weight:700;color:var(--text-primary)">${escapeHtml(item.title)}</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">${escapeHtml(item.subtitle)}</div>
        </div>
        <span class="btn btn-ghost btn-sm" style="pointer-events:none">${item.badge}</span>
      </div>
    </a>
  `).join('');
}

function fuzzyMatch(query, target) {
  if (!query) return true;
  if (target.includes(query)) return true;
  let i = 0;
  for (const char of target) {
    if (char === query[i]) i += 1;
    if (i === query.length) return true;
  }
  return false;
}

function escapeHtml(value = '') {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}
