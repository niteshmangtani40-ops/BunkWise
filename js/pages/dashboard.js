/**
 * dashboard.js — Dashboard Page Logic
 *
 * Loads and displays:
 * - Greeting & overall attendance stats
 * - Today's classes from timetable
 * - Per-subject attendance progress
 * - Weekly attendance chart (Chart.js)
 * - Achievement badges
 * - Recent activity feed
 * - Streak display
 */

import {
  getAllSubjects, getAllAttendance, getAllTimetable, markAttendance,
  getProfile, getAttendanceForDate, getAllSettings
} from '../db.js';
import {
  today, formatDateFull, getDayIndex, formatTime, formatDateShort,
  calcPercentage, calcSafeBunks, calcClassesNeeded,
  getAttendanceStatus, getProgressClass, timeAgo,
  hexToRgba, DAY_NAMES, MONTH_SHORT, debounce, predictPercentage
} from '../utils.js';
import { toggleTheme } from '../store.js';
import { showToast } from '../notifications.js';
import { showInstallPrompt } from '../pwa.js';
import { registerGlobalSearch } from '../features/search.js';
import { getPredictionsData, getHistoryComparison } from '../features/prediction.js';

let _predictionsCache = null;
let _attendanceCache = null;
let _simulatedStates = {}; // subjectId -> 'attend' | 'bunk' | null


/* ─────────────────────────────────────────────────────────────
   INIT
   ───────────────────────────────────────────────────────────── */

export async function init() {
  try {
    setupHeaderActions();
    registerGlobalSearch();
    setupLiveUpdates();
    await loadDashboard();
    setupChartPeriodSelector();
  } catch (err) {
    console.error('[Dashboard] Init error:', err);
    showDashboardError();
  }
}
export async function refresh() {
    await loadDashboard();
}
/* ─────────────────────────────────────────────────────────────
   LOAD ALL DATA
   ───────────────────────────────────────────────────────────── */

async function loadDashboard() {
  const [profile, subjects, attendance, timetable, settings] = await Promise.all([
    getProfile(),
    getAllSubjects(),
    getAllAttendance(),
    getAllTimetable(),
    getAllSettings(),
  ]);
  _attendanceCache = attendance;

  const target     = Number(profile?.attendanceTarget || settings?.attendanceTarget || 75);
  const todayDate  = today();
  const todayDay   = getDayIndex(todayDate); // 0=Sun, 1=Mon...

  // ── Greeting ────────────────────────────────────────────────
  renderGreeting(profile?.name || 'Student', todayDate);

  // ── Overall Stats ───────────────────────────────────────────
  const totalAttended = subjects.reduce((a, s) => a + (s.attendedClasses || 0), 0);
  const totalClasses  = subjects.reduce((a, s) => a + (s.totalClasses || 0), 0);
  const overallPct    = calcPercentage(totalAttended, totalClasses);
  const safeBunks     = calcSafeBunks(totalAttended, totalClasses, target);
  const status        = getAttendanceStatus(overallPct);

  window.__bunkwiseSubjects = subjects;

  renderOverallStats(overallPct, totalAttended, totalClasses, safeBunks, target);
  renderDashboardHighlights(profile, subjects, attendance, timetable, target, todayDate, overallPct, totalAttended, totalClasses, safeBunks, status);

  // ── Today's Attendance Count ─────────────────────────────────
  const todayRecords = attendance.filter(r => r.date === todayDate);
  const todayPresent = todayRecords.filter(r => r.status === 'present').length;
  const todayAbsent  = todayRecords.filter(r => r.status === 'absent').length;

  setText('stat-subjects', subjects.length);
  setText('stat-present', todayPresent);
  setText('stat-absent', todayAbsent);

  // ── Streak ──────────────────────────────────────────────────
  const streak = calcGlobalStreak(attendance, todayDate);
  setText('stat-streak', streak);
  setText('streak-count', streak);

  // ── Today's Classes ─────────────────────────────────────────
  const todaySlots  = timetable
    .filter(slot => slot.day === todayDay)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  renderTodayClasses(todaySlots, subjects, todayRecords, todayDate);

  // ── Subject Progress ─────────────────────────────────────────
  renderSubjectProgress(subjects, target);

  // ── Weekly Chart ─────────────────────────────────────────────
  renderWeeklyChart(attendance, subjects, 7);

  // ── Monthly Summary ─────────────────────────────────────────
  renderMonthlySummary(attendance, subjects, target);

  // ── Prediction Snapshot ──────────────────────────────────────
  renderPredictionSnapshot(totalAttended, totalClasses, target, todaySlots.length);

  // ── Prediction Engine & Modals ──
  const predictions = await getPredictionsData({ profile, subjects, attendance, timetable, settings });
  _predictionsCache = predictions;
  const historyComparison = await getHistoryComparison();

  renderPredictionSummary(predictions.overall);
  renderPredictionSubjectsList(predictions.subjectsData, attendance);
  renderPredictionHistory(historyComparison);
  setupWhatIfSimulator(predictions);

  // ── Achievements ─────────────────────────────────────────────
  renderAchievements(subjects, attendance, streak, overallPct);

  // ── Recent Activity ──────────────────────────────────────────
  renderRecentActivity(attendance, subjects);

  // ── Show content ────────────────────────────────────────────
  document.getElementById('dashboard-loading').classList.add('d-none');
  document.getElementById('dashboard-content').classList.remove('d-none');
  document.getElementById('dashboard-content').classList.add('animate-fade-in');
}

function renderDashboardHighlights(profile, subjects, attendance, timetable, target, todayDate, overallPct, totalAttended, totalClasses, safeBunks, status) {
  ensureDashboardBlocks();

  const todayDay = getDayIndex(todayDate);
  const todaySlots = timetable.filter(slot => slot.day === todayDay).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  const nextClass = getNextClass(timetable);
  const nextClassMinutes = nextClass
    ? Math.round((nextClass.classDate - new Date()) / 60000)
    : null;
  const todayPresent = attendance.filter(r => r.date === todayDate && r.status === 'present').length;
  const todayAbsent = attendance.filter(r => r.date === todayDate && r.status === 'absent').length;
  const todayCancelled = attendance.filter(r => r.date === todayDate && r.status === 'cancelled').length;
  const bestSubject = [...subjects].sort((a, b) => calcPercentage((b.attendedClasses || 0), (b.totalClasses || 0)) - calcPercentage((a.attendedClasses || 0), (a.totalClasses || 0)))[0];
  const dangerSubjects = [...subjects].filter((subject) => calcPercentage(subject.attendedClasses || 0, subject.totalClasses || 0) < target).slice(0, 3);

  setText(
    'dash-next-class',
    nextClass
        ? `${DAY_NAMES[nextClass.day]} • ${formatTime(nextClass.startTime)}`
        : '—'
);
  setText('dash-next-class-name', nextClass?.subjectName || 'No more classes');
  setText('dash-next-class-room', nextClass?.room || '');
  setText('dash-next-countdown', nextClassMinutes !== null ? `In ${formatCountdown(nextClassMinutes)}` : 'All classes done');
  setText('dash-today-summary', `${todayPresent} present • ${todayAbsent} absent • ${todayCancelled} cancelled`);
  setText('dash-safe-bunks', String(safeBunks));
  setText('dash-badge-status', status.label);
  setText('dash-best-subject', bestSubject ? `${bestSubject.name}` : '—');
  setText('dash-best-subject-pct', bestSubject ? `${calcPercentage(bestSubject.attendedClasses || 0, bestSubject.totalClasses || 0)}%` : '—');

  renderDangerSubjects(dangerSubjects);
  renderQuickStats(totalAttended, totalClasses, subjects.length, attendance.length);
}

function ensureDashboardBlocks() {
  const body = document.getElementById('dashboard-body');
  if (!body || document.getElementById('dashboard-highlights')) return;

  const fragment = document.createElement('div');
  fragment.id = 'dashboard-highlights';
  fragment.className = 'grid grid-2 stagger-children';
  fragment.style.gap = 'var(--space-5)';
  fragment.style.marginBottom = 'var(--space-6)';
  fragment.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title"><i class="fa-solid fa-calendar-check"></i> Today's Summary</div></div>
      <div style="display:flex;flex-direction:column;gap:var(--space-3)">
        <div class="dash-stat-card" style="padding:var(--space-4)">
          <div class="dash-stat-label">Today's Status</div>
          <div class="dash-stat-value" id="dash-badge-status" style="font-size:22px">—</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px" id="dash-today-summary">—</div>
        </div>
        <div class="dash-stat-card" style="padding:var(--space-4)">
          <div class="dash-stat-label">Safe to Bunk</div>
          <div class="dash-stat-value" id="dash-safe-bunks">0</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">Based on your current target</div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title"><i class="fa-solid fa-clock"></i> Upcoming Class</div></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4);flex-wrap:wrap">
        <div>
          <div style="font-size:14px;color:var(--text-tertiary)">Next class starts at</div>
          <div style="font-size:30px;font-weight:800" id="dash-next-class">—</div>
          <div style="font-weight:700;margin-top:4px" id="dash-next-class-name">No more classes</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px" id="dash-next-class-room"></div>
        </div>
        <div class="dash-overall-badge" style="min-width:unset">
          <div class="dash-overall-value" id="dash-next-countdown" style="font-size:28px">—</div>
          <div class="dash-overall-label">Countdown</div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title"><i class="fa-solid fa-circle-exclamation"></i> Danger Subjects</div></div>
      <div id="dash-danger-subjects" class="stagger-children"></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title"><i class="fa-solid fa-trophy"></i> Best Performing</div></div>
      <div class="dash-stat-card" style="padding:var(--space-4)">
        <div class="dash-stat-label">Top subject</div>
        <div class="dash-stat-value" id="dash-best-subject" style="font-size:22px">—</div>
        <div style="font-size:13px;color:var(--text-secondary);margin-top:4px" id="dash-best-subject-pct">—</div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title"><i class="fa-solid fa-chart-column"></i> Monthly Attendance</div></div>
      <div id="monthly-summary-chart" class="empty-state" style="padding:var(--space-5)"></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title"><i class="fa-solid fa-bullseye"></i> Prediction Snapshot</div></div>
      <div id="prediction-snapshot" class="grid grid-3" style="gap:var(--space-3)"></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title"><i class="fa-solid fa-bolt"></i> Quick Statistics</div></div>
      <div id="quick-stats-grid" class="grid grid-4" style="gap:var(--space-3)"></div>
    </div>
  `;

  body.insertBefore(fragment, body.firstElementChild.nextSibling);
}

function renderDangerSubjects(subjects) {
  const container = document.getElementById('dash-danger-subjects');
  if (!container) return;
  if (!subjects.length) {
    container.innerHTML = '<div style="color:var(--text-secondary);font-size:14px">All subjects are on track.</div>';
    return;
  }

  container.innerHTML = subjects.map((subject) => {
    const pct = calcPercentage(subject.attendedClasses || 0, subject.totalClasses || 0);
    return `
      <a href="./attendance.html?subject=${subject.id}" class="activity-item" style="text-decoration:none;border:1px solid var(--border-color);margin-bottom:var(--space-2)">
        <div class="activity-dot" style="background:${subject.color || 'var(--color-primary)'}"></div>
        <div class="activity-text"><strong>${esc(subject.name)}</strong> — ${pct}%</div>
        <div class="activity-time">Need attention</div>
      </a>
    `;
  }).join('');
}

function renderQuickStats(totalAttended, totalClasses, subjectCount, attendanceCount) {
  const container = document.getElementById('quick-stats-grid');
  if (!container) return;
  container.innerHTML = `
    <div class="dash-stat-card"><div class="dash-stat-value">${totalAttended}</div><div class="dash-stat-label">Classes Attended</div></div>
    <div class="dash-stat-card"><div class="dash-stat-value">${totalClasses}</div><div class="dash-stat-label">Total Classes</div></div>
    <div class="dash-stat-card"><div class="dash-stat-value">${subjectCount}</div><div class="dash-stat-label">Subjects</div></div>
    <div class="dash-stat-card"><div class="dash-stat-value">${attendanceCount}</div><div class="dash-stat-label">Attendance Records</div></div>
  `;
}

function renderMonthlySummary(attendance, subjects, target) {
  const container = document.getElementById('monthly-summary-chart');
  if (!container) return;

  const days = 30;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  const labels = [];
  const values = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const recs = attendance.filter((record) => record.date === dateStr && ['present', 'absent'].includes(record.status));
    const present = recs.filter((record) => record.status === 'present').length;
    labels.push(formatDateShort(dateStr));
    values.push(calcPercentage(present, recs.length));
  }
  container.textContent = labels.length ? `${labels.slice(0, 3).join(' · ')} … ${values[values.length - 1] || 0}%` : 'No monthly data yet';
}

function renderPredictionSnapshot(attended, total, target, todaysClassCount) {
  const container = document.getElementById('prediction-snapshot');
  if (!container) return;
  const fiveFuture = predictPercentage(attended, total, 5);
  const ifBunkTomorrow = total > 0 ? calcPercentage(attended, total + Math.max(1, todaysClassCount || 1)) : 0;
  const required = calcClassesNeeded(attended, total, target);
  container.innerHTML = `
    <div class="dash-stat-card"><div class="dash-stat-label">If you attend 5 more</div><div class="dash-stat-value">${fiveFuture}%</div></div>
    <div class="dash-stat-card"><div class="dash-stat-label">If you bunk tomorrow</div><div class="dash-stat-value">${ifBunkTomorrow}%</div></div>
    <div class="dash-stat-card"><div class="dash-stat-label">Need to reach target</div><div class="dash-stat-value">${required}</div></div>
  `;
}

function getNextClass(timetable) {
    if (!timetable.length) return null;

    const now = new Date();
    const currentDay = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Search up to the next 7 days
    for (let offset = 0; offset < 7; offset++) {

        const day = (currentDay + offset) % 7;

        const daySlots = timetable
            .filter(slot => slot.day === day)
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

        for (const slot of daySlots) {

            const [h, m] = (slot.startTime || "00:00").split(":").map(Number);
            const slotMinutes = h * 60 + m;

            // Today: only future classes
            if (offset === 0 && slotMinutes <= currentMinutes) {
                continue;
            }

            const classDate = new Date(now);
            classDate.setDate(now.getDate() + offset);
            classDate.setHours(h, m, 0, 0);

            return {
                ...slot,
                subjectName: getSubjectName(slot.subjectId),
                classDate
            };
        }
    }

    return null;
}

function countdownMinutes(startTime) {
  const [hours, minutes] = String(startTime || '00:00').split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes || 0, 0, 0);
  return Math.max(0, Math.round((target - now) / 60000));
}

function formatCountdown(minutes) {

    if (minutes < 60)
        return `${minutes}m`;

    if (minutes < 1440) {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return m ? `${h}h ${m}m` : `${h}h`;
    }

    const days = Math.floor(minutes / 1440);

    if (days === 1)
        return "Tomorrow";

    return `In ${days} days`;
}

function getSubjectName(subjectId) {
  const subject = window.__bunkwiseSubjects?.find((item) => item.id === subjectId);
  return subject?.name || 'Next class';
}

/* ─────────────────────────────────────────────────────────────
   GREETING
   ───────────────────────────────────────────────────────────── */

function renderGreeting(name, todayDate) {
  const hour = new Date().getHours();
  let greeting;
  if (hour < 12)      greeting = '☀️ Good morning';
  else if (hour < 17) greeting = '🌤️ Good afternoon';
  else if (hour < 21) greeting = '🌆 Good evening';
  else                greeting = '🌙 Good night';

  setText('dash-greeting', greeting);
  setText('dash-name', name);
  setText('dash-date', formatDateFull(todayDate));
  setText('header-date', formatDateFull(todayDate));
}

/* ─────────────────────────────────────────────────────────────
   OVERALL STATS
   ───────────────────────────────────────────────────────────── */

function renderOverallStats(pct, attended, total, safeBunks, target) {
  const pctEl = document.getElementById('dash-overall-pct');
  if (pctEl) {
    pctEl.textContent = pct + '%';
    const status = getAttendanceStatus(pct);
    pctEl.style.color = status.color;
    // Re-apply gradient for high pct
    if (pct >= target) {
      pctEl.style.background = 'var(--gradient-hero)';
      pctEl.style.webkitBackgroundClip = 'text';
      pctEl.style.webkitTextFillColor = 'transparent';
      pctEl.style.backgroundClip = 'text';
    } else {
      pctEl.style.background = '';
      pctEl.style.webkitTextFillColor = '';
      pctEl.style.backgroundClip = '';
    }
  }

  // Progress bar
  const bar = document.getElementById('overall-progress');
  if (bar) {
    bar.style.width = '0%';
    const progressClass = getProgressClass(pct, target);
    bar.className = `progress-bar animated ${progressClass}`;
    setTimeout(() => { bar.style.width = Math.min(pct, 100) + '%'; }, 100);
  }

  setText('dash-target-display', target + '%');
  setText('dash-classes-info', `${attended} / ${total} classes attended`);
  setText('dash-bunk-info', safeBunks > 0 ? `${safeBunks} safe to bunk` : 'Cannot bunk any class');
}

/* ─────────────────────────────────────────────────────────────
   TODAY'S CLASSES
   ───────────────────────────────────────────────────────────── */

function renderTodayClasses(slots, subjects, todayRecords, todayDate) {
  const container = document.getElementById('today-classes');
  if (!container) return;

  if (slots.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><i class="fa-solid fa-umbrella-beach"></i></div>
        <h3>No classes today</h3>
        <p>Enjoy your free day! 🎉</p>
      </div>
    `;
    return;
  }

  const now       = new Date();
  const nowMin    = now.getHours() * 60 + now.getMinutes();
  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]));
  const recordMap  = Object.fromEntries(todayRecords.map(r => [r.subjectId, r]));

  container.innerHTML = '';

  slots.forEach(slot => {
    const subject = subjectMap[slot.subjectId];
    if (!subject) return;

    const record   = recordMap[slot.subjectId];
    const [sh, sm] = (slot.startTime || '00:00').split(':').map(Number);
    const [eh, em] = (slot.endTime   || '00:00').split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin   = eh * 60 + em;
    const isCurrent = nowMin >= startMin && nowMin <= endMin;

    const el = document.createElement('div');
    el.className = `today-class-item${isCurrent ? ' current' : ''}`;

    let statusBadge = '';
    if (record) {
      const statusColors = {
        present:   'var(--color-success)',
        absent:    'var(--color-danger)',
        cancelled: 'var(--color-warning)',
        holiday:   'var(--color-info)',
      };
      const statusLabels = {
        present:   '✅ Present',
        absent:    '❌ Absent',
        cancelled: '🚫 Cancelled',
        holiday:   '🎉 Holiday',
      };
      statusBadge = `
        <span style="font-size:12px;font-weight:600;color:${statusColors[record.status]}">
          ${statusLabels[record.status] || record.status}
        </span>
      `;
    } else {
      statusBadge = `
        <button type="button" class="btn btn-primary btn-sm dash-mark-btn"
          data-subject-id="${slot.subjectId}">Mark</button>
      `;
    }

    el.innerHTML = `
      <div class="today-class-color" style="background:${subject.color || 'var(--color-primary)'}"></div>
      <div class="today-class-time">
        ${formatTime(slot.startTime)}<br/>
        <span style="color:var(--text-tertiary);font-size:11px">${formatTime(slot.endTime)}</span>
      </div>
      <div class="today-class-info">
        <div class="today-class-name">${esc(subject.name)}</div>
        <div class="today-class-meta">
          ${subject.faculty ? `<span><i class="fa-solid fa-user-tie" style="font-size:10px"></i> ${esc(subject.faculty)}</span>` : ''}
          ${slot.room ? `<span><i class="fa-solid fa-location-dot" style="font-size:10px"></i> ${esc(slot.room)}</span>` : ''}
        </div>
      </div>
      <div class="today-class-status">
        ${isCurrent ? '<span class="now-badge">NOW</span>' : ''}
        ${statusBadge}
      </div>
    `;

    const markBtn = el.querySelector('.dash-mark-btn');
    if (markBtn) {
      markBtn.addEventListener('click', async () => {
        markBtn.disabled = true;
        markBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving';

        try {
          await markAttendance(slot.subjectId, todayDate, 'present');
          showToast('Marked present for today', 'success');
          await loadDashboard();
        } catch (err) {
          console.error('[Dashboard] Quick mark failed:', err);
          showToast('Failed to mark attendance', 'error');
          markBtn.disabled = false;
          markBtn.textContent = 'Mark';
        }
      });
    }

    if (record) {
      el.classList.add('attendance-success');
    }

    container.appendChild(el);
  });
}

/* ─────────────────────────────────────────────────────────────
   SUBJECT PROGRESS
   ───────────────────────────────────────────────────────────── */

function renderSubjectProgress(subjects, target) {
  const list     = document.getElementById('subject-progress-list');
  const emptyEl  = document.getElementById('subjects-empty');

  if (!list) return;

  if (subjects.length === 0) {
    list.classList.add('d-none');
    emptyEl?.classList.remove('d-none');
    return;
  }

  emptyEl?.classList.add('d-none');
  list.classList.remove('d-none');
  list.innerHTML = '';

  // Sort by attendance percentage (lowest first = most critical)
  const sorted = [...subjects].sort((a, b) => {
    const pctA = calcPercentage(a.attendedClasses || 0, a.totalClasses || 0);
    const pctB = calcPercentage(b.attendedClasses || 0, b.totalClasses || 0);
    return pctA - pctB;
  });

  sorted.forEach(sub => {
    const pct    = calcPercentage(sub.attendedClasses || 0, sub.totalClasses || 0);
    const status = getAttendanceStatus(pct);
    const pClass = getProgressClass(pct, target);
    const bunks  = calcSafeBunks(sub.attendedClasses || 0, sub.totalClasses || 0, target);
    const needed = calcClassesNeeded(sub.attendedClasses || 0, sub.totalClasses || 0, target);

    const card = document.createElement('a');
    card.href = `./attendance.html?subject=${sub.id}`;
    card.className = 'subject-progress-card';
    card.innerHTML = `
      <div class="subject-progress-header">
        <div class="subject-color-dot" style="background:${sub.color || 'var(--color-primary)'}"></div>
        <div class="subject-progress-name">${esc(sub.name)}</div>
        <div class="subject-progress-pct" style="color:${status.color}">${pct}%</div>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar ${pClass}"
          style="width:0%;--target-width:${Math.min(pct,100)}%"
          data-target="${Math.min(pct, 100)}">
        </div>
      </div>
      <div class="subject-progress-details">
        <span>${sub.attendedClasses || 0}/${sub.totalClasses || 0} classes</span>
        <span style="color:${status.color}">${
          pct >= target
            ? bunks > 0 ? `Can bunk ${bunks}` : 'On track ✓'
            : `Need ${needed} more`
        }</span>
      </div>
    `;

    list.appendChild(card);
  });

  // Animate progress bars after paint
  requestAnimationFrame(() => {
    list.querySelectorAll('.progress-bar[data-target]').forEach(bar => {
      setTimeout(() => {
        bar.style.width = bar.dataset.target + '%';
      }, 200);
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   WEEKLY CHART
   ───────────────────────────────────────────────────────────── */

let _weeklyChart = null;

function renderWeeklyChart(attendance, subjects, days = 7) {
  const canvas = document.getElementById('weekly-chart');
  if (!canvas) return;

  // Destroy existing chart
  if (_weeklyChart) { _weeklyChart.destroy(); _weeklyChart = null; }

  const labels  = [];
  const present = [];
  const absent  = [];

  const end   = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days + 1);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayRecs = attendance.filter(r => r.date === dateStr);
    labels.push(formatDateShort(dateStr));
    present.push(dayRecs.filter(r => r.status === 'present').length);
    absent.push(dayRecs.filter(r => r.status === 'absent').length);
  }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#9090B8' : '#5A5A80';

  _weeklyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Present',
          data: present,
          backgroundColor: 'rgba(76, 175, 80, 0.8)',
          borderColor: '#4CAF50',
          borderWidth: 0,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Absent',
          data: absent,
          backgroundColor: 'rgba(244, 67, 54, 0.6)',
          borderColor: '#F44336',
          borderWidth: 0,
          borderRadius: 6,
          borderSkipped: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: textColor,
            usePointStyle: true,
            pointStyle: 'circle',
            font: { family: 'Inter', size: 12 }
          }
        },
        tooltip: {
          backgroundColor: isDark ? '#1A1A2E' : '#FFFFFF',
          titleColor: isDark ? '#E8E8FF' : '#1A1A2E',
          bodyColor: isDark ? '#9090B8' : '#5A5A80',
          borderColor: isDark ? 'rgba(108,99,255,0.2)' : 'rgba(108,99,255,0.1)',
          borderWidth: 1,
          cornerRadius: 12,
          padding: 12,
          titleFont: { family: 'Inter', size: 13, weight: '600' },
          bodyFont:  { family: 'Inter', size: 12 },
        }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor, font: { family: 'Inter', size: 11 } }
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { family: 'Inter', size: 11 },
            stepSize: 1,
            precision: 0
          },
          beginAtZero: true,
        }
      }
    }
  });
}

function setupChartPeriodSelector() {
  document.getElementById('chart-week-select')?.addEventListener('change', async (e) => {
    const days = parseInt(e.target.value);
    const [attendance, subjects] = await Promise.all([getAllAttendance(), getAllSubjects()]);
    renderWeeklyChart(attendance, subjects, days);
  });
}

function setupLiveUpdates() {
  window.addEventListener('bunkwise:data-changed', async (event) => {
    const source = event.detail?.source;
    if (!source) return;

    if (['attendance', 'subjects', 'timetable', 'profile', 'reset'].includes(source)) {
      await loadDashboard();
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   ACHIEVEMENTS
   ───────────────────────────────────────────────────────────── */

const ACHIEVEMENTS = [
  {
    id: 'first_mark',
    icon: '🌱',
    name: 'First Step',
    desc: 'Marked your first attendance',
    check: (subjects, attendance) => attendance.length > 0,
    color: 'rgba(76,175,80,0.15)'
  },
  {
    id: 'streak_7',
    icon: '🔥',
    name: 'Week Warrior',
    desc: '7-day attendance streak',
    check: (subjects, attendance, streak) => streak >= 7,
    color: 'rgba(255,152,0,0.15)'
  },
  {
    id: 'perfect_week',
    icon: '⭐',
    name: 'Perfect Week',
    desc: '100% attendance for a week',
    check: (subjects, attendance) => {
      const end   = new Date();
      const start = new Date(); start.setDate(end.getDate() - 6);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
        const dateStr = d.toISOString().split('T')[0];
        const recs = attendance.filter(r => r.date === dateStr && r.status !== 'holiday');
        if (recs.length > 0 && recs.some(r => r.status === 'absent')) return false;
      }
      return attendance.length > 0;
    },
    color: 'rgba(255,215,0,0.15)'
  },
  {
    id: 'above_target',
    icon: '🎯',
    name: 'Target Achieved',
    desc: 'Overall attendance above target',
    check: (subjects, attendance, streak, pct, target) => pct >= target && subjects.length > 0,
    color: 'rgba(108,99,255,0.15)'
  },
  {
    id: 'streak_30',
    icon: '🏆',
    name: 'Month Master',
    desc: '30-day attendance streak',
    check: (subjects, attendance, streak) => streak >= 30,
    color: 'rgba(255,101,132,0.15)'
  },
  {
    id: 'five_subjects',
    icon: '📚',
    name: 'Scholar',
    desc: 'Tracking 5+ subjects',
    check: (subjects) => subjects.length >= 5,
    color: 'rgba(67,198,172,0.15)'
  }
];

function renderAchievements(subjects, attendance, streak, overallPct) {
  const container = document.getElementById('achievements-list');
  if (!container) return;

  const target = 75; // simplified
  container.innerHTML = '';

  const visibleAchievements = ACHIEVEMENTS.slice(0, 4);

  visibleAchievements.forEach(ach => {
    const unlocked = ach.check(subjects, attendance, streak, overallPct, target);
    const el = document.createElement('div');
    el.className = 'achievement-item';
    el.style.marginBottom = 'var(--space-3)';
    el.innerHTML = `
      <div class="achievement-icon ${unlocked ? '' : 'locked'}"
        style="background:${unlocked ? ach.color : 'var(--bg-input)'}">
        ${ach.icon}
      </div>
      <div>
        <div class="achievement-name">${ach.name}</div>
        <div class="achievement-desc">${ach.desc}</div>
      </div>
      ${unlocked ? '<i class="fa-solid fa-circle-check ms-auto" style="color:var(--color-success)"></i>' :
        '<i class="fa-solid fa-lock ms-auto" style="color:var(--text-tertiary);font-size:12px"></i>'}
    `;
    container.appendChild(el);
  });
}

/* ─────────────────────────────────────────────────────────────
   RECENT ACTIVITY
   ───────────────────────────────────────────────────────────── */

function renderRecentActivity(attendance, subjects) {
  const container = document.getElementById('recent-activity');
  if (!container) return;

  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]));

  const recent = [...attendance]
    .sort((a, b) => (b.markedAt || b.date).localeCompare(a.markedAt || a.date))
    .slice(0, 10);

  if (recent.length === 0) return; // keep empty state

  const statusConfig = {
    present:   { color: 'var(--color-success)',   icon: '✅', text: 'marked present' },
    absent:    { color: 'var(--color-danger)',     icon: '❌', text: 'marked absent'  },
    cancelled: { color: 'var(--color-warning)',    icon: '🚫', text: 'cancelled'      },
    holiday:   { color: 'var(--color-info)',       icon: '🎉', text: 'holiday'        },
  };

  container.innerHTML = '';
  recent.forEach(rec => {
    const sub    = subjectMap[rec.subjectId];
    const conf   = statusConfig[rec.status] || statusConfig.present;
    if (!sub) return;

    const el = document.createElement('div');
    el.className = 'activity-item';
    el.innerHTML = `
      <div class="activity-dot" style="background:${conf.color}"></div>
      <div class="activity-text">
        <strong>${esc(sub.name)}</strong> — ${conf.icon} ${conf.text}
      </div>
      <div class="activity-time">${timeAgo(rec.date)}</div>
    `;
    container.appendChild(el);
  });
}

/* ─────────────────────────────────────────────────────────────
   STREAK CALCULATION
   ───────────────────────────────────────────────────────────── */

function calcGlobalStreak(attendance, todayDate) {
  // Get all unique dates with at least one 'present' record
  const presentDates = new Set(
    attendance.filter(r => r.status === 'present').map(r => r.date)
  );

  let streak = 0;
  const d = new Date(todayDate);

  while (true) {
    const dateStr = d.toISOString().split('T')[0];
    if (presentDates.has(dateStr)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/* ─────────────────────────────────────────────────────────────
   HEADER ACTIONS
   ───────────────────────────────────────────────────────────── */

function setupHeaderActions() {
  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const newTheme = toggleTheme();
    const icon = document.querySelector('#theme-toggle i');
    if (icon) icon.className = newTheme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  });

  // PWA install
  document.getElementById('pwa-install-btn')?.addEventListener('click', showInstallPrompt);

  // Search
  document.getElementById('search-btn')?.addEventListener('click', () => {
    import('../features/search.js').then(({ openSearch }) => openSearch());
  });
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────── */

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function esc(str = '') {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showDashboardError() {
  document.getElementById('dashboard-loading')?.classList.add('d-none');
  document.getElementById('dashboard-content')?.classList.remove('d-none');
}

/* ─────────────────────────────────────────────────────────────
   ATTENDANCE PREDICTION ENGINE UI RENDERERS
   ───────────────────────────────────────────────────────────── */

function renderPredictionSummary(overall) {
  const container = document.getElementById('prediction-summary-details');
  if (!container) return;

  container.innerHTML = `
    <div class="dash-stat-card" style="margin-bottom:0; padding:var(--space-3)">
      <div class="dash-stat-value" style="font-size:1.4rem;">${overall.pct}%</div>
      <div class="dash-stat-label" style="font-size:11px;">Overall Attendance</div>
    </div>
    <div class="dash-stat-card" style="margin-bottom:0; padding:var(--space-3)">
      <div class="dash-stat-value" style="font-size:1.4rem; color:var(--color-primary-light);">${overall.projectedSemesterPct}%</div>
      <div class="dash-stat-label" style="font-size:11px;">Semester Projection (${overall.projectionLabel})</div>
    </div>
    <div class="dash-stat-card" style="margin-bottom:0; padding:var(--space-3)">
      <div class="dash-stat-value" style="font-size:1.4rem; color:var(--color-success);">${overall.highestSubject ? `${overall.highestSubject.currentPct}%` : '—'}</div>
      <div class="dash-stat-label" style="font-size:11px;">Highest: ${overall.highestSubject ? esc(overall.highestSubject.name) : '—'}</div>
    </div>
    <div class="dash-stat-card" style="margin-bottom:0; padding:var(--space-3)">
      <div class="dash-stat-value" style="font-size:1.4rem; color:var(--color-danger);">${overall.lowestSubject ? `${overall.lowestSubject.currentPct}%` : '—'}</div>
      <div class="dash-stat-label" style="font-size:11px;">Lowest: ${overall.lowestSubject ? esc(overall.lowestSubject.name) : '—'}</div>
    </div>
    <div class="dash-stat-card" style="margin-bottom:0; padding:var(--space-3)">
      <div class="dash-stat-value" style="font-size:1.4rem; color:var(--color-warning);">${overall.safeBunks}</div>
      <div class="dash-stat-label" style="font-size:11px;">Most Safe Bunks: ${overall.maxSafeBunkSubject ? esc(overall.maxSafeBunkSubject.name) : '—'}</div>
    </div>
    <div class="dash-stat-card" style="margin-bottom:0; padding:var(--space-3)">
      <div class="dash-stat-value" style="font-size:1.4rem; color:var(--color-danger);">${overall.criticalCount}</div>
      <div class="dash-stat-label" style="font-size:11px;">Critical / At Risk Subjects</div>
    </div>
  `;
}

function renderPredictionSubjectsList(subjectsData, attendance) {
  const container = document.getElementById('prediction-subjects-list');
  if (!container) return;

  if (subjectsData.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: var(--space-4);">No subject predictions available.</div>`;
    return;
  }

  container.innerHTML = subjectsData.map(s => {
    const isSimulatingAttend = _simulatedStates[s.id] === 'attend';
    const isSimulatingBunk = _simulatedStates[s.id] === 'bunk';
    
    let currentDisplay = `${s.currentPct}%`;
    let simulatedText = '';
    
    if (isSimulatingAttend) {
      const simPct = calcPercentage((s.attendedClasses || 0) + 1, (s.totalClasses || 0) + 1);
      currentDisplay = `${s.currentPct}% → <span style="color:var(--color-success); font-weight:bold;">${simPct}%</span>`;
      simulatedText = ' (Attending Next)';
    } else if (isSimulatingBunk) {
      const simPct = calcPercentage(s.attendedClasses || 0, (s.totalClasses || 0) + 1);
      currentDisplay = `${s.currentPct}% → <span style="color:var(--color-danger); font-weight:bold;">${simPct}%</span>`;
      simulatedText = ' (Bunking Next)';
    }

    return `
      <div class="card" style="padding:var(--space-4); margin-bottom:0; border-left: 4px solid ${getRiskBorderColor(s.riskLevel)}; transition: transform var(--transition-fast);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <div style="font-weight:700; font-size:15px; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
              <span class="subject-color-dot" style="background:${s.color || 'var(--color-primary)'}; width:10px; height:10px; border-radius:50%; display:inline-block;"></span>
              ${esc(s.name)}
            </div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
              Target: ${s.target}% • Attended: ${s.attendedClasses || 0}/${s.totalClasses || 0} classes
            </div>
          </div>
          <div>
            <span class="status-badge ${s.status.toLowerCase()}" style="background:${getRiskBgColor(s.riskLevel)}; color:${getRiskColor(s.riskLevel)}; padding: 3px 8px; border-radius:var(--radius-full); font-size:11px; font-weight:700;">
              <i class="fa-solid ${getRiskIcon(s.riskLevel)}" style="margin-right:4px;"></i>${s.status}
            </span>
          </div>
        </div>
        
        <div class="grid grid-3" style="gap:var(--space-2); margin-top:var(--space-4); text-align:center;">
          <div class="dash-stat-card" style="padding:var(--space-2); margin-bottom:0;">
            <div style="font-size:10px; text-transform:uppercase; color:var(--text-tertiary);">Current${simulatedText}</div>
            <div style="font-size:18px; font-weight:800; color:var(--text-primary);">${currentDisplay}</div>
          </div>
          <div class="dash-stat-card" style="padding:var(--space-2); margin-bottom:0;">
            <div style="font-size:10px; text-transform:uppercase; color:var(--text-tertiary);">Semester Projection</div>
            <div style="font-size:18px; font-weight:800; color:var(--text-secondary);">${s.projectedSemesterPct}%</div>
          </div>
          <div class="dash-stat-card" style="padding:var(--space-2); margin-bottom:0;">
            <div style="font-size:10px; text-transform:uppercase; color:var(--text-tertiary);">Max Possible</div>
            <div style="font-size:18px; font-weight:800; color:var(--text-secondary);">${s.maxPossiblePct}%</div>
          </div>
        </div>

        <div style="margin-top:var(--space-3); display:flex; justify-content:space-between; align-items:center; font-size:13px;">
          <div style="color:var(--text-secondary);">
            ${s.currentPct >= s.target 
              ? `<span style="color:var(--color-success); font-weight:600;"><i class="fa-solid fa-circle-check"></i> Safe bunks: ${s.safeBunks}</span>` 
              : `<span style="color:var(--color-danger); font-weight:600;"><i class="fa-solid fa-triangle-exclamation"></i> Need: ${s.needed} classes</span>`
            }
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:12px; color:var(--text-tertiary);">Trend: ${s.trend}</span>
            ${getTrendSparklineSvg(attendance, s.id)}
          </div>
        </div>

        <div style="margin-top:var(--space-3); padding:var(--space-2) var(--space-3); background:rgba(255,255,255,0.01); border:1px solid var(--border-color); border-radius:var(--radius-md); font-size:12px; color:var(--text-secondary);">
          💡 <em>${s.recommendation}</em>
        </div>

        <div style="margin-top:var(--space-3); display:flex; gap:var(--space-2);">
          <button class="btn btn-sm ${isSimulatingAttend ? 'btn-success' : 'btn-ghost'}" data-simulate-action="attend" data-subject-id="${s.id}" style="flex:1;">
            <i class="fa-solid fa-circle-plus"></i> Attend Next
          </button>
          <button class="btn btn-sm ${isSimulatingBunk ? 'btn-danger' : 'btn-ghost'}" data-simulate-action="bunk" data-subject-id="${s.id}" style="flex:1;">
            <i class="fa-solid fa-circle-minus"></i> Bunk Next
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Bind simulation button clicks
  container.querySelectorAll('[data-simulate-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = Number(e.currentTarget.dataset.subjectId);
      const action = e.currentTarget.dataset.simulateAction;
      
      if (_simulatedStates[id] === action) {
        delete _simulatedStates[id];
      } else {
        _simulatedStates[id] = action;
      }
      
      renderPredictionSubjectsList(subjectsData, attendance);
    });
  });
}

function renderPredictionHistory(comparison) {
  const container = document.getElementById('prediction-history-container');
  if (!container) return;

  if (!comparison || !comparison.current) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: var(--space-4);">No snapshot history recorded yet. Snapshots are captured automatically when subjects load.</div>`;
    return;
  }

  const listItems = comparison.current.subjects.map(currSub => {
    const begSub = comparison.beginning?.subjects.find(s => s.id === currSub.id);
    const lastSub = comparison.lastWeek?.subjects.find(s => s.id === currSub.id);

    const begDiff = begSub ? currSub.pct - begSub.pct : 0;
    const lastDiff = lastSub ? currSub.pct - lastSub.pct : 0;

    const renderDiff = (diff) => {
      if (diff > 0) return `<span style="color:var(--color-success); font-weight:600;"><i class="fa-solid fa-caret-up"></i> +${diff}%</span>`;
      if (diff < 0) return `<span style="color:var(--color-danger); font-weight:600;"><i class="fa-solid fa-caret-down"></i> ${diff}%</span>`;
      return `<span style="color:var(--text-tertiary); font-weight:600;">— 0%</span>`;
    };

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:var(--space-2) var(--space-3); border-bottom:1px solid var(--border-color); font-size:13px;">
        <div style="font-weight:600; color:var(--text-primary);">${esc(currSub.name)}</div>
        <div style="display:flex; gap:var(--space-4); text-align:right;">
          <div>
            <div style="font-size:10px; color:var(--text-tertiary);">Vs Last Week</div>
            <div>${renderDiff(lastDiff)}</div>
          </div>
          <div>
            <div style="font-size:10px; color:var(--text-tertiary);">Vs Semester Start</div>
            <div>${renderDiff(begDiff)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:2px;">
      ${listItems}
      <div style="font-size:11px; color:var(--text-tertiary); text-align:center; margin-top:var(--space-3);">
        Comparing current metrics against snaps taken on ${new Date(comparison.current.timestamp).toLocaleDateString()}.
      </div>
    </div>
  `;
}

function setupWhatIfSimulator(predictions) {
  const openBtn = document.getElementById('btn-open-whatif-modal');
  const modal = document.getElementById('whatif-modal-overlay');
  const closeBtn = document.getElementById('whatif-close-btn');
  const select = document.getElementById('whatif-subject');
  const attendInput = document.getElementById('whatif-attend');
  const missInput = document.getElementById('whatif-miss');

  if (!openBtn || !modal || !select) return;

  // Bind Open/Close
  openBtn.addEventListener('click', () => {
    select.innerHTML = predictions.subjectsData.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    modal.classList.add('open');
    updateWhatIfCalculations();
  });

  const closeModal = () => modal.classList.remove('open');
  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Bind Input updates
  select.addEventListener('change', updateWhatIfCalculations);
  attendInput?.addEventListener('input', updateWhatIfCalculations);
  missInput?.addEventListener('input', updateWhatIfCalculations);
}

function updateWhatIfCalculations() {
  const select = document.getElementById('whatif-subject');
  const attendInput = document.getElementById('whatif-attend');
  const missInput = document.getElementById('whatif-miss');
  const resultsGrid = document.getElementById('whatif-results-grid');
  
  if (!select || !attendInput || !missInput || !resultsGrid || !_predictionsCache) return;
  
  const subjectId = Number(select.value);
  const attendCount = Number(attendInput.value) || 0;
  const missCount = Number(missInput.value) || 0;
  
  const sub = _predictionsCache.subjectsData.find(s => s.id === subjectId);
  if (!sub) return;
  
  const target = sub.target;
  const newAttended = (sub.attendedClasses || 0) + attendCount;
  const newTotal = (sub.totalClasses || 0) + attendCount + missCount;
  const projectedPct = calcPercentage(newAttended, newTotal);
  
  const newSafeBunks = calcSafeBunks(newAttended, newTotal, target);
  const newNeeded = calcClassesNeeded(newAttended, newTotal, target);
  const achieved = projectedPct >= target;
  
  const slots = sub.remainingClasses || 0;
  const maxPossible = (newTotal + slots) > 0 ? calcPercentage(newAttended + slots, newTotal + slots) : 100;

  resultsGrid.innerHTML = `
    <div class="dash-stat-card" style="padding:var(--space-3); margin-bottom:0;">
      <div class="dash-stat-label" style="font-size:11px;">Projected Attendance</div>
      <div class="dash-stat-value" style="font-size:1.4rem; color:${achieved ? 'var(--color-success)' : 'var(--color-danger)'}">${projectedPct}%</div>
    </div>
    <div class="dash-stat-card" style="padding:var(--space-3); margin-bottom:0;">
      <div class="dash-stat-label" style="font-size:11px;">Target Achieved?</div>
      <div class="dash-stat-value" style="font-size:1.4rem; color:${achieved ? 'var(--color-success)' : 'var(--color-danger)'}">
        ${achieved ? '✅ Yes' : '❌ No'}
      </div>
    </div>
    <div class="dash-stat-card" style="padding:var(--space-3); margin-bottom:0;">
      <div class="dash-stat-label" style="font-size:11px;">Safe Bunks Left</div>
      <div class="dash-stat-value" style="font-size:1.4rem; color:var(--color-warning)">${newSafeBunks}</div>
    </div>
    <div class="dash-stat-card" style="padding:var(--space-3); margin-bottom:0;">
      <div class="dash-stat-label" style="font-size:11px;">Max Possible</div>
      <div class="dash-stat-value" style="font-size:1.4rem; color:var(--color-primary-light)">${maxPossible}%</div>
    </div>
    ${!achieved ? `
    <div style="grid-column: span 2; padding:var(--space-3); background:rgba(var(--color-danger-rgb),0.08); border-radius:var(--radius-md); text-align:center; font-size:13px; color:var(--color-danger-light);">
      ⚠️ You need to attend <strong>${newNeeded}</strong> more consecutive classes to reach the ${target}% target.
    </div>
    ` : ''}
  `;
}

function getRiskBorderColor(risk) {
  if (risk === 'Green') return 'var(--color-success)';
  if (risk === 'Yellow') return 'var(--color-warning)';
  if (risk === 'Orange') return 'var(--color-secondary)';
  return 'var(--color-danger)';
}

function getRiskColor(risk) {
  if (risk === 'Green') return 'var(--color-success)';
  if (risk === 'Yellow') return 'var(--color-warning)';
  if (risk === 'Orange') return 'var(--color-secondary-light)';
  return 'var(--color-danger-light)';
}

function getRiskBgColor(risk) {
  if (risk === 'Green') return 'rgba(var(--color-success-rgb), 0.12)';
  if (risk === 'Yellow') return 'rgba(var(--color-warning-rgb), 0.12)';
  if (risk === 'Orange') return 'rgba(var(--color-secondary-rgb), 0.12)';
  return 'rgba(var(--color-danger-rgb), 0.12)';
}

function getRiskIcon(risk) {
  if (risk === 'Green') return 'fa-circle-check';
  if (risk === 'Yellow') return 'fa-circle-exclamation';
  if (risk === 'Orange') return 'fa-triangle-exclamation';
  return 'fa-circle-xmark';
}

function getTrendSparklineSvg(attendance, subjectId) {
  const subRecords = attendance
    .filter(r => r.subjectId === subjectId && (r.status === 'present' || r.status === 'absent'))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-6);
    
  if (subRecords.length < 2) {
    return `<svg width="80" height="24" style="overflow:visible;"><line x1="5" y1="12" x2="75" y2="12" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-dasharray="2 2" /></svg>`;
  }
  
  let runningAttended = 0;
  let runningTotal = 0;
  const pcts = [];
  
  subRecords.forEach(r => {
    runningTotal++;
    if (r.status === 'present') runningAttended++;
    pcts.push(Math.round((runningAttended / runningTotal) * 100));
  });
  
  const points = pcts.map((p, index) => {
    const x = (index / (pcts.length - 1)) * 60 + 10;
    const y = 20 - (p / 100) * 16; 
    return `${x},${y}`;
  });
  
  const pathData = points.join(' ');
  const isImproving = pcts[pcts.length - 1] >= pcts[0];
  const color = isImproving ? 'var(--color-success)' : 'var(--color-danger)';
  const lastPt = points[points.length - 1].split(',');
  
  return `
    <svg width="80" height="24" style="overflow:visible;">
      <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${pathData}" />
      <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="3" fill="${color}" />
    </svg>
  `;
}

