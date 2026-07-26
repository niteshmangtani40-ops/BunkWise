/**
 * timetable.js — Timetable Management
 */
import { getAllTimetable, saveTimetableSlot, deleteTimetableSlot, getAllSubjects } from '../db.js';
import { showToast, showConfirm } from '../notifications.js';
import { formatTime, getDayIndex, today, DAY_NAMES } from '../utils.js';

let _timetable = [];
let _subjects = [];
let _editingId = null;

const TIME_SLOTS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

export async function init() {
  await loadData();

  if (!window.__timetableInitialized) {
      setupEvents();
      window.__timetableInitialized = true;
  }
}
export async function refresh() {
    await loadData();
}
async function loadData() {
  [_timetable, _subjects] = await Promise.all([getAllTimetable(), getAllSubjects()]);
  renderGrid();
  renderCompact();
  populateSubjectDropdown();
}

function renderGrid() {
  const grid = document.getElementById('tt-grid');
  if (!grid) return;
  
  const todayIdx = getDayIndex(today());
  let html = `<div class="timetable-header-cell">Time</div>`;
  
  for (let i = 1; i <= 6; i++) {
    html += `<div class="timetable-header-cell ${i === todayIdx ? 'today' : ''}">${DAY_NAMES[i]}</div>`;
  }
  
  const slotsByDay = {};
  for (let i = 1; i <= 6; i++) slotsByDay[i] = _timetable.filter(s => s.day === i);
  
  TIME_SLOTS.forEach(time => {
    html += `<div class="timetable-time-cell">${time}</div>`;
    for (let day = 1; day <= 6; day++) {
      const slot = slotsByDay[day].find(s => s.startTime.startsWith(time.split(':')[0]));
      
      if (slot) {
        const sub = _subjects.find(s => s.id === slot.subjectId);
        html += `
          <div class="timetable-slot" data-id="${slot.id}" onclick="window.dispatchEvent(new CustomEvent('editSlot', {detail:${slot.id}}))">
            <div class="timetable-subject-chip" style="background:${sub?.color||'#888'}22; border-color:${sub?.color||'#888'}">
              <div class="timetable-subject-name" style="color:${sub?.color||'#888'}">${sub?.name || 'Unknown'}</div>
              <div class="timetable-subject-time" style="color:${sub?.color||'#888'}">${formatTime(slot.startTime)} - ${formatTime(slot.endTime)}</div>
            </div>
          </div>
        `;
      } else {
        html += `<div class="timetable-slot" data-day="${day}" data-time="${time}" onclick="window.dispatchEvent(new CustomEvent('addSlotTime', {detail:{day:${day}, time:'${time}'}}))"></div>`;
      }
    }
  });
  
  grid.innerHTML = html;
}

function renderCompact() {
  const cont = document.getElementById('tt-compact');
  if (!cont) return;
  
  const todayIdx = getDayIndex(today());
  let html = '';
  
  for (let day = 1; day <= 6; day++) {
    const slots = _timetable.filter(s => s.day === day).sort((a,b) => a.startTime.localeCompare(b.startTime));
    if (slots.length === 0) continue;
    
    html += `
      <div class="day-section">
        <div class="day-title ${day === todayIdx ? 'today' : ''}">${DAY_NAMES[day]} ${day === todayIdx ? '(Today)' : ''}</div>
    `;
    
    slots.forEach(slot => {
      const sub = _subjects.find(s => s.id === slot.subjectId);
      html += `
        <div class="slot-item" onclick="window.dispatchEvent(new CustomEvent('editSlot', {detail:${slot.id}}))">
          <div style="width:4px;height:40px;border-radius:4px;background:${sub?.color||'#888'}"></div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px;color:var(--text-primary)">${sub?.name || 'Unknown'}</div>
            <div style="font-size:12px;color:var(--text-tertiary)">${formatTime(slot.startTime)} - ${formatTime(slot.endTime)} ${slot.room ? `• ${slot.room}` : ''}</div>
          </div>
        </div>
      `;
    });
    
    html += `</div>`;
  }
  
  if (!html) {
    html = `
      <div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><i class="fa-solid fa-calendar-xmark"></i></div>
        <h3>No classes scheduled</h3>
        <p>Add some slots to build your timetable.</p>
        <button class="btn btn-primary" onclick="document.getElementById('btn-add-slot').click()">Add Slot</button>
      </div>
    `;
  }
  
  cont.innerHTML = html;
}

function populateSubjectDropdown() {
  const sel = document.getElementById('slot-subject');
  sel.innerHTML = _subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

function setupEvents() {
  document.getElementById('btn-add-slot').addEventListener('click', () => openModal());
  document.getElementById('slot-save').addEventListener('click', saveSlot);
  document.getElementById('btn-del-slot').addEventListener('click', deleteSlot);
  
  window.addEventListener('editSlot', (e) => openModal(e.detail));
  window.addEventListener('addSlotTime', (e) => {
    openModal(null);
    document.getElementById('slot-day').value = e.detail.day;
    document.getElementById('slot-start').value = e.detail.time;
    const end = new Date(`2000-01-01T${e.detail.time}`);
    end.setHours(end.getHours() + 1);
    document.getElementById('slot-end').value = end.toTimeString().slice(0,5);
  });
  
  const modal = document.getElementById('slot-modal');
  modal.querySelectorAll('.modal-close, .modal-close-btn').forEach(b => {
    b.addEventListener('click', () => { modal.classList.remove('open'); });
  });
}

function openModal(id = null) {
  if (_subjects.length === 0) {
    showToast('Please add subjects first', 'warning');
    setTimeout(() => { window.location.href = './subjects.html'; }, 1000);
    return;
  }
  
  _editingId = id;
  const modal = document.getElementById('slot-modal');
  const delBtn = document.getElementById('btn-del-slot');
  
  if (id) {
    document.getElementById('slot-modal-title').textContent = 'Edit Slot';
    const slot = _timetable.find(s => s.id === id);
    document.getElementById('slot-day').value = slot.day;
    document.getElementById('slot-subject').value = slot.subjectId;
    document.getElementById('slot-start').value = slot.startTime;
    document.getElementById('slot-end').value = slot.endTime;
    document.getElementById('slot-room').value = slot.room || '';
    delBtn.classList.remove('d-none');
  } else {
    document.getElementById('slot-modal-title').textContent = 'Add Slot';
    document.getElementById('slot-start').value = '09:00';
    document.getElementById('slot-end').value = '10:00';
    document.getElementById('slot-room').value = '';
    delBtn.classList.add('d-none');
  }
  
  modal.classList.add('open');
}

async function saveSlot() {
  const slot = {
    day: Number(document.getElementById('slot-day').value),
    subjectId: Number(document.getElementById('slot-subject').value),
    startTime: document.getElementById('slot-start').value,
    endTime: document.getElementById('slot-end').value,
    room: document.getElementById('slot-room').value.trim()
  };
  
  if (!slot.startTime || !slot.endTime) return showToast('Start and End times are required', 'error');
  if (slot.startTime >= slot.endTime) return showToast('End time must be after start time', 'error');
  
  if (_editingId) slot.id = _editingId;
  
  await saveTimetableSlot(slot);
  document.getElementById('slot-modal').classList.remove('open');
  showToast(_editingId ? 'Slot updated' : 'Slot added', 'success');
  await loadData();
}

async function deleteSlot() {
  if (!_editingId) return;
  const ok = await showConfirm('Delete Slot', 'Are you sure you want to delete this timetable slot?', 'Delete', 'danger');
  if (ok) {
    await deleteTimetableSlot(_editingId);
    document.getElementById('slot-modal').classList.remove('open');
    showToast('Slot deleted', 'success');
    await loadData();
  }
}
