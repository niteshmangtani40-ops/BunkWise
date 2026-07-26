import { getAllSubjects, getAllAttendance, getAllTimetable, getProfile } from '../db.js';
import { calcPercentage, formatDateShort, formatDateFull, getDatesInMonth, getDayIndex, getAttendanceStatus, timeAgo, today } from '../utils.js';
import { showToast } from '../notifications.js';
import { getPredictionsData } from '../features/prediction.js';


let _trendChart = null;
let _pieChart = null;
let _heatmapView = 'month';
let _heatmapCursor = new Date();
let _heatmapSelected = today();
let _heatmapBound = false;
let _heatmapData = null;

export async function init() {
  await loadData();
  setupHeatmapControls();
  setupLiveUpdates();
}
export async function refresh() {
    await loadData();
}
async function loadData() {
  const [subjects, attendance, timetable, profile] = await Promise.all([
    getAllSubjects(),
    getAllAttendance(),
    getAllTimetable(),
    getProfile()
  ]);

  window.__bunkwiseSubjects = subjects;
  populateHeatmapSelectors(attendance);
  
  renderTrendChart(attendance);
  renderPieChart(attendance);
  renderHeatmap(attendance, timetable, profile);
  
  // Predictions reporting
  const predictions = await getPredictionsData({ profile, subjects, attendance, timetable });
  renderReportsPredictions(predictions.subjectsData);

  document.getElementById('btn-export-csv').onclick = () => {
    exportToCSV(subjects, attendance, profile, predictions.subjectsData);
  };

  const printBtn = document.getElementById('btn-print-pdf');
  if (printBtn) {
    printBtn.onclick = () => {
      window.print();
    };
  }
}

function setupHeatmapControls() {
  if (_heatmapBound) return;
  _heatmapBound = true;

  document.querySelectorAll('[data-heatmap-view]').forEach((button) => {
    button.addEventListener('click', () => {
      _heatmapView = button.dataset.heatmapView;
      _heatmapCursor = new Date();
      _heatmapSelected = today();
      updateHeatmapViewButtons();
      refreshHeatmap();
    });
  });

  document.getElementById('heatmap-prev')?.addEventListener('click', () => {
    shiftHeatmapCursor(-1);
  });
  document.getElementById('heatmap-next')?.addEventListener('click', () => {
    shiftHeatmapCursor(1);
  });
  document.getElementById('heatmap-today')?.addEventListener('click', () => {
    _heatmapCursor = new Date();
    _heatmapSelected = today();
    refreshHeatmap();
  });
  document.getElementById('heatmap-month')?.addEventListener('change', (event) => {
    _heatmapCursor.setMonth(Number(event.target.value));
    refreshHeatmap();
  });
  document.getElementById('heatmap-year')?.addEventListener('change', (event) => {
    _heatmapCursor.setFullYear(Number(event.target.value));
    refreshHeatmap();
  });
}

function populateHeatmapSelectors(attendance) {
  const monthSelect = document.getElementById('heatmap-month');
  const yearSelect = document.getElementById('heatmap-year');
  if (monthSelect && monthSelect.options.length === 0) {
    monthSelect.innerHTML = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(2024, index, 1);
      return `<option value="${index}">${date.toLocaleDateString('en-US', { month: 'long' })}</option>`;
    }).join('');
  }

  if (yearSelect && yearSelect.options.length === 0) {
    const years = new Set([new Date().getFullYear()]);
    attendance.forEach((record) => {
      const year = new Date(record.date).getFullYear();
      if (!Number.isNaN(year)) years.add(year);
    });
    const sortedYears = [...years].sort((a, b) => a - b);
    yearSelect.innerHTML = sortedYears.map((year) => `<option value="${year}">${year}</option>`).join('');
  }

  if (monthSelect) monthSelect.value = String(_heatmapCursor.getMonth());
  if (yearSelect) yearSelect.value = String(_heatmapCursor.getFullYear());
}

function shiftHeatmapCursor(direction) {
  if (_heatmapView === 'year') {
    _heatmapCursor.setFullYear(_heatmapCursor.getFullYear() + direction);
  } else if (_heatmapView === 'semester') {
    _heatmapCursor.setMonth(_heatmapCursor.getMonth() + (direction * 6));
  } else {
    _heatmapCursor.setMonth(_heatmapCursor.getMonth() + direction);
  }
  refreshHeatmap();
}

function refreshHeatmap() {
  const data = _heatmapData || {};
  if (!data.attendance) return;
  renderHeatmap(data.attendance, data.timetable, data.profile);
}

function renderHeatmap(attendance, timetable, profile) {
  const container = document.getElementById('attendance-heatmap');
  if (!container) return;

  _heatmapData = { attendance, timetable, profile };
  updateHeatmapViewButtons();

  const { rangeStart, rangeEnd, label, subtitle } = getHeatmapRange(attendance, profile);
  const byDate = attendance.reduce((acc, record) => {
    (acc[record.date] ||= []).push(record);
    return acc;
  }, {});

  const dates = enumerateDates(rangeStart, rangeEnd);
  const subjectMap = Object.fromEntries((window.__bunkwiseSubjects || []).map((subject) => [subject.id, subject]));
  const cells = [];

  cells.push('<div class="heatmap-label">Sun</div><div class="heatmap-label">Mon</div><div class="heatmap-label">Tue</div><div class="heatmap-label">Wed</div><div class="heatmap-label">Thu</div><div class="heatmap-label">Fri</div><div class="heatmap-label">Sat</div>');

  const firstDow = new Date(rangeStart).getDay();
  for (let i = 0; i < firstDow; i += 1) {
    cells.push('<div class="heatmap-cell empty">•</div>');
  }

  dates.forEach((date) => {
    const records = byDate[date] || [];
    const dayStatus = getHeatmapDayStatus(date, records, timetable);
    const pct = getDayPercentage(records);
    const title = `${date} · ${dayStatus.label}`;
    cells.push(`<button class="heatmap-cell ${dayStatus.className} ${date === today() ? 'today' : ''} ${date === _heatmapSelected ? 'selected' : ''}" type="button" data-date="${date}" aria-label="${title}">${date.slice(-2)}</button>`);
  });

  container.innerHTML = cells.join('');
  container.querySelectorAll('[data-date]').forEach((cell) => {
    cell.addEventListener('click', () => {
      const date = cell.dataset.date;
      _heatmapSelected = date;
      renderHeatmapDetails(date, attendance, subjectMap, timetable);
      highlightSelectedHeatmapCell();
    });
  });

  renderHeatmapDetails(_heatmapSelected, attendance, subjectMap, timetable);
  renderHeatmapStats(attendance, timetable, rangeStart, rangeEnd);
  setText('heatmap-summary-label', `${label} view`);
  setText('heatmap-current-range', subtitle);
  highlightSelectedHeatmapCell();
}

function renderHeatmapDetails(date, attendance, subjectMap, timetable) {
  const container = document.getElementById('heatmap-day-details');
  if (!container) return;
  const records = attendance.filter((record) => record.date === date);
  const classes = timetable.filter((slot) => Number(slot.day) === getDayIndex(date));
  const summary = getDaySummary(date, records, classes.length);

  if (!records.length && !classes.length) {
    container.innerHTML = `
      <h3 style="margin-bottom:8px">${formatDateFull(date)}</h3>
      <p style="color:var(--text-secondary)">No class scheduled for this day.</p>
    `;
    return;
  }

  container.innerHTML = `
    <div class="history-title-row" style="margin-bottom:var(--space-3)">
      <div>
        <h3 style="margin-bottom:4px">${formatDateFull(date)}</h3>
        <div style="color:var(--text-tertiary);font-size:13px">${summary.label}</div>
      </div>
      <div class="history-status-chip" style="color:${summary.color};background:${summary.bg}">${summary.label}</div>
    </div>
    <div class="prediction-subject-grid" style="margin-bottom:var(--space-3)">
      <div class="prediction-subject-stat"><span>Present</span><strong>${summary.present}</strong></div>
      <div class="prediction-subject-stat"><span>Absent</span><strong>${summary.absent}</strong></div>
      <div class="prediction-subject-stat"><span>Cancelled</span><strong>${summary.cancelled}</strong></div>
      <div class="prediction-subject-stat"><span>Holiday</span><strong>${summary.holiday}</strong></div>
      <div class="prediction-subject-stat"><span>Total Classes</span><strong>${summary.total}</strong></div>
      <div class="prediction-subject-stat"><span>Attendance %</span><strong>${summary.pct}%</strong></div>
    </div>
    <div class="prediction-list">
      ${records.length ? records.map((record) => {
        const subject = subjectMap[record.subjectId];
        return `
          <div class="prediction-subject-card">
            <div class="prediction-subject-top">
              <div>
                <div class="prediction-subject-name">${escapeHtml(subject?.name || 'Unknown subject')}</div>
                <div class="prediction-subject-meta">${escapeHtml(subject?.faculty || 'Faculty not set')} • ${escapeHtml(subject?.room || 'No room set')}</div>
              </div>
              <span class="prediction-status-chip" style="color:${getStatusColor(record.status)};background:${getStatusBackground(record.status)}">${capitalize(record.status)}</span>
            </div>
            <div class="prediction-card-sub">${record.note ? escapeHtml(record.note) : 'No notes recorded.'}</div>
            <div class="prediction-card-sub" style="margin-top:6px">Marked ${timeAgo(record.markedAt || record.date)}</div>
          </div>
        `;
      }).join('') : '<div class="prediction-insight">No attendance records for this day.</div>'}
    </div>
  `;
}

function renderHeatmapStats(attendance, timetable, rangeStart, rangeEnd) {
  const filtered = attendance.filter((record) => record.date >= rangeStart && record.date <= rangeEnd);
  const stats = filtered.reduce((acc, record) => {
    if (record.status === 'present') acc.present += 1;
    else if (record.status === 'absent') acc.absent += 1;
    else if (record.status === 'cancelled') acc.cancelled += 1;
    else if (record.status === 'holiday') acc.holiday += 1;
    return acc;
  }, { present: 0, absent: 0, cancelled: 0, holiday: 0 });

  const totalClasses = stats.present + stats.absent + stats.cancelled;
  const pct = calcPercentage(stats.present, stats.present + stats.absent);
  const streaks = calculateStreaks(rangeStart, rangeEnd, attendance, timetable);

  setText('heatmap-total-classes', totalClasses);
  setText('heatmap-attendance-pct', `${pct}%`);
  setText('heatmap-present', stats.present);
  setText('heatmap-absent', stats.absent);
  setText('heatmap-cancelled', stats.cancelled);
  setText('heatmap-holiday', stats.holiday);
  setText('heatmap-longest-present', streaks.present);
  setText('heatmap-longest-absent', streaks.absent);
}

function getHeatmapRange(attendance, profile) {
  const semesterKey = String(profile?.semester || '').trim();
  if (_heatmapView === 'year') {
    const year = _heatmapCursor.getFullYear();
    return {
      rangeStart: `${year}-01-01`,
      rangeEnd: `${year}-12-31`,
      label: `${year} Year`,
      subtitle: `${semesterKey ? `Semester ${semesterKey} • ` : ''}Full calendar year`,
    };
  }

  if (_heatmapView === 'semester') {
    const semesterRecords = attendance.filter((record) => String(record.semester || semesterKey) === semesterKey);
    if (semesterRecords.length) {
      const dates = semesterRecords.map((record) => record.date).sort();
      return {
        rangeStart: dates[0],
        rangeEnd: dates[dates.length - 1],
        label: `Semester ${semesterKey || 'View'}`,
        subtitle: `Records from ${formatDateShort(dates[0])} to ${formatDateShort(dates[dates.length - 1])}`,
      };
    }
  }

  const year = _heatmapCursor.getFullYear();
  const month = _heatmapCursor.getMonth();
  const days = getDatesInMonth(year, month);
  return {
    rangeStart: days[0],
    rangeEnd: days[days.length - 1],
    label: `${_heatmapCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
    subtitle: `${semesterKey ? `Semester ${semesterKey} • ` : ''}Monthly view`,
  };
}

function getHeatmapDayStatus(date, records, timetable) {
  const hasClass = timetable.some((slot) => Number(slot.day) === getDayIndex(date));
  const present = records.filter((record) => record.status === 'present').length;
  const absent = records.filter((record) => record.status === 'absent').length;
  const cancelled = records.filter((record) => record.status === 'cancelled').length;
  const holiday = records.filter((record) => record.status === 'holiday').length;

  if (holiday > 0 && present === 0 && absent === 0) return { className: 'holiday', label: 'Holiday' };
  if (!records.length || !hasClass) return { className: 'noclass', label: 'No Class' };
  if (present > 0 && absent === 0) return { className: 'present', label: 'Present' };
  if (absent > 0 && present === 0) return { className: 'absent', label: 'Absent' };
  if (present >= absent) return { className: 'present', label: 'Mostly Present' };
  return { className: 'absent', label: 'Mostly Absent' };
}

function getDayPercentage(records) {
  const present = records.filter((record) => record.status === 'present').length;
  const absent = records.filter((record) => record.status === 'absent').length;
  return calcPercentage(present, present + absent);
}

function getDaySummary(date, records, classCount) {
  const present = records.filter((record) => record.status === 'present').length;
  const absent = records.filter((record) => record.status === 'absent').length;
  const cancelled = records.filter((record) => record.status === 'cancelled').length;
  const holiday = records.filter((record) => record.status === 'holiday').length;
  const total = present + absent + cancelled;
  const pct = calcPercentage(present, present + absent);
  const status = getAttendanceStatus(pct);
  return {
    present,
    absent,
    cancelled,
    holiday,
    total,
    pct,
    label: classCount === 0 ? 'No Class' : holiday > 0 ? 'Holiday' : status.label,
    color: classCount === 0 ? 'var(--text-tertiary)' : holiday > 0 ? 'var(--color-warning)' : status.color,
    bg: classCount === 0 ? 'rgba(255,255,255,0.04)' : holiday > 0 ? 'rgba(var(--color-warning-rgb),0.12)' : 'rgba(var(--color-primary-rgb),0.1)',
  };
}

function calculateStreaks(rangeStart, rangeEnd, attendance, timetable) {
  const dates = enumerateDates(rangeStart, rangeEnd);
  let longestPresent = 0;
  let longestAbsent = 0;
  let currentPresent = 0;
  let currentAbsent = 0;

  dates.forEach((date) => {
    const records = attendance.filter((record) => record.date === date);
    const classes = timetable.some((slot) => Number(slot.day) === getDayIndex(date));
    if (!records.length && !classes) return;

    const summary = getDaySummary(date, records, classes ? 1 : 0);
    if (summary.label === 'Holiday' || summary.label === 'No Class') return;
    if (summary.pct >= 75) {
      currentPresent += 1;
      longestPresent = Math.max(longestPresent, currentPresent);
      currentAbsent = 0;
    } else {
      currentAbsent += 1;
      longestAbsent = Math.max(longestAbsent, currentAbsent);
      currentPresent = 0;
    }
  });

  return { present: longestPresent, absent: longestAbsent };
}

function enumerateDates(start, end) {
  const dates = [];
  const cursor = new Date(start);
  const stop = new Date(end);
  while (cursor <= stop) {
    dates.push(cursor.toISOString().split('T')[0]);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function updateHeatmapViewButtons() {
  document.querySelectorAll('[data-heatmap-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.heatmapView === _heatmapView);
  });
}

function highlightSelectedHeatmapCell() {
  document.querySelectorAll('.heatmap-cell[data-date]').forEach((cell) => {
    cell.classList.toggle('selected', cell.dataset.date === _heatmapSelected);
  });
}

function getStatusColor(status) {
  if (status === 'present') return 'var(--color-success)';
  if (status === 'absent') return 'var(--color-danger)';
  if (status === 'cancelled') return 'var(--color-warning)';
  return 'var(--color-info)';
}

function getStatusBackground(status) {
  if (status === 'present') return 'rgba(var(--color-success-rgb),0.12)';
  if (status === 'absent') return 'rgba(var(--color-danger-rgb),0.12)';
  if (status === 'cancelled') return 'rgba(var(--color-warning-rgb),0.12)';
  return 'rgba(var(--color-info-rgb),0.12)';
}

function setupLiveUpdates() {
  window.addEventListener('bunkwise:data-changed', (event) => {
    if (['attendance', 'subjects', 'timetable', 'profile', 'reset'].includes(event.detail?.source)) {
      loadData();
    }
  });
}

function renderTrendChart(attendance) {
  const canvas = document.getElementById('trend-chart');
  if (!canvas) return;
  if (_trendChart) _trendChart.destroy();
  
  const dates = [...new Set(attendance.map(a => a.date))].sort();
  if (dates.length === 0) return; // No data
  
  const labels = dates.slice(-14).map(d => formatDateShort(d)); // last 14 active days
  const presentData = [];
  
  dates.slice(-14).forEach(d => {
    const dayRecs = attendance.filter(a => a.date === d);
    const pres = dayRecs.filter(a => a.status === 'present').length;
    const tot = dayRecs.filter(a => ['present','absent'].includes(a.status)).length;
    presentData.push(tot > 0 ? (pres / tot) * 100 : 0);
  });

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#9090B8' : '#5A5A80';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  _trendChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Daily Attendance %',
        data: presentData,
        borderColor: '#6C63FF',
        backgroundColor: 'rgba(108,99,255,0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor, font: { family: 'Inter' } } }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor } },
        y: { grid: { color: gridColor }, ticks: { color: textColor }, min: 0, max: 100 }
      }
    }
  });
}

function renderPieChart(attendance) {
  const canvas = document.getElementById('pie-chart');
  if (!canvas) return;
  if (_pieChart) _pieChart.destroy();
  
  let p = 0, a = 0, c = 0, h = 0;
  attendance.forEach(rec => {
    if (rec.status === 'present') p++;
    else if (rec.status === 'absent') a++;
    else if (rec.status === 'cancelled') c++;
    else if (rec.status === 'holiday') h++;
  });
  
  if (p+a+c+h === 0) return;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#9090B8' : '#5A5A80';

  _pieChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Present', 'Absent', 'Cancelled', 'Holiday'],
      datasets: [{
        data: [p, a, c, h],
        backgroundColor: ['#4CAF50', '#F44336', '#FF9800', '#29B6F6'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { position: 'right', labels: { color: textColor, font: { family: 'Inter' }, usePointStyle: true } }
      }
    }
  });
}

function exportToCSV(subjects, attendance, profile, predictionsData = []) {
  if (attendance.length === 0) {
    showToast('No attendance data to export', 'warning');
    return;
  }
  
  const subMap = Object.fromEntries(subjects.map(s => [s.id, s.name]));
  
  let csv = 'PART 1: ATTENDANCE HISTORY RECORDS\n';
  csv += 'Date,Subject,Status\n';
  const sorted = [...attendance].sort((a,b) => a.date.localeCompare(b.date));
  
  sorted.forEach(a => {
    csv += `${a.date},"${subMap[a.subjectId] || 'Unknown'}","${a.status}"\n`;
  });
  
  if (predictionsData && predictionsData.length > 0) {
    csv += '\nPART 2: SUBJECT ATTENDANCE PROJECTIONS & PREDICTIONS\n';
    csv += 'Subject,Current %,Target %,Status,Safe Bunks,Classes Needed,Projected Semester %,Trend\n';
    predictionsData.forEach(p => {
      csv += `"${p.name}",${p.currentPct}%,${p.target}%,"${p.status}",${p.safeBunks},${p.needed},${p.projectedSemesterPct}%,"${p.trend}"\n`;
    });
  }
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(profile?.name || 'student').replace(/\s+/g,'_')}_attendance_report_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported', 'success');
}

function renderReportsPredictions(subjectsData) {
  const tbody = document.getElementById('reports-prediction-table-body');
  if (!tbody) return;

  if (subjectsData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:var(--space-4); text-align:center; color:var(--text-secondary);">No subjects tracked yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = subjectsData.map(s => {
    return `
      <tr style="border-bottom:1px solid var(--border-color);">
        <td style="padding:var(--space-3); font-weight:600;">${escapeHtml(s.name)}</td>
        <td style="padding:var(--space-3); text-align:center; font-weight:700;">${s.currentPct}%</td>
        <td style="padding:var(--space-3); text-align:center; color:var(--text-secondary);">${s.target}%</td>
        <td style="padding:var(--space-3); text-align:center;">
          <span style="color:${getRiskColor(s.riskLevel)}; font-weight:700;">${s.status}</span>
        </td>
        <td style="padding:var(--space-3); text-align:center; color:var(--color-success); font-weight:600;">${s.safeBunks}</td>
        <td style="padding:var(--space-3); text-align:center; color:var(--color-danger); font-weight:600;">${s.needed}</td>
        <td style="padding:var(--space-3); text-align:center; font-weight:700; color:var(--color-primary-light);">${s.projectedSemesterPct}%</td>
        <td style="padding:var(--space-3); text-align:center; font-weight:600;">${s.trend}</td>
      </tr>
    `;
  }).join('');
}

function getRiskColor(risk) {
  if (risk === 'Green') return 'var(--color-success)';
  if (risk === 'Yellow') return 'var(--color-warning)';
  if (risk === 'Orange') return 'var(--color-secondary-light)';
  return 'var(--color-danger-light)';
}

function escapeHtml(value = '') {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}
