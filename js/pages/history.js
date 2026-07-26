import { getAllAttendance, getAllSubjects, getProfile, markAttendance, deleteAttendanceRecord, undoLastAttendanceChange, getAttendanceUndoStack } from '../db.js';
import { today, formatDateShort, formatTime, calcPercentage, getAttendanceStatus, timeAgo, getDayIndex, formatDateFull, getDatesInMonth, MONTH_NAMES, debounce } from '../utils.js';
import { showToast, showConfirm } from '../notifications.js';

const PAGE_SIZE = 25;

let _records = [];
let _subjects = [];
let _profile = null;
let _filters = { query: '', subjectId: '', status: '', date: '', month: '', semester: '' };
let _visibleCount = PAGE_SIZE;
let _selected = new Set();
let _editingRecord = null;

export async function init() {
  bindEvents();
  setupLiveUpdates();
  await loadHistory();
}
export async function refresh() {
    await loadHistory();
}
async function loadHistory() {
  try {
    const [records, subjects, profile] = await Promise.all([
      getAllAttendance(),
      getAllSubjects(),
      getProfile(),
    ]);

    _records = records;
    _subjects = subjects;
    _profile = profile;

    populateFilters();
    renderSummary();
    renderTimeline();
    renderUndoState();
  } catch (error) {
    console.error('[History] Failed to load:', error);
    showToast('Attendance history could not load', 'error');
    renderErrorState();
  }
}

function populateFilters() {
  const subjectSelect = document.getElementById('history-subject');
  const semesterSelect = document.getElementById('history-semester');
  if (subjectSelect && subjectSelect.options.length === 1) {
    subjectSelect.innerHTML = '<option value="">All subjects</option>' + _subjects
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((subject) => `<option value="${subject.id}">${escapeHtml(subject.name)}</option>`)
      .join('');
  }

  if (semesterSelect && semesterSelect.options.length === 1) {
    const semesters = [...new Set(_records.map((record) => String(record.semester || _profile?.semester || '')).filter(Boolean))].sort();
    semesterSelect.innerHTML = '<option value="">All semesters</option>' + semesters.map((semester) => `<option value="${escapeHtml(semester)}">${escapeHtml(semester)}</option>`).join('');
  }
}

function renderSummary() {
  const stats = _records.reduce((acc, record) => {
    if (record.status === 'present') acc.present += 1;
    else if (record.status === 'absent') acc.absent += 1;
    else if (record.status === 'cancelled') acc.cancelled += 1;
    return acc;
  }, { present: 0, absent: 0, cancelled: 0 });

  setText('history-total', _records.length);
  setText('history-present', stats.present);
  setText('history-absent', stats.absent);
  setText('history-cancelled', stats.cancelled);
  setText('history-subtitle', `${_profile?.name || 'Student'} • ${_profile?.semester ? `Semester ${_profile.semester}` : 'Offline history'}`);
}

function renderTimeline() {
  const container = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const count = document.getElementById('history-count');
  if (!container || !empty || !count) return;

  const filtered = applyFilters();
  count.textContent = filtered.length ? `${filtered.length} records shown` : 'No records match your filters';

  if (!filtered.length) {
    container.innerHTML = '';
    empty.classList.remove('d-none');
    updateBulkBar();
    return;
  }

  empty.classList.add('d-none');

  const visible = filtered.slice(0, _visibleCount);
  const groups = groupRecords(visible);
  const fragment = document.createDocumentFragment();

  groups.forEach(({ label, records }) => {
    const groupEl = document.createElement('section');
    groupEl.className = 'history-group';
    groupEl.innerHTML = `<div class="history-group-title"><i class="fa-solid fa-layer-group"></i> ${escapeHtml(label)}</div>`;

    records.forEach((record) => {
      groupEl.appendChild(createRecordCard(record));
    });

    fragment.appendChild(groupEl);
  });

  container.innerHTML = '';
  container.appendChild(fragment);
  bindRecordActions();
  updateBulkBar();
  updateLoadMore(filtered.length);
}

function applyFilters() {
  return _records
    .slice()
    .sort((a, b) => (b.markedAt || b.date).localeCompare(a.markedAt || a.date))
    .filter((record) => {
      const subject = _subjects.find((item) => item.id === record.subjectId);
      const semesterValue = String(record.semester || _profile?.semester || '');
      const query = _filters.query.trim().toLowerCase();
      const haystack = `${subject?.name || ''} ${subject?.code || ''} ${subject?.faculty || ''} ${record.note || ''} ${record.status || ''}`.toLowerCase();

      if (query && !haystack.includes(query)) return false;
      if (_filters.subjectId && String(record.subjectId) !== _filters.subjectId) return false;
      if (_filters.status && record.status !== _filters.status) return false;
      if (_filters.date && record.date !== _filters.date) return false;
      if (_filters.month && !record.date.startsWith(_filters.month)) return false;
      if (_filters.semester && semesterValue !== _filters.semester) return false;
      return true;
    });
}

function groupRecords(records) {
  const grouped = new Map();
  records.forEach((record) => {
    const label = getGroupLabel(record.date);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(record);
  });

  const order = ['Today', 'Yesterday', 'Earlier This Week', 'Earlier This Month', 'Older'];
  return order.filter((label) => grouped.has(label)).map((label) => ({ label, records: grouped.get(label) }));
}

function getGroupLabel(date) {
  const diffDays = Math.abs(daysBetween(date, today()));
  const recordDate = new Date(date);
  const now = new Date(today());
  if (date === today()) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (recordDate.getMonth() === now.getMonth() && diffDays <= 7) return 'Earlier This Week';
  if (recordDate.getMonth() === now.getMonth()) return 'Earlier This Month';
  return 'Older';
}

function createRecordCard(record) {
  const subject = _subjects.find((item) => item.id === record.subjectId);
  const pct = typeof record.postPercentage === 'number' ? record.postPercentage : calcPercentage(subject?.attendedClasses || 0, subject?.totalClasses || 0);
  const status = getAttendanceStatus(record.status === 'present' ? 100 : record.status === 'absent' ? 0 : 50);
  const wrapper = document.createElement('article');
  wrapper.className = 'history-record';
  wrapper.dataset.id = String(record.id);
  wrapper.innerHTML = `
    <input type="checkbox" class="history-checkbox" data-select-record="${record.id}" aria-label="Select record" />
    <div class="history-progress" style="background:conic-gradient(${status.color} ${Math.min(pct, 100) * 3.6}deg, rgba(var(--color-primary-rgb),0.08) 0deg)">
      <div class="history-progress-value">${pct}%</div>
    </div>
    <div class="history-main">
      <div class="history-title-row">
        <div>
          <div class="history-title">${escapeHtml(subject?.name || 'Unknown subject')}</div>
          <div class="history-meta">
            <span><i class="fa-solid fa-calendar-day"></i> ${formatDateFull(record.date)}</span>
            <span><i class="fa-solid fa-clock"></i> ${formatTime(record.markedAt ? new Date(record.markedAt).toTimeString().slice(0, 5) : '') || formatTime('09:00')}</span>
            <span><i class="fa-solid fa-book"></i> ${escapeHtml(subject?.code || 'No code')}</span>
          </div>
        </div>
        <div class="history-status-chip" style="color:${status.color};background:rgba(255,255,255,0.04)"><i class="fa-solid ${getStatusIcon(record.status)}"></i> ${capitalize(record.status)}</div>
      </div>

      <div class="history-meta">
        <span><i class="fa-solid fa-user-tie"></i> ${escapeHtml(subject?.faculty || 'Faculty not set')}</span>
        <span><i class="fa-solid fa-graduation-cap"></i> Semester ${escapeHtml(String(record.semester || _profile?.semester || '—'))}</span>
        <span><i class="fa-solid fa-percent"></i> After mark: ${pct}%</span>
      </div>

      ${record.note ? `<div class="history-note">${escapeHtml(record.note)}</div>` : '<div class="history-note" style="opacity:.7">No notes</div>'}
    </div>
    <div class="history-actions-row">
      <button class="btn btn-ghost btn-sm" data-edit-record="${record.id}"><i class="fa-solid fa-pen"></i> Edit</button>
      <button class="btn btn-ghost btn-sm text-danger" data-delete-record="${record.id}"><i class="fa-solid fa-trash-can"></i> Delete</button>
    </div>
  `;
  return wrapper;
}

function bindRecordActions() {
  document.querySelectorAll('[data-edit-record]').forEach((button) => {
    button.addEventListener('click', () => openEditModal(Number(button.dataset.editRecord)));
  });
  document.querySelectorAll('[data-delete-record]').forEach((button) => {
    button.addEventListener('click', () => deleteSingleRecord(Number(button.dataset.deleteRecord)));
  });
  document.querySelectorAll('[data-select-record]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const id = Number(checkbox.dataset.selectRecord);
      if (checkbox.checked) _selected.add(id);
      else _selected.delete(id);
      updateBulkBar();
      toggleSelectedCard(id, checkbox.checked);
    });
  });
}

function updateBulkBar() {
  const bulkBtn = document.getElementById('history-bulk-delete');
  const selectedCount = document.getElementById('history-selected-count');
  if (!bulkBtn || !selectedCount) return;
  selectedCount.textContent = String(_selected.size);
  bulkBtn.classList.toggle('d-none', _selected.size === 0);
}

function updateLoadMore(total) {
  const btn = document.getElementById('history-load-more');
  if (!btn) return;
  btn.disabled = _visibleCount >= total;
  btn.textContent = _visibleCount >= total ? 'All Loaded' : 'Load More';
}

async function deleteSingleRecord(id) {
  const record = _records.find((item) => item.id === id);
  if (!record) return;
  const ok = await showConfirm('Delete Attendance', 'This record will be removed and can be restored with Undo.', 'Delete', 'danger');
  if (!ok) return;
  try {
    await deleteAttendanceRecord(id);
    showToast('Attendance deleted', 'success');
    await loadHistory();
  } catch (error) {
    console.error('[History] Delete failed:', error);
    showToast('Could not delete attendance', 'error');
  }
}

async function deleteSelectedRecords() {
  if (!_selected.size) return;
  const ok = await showConfirm('Delete Selected', `Delete ${_selected.size} selected attendance records?`, 'Delete', 'danger');
  if (!ok) return;

  try {
    for (const id of _selected) {
      await deleteAttendanceRecord(id);
    }
    _selected.clear();
    showToast('Selected records deleted', 'success');
    await loadHistory();
  } catch (error) {
    console.error('[History] Bulk delete failed:', error);
    showToast('Could not delete selected records', 'error');
  }
}

function openEditModal(recordId) {
  _editingRecord = _records.find((item) => item.id === recordId) || null;
  if (!_editingRecord) return;

  const subject = _subjects.find((item) => item.id === _editingRecord.subjectId);
  document.getElementById('history-edit-meta').textContent = `${subject?.name || 'Unknown subject'} • ${_editingRecord.date}`;
  document.getElementById('history-edit-status').value = _editingRecord.status;
  document.getElementById('history-edit-note').value = _editingRecord.note || '';
  document.getElementById('history-modal').classList.add('open');
}

async function saveEdit() {
  if (!_editingRecord) return;
  try {
    await markAttendance(_editingRecord.subjectId, _editingRecord.date, document.getElementById('history-edit-status').value, document.getElementById('history-edit-note').value.trim());
    document.getElementById('history-modal').classList.remove('open');
    showToast('Attendance updated', 'success');
    await loadHistory();
  } catch (error) {
    console.error('[History] Edit failed:', error);
    showToast('Could not update attendance', 'error');
  }
}

async function handleUndo() {
  try {
    const ok = await undoLastAttendanceChange();
    if (!ok) {
      showToast('Nothing to undo', 'warning');
      return;
    }
    showToast('Last change undone', 'success');
    await loadHistory();
  } catch (error) {
    console.error('[History] Undo failed:', error);
    showToast('Could not undo last change', 'error');
  }
}

function renderUndoState() {
  getAttendanceUndoStack().then((stack) => {
    const btn = document.getElementById('history-undo');
    if (btn) btn.disabled = !stack.length;
  }).catch(() => {});
}

function renderErrorState() {
  const container = document.getElementById('history-list');
  if (!container) return;
  container.innerHTML = `
    <div class="history-empty-card">
      <h3 style="margin-bottom:8px">Could not load history</h3>
      <p style="color:var(--text-secondary)">The local database may be unavailable or the stored data is corrupted.</p>
    </div>
  `;
}

function bindEvents() {
  const bind = (id, event, handler) => document.getElementById(id)?.addEventListener(event, handler);

  bind('history-search', 'input', debounce((event) => {
    _filters.query = event.target.value;
    _visibleCount = PAGE_SIZE;
    renderTimeline();
  }, 180));
  bind('history-subject', 'change', (event) => { _filters.subjectId = event.target.value; _visibleCount = PAGE_SIZE; renderTimeline(); });
  bind('history-status', 'change', (event) => { _filters.status = event.target.value; _visibleCount = PAGE_SIZE; renderTimeline(); });
  bind('history-date', 'change', (event) => { _filters.date = event.target.value; _visibleCount = PAGE_SIZE; renderTimeline(); });
  bind('history-month', 'change', (event) => { _filters.month = event.target.value; _visibleCount = PAGE_SIZE; renderTimeline(); });
  bind('history-semester', 'change', (event) => { _filters.semester = event.target.value; _visibleCount = PAGE_SIZE; renderTimeline(); });
  bind('history-clear-filters', 'click', clearFilters);
  bind('history-load-more', 'click', () => { _visibleCount += PAGE_SIZE; renderTimeline(); });
  bind('history-bulk-delete', 'click', deleteSelectedRecords);
  bind('history-undo', 'click', handleUndo);

  bind('history-modal-close', 'click', closeModal);
  bind('history-edit-cancel', 'click', closeModal);
  bind('history-edit-save', 'click', saveEdit);
  document.getElementById('history-modal')?.addEventListener('click', (event) => { if (event.target.id === 'history-modal') closeModal(); });
}

function clearFilters() {
  _filters = { query: '', subjectId: '', status: '', date: '', month: '', semester: '' };
  _visibleCount = PAGE_SIZE;
  _selected.clear();
  ['history-search', 'history-subject', 'history-status', 'history-date', 'history-month', 'history-semester'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderTimeline();
}

function closeModal() {
  document.getElementById('history-modal')?.classList.remove('open');
  _editingRecord = null;
}

function toggleSelectedCard(id, selected) {
  const card = document.querySelector(`.history-record[data-id="${id}"]`);
  if (card) card.classList.toggle('selected', selected);
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function getStatusIcon(status) {
  if (status === 'present') return 'fa-circle-check';
  if (status === 'absent') return 'fa-circle-xmark';
  if (status === 'cancelled') return 'fa-ban';
  return 'fa-cloud-sun';
}

function capitalize(value = '') {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function escapeHtml(value = '') {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setupLiveUpdates() {
  window.addEventListener('bunkwise:data-changed', (event) => {
    if (['attendance', 'subjects', 'timetable', 'profile', 'reset'].includes(event.detail?.source)) {
      loadHistory();
    }
  });
}