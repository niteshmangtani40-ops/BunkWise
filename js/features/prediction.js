import { getSetting, saveSetting, getProfile, getAllSubjects, getAllAttendance, getAllTimetable } from '../db.js';
import { today, getDayIndex, calcPercentage, calcSafeBunks, calcClassesNeeded } from '../utils.js';

/**
 * Attendance Prediction Engine
 */

export async function getPredictionsData(providedData = null) {
  // Allow passing cached database results for memoization/performance
  const subjects = providedData?.subjects || await getAllSubjects();
  const attendance = providedData?.attendance || await getAllAttendance();
  const timetable = providedData?.timetable || await getAllTimetable();
  const profile = providedData?.profile || await getProfile();
  const settings = providedData?.settings || await getSetting('attendanceTarget', 75);

  const target = Number(profile?.attendanceTarget || settings || 75);

  // Auto-record snapshot for history
  await recordSnapshotIfNeeded(subjects);

  // Calculate semester remaining weeks
  let startDate = today();
  if (attendance.length > 0) {
    const dates = attendance.map(a => a.date).sort();
    startDate = dates[0];
  }
  const semesterDays = 112; // 16 weeks standard
  const startMs = new Date(startDate).getTime();
  const endMs = startMs + semesterDays * 24 * 60 * 60 * 1000;
  const nowMs = new Date(today()).getTime();
  const daysRemaining = Math.max(0, Math.ceil((endMs - nowMs) / (24 * 60 * 60 * 1000)));
  const weeksRemaining = Math.max(0, Math.ceil(daysRemaining / 7));

  const subjectsData = subjects.map(subject => {
    const attended = subject.attendedClasses || 0;
    const total = subject.totalClasses || 0;
    const currentPct = calcPercentage(attended, total);
    
    // Remaining classes calculation from timetable
    const slots = timetable.filter(s => s.subjectId === subject.id);
    const slotsPerWeek = slots.length;
    const remainingClasses = slotsPerWeek * weeksRemaining;

    // Predictions
    const safeBunks = calcSafeBunks(attended, total, target);
    const needed = calcClassesNeeded(attended, total, target);
    const maxPossiblePct = (total + remainingClasses) > 0 
      ? calcPercentage(attended + remainingClasses, total + remainingClasses)
      : 100;

    // Semester End Projection
    // Let's assume student attends classes at their current rate or attends 100% of future classes?
    // Prediction usually assumes if they attend 100% of future classes, or at current rate.
    // Let's show both or assume they maintain current rate:
    const projectedSemesterPct = (total + remainingClasses) > 0
      ? calcPercentage(Math.round(attended + (currentPct/100) * remainingClasses), total + remainingClasses)
      : 100;

    // Status and Risk Level
    let status = 'Safe'; // Safe, Monitor, At Risk, Critical
    let riskLevel = 'Green'; // Green, Yellow, Orange, Red
    
    if (currentPct >= target && safeBunks > 0) {
      status = 'Safe';
      riskLevel = 'Green';
    } else if (currentPct >= target && safeBunks === 0) {
      status = 'Monitor';
      riskLevel = 'Yellow';
    } else if (maxPossiblePct >= target) {
      status = 'At Risk';
      riskLevel = 'Orange';
    } else {
      status = 'Critical';
      riskLevel = 'Red';
    }

    // Trend
    const subRecords = attendance
      .filter(r => r.subjectId === subject.id && (r.status === 'present' || r.status === 'absent'))
      .sort((a, b) => a.date.localeCompare(b.date));
    let trend = 'Stable'; // Improving, Stable, Declining
    if (subRecords.length >= 4) {
      const values = subRecords.slice(-6).map(r => r.status === 'present' ? 1 : 0);
      const half = Math.floor(values.length / 2);
      const firstHalf = values.slice(0, half);
      const secondHalf = values.slice(half);
      const sum = arr => arr.reduce((a, b) => a + b, 0);
      const avg1 = sum(firstHalf) / firstHalf.length;
      const avg2 = sum(secondHalf) / secondHalf.length;
      if (avg2 > avg1 + 0.05) trend = 'Improving';
      else if (avg2 < avg1 - 0.05) trend = 'Declining';
    }

    // Smart Recommendation
    let recommendation = '';
    if (status === 'Safe') {
      recommendation = `You can safely bunk the next ${safeBunks} ${subject.name} classes.`;
    } else if (status === 'Monitor') {
      recommendation = `Attend the next class to maintain target in ${subject.name}.`;
    } else if (status === 'At Risk') {
      recommendation = `Attend the next ${needed} ${subject.name} classes to reach ${target}%.`;
    } else {
      recommendation = `${subject.name} attendance is critical. Max possible is only ${maxPossiblePct}%.`;
    }

    if (trend === 'Improving' && currentPct < target) {
      recommendation = `${subject.name} attendance is improving! Keep attending to reach target.`;
    }

    return {
      ...subject,
      currentPct,
      target,
      safeBunks,
      needed,
      maxPossiblePct,
      projectedSemesterPct,
      status,
      riskLevel,
      trend,
      recommendation,
      remainingClasses
    };
  });

  // Calculate Overall Snapshot
  const totalAttended = subjects.reduce((sum, s) => sum + (s.attendedClasses || 0), 0);
  const totalClasses = subjects.reduce((sum, s) => sum + (s.totalClasses || 0), 0);
  const overallPct = calcPercentage(totalAttended, totalClasses);
  const overallSafeBunks = calcSafeBunks(totalAttended, totalClasses, target);
  
  const highestSub = [...subjectsData].sort((a,b) => b.currentPct - a.currentPct)[0] || null;
  const lowestSub = [...subjectsData].sort((a,b) => a.currentPct - b.currentPct)[0] || null;
  const maxSafeBunkSub = [...subjectsData].sort((a,b) => b.safeBunks - a.safeBunks)[0] || null;
  const criticalSubjectsCount = subjectsData.filter(s => s.status === 'Critical' || s.status === 'At Risk').length;
  
  const totalRemainingClasses = subjectsData.reduce((sum, s) => sum + s.remainingClasses, 0);
  const overallMaxPossible = (totalClasses + totalRemainingClasses) > 0
    ? calcPercentage(totalAttended + totalRemainingClasses, totalClasses + totalRemainingClasses)
    : 100;
  const overallProjectedSemesterPct = (totalClasses + totalRemainingClasses) > 0
    ? calcPercentage(Math.round(totalAttended + (overallPct/100) * totalRemainingClasses), totalClasses + totalRemainingClasses)
    : 100;

  let overallProjectionLabel = 'Good';
  if (overallProjectedSemesterPct >= 90) overallProjectionLabel = 'Excellent';
  else if (overallProjectedSemesterPct >= 80) overallProjectionLabel = 'Good';
  else if (overallProjectedSemesterPct >= 75) overallProjectionLabel = 'Warning';
  else overallProjectionLabel = 'Critical';

  return {
    subjectsData,
    overall: {
      pct: overallPct,
      target,
      attended: totalAttended,
      total: totalClasses,
      safeBunks: overallSafeBunks,
      highestSubject: highestSub,
      lowestSubject: lowestSub,
      maxSafeBunkSubject: maxSafeBunkSub,
      criticalCount: criticalSubjectsCount,
      maxPossible: overallMaxPossible,
      projectedSemesterPct: overallProjectedSemesterPct,
      projectionLabel: overallProjectionLabel
    }
  };
}

async function recordSnapshotIfNeeded(subjects) {
  try {
    const history = await getSetting('predictionHistory', []);
    const todayDate = today();
    const hasToday = history.some(s => s.date === todayDate);

    if (!hasToday) {
      const newSnapshot = {
        timestamp: new Date().toISOString(),
        date: todayDate,
        subjects: subjects.map(s => ({
          id: s.id,
          name: s.name,
          pct: calcPercentage(s.attendedClasses || 0, s.totalClasses || 0)
        }))
      };
      history.push(newSnapshot);
      await saveSetting('predictionHistory', history.slice(-100)); // Keep last 100
    }
  } catch (e) {
    console.error('[Prediction] Snapshot failed:', e);
  }
}

export async function getHistoryComparison() {
  const history = await getSetting('predictionHistory', []);
  if (!history || history.length === 0) return null;

  const current = history[history.length - 1];
  const beginning = history[0];
  
  // Find snapshot from approx 7 days ago
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  let lastWeek = history.find(s => s.date <= sevenDaysAgoStr);
  if (!lastWeek && history.length > 1) {
    lastWeek = history[Math.max(0, history.length - 7)];
  }

  return {
    beginning,
    lastWeek,
    current
  };
}
