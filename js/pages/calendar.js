import { getAllAttendance, getAllSubjects, getAllTimetable, getProfile, markAttendance } from '../db.js';
import { today, getDatesInMonth, getDayIndex, calcPercentage, formatDateFull, getAttendanceStatus, getProgressClass, calcSafeBunks, calcClassesNeeded, formatDateShort, timeAgo, DAY_NAMES } from '../utils.js';
import { showToast } from '../notifications.js';

let currentMonth = new Date();
let _calendarCache = null;
let _selectedDate = today();

export async function init() {
  try {
    bindEvents();
    setupLiveUpdates();
    setupSwipeNavigation();
    setupModalEvents();
    await loadCalendar();
  } catch (error) {
    console.error('[Calendar] Init failed:', error);
    showToast('Calendar could not load. Redirecting to dashboard.', 'error');
    setTimeout(() => { window.location.href = './dashboard.html'; }, 900);
  }
}

export async function refresh() {
  await loadCalendar();
}

async function loadCalendar() {
  const [subjects, attendance, timetable, profile] = await Promise.all([
    getAllSubjects(),
    getAllAttendance(),
    getAllTimetable(),
    getProfile(),
  ]);

  _calendarCache = { subjects, attendance, timetable, profile };

  renderMonthHeader(profile);
  renderStats(attendance);
  renderMonthlyStats(attendance);
  renderCalendarGrid(subjects, attendance, timetable);
  
  // Re-render modal if it's open
  const modal = document.getElementById('day-details-modal-overlay');
  if (modal && modal.classList.contains('open') && _selectedDate) {
    renderModalDetails(_selectedDate);
  }
}

function renderMonthHeader(profile) {
  const title = document.getElementById('calendar-title');
  const subtitle = document.getElementById('calendar-subtitle');
  if (title) title.textContent = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (subtitle) subtitle.textContent = `${profile?.name || 'Student'} • ${profile?.college || 'My College'}`;
}

function renderStats(attendance) {
  const stats = { present: 0, absent: 0, cancelled: 0, holiday: 0 };
  attendance.forEach((record) => { if (stats[record.status] !== undefined) stats[record.status] += 1; });
  setText('cal-present', stats.present);
  setText('cal-absent', stats.absent);
  setText('cal-cancelled', stats.cancelled);
  setText('cal-holiday', stats.holiday);
}

function renderMonthlyStats(attendance) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthIsoPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  
  const monthRecords = attendance.filter(r => r.date.startsWith(monthIsoPrefix));
  const present = monthRecords.filter(r => r.status === 'present').length;
  const absent = monthRecords.filter(r => r.status === 'absent').length;
  const total = present + absent;
  const pct = calcPercentage(present, total);

  setText('month-total', total);
  setText('month-present', present);
  setText('month-absent', absent);
  setText('month-percentage', `${pct}%`);
  setText('month-bunks', absent);
}

function getDayStatusClass(date, records, classes, todayIso) {
  if (date > todayIso) {
    return 'future';
  }
  if (records.length > 0) {
    if (records.some(r => r.status === 'absent')) return 'absent';
    if (records.some(r => r.status === 'present')) return 'present';
    if (records.some(r => r.status === 'holiday')) return 'holiday';
    return 'no-classes';
  }
  if (classes.length === 0) {
    return 'no-classes';
  }
  return '';
}

function renderCalendarGrid(subjects, attendance, timetable) {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const days = getDatesInMonth(year, month);
  const firstDow = new Date(year, month, 1).getDay();
  const todayIso = today();
  const subjectMap = Object.fromEntries(subjects.map((subject) => [subject.id, subject]));
  const attendanceByDate = attendance.reduce((acc, record) => {
    (acc[record.date] ||= []).push(record);
    return acc;
  }, {});

  const fragment = document.createDocumentFragment();
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach((day) => {
    const head = document.createElement('div');
    head.className = 'calendar-day-head';
    head.textContent = day;
    fragment.appendChild(head);
  });

  for (let i = 0; i < firstDow; i += 1) {
    const blank = document.createElement('div');
    blank.className = 'calendar-day blank';
    fragment.appendChild(blank);
  }

  days.forEach((date) => {
    const dayEl = document.createElement('button');
    dayEl.type = 'button';
    dayEl.className = 'calendar-day';
    const records = attendanceByDate[date] || [];
    const present = records.filter((record) => record.status === 'present').length;
    const total = records.filter((record) => record.status === 'present' || record.status === 'absent').length;
    const pct = calcPercentage(present, total);
    const classes = timetable.filter((slot) => slot.day === getDayIndex(date));

    dayEl.innerHTML = `
      <div class="calendar-day-number">${Number(date.slice(-2))}</div>
      <div class="calendar-day-meta">${records.length ? `${pct}%` : `${classes.length} class${classes.length === 1 ? '' : 'es'}`}</div>
      <div class="calendar-dots">
        ${records.slice(0, 3).map((record) => `<span class="calendar-dot ${record.status}"></span>`).join('')}
      </div>
    `;

    if (date === todayIso) dayEl.classList.add('today');
    if (date === _selectedDate) dayEl.classList.add('selected');

    const stateClass = getDayStatusClass(date, records, classes, todayIso);
    if (stateClass) dayEl.classList.add(stateClass);

    dayEl.addEventListener('click', () => {
      _selectedDate = date;
      // Visually select in grid
      grid.querySelectorAll('.calendar-day').forEach(el => el.classList.remove('selected'));
      dayEl.classList.add('selected');
      
      openDayDetailsModal(date);
      renderDayDetails(date, records, subjectMap);
    });
    fragment.appendChild(dayEl);
  });

  grid.innerHTML = '';
  grid.appendChild(fragment);

  if (days.includes(todayIso)) {
    renderDayDetails(_selectedDate || todayIso, attendanceByDate[_selectedDate || todayIso] || [], subjectMap);
  }
}

function renderDayDetails(date, records, subjectMap) {
  const container = document.getElementById('calendar-day-details');
  if (!container) return;
  _selectedDate = date;
  const dayLabel = formatDateFull(date);

  if (!records.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-5)">
        <div class="empty-state-icon"><i class="fa-solid fa-calendar-day"></i></div>
        <h3>${dayLabel}</h3>
        <p>No attendance records for this day.</p>
        <button class="btn btn-primary btn-sm" id="calendar-add-record">Add Attendance</button>
      </div>
    `;
    document.getElementById('calendar-add-record')?.addEventListener('click', () => {
      openDayDetailsModal(date);
    });
    return;
  }

  const stats = buildDayStats(records);
  container.innerHTML = `
    <div style="font-weight:700;font-size:16px;margin-bottom:var(--space-3)">${dayLabel}</div>
    <div class="grid grid-4" style="gap:var(--space-3);margin-bottom:var(--space-4)">
      <div class="dash-stat-card"><div class="dash-stat-value">${stats.present}</div><div class="dash-stat-label">Present</div></div>
      <div class="dash-stat-card"><div class="dash-stat-value">${stats.absent}</div><div class="dash-stat-label">Absent</div></div>
      <div class="dash-stat-card"><div class="dash-stat-value">${stats.cancelled}</div><div class="dash-stat-label">Cancelled</div></div>
      <div class="dash-stat-card"><div class="dash-stat-value">${stats.totalPct}%</div><div class="dash-stat-label">Attendance</div></div>
    </div>
    <div class="stagger-children">
      ${records.map((record) => {
        const subject = subjectMap[record.subjectId];
        const status = getAttendanceStatus(record.status === 'present' ? 100 : record.status === 'absent' ? 0 : 50);
        return `
          <div class="card" style="padding:var(--space-3);margin-bottom:var(--space-3)">
            <div style="display:flex;justify-content:space-between;gap:var(--space-3)">
              <div>
                <div style="font-weight:700">${escapeHtml(subject?.name || 'Unknown subject')}</div>
                <div style="font-size:13px;color:var(--text-secondary)">${escapeHtml(subject?.faculty || 'Faculty not set')}</div>
                <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">${escapeHtml(subject?.room || 'No room set')}</div>
              </div>
              <div style="font-weight:700;text-transform:capitalize;color:${status.color}">${record.status}</div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:var(--space-3);gap:var(--space-3)">
              <div style="font-size:12px;color:var(--text-tertiary)">${timeAgo(record.markedAt || record.date)}</div>
              <button class="btn btn-ghost btn-sm" data-edit-record="${record.subjectId}">Edit</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  container.querySelectorAll('[data-edit-record]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      openDayDetailsModal(date);
    });
  });
}

function openDayDetailsModal(date) {
  const modal = document.getElementById('day-details-modal-overlay');
  if (!modal) return;
  _selectedDate = date;
  renderModalDetails(date);
  modal.classList.add('open');
}

function renderModalDetails(date) {
  const container = document.getElementById('modal-day-details-body');
  const title = document.getElementById('modal-date-title');
  if (!container || !title || !_calendarCache) return;

  const dayOfWeekIndex = getDayIndex(date);
  title.textContent = formatDateFull(date);

  const records = _calendarCache.attendance.filter(r => r.date === date);
  const timetableSlots = _calendarCache.timetable
    .filter(s => s.day === dayOfWeekIndex)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const subjectMap = Object.fromEntries(_calendarCache.subjects.map(s => [s.id, s]));

  const dayPresent = records.filter(r => r.status === 'present').length;
  const dayAbsent = records.filter(r => r.status === 'absent').length;
  const dayTotal = dayPresent + dayAbsent;
  const dayPct = calcPercentage(dayPresent, dayTotal);

  const classesToShow = [];
  const slotSubjectIds = new Set();

  timetableSlots.forEach(slot => {
    const subject = subjectMap[slot.subjectId];
    const record = records.find(r => r.subjectId === slot.subjectId);
    slotSubjectIds.add(slot.subjectId);
    classesToShow.push({
      subjectId: slot.subjectId,
      subjectName: subject?.name || 'Unknown Subject',
      faculty: subject?.faculty || '',
      room: slot.room || subject?.room || '',
      time: `${formatTime(slot.startTime)} - ${formatTime(slot.endTime)}`,
      status: record?.status || 'unmarked'
    });
  });

  records.forEach(record => {
    if (!slotSubjectIds.has(record.subjectId)) {
      const subject = subjectMap[record.subjectId];
      classesToShow.push({
        subjectId: record.subjectId,
        subjectName: subject?.name || 'Unknown Subject',
        faculty: subject?.faculty || '',
        room: subject?.room || '',
        time: 'Manual Entry',
        status: record.status
      });
    }
  });

  container.innerHTML = `
    <div class="day-stats-summary" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:var(--space-3); margin-bottom:var(--space-6); text-align:center;">
      <div class="dash-stat-card" style="padding:var(--space-3); margin-bottom:0;">
        <div class="dash-stat-value" style="font-size:1.4rem;">${dayTotal}</div>
        <div class="dash-stat-label" style="font-size:11px;">Total</div>
      </div>
      <div class="dash-stat-card" style="padding:var(--space-3); margin-bottom:0;">
        <div class="dash-stat-value" style="font-size:1.4rem; color:var(--color-success);">${dayPresent}</div>
        <div class="dash-stat-label" style="font-size:11px;">Present</div>
      </div>
      <div class="dash-stat-card" style="padding:var(--space-3); margin-bottom:0;">
        <div class="dash-stat-value" style="font-size:1.4rem; color:var(--color-danger);">${dayAbsent}</div>
        <div class="dash-stat-label" style="font-size:11px;">Absent</div>
      </div>
      <div class="dash-stat-card" style="padding:var(--space-3); margin-bottom:0;">
        <div class="dash-stat-value" style="font-size:1.4rem; color:var(--color-primary-light);">${dayPct}%</div>
        <div class="dash-stat-label" style="font-size:11px;">Attendance</div>
      </div>
    </div>

    <div class="modal-classes-list" style="display: flex; flex-direction: column; gap: var(--space-3);">
      ${classesToShow.map(c => `
        <div class="modal-class-card" style="margin-bottom:0;">
          <div class="modal-class-header">
            <div class="modal-class-info">
              <div class="modal-class-subject">${escapeHtml(c.subjectName)}</div>
              <div class="modal-class-faculty">${escapeHtml(c.faculty || 'Faculty not set')}</div>
              <div class="modal-class-room"><i class="fa-solid fa-location-dot" style="margin-right: 4px; color: var(--text-tertiary);"></i>${escapeHtml(c.room || 'No room set')}</div>
              <div class="modal-class-time" style="font-size:12px; color:var(--text-tertiary); margin-top:4px;"><i class="fa-solid fa-clock" style="margin-right: 4px;"></i>${c.time}</div>
            </div>
            <div>
              <span class="status-badge ${c.status}">${c.status}</span>
            </div>
          </div>
          <div class="modal-class-actions" style="display:flex; gap:var(--space-2); margin-top:var(--space-2);">
            <button class="btn btn-sm ${c.status === 'present' ? 'btn-success' : 'btn-ghost'}" data-mark-status="present" data-subject-id="${c.subjectId}" style="flex:1;">Present</button>
            <button class="btn btn-sm ${c.status === 'absent' ? 'btn-danger' : 'btn-ghost'}" data-mark-status="absent" data-subject-id="${c.subjectId}" style="flex:1;">Absent</button>
            <button class="btn btn-sm ${c.status === 'cancelled' ? 'btn-warning' : 'btn-ghost'}" data-mark-status="cancelled" data-subject-id="${c.subjectId}" style="flex:1;">Cancelled</button>
          </div>
        </div>
      `).join('') || `
        <div class="empty-state" style="padding:var(--space-8)">
          <div class="empty-state-icon"><i class="fa-solid fa-calendar-xmark"></i></div>
          <h3>No scheduled classes</h3>
          <p>There are no classes scheduled or attendance marked for this day.</p>
        </div>
      `}
    </div>
  `;

  container.querySelectorAll('[data-mark-status]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const subjectId = Number(e.currentTarget.dataset.subjectId);
      const status = e.currentTarget.dataset.markStatus;
      
      await markAttendance(subjectId, date, status);
      
      window.dispatchEvent(new CustomEvent('bunkwise:data-changed', { detail: { source: 'attendance', date } }));
      showToast(`Attendance marked as ${status}`, 'success');
    });
  });
}

function setupModalEvents() {
  const modal = document.getElementById('day-details-modal-overlay');
  modal?.querySelectorAll('.modal-close, #modal-close-btn').forEach(b => {
    b.addEventListener('click', () => { modal.classList.remove('open'); });
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
}

function bindEvents() {
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    currentMonth.setMonth(currentMonth.getMonth() - 1);
    loadCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    loadCalendar();
  });
  document.getElementById('cal-today')?.addEventListener('click', () => {
    currentMonth = new Date();
    loadCalendar();
  });
}

function setupLiveUpdates() {
  window.addEventListener('bunkwise:data-changed', (event) => {
    if (['attendance', 'subjects', 'timetable', 'profile', 'reset'].includes(event.detail?.source)) {
      loadCalendar();
    }
  });
}

function setupSwipeNavigation() {
  const container = document.getElementById('calendar-grid');
  if (!container) return;
  let startX = 0;
  let startY = 0;

  container.addEventListener('touchstart', (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
  }, { passive: true });

  container.addEventListener('touchend', (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const diffX = touch.clientX - startX;
    const diffY = Math.abs(touch.clientY - startY);
    if (diffY > 60) return;

    if (diffX < -60) {
      document.getElementById('cal-next')?.click();
    } else if (diffX > 60) {
      document.getElementById('cal-prev')?.click();
    }
  }, { passive: true });
}

function buildDayStats(records) {
  const present = records.filter((record) => record.status === 'present').length;
  const absent = records.filter((record) => record.status === 'absent').length;
  const cancelled = records.filter((record) => record.status === 'cancelled').length;
  const total = present + absent;
  return {
    present,
    absent,
    cancelled,
    totalPct: calcPercentage(present, total),
  };
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escapeHtml(value = '') {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}