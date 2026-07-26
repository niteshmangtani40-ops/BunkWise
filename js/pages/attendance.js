/**
 * attendance.js — Attendance Marking Logic
 */
import { getAllSubjects, getAllTimetable, getAttendanceForDate, markAttendance as saveAttendance, dbDelete, updateSubjectCounts, updateStatistics, getProfile, getAllSettings } from '../db.js';
import { today, formatDateFull, getDayIndex, calcPercentage, getAttendanceStatus } from '../utils.js';
import { showToast } from '../notifications.js';

let _currentDate = today();
let _subjects = [];
let _attendance = [];
let _target = 75;

export async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('date')) _currentDate = urlParams.get('date');
  
  const [prof, set] = await Promise.all([getProfile(), getAllSettings()]);
  _target = prof?.attendanceTarget || set?.attendanceTarget || 75;
  
  if (!window.__attendanceInitialized) {
    setupEvents();
    setupSwipeNavigation();
    window.__attendanceInitialized = true;
}
  await loadData();
}
export async function refresh() {
    _currentDate = today();
    await loadData();
}
async function loadData() {
  updateDateDisplay();

  const day = getDayIndex(_currentDate);

  const [subjects, timetable, attendance] = await Promise.all([
    getAllSubjects(),
    getAllTimetable(),
    getAttendanceForDate(_currentDate)
  ]);

  const todaySlots = timetable.filter(slot => slot.day === day);

  const todaySubjectIds = todaySlots.map(slot => slot.subjectId);

  _subjects = subjects.filter(subject =>
    todaySubjectIds.includes(subject.id)
  );

  _attendance = attendance;

  renderList();
  updateSummary();
}

function updateDateDisplay() {
  const d = new Date(_currentDate);
  const isToday = _currentDate === today();
  
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  
  document.getElementById('date-day').textContent = isToday ? 'Today' : days[d.getDay()];
  document.getElementById('date-full').textContent = `${days[d.getDay()].substring(0,3)}, ${d.getDate()} ${months[d.getMonth()]}`;
  
  document.getElementById('today-badge').classList.toggle('d-none', !isToday);
  document.getElementById('date-picker-hidden').value = _currentDate;
  
  document.getElementById('btn-next-day').disabled = isToday;
}

function renderList() {
  const cont = document.getElementById('attendance-list');
  if (!cont) return;
  
  if (_subjects.length === 0) {
    cont.innerHTML = `
      <div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><i class="fa-solid fa-book-open"></i></div>
        <h3>No classes today</h3>
        <p>No subjects are scheduled for this day.</p>
        <a href="./timetable.html" class="btn btn-primary">Edit Timetable</a>
      </div>
    `;
    return;
  }
  
  const recs = Object.fromEntries(_attendance.map(r => [r.subjectId, r]));
  
  let html = '';
  _subjects.forEach(sub => {
    const rec = recs[sub.id];
    const status = rec ? rec.status : null;
    
    // Optimistic projection logic
    let tempAtt = sub.attendedClasses || 0;
    let tempTot = sub.totalClasses || 0;
    
    const pct = calcPercentage(tempAtt, tempTot);
    const ast = getAttendanceStatus(pct);
    
    const isPresent = status === 'present';
    const isAbsent = status === 'absent';
    const isCancelled = status === 'cancelled';
    
    html += `
      <div class="attendance-subject-row ${isPresent ? 'marked-present' : isAbsent ? 'marked-absent' : isCancelled ? 'marked-cancelled' : ''}">
        <div class="att-subject-info">
          <div class="att-subject-name">${sub.name}</div>
          <div class="att-subject-pct">
            <span style="color:${ast.color}">${pct}%</span>
            <div class="att-mini-progress">
              <div class="att-mini-bar" style="width:${pct}%;background:${ast.color}"></div>
            </div>
            <span style="color:var(--text-tertiary);font-size:11px;font-weight:400">${tempAtt}/${tempTot}</span>
          </div>
        </div>
        <div class="att-mark-btns">
          <button class="att-mark-btn present ${isPresent ? 'active' : ''}" data-sub="${sub.id}" data-status="present">
            ${isPresent ? '<i class="fa-solid fa-check"></i>' : 'Present'}
          </button>
          <button class="att-mark-btn absent ${isAbsent ? 'active' : ''}" data-sub="${sub.id}" data-status="absent">
             ${isAbsent ? '<i class="fa-solid fa-xmark"></i>' : 'Absent'}
          </button>
          <button class="att-mark-btn cancelled ${isCancelled ? 'active' : ''}" data-sub="${sub.id}" data-status="cancelled" title="Cancelled">
             <i class="fa-solid fa-ban"></i>
          </button>
          ${rec ? `<button class="att-mark-btn undo" data-sub="${sub.id}" data-action="undo" title="Undo">Undo</button>` : ''}
        </div>
      </div>
    `;
  });
  
  cont.innerHTML = html;
  
  cont.querySelectorAll('.att-mark-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (b.dataset.action === 'undo') {
        await undoAttendance(Number(b.dataset.sub));
        return;
      }
      await markAttendance(Number(b.dataset.sub), b.dataset.status);
    });
  });

  cont.querySelectorAll('.attendance-subject-row').forEach((row) => {
    if (row.classList.contains('marked-present') || row.classList.contains('marked-absent') || row.classList.contains('marked-cancelled')) {
      row.classList.add('attendance-success');
    }
  });
}

function updateSummary() {
  let p = 0, a = 0, c = 0;
  _attendance.forEach(r => {
    if (r.status === 'present') p++;
    else if (r.status === 'absent') a++;
    else if (r.status === 'cancelled') c++;
  });
  
  document.getElementById('sum-total').textContent = _subjects.length;
  document.getElementById('sum-present').textContent = p;
  document.getElementById('sum-absent').textContent = a;
  document.getElementById('sum-cancelled').textContent = c;
}

async function undoAttendance(subjectId) {
  try {
    const existing = _attendance.find(a => a.subjectId === subjectId);
    if (!existing) return;

    await dbDelete('attendance', existing.id);
    await updateSubjectCounts(subjectId);
    await updateStatistics(subjectId);
    await loadData();
    showToast('Attendance removed', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to undo attendance', 'error');
  }
}

async function markAttendance(subjectId, status) {
  try {
    const existing = _attendance.find(a => a.subjectId === subjectId);
    // If clicking same status, treat as toggle (unmark)
    const finalStatus = (existing && existing.status === status) ? 'unmark' : status;

    if (finalStatus === 'unmark') {
      if (existing) {
        await dbDelete('attendance', existing.id);
        await updateSubjectCounts(subjectId);
        await updateStatistics(subjectId);
      }
    } else {
      await saveAttendance(subjectId, _currentDate, finalStatus);
    }
    
    // Quick reload
    await loadData();
    window.dispatchEvent(new CustomEvent('bunkwise:data-changed', { detail: { source: 'attendance', subjectId, date: _currentDate, status: finalStatus } }));
    
    // Vibrate if supported
    if (navigator.vibrate) {
      if (finalStatus === 'present') navigator.vibrate(50);
      else if (finalStatus === 'absent') navigator.vibrate([50, 50, 50]);
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to save attendance', 'error');
  }
}

function setupSwipeNavigation() {
  const target = document.getElementById('attendance-list') || document.body;
  let startX = 0;
  let startY = 0;

  target.addEventListener('touchstart', (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
  }, { passive: true });

  target.addEventListener('touchend', (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const diffX = touch.clientX - startX;
    const diffY = Math.abs(touch.clientY - startY);
    if (diffY > 60) return;

    if (diffX < -60) {
      document.getElementById('btn-next-day')?.click();
    } else if (diffX > 60) {
      document.getElementById('btn-prev-day')?.click();
    }
  }, { passive: true });
}

function setupEvents() {
  document.getElementById('btn-prev-day').addEventListener('click', () => {
    const d = new Date(_currentDate);
    d.setDate(d.getDate() - 1);
    _currentDate = d.toISOString().split('T')[0];
    loadData();
  });

  document.getElementById('btn-calendar').addEventListener('click', () => {
  const picker = document.getElementById('date-picker-hidden');

  try {
    picker.showPicker();   // Chrome, Edge, Opera
  } catch (e) {
    picker.click();        // Fallback for browsers without showPicker()
  }
  });
  
  document.getElementById('btn-next-day').addEventListener('click', () => {
    if (_currentDate === today()) return;
    const d = new Date(_currentDate);
    d.setDate(d.getDate() + 1);
    _currentDate = d.toISOString().split('T')[0];
    loadData();
  });
  
  document.getElementById('date-picker-hidden').addEventListener('change', (e) => {
    if (e.target.value) {
      if (e.target.value > today()) {
        showToast('Cannot select future dates', 'warning');
        e.target.value = _currentDate;
      } else {
        _currentDate = e.target.value;
        loadData();
      }
    }
  });
  
  document.getElementById('btn-mark-all-present').addEventListener('click', async () => {
    for (const sub of _subjects) {
      const existing = _attendance.find(a => a.subjectId === sub.id);
      if (!existing || existing.status !== 'present') {
        await saveAttendance(sub.id, _currentDate, 'present');
      }
    }
    await loadData();
    showToast('All marked as present', 'success');
  });
}
