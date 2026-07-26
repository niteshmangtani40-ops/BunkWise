/**
 * calculator.js — Bunk Calculator Logic
 */
import { getAllSubjects, getAllAttendance, getAllTimetable, getProfile, getAllSettings } from '../db.js';
import { calcPercentage, calcSafeBunks, calcClassesNeeded, getAttendanceStatus, getProgressClass, predictPercentage, today, getDayIndex, getDatesInMonth } from '../utils.js';
import { showToast } from '../notifications.js';

let _subjects = [];
let _attendance = [];
let _timetable = [];
let _profile = null;
let _target = 75;

export async function init() {
  try {
    await loadData();
    setupEvents();
    calculate();
    renderPredictionCards();
    renderSimulator();
    renderSubjectPredictions();
    applySubjectQuery();
  } catch (error) {
    console.error('[Calculator] Init failed:', error);
    showToast('Calculator could not load', 'error');
  }
}
export async function refresh() {
    await loadData();
    calculate();
    renderPredictionCards();
    renderSimulator();
    renderSubjectPredictions();
    applySubjectQuery();
}
async function loadData() {
  const [prof, set, subjects, attendance, timetable] = await Promise.all([
    getProfile(),
    getAllSettings(),
    getAllSubjects(),
    getAllAttendance(),
    getAllTimetable(),
  ]);

  _profile = prof;
  _target = Number(prof?.attendanceTarget || set?.attendanceTarget || 75);
  _subjects = subjects;
  _attendance = attendance;
  _timetable = timetable;

  document.getElementById('calc-target').value = _target;

  const sel = document.getElementById('calc-subject-select');
  sel.innerHTML = '<option value="">-- Choose a subject --</option>' + _subjects
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((subject) => `<option value="${subject.id}">${subject.name}</option>`)
    .join('');
}

function setupEvents() {
  ['calc-attended', 'calc-total', 'calc-target'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      calculate();
      renderPredictionCards();
    });
  });
  
  document.getElementById('calc-subject-select').addEventListener('change', (e) => {
    const id = Number(e.target.value);
    if (!id) return;
    const sub = _subjects.find(s => s.id === id);
    if (sub) {
      document.getElementById('calc-attended').value = sub.attendedClasses || 0;
      document.getElementById('calc-total').value = sub.totalClasses || 0;
      calculate();
      renderPredictionCards();
      renderSubjectPredictions();
    }
  });

  const lecturesSlider = document.getElementById('sim-lectures');
  const absencesSlider = document.getElementById('sim-absences');
  lecturesSlider.addEventListener('input', renderSimulator);
  absencesSlider.addEventListener('input', renderSimulator);

  window.addEventListener('bunkwise:data-changed', (event) => {
    if (['attendance', 'subjects', 'timetable', 'profile', 'reset'].includes(event.detail?.source)) {
      void loadData().then(() => {
        calculate();
        renderPredictionCards();
        renderSimulator();
        renderSubjectPredictions();
      });
    }
  });
}

function calculate() {
  const attended = parseInt(document.getElementById('calc-attended').value) || 0;
  const total = parseInt(document.getElementById('calc-total').value) || 0;
  const target = parseInt(document.getElementById('calc-target').value) || _target || 75;
  const riskEl = document.getElementById('calc-risk');
  const gaugeEl = document.getElementById('calc-gauge');
  const suggestionEl = document.getElementById('calc-suggestions');
  const expectedEl = document.getElementById('calc-expected');
  const safeBunksEl = document.getElementById('calc-safe-bunks');
  
  const valEl = document.getElementById('calc-res-val');
  const msgEl = document.getElementById('calc-res-msg');
  
  if (total === 0) {
    valEl.textContent = '—';
    msgEl.textContent = 'Enter your stats above.';
    setMeta(null, null, riskEl, gaugeEl, suggestionEl);
    setText('calc-expected', '—');
    setText('calc-safe-bunks', '—');
    return;
  }
  
  if (attended > total) {
    valEl.textContent = 'Err';
    msgEl.textContent = 'Attended classes cannot be more than total classes.';
    setMeta(null, null, riskEl, gaugeEl, suggestionEl, true);
    return;
  }
  
  const pct = calcPercentage(attended, total);
  const status = getAttendanceStatus(pct);
  const safeBunks = calcSafeBunks(attended, total, target);
  const needed = calcClassesNeeded(attended, total, target);
  const progressClass = getProgressClass(pct, target);
  const risk = getRiskLabel(pct, target);
  const expected = total ? calcPercentage(attended + 5, total + 5) : 0;
  setText('calc-expected', `${expected}%`);
  setText('calc-safe-bunks', String(Math.max(0, safeBunks)));
  
  if (pct >= target) {
    if (safeBunks > 0) {
      valEl.textContent = safeBunks;
      valEl.style.background = 'var(--gradient-success)';
      valEl.style.webkitBackgroundClip = 'text';
      msgEl.textContent = `You can safely bunk ${safeBunks} class${safeBunks>1?'es':''} and maintain ${target}%.`;
    } else {
      valEl.textContent = 'On Track';
      valEl.style.background = 'var(--gradient-primary)';
      valEl.style.webkitBackgroundClip = 'text';
      msgEl.textContent = `You have exactly ${pct}%. Bunking the next class will drop you below target.`;
    }
  } else {
    valEl.textContent = needed;
    valEl.style.background = 'var(--gradient-danger)';
    valEl.style.webkitBackgroundClip = 'text';
    msgEl.textContent = `You need to attend ${needed} more class${needed>1?'es':''} to reach ${target}%.`;
  }

  setMeta({ pct, target, safeBunks, needed, risk, expected, status, progressClass }, null, riskEl, gaugeEl, suggestionEl);
}

function setMeta(data, _, riskEl, gaugeEl, suggestionEl, isError = false) {
  if (riskEl) riskEl.textContent = isError ? 'Invalid input' : (data?.risk || '—');
  if (gaugeEl) {
    gaugeEl.style.width = data ? `${Math.min(data.pct, 100)}%` : '0%';
    gaugeEl.className = `progress-bar animated ${data?.progressClass || 'danger'}`;
  }
  if (suggestionEl) {
    if (!data) {
      suggestionEl.textContent = 'Enter attendance stats to see a prediction.';
    } else if (data.pct >= data.target) {
      suggestionEl.textContent = `Expected attendance if you attend 5 more classes: ${data.expected}%.`;
    } else {
      suggestionEl.textContent = `${data.needed} more classes needed. Attendance status: ${data.status.label}.`;
    }
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderPredictionCards() {
  const container = document.getElementById('prediction-cards');
  if (!container) return;

  const attended = parseInt(document.getElementById('calc-attended').value) || 0;
  const total = parseInt(document.getElementById('calc-total').value) || 0;
  const target = parseInt(document.getElementById('calc-target').value) || _target || 75;
  const remaining = estimateRemainingLectures();
  const trend = getTrendPercentage();
  const trendFutureAttended = Math.round(remaining * (trend / 100));

  const scenarios = [
    { title: 'Attend next 5', value: predictPercentage(attended, total, 5), note: 'If you attend the next 5 lectures.' },
    { title: 'Attend next 10', value: predictPercentage(attended, total, 10), note: 'If you attend the next 10 lectures.' },
    { title: 'Miss tomorrow', value: calcPercentage(attended, total + 1), note: 'One missed lecture tomorrow.' },
    { title: 'Miss this week', value: calcPercentage(attended, total + 5), note: 'Assuming 5 missed lectures.' },
    { title: 'All remaining', value: remaining ? calcPercentage(attended + remaining, total + remaining) : calcPercentage(attended, total), note: `${remaining} scheduled lectures remaining this month.` },
    { title: 'Maintain trend', value: remaining ? calcPercentage(attended + trendFutureAttended, total + remaining) : calcPercentage(attended, total), note: `Current 7-day trend (${trend}%) projected forward.` },
  ];

  container.innerHTML = scenarios.map((scenario) => {
    const risk = getRiskLabel(scenario.value, target);
    return `
      <div class="prediction-card">
        <div class="prediction-card-title">${scenario.title}</div>
        <div class="prediction-card-value" style="color:${risk.color}">${scenario.value}%</div>
        <div class="progress-bar-container" style="margin-top:var(--space-3)"><div class="progress-bar animated ${risk.progressClass}" style="width:${Math.min(scenario.value,100)}%"></div></div>
        <div class="prediction-card-sub">${scenario.note}</div>
      </div>
    `;
  }).join('');

  const insight = document.getElementById('prediction-insight');
  if (insight) {
    const bunks = calcSafeBunks(attended, total, target);
    const attendNeeded = calcClassesNeeded(attended, total, target);
    insight.innerHTML = `${bunks > 0 ? `You can safely bunk ${bunks} more classes.` : `No safe bunks remain at the moment.`} ${attendNeeded > 0 ? `Attend the next ${attendNeeded} lectures to reach ${target}%.` : `You are already at or above your target.`}`;
  }
}

function renderSimulator() {
  const lecturesSlider = document.getElementById('sim-lectures');
  const absencesSlider = document.getElementById('sim-absences');
  const lecturesVal = Number(lecturesSlider.value);
  const absencesVal = Number(absencesSlider.value);
  const attended = parseInt(document.getElementById('calc-attended').value) || 0;
  const total = parseInt(document.getElementById('calc-total').value) || 0;

  const safeAbsences = Math.min(absencesVal, lecturesVal);
  const simulatedPct = total + lecturesVal > 0 ? calcPercentage(attended + lecturesVal - safeAbsences, total + lecturesVal) : 0;
  const risk = getRiskLabel(simulatedPct, _target);

  setText('sim-lectures-val', String(lecturesVal));
  setText('sim-absences-val', String(absencesVal));
  setText('sim-result', `${simulatedPct}%`);
  setText('sim-result-sub', `${lecturesVal} future lectures, ${safeAbsences} absences. ${risk.label}.`);

  const bar = document.getElementById('sim-result-bar');
  if (bar) {
    bar.style.width = `${Math.min(simulatedPct, 100)}%`;
    bar.className = `progress-bar animated ${risk.progressClass}`;
  }
}

function renderSubjectPredictions() {
  const container = document.getElementById('subject-predictions');
  if (!container) return;

  if (_subjects.length === 0) {
    container.innerHTML = '<div class="prediction-insight">No subjects available yet.</div>';
    return;
  }

  container.innerHTML = _subjects.slice().sort((a, b) => getSubjectPct(a) - getSubjectPct(b)).map((subject) => {
    const pct = getSubjectPct(subject);
    const status = getAttendanceStatus(pct);
    const safeBunks = calcSafeBunks(subject.attendedClasses || 0, subject.totalClasses || 0, _target);
    const mustAttend = calcClassesNeeded(subject.attendedClasses || 0, subject.totalClasses || 0, _target);
    const predicted = predictPercentage(subject.attendedClasses || 0, subject.totalClasses || 0, 5);
    const diff = pct - _target;
    const risk = getRiskLabel(pct, _target);

    return `
      <article class="prediction-subject-card">
        <div class="prediction-subject-top">
          <div>
            <div class="prediction-subject-name">${subject.name}</div>
            <div class="prediction-subject-meta">${subject.code || 'No code'} • ${subject.faculty || 'Faculty not set'}</div>
          </div>
          <span class="prediction-status-chip" style="color:${risk.color};background:${risk.bg}">${risk.label}</span>
        </div>
        <div class="prediction-subject-grid">
          <div class="prediction-subject-stat"><span>Current</span><strong>${pct}%</strong></div>
          <div class="prediction-subject-stat"><span>Target</span><strong>${_target}%</strong></div>
          <div class="prediction-subject-stat"><span>Safe Bunks</span><strong>${safeBunks}</strong></div>
          <div class="prediction-subject-stat"><span>Predicted</span><strong>${predicted}%</strong></div>
          <div class="prediction-subject-stat"><span>Must Attend</span><strong>${mustAttend}</strong></div>
          <div class="prediction-subject-stat"><span>Target Diff</span><strong>${diff >= 0 ? '+' : ''}${diff}%</strong></div>
        </div>
        <div class="prediction-bars">
          <div class="prediction-bar"><div class="progress-bar ${getProgressClass(pct, _target)}" style="width:${Math.min(pct, 100)}%"></div></div>
          <div class="prediction-bar"><div class="progress-bar ${getProgressClass(predicted, _target)}" style="width:${Math.min(predicted, 100)}%"></div></div>
        </div>
        <div class="prediction-card-sub" style="margin-top:10px">${status.label} attendance with ${subject.attendedClasses || 0}/${subject.totalClasses || 0} classes tracked.</div>
      </article>
    `;
  }).join('');
}

function applySubjectQuery() {
  const params = new URLSearchParams(window.location.search);
  const subjectId = params.get('subject');
  if (!subjectId) return;
  const select = document.getElementById('calc-subject-select');
  select.value = subjectId;
  select.dispatchEvent(new Event('change'));
}

function getSubjectPct(subject) {
  return calcPercentage(subject.attendedClasses || 0, subject.totalClasses || 0);
}

function getTrendPercentage() {
  const end = today();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const startIso = start.toISOString().split('T')[0];
  const recent = _attendance.filter((record) => record.date >= startIso && record.date <= end && ['present', 'absent'].includes(record.status));
  const present = recent.filter((record) => record.status === 'present').length;
  return recent.length ? calcPercentage(present, recent.length) : _target;
}

function estimateRemainingLectures() {
  if (!_timetable.length) return 0;
  const dates = getDatesInMonth(new Date().getFullYear(), new Date().getMonth()).filter((date) => date >= today());
  let total = 0;
  dates.forEach((date) => {
    const day = getDayIndex(date);
    total += _timetable.filter((slot) => Number(slot.day) === day).length;
  });
  return total;
}

function getRiskLabel(pct, target) {
  if (pct >= 95) return { label: 'Low', color: 'var(--color-info)', bg: 'rgba(var(--color-info-rgb),0.12)', progressClass: 'success' };
  if (pct >= 85) return { label: 'Low', color: 'var(--color-success)', bg: 'rgba(var(--color-success-rgb),0.12)', progressClass: 'success' };
  if (pct >= 75) return { label: 'Medium', color: 'var(--color-warning)', bg: 'rgba(var(--color-warning-rgb),0.12)', progressClass: 'warning' };
  if (pct >= 65) return { label: 'High', color: '#FF9800', bg: 'rgba(255,152,0,0.12)', progressClass: 'warning' };
  return { label: 'Very High', color: 'var(--color-danger)', bg: 'rgba(var(--color-danger-rgb),0.12)', progressClass: 'danger' };
}
