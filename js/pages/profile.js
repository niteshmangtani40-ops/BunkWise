import { getAllAttendance, getAllSubjects, getProfile, saveProfile } from '../db.js';
import { calcPercentage, getAttendanceStatus, getInitials } from '../utils.js';
import { showToast } from '../notifications.js';

export async function init() {
  try {
    await loadProfile();
    bindEvents();
  } catch (error) {
    console.error('[Profile] Init failed:', error);
    showToast('Profile could not load. Redirecting to dashboard.', 'error');
    setTimeout(() => { window.location.href = './dashboard.html'; }, 900);
  }
}
export async function refresh() {
    await loadProfile();
}
async function loadProfile() {
  const [profile, subjects, attendance] = await Promise.all([
    getProfile(),
    getAllSubjects(),
    getAllAttendance(),
  ]);

  const attended = subjects.reduce((sum, subject) => sum + (subject.attendedClasses || 0), 0);
  const total = subjects.reduce((sum, subject) => sum + (subject.totalClasses || 0), 0);
  const pct = calcPercentage(attended, total);
  const status = getAttendanceStatus(pct);
  const streak = calcStreak(attendance);

  setValue('profile-name', profile?.name || 'Student');
  setValue('profile-college', profile?.college || 'My College');
  setValue('profile-semester', profile?.semester ? `Semester ${profile.semester}` : 'Semester —');
  setValue('profile-target', `${Number(profile?.attendanceTarget || 75)}%`);
  setValue('profile-attendance', `${pct}%`);
  setValue('profile-subjects', String(subjects.length));
  setValue('profile-streak', String(streak));

  const avatar = document.getElementById('profile-avatar');
  if (avatar) avatar.textContent = getInitials(profile?.name || 'BW') || 'BW';

  document.getElementById('profile-input-name').value = profile?.name || '';
  document.getElementById('profile-input-college').value = profile?.college || '';
  document.getElementById('profile-input-semester').value = profile?.semester || '';
  document.getElementById('profile-input-target').value = profile?.attendanceTarget || 75;
  document.getElementById('profile-input-rollno').value = profile?.rollNo || '';

  const attendanceEl = document.getElementById('profile-attendance');
  if (attendanceEl) attendanceEl.style.color = status.color;
}

function bindEvents() {
  document.getElementById('profile-save-btn')?.addEventListener('click', saveCurrentProfile);
}

async function saveCurrentProfile() {
  try {
    const name = document.getElementById('profile-input-name').value.trim();
    const college = document.getElementById('profile-input-college').value.trim();
    const semester = document.getElementById('profile-input-semester').value.trim();
    const attendanceTarget = Number(document.getElementById('profile-input-target').value) || 75;
    const rollNo = document.getElementById('profile-input-rollno').value.trim();

    if (!name) return showToast('Name is required', 'warning');
    if (attendanceTarget < 1 || attendanceTarget > 100) return showToast('Attendance target must be between 1 and 100', 'warning');

    await saveProfile({ name, college, semester, attendanceTarget, rollNo });
    showToast('Profile saved successfully', 'success');
    await loadProfile();
  } catch (error) {
    console.error('[Profile] Save failed:', error);
    showToast('Could not save profile', 'error');
  }
}

function calcStreak(attendance) {
  const sorted = [...attendance].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  for (const record of sorted) {
    if (record.status === 'present') streak += 1;
    else if (record.status === 'absent') break;
  }
  return streak;
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}