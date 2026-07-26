/**
 * wizard.js — Setup Wizard Logic
 *
 * Manages multi-step onboarding:
 * Step 1: Welcome
 * Step 2: Name
 * Step 3: College / Department
 * Step 4: Semester / Roll No
 * Step 5: Attendance Target
 * Step 6: Import Timetable OR Add Manually
 * Step 7: Finish / Confirmation
 */

import { getAllSubjects, getAllTimetable, saveProfile, saveSetting, saveSubject, saveTimetableSlot } from '../db.js';
import { SUBJECT_COLORS, defaultSubjectColor, DAY_NAMES } from '../utils.js';
import { toast } from '../notifications.js';
import { requestNotificationPermission } from '../pwa.js';

/* ─────────────────────────────────────────────────────────────
   STATE
   ───────────────────────────────────────────────────────────── */

const wizardData = {
  currentStep: 1,
  totalSteps: 7,
  name: '',
  college: '',
  department: '',
  semester: '',
  rollNo: '',
  attendanceTarget: 75,
  subjects: [],   // [{ name, code, color, faculty, day, startTime, endTime, room }]
  importMethod: null,
  importPreview: false,
  importPersisted: false,
};

/* ─────────────────────────────────────────────────────────────
   INIT
   ───────────────────────────────────────────────────────────── */

export function init() {
  buildProgress();
  bindStepEvents();
  initTargetSelector();
  initImportMethods();
}

/* ─────────────────────────────────────────────────────────────
   PROGRESS INDICATOR
   ───────────────────────────────────────────────────────────── */

function buildProgress() {
  const container = document.getElementById('wizard-progress');
  if (!container) return;

  let html = '';
  for (let i = 1; i <= wizardData.totalSteps; i++) {
    if (i > 1) {
      html += `<div class="wizard-step-line">
        <div class="wizard-step-line-fill" id="line-${i-1}"></div>
      </div>`;
    }
    html += `<div class="wizard-step-dot" id="dot-${i}" title="Step ${i}"></div>`;
  }
  container.innerHTML = html;
  updateProgress(1);
}

function updateProgress(step) {
  for (let i = 1; i <= wizardData.totalSteps; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (!dot) continue;
    dot.classList.remove('active', 'completed');
    if (i < step)  dot.classList.add('completed');
    if (i === step) dot.classList.add('active');
  }
  // Fill lines
  for (let i = 1; i < wizardData.totalSteps; i++) {
    const line = document.getElementById(`line-${i}`);
    if (line) line.style.width = i < step ? '100%' : '0%';
  }
}

/* ─────────────────────────────────────────────────────────────
   NAVIGATION
   ───────────────────────────────────────────────────────────── */

function goToStep(step) {
  const current = document.getElementById(`step-${wizardData.currentStep}`);
  const next    = document.getElementById(`step-${step}`);
  if (!next) return;

  // Hide current with slide-out
  if (current) {
    current.style.animation = 'slideInLeft 0.3s ease reverse forwards';
    setTimeout(() => {
      current.classList.add('d-none');
      current.style.animation = '';
    }, 280);
  }

  // Show next with slide-in
  setTimeout(() => {
    next.classList.remove('d-none');
    next.style.animation = 'wizardSlideIn 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards';
  }, 150);

  wizardData.currentStep = step;
  updateProgress(step);

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Focus first input on the new step
  setTimeout(() => {
    const firstInput = next.querySelector('input:not([type="hidden"]):not([type="checkbox"]), select');
    firstInput?.focus();
  }, 500);
}

/* ─────────────────────────────────────────────────────────────
   BIND EVENTS
   ───────────────────────────────────────────────────────────── */

function bindStepEvents() {
  // Step 1 — Welcome
  btn('step1-next', () => goToStep(2));

  // Step 2 — Name
  btn('step2-back', () => goToStep(1));
  btn('step2-next', () => {
    const name = val('input-name').trim();
    if (!name) { showError('error-name'); return; }
    hideError('error-name');
    wizardData.name = name;
    goToStep(3);
  });
  onEnter('input-name', 'step2-next');

  // Step 3 — College
  btn('step3-back', () => goToStep(2));
  btn('step3-next', () => {
    wizardData.college    = val('input-college').trim() || 'My College';
    wizardData.department = val('input-department').trim();
    goToStep(4);
  });

  // Step 4 — Semester
  btn('step4-back', () => goToStep(3));
  btn('step4-next', () => {
    const semester = val('input-semester');
    if (!semester) { showError('error-semester'); return; }
    hideError('error-semester');
    wizardData.semester = semester;
    wizardData.rollNo   = val('input-rollno').trim();
    goToStep(5);
  });

  // Step 5 — Target (handled by initTargetSelector)
  btn('step5-back', () => goToStep(4));
  btn('step5-next', () => {
    wizardData.attendanceTarget = parseInt(document.getElementById('final-target').value) || 75;
    goToStep(6);
  });

  // Step 6 — Import
  btn('step6-back', () => goToStep(5));
  btn('step6-next', async () => {
    const saved = await persistWizardSubjects();
    if (!saved) return;

    wizardData.importPersisted = true;
    goToStep(7);
    buildSummary();
  });

  // Step 7 — Finish
  btn('finish-btn', finishSetup);
}

/* ─────────────────────────────────────────────────────────────
   STEP 5 — TARGET SELECTOR
   ───────────────────────────────────────────────────────────── */

function initTargetSelector() {
  const options    = document.querySelectorAll('.target-option');
  const slider     = document.getElementById('target-slider');
  const sliderVal  = document.getElementById('slider-val');
  const customSec  = document.getElementById('target-custom-section');
  const finalInput = document.getElementById('final-target');

  // Select 75% by default
  options.forEach(opt => {
    if (opt.dataset.value === '75') opt.classList.add('selected');

    opt.addEventListener('click', () => {
      options.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');

      if (opt.dataset.value === 'custom') {
        customSec.classList.remove('d-none');
        finalInput.value = slider.value;
      } else {
        customSec.classList.add('d-none');
        finalInput.value = opt.dataset.value;
      }
    });
  });

  slider?.addEventListener('input', () => {
    sliderVal.textContent = slider.value;
    finalInput.value = slider.value;
  });
}

/* ─────────────────────────────────────────────────────────────
   STEP 6 — IMPORT METHODS
   ───────────────────────────────────────────────────────────── */

function initImportMethods() {
  const methods = document.querySelectorAll('.import-method-card');

  methods.forEach(card => {
    card.addEventListener('click', () => {
      methods.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      wizardData.importMethod = card.dataset.method;
      handleImportMethod(card.dataset.method);
    });
  });

  // File inputs
  fileInput('file-input-pdf',    handleFileImport);
  fileInput('file-input-image',  handleFileImport);
  fileInput('file-input-camera', handleFileImport);
}

function handleImportMethod(method) {
  hide('manual-subjects');
  wizardData.importPreview = false;
  wizardData.importPersisted = false;

  if (method === 'pdf') {
    document.getElementById('file-input-pdf').click();
  } else if (method === 'image') {
    document.getElementById('file-input-image').click();
  } else if (method === 'camera') {
    document.getElementById('file-input-camera').click();
  } else if (method === 'manual') {
    if (wizardData.importPreview || wizardData.subjects.length === 0) {
      wizardData.subjects = [createWizardSubject()];
    }
    show('manual-subjects');
    renderWizardSubjects();
  }
}

async function handleFileImport(file) {
  if (!file) return;

  showEl('import-processing');
  hide('manual-subjects');
  wizardData.importPersisted = false;

  setImportStatus('Analyzing file…', 10);

  try {
    let importedEntries = [];

    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      setImportStatus('Extracting text from PDF…', 30);
      const { extractPDFText } = await import('../features/pdfparse.js');
      const pdfResult = await extractPDFText(file);

      if (pdfResult.requiresOCR) {
        setImportStatus('PDF appears scanned. Running OCR…', 45);
        const { runOCR } = await import('../features/ocr.js');
        const ocrResult = await runOCR(file, (progress) => {
          setImportStatus(`OCR: ${Math.round(progress)}%…`, Math.max(45, Math.min(95, Math.round(45 + (progress * 0.5)))));
        });

        if (!ocrResult.success) {
          throw new Error(ocrResult.error || 'OCR failed.');
        }

        setImportStatus('Parsing OCR text…', 78);
        const { parseTimetable } = await import('../features/parser.js');
        const parsed = parseTimetable(ocrResult);
        if (!parsed.success) {
          throw new Error(parsed.error || 'No timetable detected.');
        }
        importedEntries = parsed.subjects || [];
      } else {
        if (!pdfResult.success) {
          throw new Error(pdfResult.error || 'Failed to read the PDF.');
        }

        setImportStatus('Parsing timetable structure…', 60);
        const { parseTimetable } = await import('../features/parser.js');
        const parsed = parseTimetable(pdfResult);
        if (!parsed.success) {
          throw new Error(parsed.error || 'No timetable detected.');
        }
        importedEntries = parsed.subjects || [];
      }
    } else {
      setImportStatus('Running OCR on image…', 20);
      const { runOCR } = await import('../features/ocr.js');
      const ocrResult = await runOCR(file, (p) => setImportStatus(`OCR: ${Math.round(p)}%…`, Math.max(20, Math.min(92, Math.round(20 + (p * 0.7))))));

      if (!ocrResult.success) {
        throw new Error(ocrResult.error || 'OCR failed.');
      }

      setImportStatus('Parsing timetable…', 70);
      const { parseTimetable } = await import('../features/parser.js');
      const parsed = parseTimetable(ocrResult);
      if (!parsed.success) {
        throw new Error(parsed.error || 'No timetable detected.');
      }
      importedEntries = parsed.subjects || [];
    }

    setImportStatus('Done!', 100);

    if (importedEntries.length > 0) {
      wizardData.subjects = importedEntries.map((entry, index) => createWizardSubject({
        ...entry,
        color: defaultSubjectColor(index),
      }));
      wizardData.importPreview = true;
      setTimeout(() => {
        hide('import-processing');
        show('manual-subjects');
        renderWizardSubjects();
        toast.success(`Found ${importedEntries.length} timetable rows. Please review and edit.`, 'Import Complete');
      }, 500);
    } else {
      hide('import-processing');
      show('manual-subjects');
      wizardData.importPreview = false;
      wizardData.subjects = [createWizardSubject()];
      renderWizardSubjects();
      toast.warning('Could not auto-detect subjects. Please add them manually.', 'Manual Entry');
    }
  } catch (err) {
    console.error('[Import] Error:', err);
    hide('import-processing');
    show('manual-subjects');
    wizardData.importPreview = false;
    wizardData.subjects = [createWizardSubject()];
    renderWizardSubjects();
    toast.error(err?.message ? err.message : 'Import failed. Please add subjects manually.', 'Import Error');
  }
}

function setImportStatus(msg, pct) {
  const statusEl = document.getElementById('import-status');
  const barEl    = document.getElementById('import-progress-bar');
  if (statusEl) statusEl.textContent = msg;
  if (barEl)    barEl.style.width = pct + '%';
}

/* ── Wizard Subject Management ─────────────────────────────── */

function createWizardSubject(data = {}) {
  return {
    name: data.name || '',
    code: data.code || '',
    faculty: data.faculty || '',
    room: data.room || '',
    day: Number(data.day) || 1,
    startTime: data.startTime || '',
    endTime: data.endTime || '',
    color: data.color || defaultSubjectColor(wizardData.subjects.length),
    _id: data._id || Date.now() + Math.random(),
  };
}

function addWizardSubject() {
  wizardData.subjects.push(createWizardSubject());
}

function renderWizardSubjects() {
  const container = document.getElementById('subject-list-wizard');
  if (!container) return;

  renderImportSummary();
  updateImportActionLabel();

  container.innerHTML = '';

  wizardData.subjects.forEach((sub, idx) => {
    const row = document.createElement('div');
    row.className = 'card';
    row.style.cssText = 'padding:var(--space-4);margin-bottom:var(--space-3);animation:slideInUp 0.3s ease both';
    row.style.animationDelay = `${idx * 0.05}s`;
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3)">
        <div class="color-swatch active" data-idx="${idx}"
          style="background:${sub.color};border-color:white;cursor:pointer"
          title="Change color"></div>
        <input
          class="form-input flex-1"
          placeholder="Subject Name *"
          value="${esc(sub.name)}"
          data-field="name"
          data-idx="${idx}"
          style="padding:10px 14px"
        />
        <button class="btn btn-icon" data-remove="${idx}" title="Remove subject" style="color:var(--color-danger);border-color:rgba(244,67,54,0.2)">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-2)">
        <input
          class="form-input"
          placeholder="Subject Code"
          value="${esc(sub.code)}"
          data-field="code"
          data-idx="${idx}"
          style="padding:8px 12px;font-size:13px"
        />
        <input
          class="form-input"
          placeholder="Faculty Name"
          value="${esc(sub.faculty)}"
          data-field="faculty"
          data-idx="${idx}"
          style="padding:8px 12px;font-size:13px"
        />
      </div>
      ${wizardData.importPreview ? `
        <div style="display:grid;grid-template-columns:1.1fr 1fr 1fr 1fr;gap:var(--space-2);margin-top:var(--space-3)">
          <select class="form-input" data-field="day" data-idx="${idx}" style="padding:8px 12px;font-size:13px">
            ${DAY_NAMES.slice(1, 7).map((day, dayIndex) => `<option value="${dayIndex + 1}" ${Number(sub.day) === (dayIndex + 1) ? 'selected' : ''}>${day}</option>`).join('')}
          </select>
          <input
            class="form-input"
            type="time"
            placeholder="Start Time"
            value="${esc(sub.startTime)}"
            data-field="startTime"
            data-idx="${idx}"
            style="padding:8px 12px;font-size:13px"
          />
          <input
            class="form-input"
            type="time"
            placeholder="End Time"
            value="${esc(sub.endTime)}"
            data-field="endTime"
            data-idx="${idx}"
            style="padding:8px 12px;font-size:13px"
          />
          <input
            class="form-input"
            placeholder="Room"
            value="${esc(sub.room)}"
            data-field="room"
            data-idx="${idx}"
            style="padding:8px 12px;font-size:13px"
          />
        </div>
      ` : ''}
    `;
    container.appendChild(row);
  });

  // Bind input events
  container.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx   = parseInt(e.target.dataset.idx);
      const field = e.target.dataset.field;
      if (wizardData.subjects[idx]) {
        wizardData.subjects[idx][field] = field === 'day' ? Number(e.target.value) : e.target.value;
      }
    });
  });

  // Bind remove buttons
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.dataset.remove);
      wizardData.subjects.splice(idx, 1);
      renderWizardSubjects();
    });
  });

  // Bind color swatches (cycle through colors)
  container.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      const idx = parseInt(swatch.dataset.idx);
      const currentColorIdx = SUBJECT_COLORS.indexOf(wizardData.subjects[idx].color);
      const nextColorIdx    = (currentColorIdx + 1) % SUBJECT_COLORS.length;
      wizardData.subjects[idx].color = SUBJECT_COLORS[nextColorIdx];
      renderWizardSubjects();
    });
  });
}

function renderImportSummary() {
  const container = document.getElementById('manual-subjects');
  if (!container) return;

  let summary = document.getElementById('import-preview-summary');
  if (!wizardData.importPreview) {
    summary?.remove();
    return;
  }

  if (!summary) {
    summary = document.createElement('div');
    summary.id = 'import-preview-summary';
    summary.className = 'card';
    summary.style.cssText = 'padding:var(--space-4);margin-bottom:var(--space-4)';
    const list = document.getElementById('subject-list-wizard');
    container.insertBefore(summary, list);
  }

  const total = wizardData.subjects.length;
  const scheduleCount = wizardData.subjects.filter((subject) => subject.startTime && subject.endTime).length;

  summary.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap">
      <div>
        <div style="font-weight:700;font-size:15px;color:var(--text-primary)">Detected Timetable</div>
        <div style="font-size:13px;color:var(--text-secondary)">${total} rows ready for review · ${scheduleCount} with time slots</div>
      </div>
      <div style="font-size:12px;color:var(--text-tertiary)">Edit anything before confirming import</div>
    </div>
  `;
}

function updateImportActionLabel() {
  const button = document.getElementById('step6-next');
  if (!button) return;

  button.innerHTML = wizardData.importPreview
    ? '<i class="fa-solid fa-circle-check"></i> Confirm Import'
    : 'Continue <i class="fa-solid fa-arrow-right"></i>';
}

async function persistWizardSubjects() {
  const entries = wizardData.subjects
    .map((subject) => normalizeWizardSubject(subject))
    .filter((subject) => subject.name);

  if (!entries.length) {
    toast.warning('Please add at least one subject before continuing.', 'No Subjects');
    return false;
  }

  const [existingSubjects, existingTimetable] = await Promise.all([
    getAllSubjects(),
    getAllTimetable(),
  ]);

  const subjectLookup = new Map();
  existingSubjects.forEach((subject) => {
    for (const key of buildSubjectKeys(subject)) {
      subjectLookup.set(key, subject);
    }
  });

  const timetableKeys = new Set(existingTimetable.map((slot) => buildTimetableKey(slot)));
  let addedSubjects = 0;
  let updatedSubjects = 0;
  let addedSlots = 0;
  let duplicateSlots = 0;

  for (const entry of entries) {
    const subjectKey = buildSubjectKeys(entry).find((key) => subjectLookup.has(key));
    let subject = subjectKey ? subjectLookup.get(subjectKey) : null;

    if (subject) {
      const merged = {
        ...subject,
        name: subject.name || entry.name,
        code: subject.code || entry.code,
        faculty: subject.faculty || entry.faculty,
        color: subject.color || entry.color || defaultSubjectColor(subjectLookup.size),
      };

      const needsUpdate = ['name', 'code', 'faculty', 'color'].some((field) => String(merged[field] || '') !== String(subject[field] || ''));
      if (needsUpdate) {
        await saveSubject(merged);
        updatedSubjects += 1;
        subject = merged;
      }
    } else {
      const subjectId = await saveSubject({
        name: entry.name,
        code: entry.code,
        faculty: entry.faculty,
        color: entry.color || defaultSubjectColor(subjectLookup.size + addedSubjects),
      });

      subject = {
        id: subjectId,
        name: entry.name,
        code: entry.code,
        faculty: entry.faculty,
        color: entry.color || defaultSubjectColor(subjectLookup.size + addedSubjects),
      };
      for (const key of buildSubjectKeys(subject)) {
        subjectLookup.set(key, subject);
      }
      addedSubjects += 1;
    }

    if (hasValidSchedule(entry) && subject?.id) {
      const slot = {
        subjectId: subject.id,
        day: Number(entry.day),
        startTime: normalizeTime(entry.startTime),
        endTime: normalizeTime(entry.endTime),
        room: entry.room || '',
      };

      if (isValidSlot(slot)) {
        const slotKey = buildTimetableKey(slot);
        if (timetableKeys.has(slotKey)) {
          duplicateSlots += 1;
        } else {
          await saveTimetableSlot(slot);
          timetableKeys.add(slotKey);
          addedSlots += 1;
        }
      }
    }
  }

  const importedCount = addedSubjects + updatedSubjects;
  if (addedSubjects || updatedSubjects || addedSlots) {
    toast.success(`${addedSubjects} new subjects, ${updatedSubjects} updated, ${addedSlots} timetable slots saved.`, 'Import Successful');
  }

  if (duplicateSlots > 0) {
    toast.warning(`${duplicateSlots} duplicate timetable slots were ignored.`, 'Duplicates Ignored');
  }

  if (!importedCount && !addedSlots) {
    toast.warning('No new records were saved.', 'Nothing to Import');
  }

  wizardData.importPersisted = true;
  return true;
}

// "Add Subject" button
document.addEventListener('click', (e) => {
  if (e.target.closest('#add-subject-wizard')) {
    addWizardSubject();
    renderWizardSubjects();
    // Scroll to bottom of list
    setTimeout(() => {
      const list = document.getElementById('subject-list-wizard');
      list?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
  }
});

/* ─────────────────────────────────────────────────────────────
   STEP 7 — SUMMARY
   ───────────────────────────────────────────────────────────── */

function buildSummary() {
  const grid = document.getElementById('wizard-summary');
  if (!grid) return;

  grid.innerHTML = `
    <div class="wizard-summary-item">
      <div class="wizard-summary-label">Name</div>
      <div class="wizard-summary-value">${esc(wizardData.name || '—')}</div>
    </div>
    <div class="wizard-summary-item">
      <div class="wizard-summary-label">College</div>
      <div class="wizard-summary-value">${esc(wizardData.college || '—')}</div>
    </div>
    <div class="wizard-summary-item">
      <div class="wizard-summary-label">Semester</div>
      <div class="wizard-summary-value">${ordinal(wizardData.semester)} Semester</div>
    </div>
    <div class="wizard-summary-item">
      <div class="wizard-summary-label">Target</div>
      <div class="wizard-summary-value">${wizardData.attendanceTarget}%</div>
    </div>
    <div class="wizard-summary-item" style="grid-column:1/-1">
      <div class="wizard-summary-label">Subjects Added</div>
      <div class="wizard-summary-value">${wizardData.subjects.filter(s => s.name.trim()).length} subjects</div>
    </div>
  `;
}

/* ─────────────────────────────────────────────────────────────
   FINISH — SAVE TO DB
   ───────────────────────────────────────────────────────────── */

async function finishSetup() {
  const finishBtn = document.getElementById('finish-btn');
  if (finishBtn) finishBtn.disabled = true;
  finishBtn?.classList.add('loading');

  try {
    if (!wizardData.importPersisted) {
      const saved = await persistWizardSubjects();
      if (!saved) {
        if (finishBtn) finishBtn.disabled = false;
        finishBtn?.classList.remove('loading');
        return;
      }
    }

    // Save profile
    await saveProfile({
      name:             wizardData.name,
      college:          wizardData.college,
      department:       wizardData.department,
      semester:         wizardData.semester,
      rollNo:           wizardData.rollNo,
      attendanceTarget: wizardData.attendanceTarget,
      setupAt:          new Date().toISOString(),
    });

    // Save attendance target as setting too
    await saveSetting('attendanceTarget', wizardData.attendanceTarget);
    await saveSetting('theme', 'dark');

    // Request notifications if checked
    const notifCheck = document.getElementById('enable-notifications');
    if (notifCheck?.checked) {
      await requestNotificationPermission();
      await saveSetting('notificationsEnabled', true);
    }

    // Navigate to dashboard
    toast.success('Setup complete! Welcome to BunkWise 🎉');
    setTimeout(() => {
      window.location.href = './dashboard.html';
    }, 800);

  } catch (err) {
    console.error('[Wizard] Setup failed:', err);
    toast.error('Failed to save setup. Please try again.');
    if (finishBtn) finishBtn.disabled = false;
    finishBtn?.classList.remove('loading');
  }
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────── */

function btn(id, handler) {
  document.getElementById(id)?.addEventListener('click', handler);
}

function val(id) {
  return document.getElementById(id)?.value || '';
}

function showEl(id) {
  document.getElementById(id)?.classList.remove('d-none');
}

function show(id) { document.getElementById(id)?.classList.remove('d-none'); }
function hide(id) { document.getElementById(id)?.classList.add('d-none'); }

function showError(id) {
  document.getElementById(id)?.classList.remove('d-none');
}

function hideError(id) {
  document.getElementById(id)?.classList.add('d-none');
}

function onEnter(inputId, btnId) {
  document.getElementById(inputId)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById(btnId)?.click();
  });
}

function fileInput(id, handler) {
  document.getElementById(id)?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handler(file);
    e.target.value = '';
  });
}

function esc(str = '') {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function ordinal(n) {
  const num = parseInt(n);
  const s = ['th','st','nd','rd'];
  const v = num % 100;
  return num + (s[(v-20)%10] || s[v] || s[0]);
}

function normalizeWizardSubject(subject) {
  return {
    ...subject,
    name: String(subject.name || '').trim(),
    code: String(subject.code || '').trim(),
    faculty: String(subject.faculty || '').trim(),
    room: String(subject.room || '').trim(),
    day: Number(subject.day) || 0,
    startTime: normalizeTime(subject.startTime),
    endTime: normalizeTime(subject.endTime),
    color: String(subject.color || '').trim() || defaultSubjectColor(0),
  };
}

function buildSubjectKeys(subject) {
  const keys = [];
  const code = String(subject.code || '').trim().toLowerCase();
  const name = String(subject.name || '').trim().toLowerCase();

  if (code) keys.push(`code:${code}`);
  if (name) keys.push(`name:${name}`);
  return keys;
}

function buildTimetableKey(slot) {
  return [
    slot.subjectId,
    Number(slot.day) || 0,
    normalizeTime(slot.startTime),
    normalizeTime(slot.endTime),
    String(slot.room || '').trim().toLowerCase(),
  ].join('|');
}

function hasValidSchedule(entry) {
  return Number(entry.day) >= 1 && Number(entry.day) <= 6 && Boolean(normalizeTime(entry.startTime) && normalizeTime(entry.endTime));
}

function isValidSlot(slot) {
  return Boolean(slot.subjectId && slot.day >= 1 && slot.day <= 6 && slot.startTime && slot.endTime && slot.startTime < slot.endTime);
}

function normalizeTime(value = '') {
  const text = String(value).trim();
  if (!text) return '';

  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return '';

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toUpperCase() || '';

  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (!meridiem && hour < 8) hour += 12;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
