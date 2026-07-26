import { getAllSubjects, getAllAttendance, getProfile } from '../db.js';
import { calcPercentage } from '../utils.js';

export async function init() {
  try {
    const [profile, subjects, attendance] = await Promise.all([
      getProfile(),
      getAllSubjects(),
      getAllAttendance(),
    ]);

    const attended = subjects.reduce((sum, subject) => sum + (subject.attendedClasses || 0), 0);
    const total = subjects.reduce((sum, subject) => sum + (subject.totalClasses || 0), 0);
    const pct = calcPercentage(attended, total);

    const dev = document.getElementById('about-developer');
    if (dev) dev.textContent = profile?.name ? `${profile.name} & Team` : 'BunkWise Team';

    const version = document.getElementById('about-version');
    if (version) version.textContent = '1.0.0';

    const title = document.querySelector('.page-subtitle');
    if (title) title.textContent = `${subjects.length} subjects • ${pct}% overall attendance`;
  } catch (error) {
    console.error('[About] Init failed:', error);
  }
}
export async function refresh() {
    await init();
}