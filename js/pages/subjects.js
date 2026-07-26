/**
 * subjects.js — Subjects Management
 */
import { getAllSubjects, getAllAttendance, saveSubject, deleteSubject, getProfile } from '../db.js';
import { defaultSubjectColor, SUBJECT_COLORS, calcPercentage, calcSafeBunks, calcClassesNeeded, getAttendanceStatus, today, sanitize } from '../utils.js';
import { showToast, showConfirm } from '../notifications.js';

let _subjects = [];
let _attendance = [];
let _profile = null;
let _editingId = null;
let _selectedColor = '';

export async function init() {
  await loadSubjects();
  setupEvents();
  setupColorPicker();
  setupLiveUpdates();
}
export async function refresh() {
    await loadSubjects();
}   
async function loadSubjects() {
  [_subjects, _attendance, _profile] = await Promise.all([
    getAllSubjects(),
    getAllAttendance(),
    getProfile(),
  ]);
  renderSubjects();
}

function renderSubjects(filter = '') {
  const grid = document.getElementById('subjects-grid');
  const empty = document.getElementById('subjects-empty');
  const target = Number(_profile?.attendanceTarget || 75);
  
  const filtered = _subjects.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) || (s.code && s.code.toLowerCase().includes(filter.toLowerCase())));
  
  if (filtered.length === 0) {
    grid.classList.add('d-none');
    empty.classList.remove('d-none');
    return;
  }
  
  empty.classList.add('d-none');
  grid.classList.remove('d-none');
  grid.innerHTML = '';

  const attendanceMap = buildAttendanceMap(_attendance);
  
  filtered.forEach(sub => {
    const metrics = buildSubjectMetrics(sub, attendanceMap, target);
    const card = document.createElement('div');
    card.className = 'subject-card-full';
    card.innerHTML = `
      <div class="subject-card-top" style="background:${sub.color || 'var(--color-primary)'}"></div>
      <div class="subject-card-body">
        <div class="subject-card-header">
          <div class="subject-avatar-wrap">
            <div class="subject-progress-ring" style="background:conic-gradient(${metrics.riskColor} ${Math.min(metrics.pct,100) * 3.6}deg, rgba(var(--color-primary-rgb),0.08) 0deg)">
              <div class="subject-avatar" style="background:${sub.color || 'var(--color-primary)'}">${sub.name.charAt(0).toUpperCase()}</div>
            </div>
          </div>
          <div class="subject-card-main">
            <div class="subject-card-name">${sanitize(sub.name)}</div>
            <div class="subject-card-code">${sanitize(sub.code || '—')}</div>
            <div class="subject-card-faculty"><i class="fa-solid fa-user-tie"></i> ${sanitize(sub.faculty || 'Faculty not set')}</div>
          </div>
        </div>
        <div class="subject-risk-row">
          <span class="subject-risk-chip" style="color:${metrics.riskColor};background:${metrics.riskBg}">${metrics.riskLabel}</span>
          <span class="subject-risk-chip subject-risk-ghost">Safe Bunks: ${metrics.safeBunks}</span>
        </div>

        <div class="subject-progress-block">
          <div class="subject-progress-header-row">
            <div class="subject-progress-label">Attendance</div>
            <div class="subject-progress-value" style="color:${metrics.riskColor}">${metrics.pct}%</div>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar animated ${metrics.progressClass}" style="width:${Math.min(metrics.pct, 100)}%"></div>
          </div>
        </div>

        <div class="subject-mini-grid">
          <div class="subject-mini-card"><span>Present</span><strong>${metrics.present}</strong></div>
          <div class="subject-mini-card"><span>Absent</span><strong>${metrics.absent}</strong></div>
          <div class="subject-mini-card"><span>Cancelled</span><strong>${metrics.cancelled}</strong></div>
          <div class="subject-mini-card"><span>Holiday</span><strong>${metrics.holiday}</strong></div>
        </div>

        <div class="subject-mini-grid subject-mini-grid-2">
          <div class="subject-mini-card"><span>Need to Attend</span><strong>${metrics.needToAttend}</strong></div>
          <div class="subject-mini-card"><span>Can Safely Bunk</span><strong>${metrics.safeBunks}</strong></div>
        </div>

        <div class="subject-card-actions">
          <a class="btn btn-ghost flex-1" href="./history.html?subject=${sub.id}"><i class="fa-solid fa-clock-rotate-left"></i> History</a>
          <button class="btn btn-ghost flex-1 edit-btn" data-id="${sub.id}"><i class="fa-solid fa-pen"></i> Quick Edit</button>
        </div>

        <div class="subject-card-actions subject-card-actions-secondary">
          <a class="btn btn-ghost flex-1" href="./calculator.html?subject=${sub.id}"><i class="fa-solid fa-calculator"></i> Calculator</a>
          <a class="btn btn-ghost flex-1" href="./attendance.html?subject=${sub.id}"><i class="fa-solid fa-clipboard-check"></i> Mark Attendance</a>
          <a class="btn btn-ghost flex-1" href="./timetable.html?subject=${sub.id}"><i class="fa-solid fa-calendar-days"></i> Timetable</a>
          <details class="subject-more-menu-wrap">
            <summary class="btn btn-ghost btn-icon subject-more-toggle" aria-label="More options"><i class="fa-solid fa-ellipsis"></i></summary>
            <div class="subject-more-menu">
              <button class="subject-more-item del-btn" data-id="${sub.id}"><i class="fa-solid fa-trash-can"></i> Delete Subject</button>
            </div>
          </details>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', (e) => openModal(Number(e.currentTarget.dataset.id))));
  grid.querySelectorAll('.del-btn').forEach(b => b.addEventListener('click', (e) => confirmDelete(Number(e.currentTarget.dataset.id))));
}

function setupEvents() {
  document.getElementById('btn-add-subject').addEventListener('click', () => openModal());
  document.getElementById('search-subjects').addEventListener('input', (e) => renderSubjects(e.target.value));
  document.getElementById('sub-save').addEventListener('click', saveCurrentSubject);
  
  const modal = document.getElementById('subject-modal');
  modal.querySelectorAll('.modal-close, .modal-close-btn').forEach(b => {
    b.addEventListener('click', () => { modal.classList.remove('open'); });
  });
}

function setupColorPicker() {
  const container = document.getElementById('sub-colors');
  container.innerHTML = SUBJECT_COLORS.map((c, i) => `<div class="color-swatch ${i===0?'active':''}" data-color="${c}" style="background:${c}"></div>`).join('');
  
  container.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', (e) => {
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      _selectedColor = sw.dataset.color;
    });
  });
}

function openModal(id = null) {
  _editingId = id;
  const modal = document.getElementById('subject-modal');
  document.getElementById('subject-modal-title').textContent = id ? 'Edit Subject' : 'Add Subject';
  
  if (id) {
    const sub = _subjects.find(s => s.id === id);
    document.getElementById('sub-name').value = sub.name;
    document.getElementById('sub-code').value = sub.code || '';
    document.getElementById('sub-faculty').value = sub.faculty || '';
    document.getElementById('sub-present').value =
    sub.presentClasses || 0;

document.getElementById('sub-total').value =
    sub.totalClasses || 0;
    _selectedColor = sub.color;
    const swatches = document.querySelectorAll('#sub-colors .color-swatch');
    swatches.forEach(s => s.classList.toggle('active', s.dataset.color === sub.color));
  } else {
    document.getElementById('sub-name').value = '';
    document.getElementById('sub-code').value = '';
    document.getElementById('sub-faculty').value = '';
    document.getElementById('sub-present').value = 0;
document.getElementById('sub-total').value = 0;
    _selectedColor = SUBJECT_COLORS[0];
    const swatches = document.querySelectorAll('#sub-colors .color-swatch');
    swatches.forEach((s, i) => s.classList.toggle('active', i === 0));
  }
  
  modal.classList.add('open');
}

async function saveCurrentSubject() {
  const name = document.getElementById('sub-name').value.trim();
  if (!name) return showToast('Subject name is required', 'error');
  
  const sub = {
    name,
    code: document.getElementById('sub-code').value.trim(),
    faculty: document.getElementById('sub-faculty').value.trim(),

    presentClasses: Number(
        document.getElementById('sub-present').value
    ),

    totalClasses: Number(
        document.getElementById('sub-total').value
    ),

    color: _selectedColor
};
  
  if (_editingId) sub.id = _editingId;
  
  await saveSubject(sub);
  document.getElementById('subject-modal').classList.remove('open');
  showToast(_editingId ? 'Subject updated' : 'Subject added', 'success');
  await loadSubjects();
}

async function confirmDelete(id) {
  const ok = await showConfirm('Delete Subject', 'Are you sure? This will delete all attendance records and timetable slots for this subject. This cannot be undone.', 'Delete', 'danger');
  if (ok) {
    await deleteSubject(id);
    showToast('Subject deleted', 'success');
    await loadSubjects();
  }
}

function buildAttendanceMap(attendance) {
  return attendance.reduce((map, record) => {
    if (!map.has(record.subjectId)) {
      map.set(record.subjectId, { present: 0, absent: 0, cancelled: 0, holiday: 0 });
    }
    const bucket = map.get(record.subjectId);
    if (bucket[record.status] !== undefined) bucket[record.status] += 1;
    return map;
  }, new Map());
}

function buildSubjectMetrics(subject, attendanceMap, target) {

  const counts = attendanceMap.get(subject.id) || {
    present: 0,
    absent: 0,
    cancelled: 0,
    holiday: 0
  };

  // Initial values entered by the user
  const initialPresent = Number(subject.presentClasses || 0);
  const initialTotal = Number(subject.totalClasses || 0);

  // Final counts
  const present = initialPresent + counts.present;
  const absent = counts.absent;
  const cancelled = counts.cancelled;
  const holiday = counts.holiday;

  const total = initialTotal + counts.present + counts.absent;

  const pct = calcPercentage(present, total);
  const safeBunks = calcSafeBunks(present, total, target);
  const needToAttend = pct >= target
      ? 0
      : calcClassesNeeded(present, total, target);

  const risk = getRiskBand(pct);

  return {
    present,
    absent,
    cancelled,
    holiday,
    pct,
    safeBunks,
    needToAttend,
    progressClass: risk.progressClass,
    riskColor: risk.color,
    riskBg: risk.bg,
    riskLabel: risk.label
  };
}

function getRiskBand(pct) {
  if (pct >= 95) return { color: 'var(--color-info)', bg: 'rgba(var(--color-info-rgb),0.12)', label: 'Blue Zone', progressClass: 'success' };
  if (pct >= 85) return { color: 'var(--color-success)', bg: 'rgba(var(--color-success-rgb),0.12)', label: 'Green Zone', progressClass: 'success' };
  if (pct >= 75) return { color: 'var(--color-warning)', bg: 'rgba(var(--color-warning-rgb),0.12)', label: 'Yellow Zone', progressClass: 'warning' };
  if (pct >= 65) return { color: '#FF9800', bg: 'rgba(255,152,0,0.12)', label: 'Orange Zone', progressClass: 'warning' };
  return { color: 'var(--color-danger)', bg: 'rgba(var(--color-danger-rgb),0.12)', label: 'Red Zone', progressClass: 'danger' };
}

function setupLiveUpdates() {
  window.addEventListener('bunkwise:data-changed', (event) => {
    if (['attendance', 'subjects', 'timetable', 'profile', 'reset'].includes(event.detail?.source)) {
      loadSubjects();
    }
  });
}
