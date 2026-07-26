/**
 * utils.js — Utility Functions
 *
 * Date helpers, formatters, math, color utilities,
 * DOM helpers, and general-purpose functions.
 */

/* ─────────────────────────────────────────────────────────────
   DATE & TIME
   ───────────────────────────────────────────────────────────── */

/** ISO date string for today: "YYYY-MM-DD" */
export function today() {
  return new Date().toISOString().split('T')[0];
}

/** Format a Date object or ISO string to "Mon, 21 Jul" */
export function formatDateShort(dateInput) {
  const d = new Date(dateInput);
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Format to full: "Monday, 21 July 2026" */
export function formatDateFull(dateInput) {
  const d = new Date(dateInput);
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Format to "Jul 2026" */
export function formatMonthYear(dateInput) {
  const d = new Date(dateInput);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Format to "HH:MM AM/PM" */
export function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Day of week index from ISO date string (0=Sun, 1=Mon … 6=Sat) */
export function getDayIndex(dateStr) {
  return new Date(dateStr).getDay();
}

/** Day name from index */
export const DAY_NAMES      = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const DAY_SHORT      = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export const MONTH_NAMES    = ['January','February','March','April','May','June',
                               'July','August','September','October','November','December'];
export const MONTH_SHORT    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function getDayName(index) { return DAY_NAMES[index]; }
export function getDayShort(index) { return DAY_SHORT[index]; }

/** Get ISO dates for a given month (YYYY-MM) */
export function getDatesInMonth(year, month) {
  const dates = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    dates.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** Difference in days between two ISO dates */
export function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

/** How many days ago was the date (returns "Today", "Yesterday", "3 days ago", etc.) */
export function timeAgo(dateStr) {
  const diff = daysBetween(dateStr, today());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)  return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)} week${diff >= 14 ? 's' : ''} ago`;
  return formatDateShort(dateStr);
}

/** Get the next N working days' ISO dates */
export function getUpcomingDays(n = 7) {
  const days = [];
  const d = new Date();
  while (days.length < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0) { // Skip Sundays (optional: also skip Sat)
      days.push(d.toISOString().split('T')[0]);
    }
  }
  return days;
}

/* ─────────────────────────────────────────────────────────────
   ATTENDANCE MATH
   ───────────────────────────────────────────────────────────── */

/**
 * Calculate attendance percentage.
 * Returns 0 if no classes held.
 */
export function calcPercentage(attended, total) {
  if (!total || total === 0) return 0;
  return Math.round((attended / total) * 100);
}

/**
 * How many classes can be bunked while maintaining target%.
 * Formula: floor((attended - target/100 * total) / (target/100))
 * Returns 0 if none can be bunked.
 */
export function calcSafeBunks(attended, total, target = 75) {
  const t = target / 100;
  const bunks = Math.floor((attended - t * total) / t);
  return Math.max(0, bunks);
}

/**
 * How many consecutive classes must be attended to reach target%.
 * Solve: (attended + x) / (total + x) >= target/100
 * x >= (target*total - 100*attended) / (100 - target)
 */
export function calcClassesNeeded(attended, total, target = 75) {
  const t = target / 100;
  const needed = Math.ceil((t * total - attended) / (1 - t));
  return Math.max(0, needed);
}

/**
 * Predict future percentage if student attends all remaining classes.
 */
export function predictPercentage(attended, total, futureClasses) {
  const newTotal    = total + futureClasses;
  const newAttended = attended + futureClasses;
  return calcPercentage(newAttended, newTotal);
}

/** Status label based on percentage */
export function getAttendanceStatus(pct) {
  if (pct >= 90) return { label: 'Excellent', color: 'var(--color-success)', icon: 'fa-star' };
  if (pct >= 75) return { label: 'Good',      color: 'var(--color-success)', icon: 'fa-check-circle' };
  if (pct >= 60) return { label: 'Average',   color: 'var(--color-warning)', icon: 'fa-exclamation-circle' };
  return           { label: 'Critical',   color: 'var(--color-danger)',  icon: 'fa-times-circle' };
}

/** Get progress bar color class based on percentage */
export function getProgressClass(pct, target = 75) {
  if (pct >= target)        return 'success';
  if (pct >= target * 0.85) return 'warning';
  return 'danger';
}

/* ─────────────────────────────────────────────────────────────
   STRING HELPERS
   ───────────────────────────────────────────────────────────── */

/** Capitalize first letter */
export function capitalize(str = '') {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/** Truncate string with ellipsis */
export function truncate(str = '', maxLen = 30) {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

/** Get initials from name (first 2 chars of words) */
export function getInitials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

/** Slugify string for IDs */
export function slugify(str = '') {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/** Sanitize HTML to prevent XSS */
export function sanitize(str = '') {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ─────────────────────────────────────────────────────────────
   NUMBER & FORMAT HELPERS
   ───────────────────────────────────────────────────────────── */

/** Format number with ordinal suffix: 1st, 2nd, 3rd, 4th … */
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Format number compactly: 1200 → "1.2K" */
export function formatCompact(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

/* ─────────────────────────────────────────────────────────────
   COLOR HELPERS
   ───────────────────────────────────────────────────────────── */

/** Subject color palette */
export const SUBJECT_COLORS = [
  '#6C63FF', '#FF6584', '#43C6AC', '#FF9800',
  '#29B6F6', '#AB47BC', '#EF5350', '#26A69A',
  '#FFA726', '#EC407A', '#5C6BC0', '#66BB6A'
];

/** Pick a default color for a subject by index */
export function defaultSubjectColor(index) {
  return SUBJECT_COLORS[index % SUBJECT_COLORS.length];
}

/** Convert hex to rgba */
export function hexToRgba(hex, alpha = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ─────────────────────────────────────────────────────────────
   DOM HELPERS
   ───────────────────────────────────────────────────────────── */

/** Query selector shorthand */
export const $ = (sel, parent = document) => parent.querySelector(sel);
export const $$ = (sel, parent = document) => [...parent.querySelectorAll(sel)];

/** Create element with attributes and children */
export function createElement(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') el.insertAdjacentHTML('beforeend', child);
    else if (child instanceof Node) el.appendChild(child);
  }
  return el;
}

/** Show / hide element */
export function show(el) { if (el) el.classList.remove('d-none'); }
export function hide(el) { if (el) el.classList.add('d-none'); }
export function toggle(el, condition) {
  if (el) el.classList.toggle('d-none', !condition);
}

/** Set text content safely */
export function setText(sel, text, parent = document) {
  const el = $(sel, parent);
  if (el) el.textContent = text;
}

/** Set inner HTML safely */
export function setHTML(sel, html, parent = document) {
  const el = $(sel, parent);
  if (el) el.innerHTML = html;
}

/* ─────────────────────────────────────────────────────────────
   LOCAL STORAGE HELPERS
   ───────────────────────────────────────────────────────────── */

export function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

export function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function lsRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

/* ─────────────────────────────────────────────────────────────
   FILE & EXPORT HELPERS
   ───────────────────────────────────────────────────────────── */

/** Trigger file download */
export function downloadFile(filename, content, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

/** Convert attendance records to CSV string */
export function toCSV(records, subjects) {
  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s.name]));
  const header = 'Subject,Date,Day,Status,Note\n';
  const rows = records.map(r => [
    `"${subjectMap[r.subjectId] || r.subjectId}"`,
    r.date,
    getDayName(getDayIndex(r.date)),
    r.status,
    `"${r.note || ''}"`
  ].join(','));
  return header + rows.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   DEBOUNCE / THROTTLE
   ───────────────────────────────────────────────────────────── */

export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function throttle(fn, limit = 200) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= limit) { last = now; fn(...args); }
  };
}

/* ─────────────────────────────────────────────────────────────
   RIPPLE EFFECT
   ───────────────────────────────────────────────────────────── */

export function addRipple(element) {
  element.addEventListener('click', function(e) {
    const ripple = document.createElement('span');
    ripple.className = 'ripple-effect';
    const rect = this.getBoundingClientRect();
    ripple.style.left = (e.clientX - rect.left) + 'px';
    ripple.style.top  = (e.clientY - rect.top) + 'px';
    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  });
}

/* ─────────────────────────────────────────────────────────────
   GENERATE UNIQUE ID
   ───────────────────────────────────────────────────────────── */

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/* ─────────────────────────────────────────────────────────────
   SORT HELPERS
   ───────────────────────────────────────────────────────────── */

export function sortByDate(arr, field = 'date', asc = true) {
  return [...arr].sort((a, b) => {
    const diff = a[field].localeCompare(b[field]);
    return asc ? diff : -diff;
  });
}

export function sortByName(arr, field = 'name') {
  return [...arr].sort((a, b) => a[field].localeCompare(b[field]));
}
