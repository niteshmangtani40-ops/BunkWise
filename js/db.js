/**
 * db.js — IndexedDB Abstraction Layer
 *
 * Provides a clean promise-based API for all IndexedDB operations.
 * Database: SmartAttendanceDB v2
 *
 * Object Stores:
 *   profile     — user profile info
 *   subjects    — subjects/courses
 *   timetable   — weekly timetable slots
 *   attendance  — per-class attendance records
 *   settings    — app settings (key-value)
 *   statistics  — per-subject streaks
 *   backups     — manual backup snapshots
 */

import { calcPercentage } from './utils.js';

const DB_NAME    = 'SmartAttendanceDB';
const DB_VERSION = 2;
const ATTENDANCE_UNDO_KEY = 'attendanceUndoStack';

let _db = null;

/** Open (or upgrade) the IndexedDB database */
export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // ── profile ────────────────────────────────────────────
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id', autoIncrement: true });
      }

      // ── subjects ───────────────────────────────────────────
      if (!db.objectStoreNames.contains('subjects')) {
        const ss = db.createObjectStore('subjects', { keyPath: 'id', autoIncrement: true });
        ss.createIndex('name', 'name', { unique: false });
      }

      // ── timetable ──────────────────────────────────────────
      if (!db.objectStoreNames.contains('timetable')) {
        const ts = db.createObjectStore('timetable', { keyPath: 'id', autoIncrement: true });
        ts.createIndex('day', 'day', { unique: false });
        ts.createIndex('subjectId', 'subjectId', { unique: false });
      }

      // ── attendance ─────────────────────────────────────────
      if (!db.objectStoreNames.contains('attendance')) {
        const as = db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
        as.createIndex('subjectId', 'subjectId', { unique: false });
        as.createIndex('date', 'date', { unique: false });
        as.createIndex('subjectDate', ['subjectId', 'date'], { unique: true });
      }

      // ── settings ───────────────────────────────────────────
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // ── statistics ─────────────────────────────────────────
      if (!db.objectStoreNames.contains('statistics')) {
        const stts = db.createObjectStore('statistics', { keyPath: 'subjectId' });
        stts.createIndex('subjectId', 'subjectId', { unique: true });
      }

      // ── backups ────────────────────────────────────────────
      if (!db.objectStoreNames.contains('backups')) {
        const bs = db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
        bs.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    request.onerror    = (e) => reject(e.target.error);
  });
}

/** Get the open DB instance (call openDB first) */
export function getDB() {
  if (!_db) throw new Error('DB not initialized. Call openDB() first.');
  return _db;
}

/* ─────────────────────────────────────────────────────────────
   GENERIC CRUD HELPERS
   ───────────────────────────────────────────────────────────── */

/** Add a record and return the new id */
export function dbAdd(storeName, data) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).add({ ...data });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Put (upsert) a record */
export function dbPut(storeName, data) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put({ ...data });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Get a single record by key */
export function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx  = _db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Get all records from a store */
export function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx  = _db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Delete a record by key */
export function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx  = _db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Clear all records from a store */
export function dbClear(storeName) {
  return new Promise((resolve, reject) => {
    const tx  = _db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Get all records from a store matching an index value */
export function dbGetByIndex(storeName, indexName, value) {
  return new Promise((resolve, reject) => {
    const tx    = _db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req   = index.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Count all records in a store */
export function dbCount(storeName) {
  return new Promise((resolve, reject) => {
    const tx  = _db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/* ─────────────────────────────────────────────────────────────
   DOMAIN-SPECIFIC HELPERS
   ───────────────────────────────────────────────────────────── */

/** Profile */
export async function getProfile() {
  const all = await dbGetAll('profile');
  return all[0] || null;
}

export async function saveProfile(data) {
  const existing = await getProfile();
  if (existing) {
    const result = await dbPut('profile', { ...existing, ...data });
    notifyDataChange('profile');
    return result;
  }
  const result = await dbAdd('profile', { ...data, createdAt: new Date().toISOString() });
  notifyDataChange('profile');
  return result;
}

/** Settings */
export async function getSetting(key, defaultValue = null) {
  const record = await dbGet('settings', key);
  return record ? record.value : defaultValue;
}

export async function saveSetting(key, value) {
  return dbPut('settings', { key, value });
}

export async function getAllSettings() {
  const all = await dbGetAll('settings');
  return all.reduce((acc, { key, value }) => ({ ...acc, [key]: value }), {});
}

/** Subjects */
export async function getSubject(id) {
  return dbGet('subjects', id);
}

export async function getAllSubjects() {
  return dbGetAll('subjects');
}

export async function saveSubject(data) {
  if (data.id) {
    const result = await dbPut('subjects', data);
    notifyDataChange('subjects');
    return result;
  }
  const result = await dbAdd('subjects', {
    ...data,
    totalClasses: 0,
    attendedClasses: 0,
    createdAt: new Date().toISOString()
  });
  notifyDataChange('subjects');
  return result;
}

export async function deleteSubject(id) {
  // Also delete associated timetable slots and attendance records
  const slots = await dbGetByIndex('timetable', 'subjectId', id);
  for (const s of slots) await dbDelete('timetable', s.id);

  const records = await dbGetByIndex('attendance', 'subjectId', id);
  for (const r of records) await dbDelete('attendance', r.id);

  await dbDelete('statistics', id);
  const result = await dbDelete('subjects', id);
  notifyDataChange('subjects');
  return result;
}

/** Timetable */
export async function getTimetableForDay(day) {
  return dbGetByIndex('timetable', 'day', day);
}

export async function getAllTimetable() {
  return dbGetAll('timetable');
}

export async function saveTimetableSlot(data) {
  const result = data.id
    ? await dbPut('timetable', data)
    : await dbAdd('timetable', { ...data, createdAt: new Date().toISOString() });
  notifyDataChange('timetable');
  return result;
}

export async function deleteTimetableSlot(id) {
  const result = await dbDelete('timetable', id);
  notifyDataChange('timetable');
  return result;
}

/** Attendance */
export async function markAttendance(subjectId, date, status, note = '') {
  // Check if record already exists using the compound index
  const all = await dbGetAll('attendance');
  const existing = all.find(r => r.subjectId === subjectId && r.date === date);
  const profile = await getProfile();
  const semester = profile?.semester || '';

  const record = {
    subjectId,
    date,
    status,    // 'present' | 'absent' | 'cancelled' | 'holiday'
    note,
    semester,
    markedAt: new Date().toISOString()
  };

  let id;
  if (existing) {
    await pushAttendanceUndo({ type: 'restore', record: existing });
    id = await dbPut('attendance', { ...existing, ...record, id: existing.id });
  } else {
    id = await dbAdd('attendance', record);
    // Update subject totals only for new records
    await updateSubjectCounts(subjectId);
  }

  if (existing && existing.status !== status) {
    await updateSubjectCounts(subjectId);
  }

  // Update statistics
  await updateStatistics(subjectId);
  const subject = await getSubject(subjectId);
  const postPercentage = calcPercentage(subject?.attendedClasses || 0, subject?.totalClasses || 0);
  await dbPut('attendance', { ...(existing || record), id, semester, postPercentage });

  if (!existing) {
    const saved = await dbGet('attendance', id);
    await pushAttendanceUndo({ type: 'delete', record: saved });
  }

  notifyDataChange('attendance', { subjectId, date, status });
  return id;
}

export async function deleteAttendanceRecord(recordId) {
  const record = await dbGet('attendance', recordId);
  if (!record) return false;

  await pushAttendanceUndo({ type: 'restore', record });
  await dbDelete('attendance', recordId);
  await updateSubjectCounts(record.subjectId);
  await updateStatistics(record.subjectId);
  notifyDataChange('attendance', { deletedId: recordId, subjectId: record.subjectId, date: record.date });
  return true;
}

export async function undoLastAttendanceChange() {
  const stack = await getAttendanceUndoStack();
  const entry = stack.pop();
  await saveAttendanceUndoStack(stack);
  if (!entry?.record) return false;

  if (entry.type === 'delete') {
    await dbDelete('attendance', entry.record.id);
  } else {
    await dbPut('attendance', entry.record);
  }

  await updateSubjectCounts(entry.record.subjectId);
  await updateStatistics(entry.record.subjectId);
  notifyDataChange('attendance', { undo: true, subjectId: entry.record.subjectId, date: entry.record.date });
  return true;
}

export async function getAttendanceForSubject(subjectId) {
  return dbGetByIndex('attendance', 'subjectId', subjectId);
}

export async function getAttendanceForDate(date) {
  return dbGetByIndex('attendance', 'date', date);
}

export async function getAllAttendance() {
  return dbGetAll('attendance');
}

export async function getAttendanceRecord(subjectId, date) {
  const all = await dbGetAll('attendance');
  return all.find(r => r.subjectId === subjectId && r.date === date) || null;
}

/** Recompute total/attended for a subject from attendance records */
export async function updateSubjectCounts(subjectId) {
  const records = await getAttendanceForSubject(subjectId);
  const totalClasses   = records.filter(r => r.status !== 'holiday').length;
  const attendedClasses = records.filter(r => r.status === 'present').length;

  const subject = await getSubject(subjectId);
  if (subject) {
    await dbPut('subjects', { ...subject, totalClasses, attendedClasses });
  }
}

/** Statistics / Streaks */
export async function updateStatistics(subjectId) {
  const records = await getAttendanceForSubject(subjectId);
  const sorted  = records
    .filter(r => r.status === 'present' || r.status === 'absent')
    .sort((a, b) => a.date.localeCompare(b.date));

  let streak = 0;
  let longestStreak = 0;
  let currentStreak = 0;

  for (const r of sorted) {
    if (r.status === 'present') {
      currentStreak++;
      longestStreak = Math.max(longestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  // Current streak is end-of-sorted
  streak = currentStreak;
  const lastMarked = sorted.length ? sorted[sorted.length - 1].date : null;

  await dbPut('statistics', { subjectId, streak, longestStreak, lastMarked });
}

export async function getStatistics(subjectId) {
  return dbGet('statistics', subjectId);
}

/** Backups */
export async function createBackup(name) {
  const [profile, subjects, timetable, attendance, settings] = await Promise.all([
    dbGetAll('profile'),
    dbGetAll('subjects'),
    dbGetAll('timetable'),
    dbGetAll('attendance'),
    dbGetAll('settings')
  ]);

  const data = { profile, subjects, timetable, attendance, settings };
  return dbAdd('backups', {
    name: name || `Backup ${new Date().toLocaleDateString()}`,
    data,
    createdAt: new Date().toISOString()
  });
}

export async function getAllBackups() {
  return dbGetAll('backups');
}

export async function restoreBackup(backupId) {
  const backup = await dbGet('backups', backupId);
  if (!backup) throw new Error('Backup not found');

  const { profile, subjects, timetable, attendance, settings } = backup.data;

  // Clear and restore each store
  await dbClear('profile');
  for (const r of profile) await dbAdd('profile', r);

  await dbClear('subjects');
  for (const r of subjects) await dbAdd('subjects', r);

  await dbClear('timetable');
  for (const r of timetable) await dbAdd('timetable', r);

  await dbClear('attendance');
  for (const r of attendance) await dbAdd('attendance', r);

  await dbClear('settings');
  for (const r of settings) await dbPut('settings', r);

  return true;
}

export async function deleteBackup(id) {
  return dbDelete('backups', id);
}

/** Export entire DB as JSON string */
export async function exportAllData() {
  const [profile, subjects, timetable, attendance, settings, statistics, backups] = await Promise.all([
    dbGetAll('profile'),
    dbGetAll('subjects'),
    dbGetAll('timetable'),
    dbGetAll('attendance'),
    dbGetAll('settings'),
    dbGetAll('statistics'),
    dbGetAll('backups')
  ]);
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: DB_VERSION,
    profile, subjects, timetable, attendance, settings, statistics, backups
  }, null, 2);
}

/** Import entire DB from JSON string */
export async function importAllData(jsonString) {
  const data = JSON.parse(jsonString);

  const stores = ['profile', 'subjects', 'timetable', 'attendance', 'settings', 'statistics'];
  for (const store of stores) {
    if (data[store]) {
      await dbClear(store);
      for (const r of data[store]) {
        if (store === 'settings') {
          await dbPut(store, r);
        } else {
          await dbAdd(store, r);
        }
      }
    }
  }
  return true;
}

export const exportData = exportAllData;
export const importData = importAllData;

export async function clearAllData() {
  await Promise.all([
    dbClear('profile'),
    dbClear('subjects'),
    dbClear('timetable'),
    dbClear('attendance'),
    dbClear('settings'),
    dbClear('statistics'),
    dbClear('backups'),
  ]);
  await saveAttendanceUndoStack([]);
  notifyDataChange('reset');
  return true;
}

export async function getAttendanceUndoStack() {
  return getSetting(ATTENDANCE_UNDO_KEY, []);
}

async function pushAttendanceUndo(entry) {
  const stack = await getAttendanceUndoStack();
  stack.push({ ...entry, timestamp: new Date().toISOString() });
  await saveAttendanceUndoStack(stack.slice(-50));
}

async function saveAttendanceUndoStack(stack) {
  await saveSetting(ATTENDANCE_UNDO_KEY, stack);
}

function notifyDataChange(source, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('bunkwise:data-changed', {
    detail: { source, ...detail, timestamp: Date.now() }
  }));
}
