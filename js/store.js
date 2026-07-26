/**
 * store.js — In-Memory Reactive State Store
 *
 * A lightweight observable store that holds the app's runtime
 * state and notifies subscribers on changes.
 * Backed by IndexedDB for persistence.
 */

import { openDB, getProfile as fetchProfile, getAllSubjects, getAllSettings, getAllTimetable } from './db.js';
import { lsGet } from './utils.js';

/* ─────────────────────────────────────────────────────────────
   STATE SHAPE
   ───────────────────────────────────────────────────────────── */

const _state = {
  // App lifecycle
  initialized: false,
  setupComplete: false,

  // User data
  profile: null,
  subjects: [],
  timetable: [],
  settings: {},

  // UI
  theme: 'dark',
  sidebarOpen: false,
  currentPage: '',

  // Notifications
  notificationsEnabled: false,
};

/* ─────────────────────────────────────────────────────────────
   SUBSCRIBERS
   ───────────────────────────────────────────────────────────── */

const _subscribers = new Map(); // key → Set of callbacks

/** Subscribe to state changes on a specific key (or '*' for any) */
export function subscribe(key, callback) {
  if (!_subscribers.has(key)) _subscribers.set(key, new Set());
  _subscribers.get(key).add(callback);

  // Return unsubscribe function
  return () => _subscribers.get(key)?.delete(callback);
}

/** Notify subscribers for a key */
function _notify(key, value) {
  _subscribers.get(key)?.forEach(cb => cb(value, _state));
  _subscribers.get('*')?.forEach(cb => cb(key, value, _state));
}

/* ─────────────────────────────────────────────────────────────
   STATE ACCESSORS
   ───────────────────────────────────────────────────────────── */

/** Get a state value */
export function getState(key) {
  return key ? _state[key] : { ..._state };
}

/** Set a single state value and notify subscribers */
export function setState(key, value) {
  if (_state[key] !== value) {
    _state[key] = value;
    _notify(key, value);
  }
}

/** Batch update multiple state keys */
export function batchSetState(updates) {
  for (const [key, value] of Object.entries(updates)) {
    _state[key] = value;
  }
  for (const key of Object.keys(updates)) {
    _notify(key, _state[key]);
  }
}

/* ─────────────────────────────────────────────────────────────
   INITIALIZATION
   ───────────────────────────────────────────────────────────── */

/**
 * Boot the app:
 * 1. Open IndexedDB
 * 2. Load profile, subjects, timetable, settings
 * 3. Determine if setup is complete
 * 4. Apply saved theme
 */
export async function initStore() {
  await openDB();

  // Load all data
  const [profile, subjects, settings, timetable] = await Promise.all([
    fetchProfile(),
    getAllSubjects(),
    getAllSettings(),
    getAllTimetable(),
  ]);

  // Apply theme from localStorage (fast, no DB needed)
  const theme = lsGet('theme', 'dark');

  batchSetState({
    initialized: true,
    profile,
    subjects,
    timetable,
    settings,
    theme,
    setupComplete: !!(profile && profile.name),
    currentPage: window.location.pathname.split('/').pop() || 'index.html',
  });

  // Apply theme to DOM
  applyTheme(theme);

  return _state;
}

/* ─────────────────────────────────────────────────────────────
   THEME
   ───────────────────────────────────────────────────────────── */

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  setState('theme', theme);
}

export function toggleTheme() {
  const newTheme = _state.theme === 'dark' ? 'light' : 'dark';
  import('./utils.js').then(({ lsSet }) => lsSet('theme', newTheme));
  applyTheme(newTheme);
  return newTheme;
}

/* ─────────────────────────────────────────────────────────────
   SUBJECT HELPERS (keep store in sync with DB)
   ───────────────────────────────────────────────────────────── */

export async function refreshSubjects() {
  const subjects = await getAllSubjects();
  setState('subjects', subjects);
  return subjects;
}

export async function refreshTimetable() {
  const timetable = await getAllTimetable();
  setState('timetable', timetable);
  return timetable;
}

export async function refreshProfile() {
  const profile = await fetchProfile();
  setState('profile', profile);
  return profile;
}

/* ─────────────────────────────────────────────────────────────
   CONVENIENCE GETTERS
   ───────────────────────────────────────────────────────────── */

export function getProfile() {
  return _state.profile;
}

export function getSubjects() {
  return _state.subjects;
}

export function getSubjectById(id) {
  return _state.subjects.find(s => s.id === id) || null;
}

export function getTimetable() {
  return _state.timetable;
}

export function getTimetableForDay(day) {
  return _state.timetable
    .filter(slot => slot.day === day)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}

export function getSetting(key, fallback = null) {
  return _state.settings[key] ?? fallback;
}

export function getAttendanceTarget() {
  return Number(_state.profile?.attendanceTarget || 75);
}

export function isSetupComplete() {
  return _state.setupComplete;
}
