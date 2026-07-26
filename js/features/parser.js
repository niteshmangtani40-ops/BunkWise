const DAY_ALIASES = [
  ['monday', 1],
  ['tuesday', 2],
  ['wednesday', 3],
  ['thursday', 4],
  ['friday', 5],
  ['saturday', 6],
];

const DAY_REGEXES = [
  [/\bmon(day)?\b/i, 1],
  [/\btue(s|sday)?\b/i, 2],
  [/\bwed(nesday)?\b/i, 3],
  [/\bthu(r|rs|rsday)?\b/i, 4],
  [/\bfri(day)?\b/i, 5],
  [/\bsat(urday)?\b/i, 6],
];

const NOISE_PATTERNS = [
  /\b(lunch|break|holiday|library|recess|free|tutorial break)\b/i,
  /\b(subject|faculty|room|time|day|timetable|schedule)\b/i,
];

const FACULTY_PATTERN = /\b(?:dr|prof|professor|mr|mrs|ms|miss|shri|smt|asst\.?\s*prof(?:essor)?|assistant\s*professor)\.?\s+[A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*){0,3}/i;
const CODE_PATTERN = /\b[A-Z]{2,}[A-Z0-9/-]*\d[A-Z0-9/-]*\b/;
const ROOM_PATTERN = /\b(?:room\s*)?[A-Z]?-?\d{1,4}[A-Z]?(?:\s*[A-Z])?|\b(?:lab|lecture\s*hall|hall|classroom|tutorial\s*room)\s*[A-Z0-9-]*\b/i;

export function parseTimetable(text) {
  try {
    const structuredSource = normalizeStructuredSource(text);
    const structuredResult = parseStructuredTimetable(structuredSource);
    if (structuredResult.success) {
      return structuredResult;
    }

    const normalized = normalizeText(structuredSource.text);
    if (!normalized) {
      return emptyResult('No timetable detected.');
    }

    const lines = normalized
      .split(/\n+/)
      .map((line) => cleanLine(line))
      .filter(Boolean);

    const entries = [];
    let currentDay = null;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const detectedDay = detectDay(line);
      if (detectedDay) {
        currentDay = detectedDay;
      }

      if (isNoiseLine(line)) continue;

      const parsed = parseLine(line, currentDay);
      if (parsed.length) {
        entries.push(...parsed);
        continue;
      }

      const nextLine = lines[index + 1] ? `${line} ${lines[index + 1]}` : line;
      const mergedParsed = parseLine(nextLine, currentDay);
      if (mergedParsed.length) {
        entries.push(...mergedParsed);
        index += 1;
      }
    }

    const subjects = dedupe(entries)
      .sort(sortByDayThenTime)
      .map((entry) => ({
        name: entry.name,
        code: entry.code || '',
        faculty: entry.faculty || '',
        room: entry.room || '',
        day: entry.day,
        startTime: entry.startTime,
        endTime: entry.endTime,
      }));

    if (!subjects.length) {
      return emptyResult('No timetable detected.');
    }

    return {
      success: true,
      subjects,
    };
  } catch (error) {
    return {
      success: false,
      subjects: [],
      error: formatError(error),
    };
  }
}

function normalizeStructuredSource(input) {
  if (typeof input === 'string') {
    return { text: input, lines: [] };
  }

  if (input && typeof input === 'object') {
    return {
      text: String(input.text || ''),
      lines: Array.isArray(input.lines) ? input.lines : [],
    };
  }

  return { text: '', lines: [] };
}

function parseStructuredTimetable(source) {
  const lines = Array.isArray(source.lines) ? source.lines : [];
  if (!lines.length) {
    return emptyResult('No timetable detected.');
  }

  const header = findDayHeaderLine(lines);
  if (!header) {
    return emptyResult('No timetable detected.');
  }

  const columns = extractDayColumns(header);
  if (columns.length < 2) {
    return emptyResult('No timetable detected.');
  }

  const entries = [];
  for (let index = lines.indexOf(header) + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const rowText = cleanLine(line.text || '');
    if (!rowText) continue;
    if (isNoiseLine(rowText)) continue;

    const timeMatch = extractTimeRange(rowText);
    if (!timeMatch) continue;

    const schedule = normalizeTimeRange(timeMatch);
    if (!schedule) continue;

    const cells = splitIntoColumns(line, columns);
    for (const cell of cells) {
      const subjectText = cleanLine(cell.text || '');
      if (!subjectText || looksLikeMetadata(subjectText)) continue;

      const subject = sanitizeRow({
        name: subjectText,
        code: extractCode(subjectText),
        faculty: extractFaculty(subjectText),
        room: extractRoom(subjectText),
        day: cell.day,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      });

      const finalName = subject.name || subject.code || subject.faculty || subject.room || 'Untitled Subject';
      if (isValidSchedule(subject.startTime, subject.endTime)) {
        entries.push({ ...subject, name: finalName });
      }
    }
  }

  const subjects = dedupe(entries).sort(sortByDayThenTime);
  if (!subjects.length) {
    return emptyResult('No timetable detected.');
  }

  return { success: true, subjects };
}

function findDayHeaderLine(lines) {
  let bestLine = null;
  let bestCount = 0;

  for (const line of lines) {
    const words = getWords(line);
    const count = words.reduce((sum, word) => sum + (detectDay(word.text) ? 1 : 0), 0);
    if (count > bestCount) {
      bestCount = count;
      bestLine = line;
    }
  }

  return bestCount >= 2 ? bestLine : null;
}

function extractDayColumns(line) {
  const words = getWords(line);
  const columns = [];

  for (const word of words) {
    const day = detectDay(word.text);
    if (!day) continue;
    const center = Number(word.x || 0) + (Number(word.width || 0) / 2);
    columns.push({ day, center, label: word.text });
  }

  return columns
    .sort((a, b) => a.center - b.center)
    .filter((column, index, array) => index === 0 || Math.abs(column.center - array[index - 1].center) > 18);
}

function splitIntoColumns(line, columns) {
  const words = getWords(line);
  if (!words.length) return [];

  const grouped = columns.map((column) => ({ day: column.day, words: [] }));

  for (const word of words) {
    const wordDay = detectDay(word.text);
    if (wordDay) continue;
    const center = Number(word.x || 0) + (Number(word.width || 0) / 2);
    let bestIndex = 0;
    let bestDistance = Infinity;

    columns.forEach((column, index) => {
      const distance = Math.abs(center - column.center);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    if (!grouped[bestIndex]) continue;
    grouped[bestIndex].words.push(word.text);
  }

  return grouped
    .map((group) => ({
      day: group.day,
      text: group.words.join(' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter((group) => group.text);
}

function getWords(line) {
  if (Array.isArray(line?.words) && line.words.length) {
    return line.words
      .map((word) => ({
        text: String(word?.text || '').trim(),
        x: Number(word?.x || 0),
        width: Number(word?.width || 0),
      }))
      .filter((word) => word.text);
  }

  const text = String(line?.text || '').trim();
  if (!text) return [];
  return text.split(/\s+/).map((word) => ({ text: word, x: 0, width: 0 }));
}

function parseLine(line, currentDay) {
  const detectedDay = detectDay(line) || currentDay || 1;
  const timeMatch = extractTimeRange(line);
  if (!timeMatch) return [];

  const schedule = normalizeTimeRange(timeMatch);
  if (!schedule) return [];

  let working = line
    .replace(timeMatch.raw, ' ')
    .replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday)\b/ig, ' ')
    .replace(/\b(?:mon|tue|tues|wed|thu|thur|fri|sat)\b/ig, ' ')
    .replace(/[\[\](){}]/g, ' ')
    .replace(/[|•·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!working) return [];

  const segments = splitSegments(working);
  const rows = buildRowsFromSegments(segments, schedule, detectedDay);

  return rows
    .map((row) => sanitizeRow(row))
    .map((row) => ({
      ...row,
      name: row.name || row.code || row.faculty || row.room || 'Untitled Subject',
    }))
    .filter((row) => row.day && row.startTime && row.endTime && isValidSchedule(row.startTime, row.endTime));
}

function splitSegments(value) {
  const parts = value
    .split(/\s*(?:\||\t|;|,|\s{2,})\s*/)
    .map((part) => cleanLine(part))
    .filter(Boolean);

  return parts.length ? parts : [value.trim()];
}

function buildRowsFromSegments(segments, schedule, day) {
  const rows = [{
    name: '',
    code: '',
    faculty: '',
    room: '',
    day,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
  }];

  for (const segment of segments) {
    const text = segment.trim();
    if (!text) continue;

    const code = extractCode(text);
    const faculty = extractFaculty(text);
    const room = extractRoom(text);

    if (code && !rows[0].code) rows[0].code = code;
    if (faculty && !rows[0].faculty) rows[0].faculty = faculty;
    if (room && !rows[0].room) rows[0].room = room;

    const remainder = text
      .replace(code || '', ' ')
      .replace(faculty || '', ' ')
      .replace(room || '', ' ')
      .replace(/\b(?:class|lecture|tutorial|practical|theory|session|slot|room|lab)\b/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (remainder && !looksLikeMetadata(remainder)) {
      rows[0].name = rows[0].name ? `${rows[0].name} ${remainder}`.trim() : remainder;
    }
  }

  if (!rows[0].name) {
    const joined = segments.join(' ');
    const fallback = joined
      .replace(extractCode(joined) || '', ' ')
      .replace(extractFaculty(joined) || '', ' ')
      .replace(extractRoom(joined) || '', ' ')
      .replace(/\b(?:class|lecture|tutorial|practical|theory|session|slot|room|lab)\b/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    rows[0].name = fallback;
  }

  return rows;
}

function sanitizeRow(row) {
  const name = tidySubjectName(row.name || row.code || row.faculty || row.room || '');
  const code = tidyCode(row.code);
  const faculty = tidyFaculty(row.faculty);
  const room = tidyRoom(row.room);

  return {
    ...row,
    name,
    code,
    faculty,
    room,
  };
}

function tidySubjectName(value = '') {
  return smartTitleCase(String(value).replace(/\s+/g, ' ').trim())
    .replace(/\b(Break|Lunch|Holiday|Library)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tidyFaculty(value = '') {
  return smartTitleCase(String(value).replace(/\s+/g, ' ').trim())
    .replace(/^Dr\.?\s+/i, 'Dr. ')
    .replace(/^Prof\.?\s+/i, 'Prof. ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tidyCode(value = '') {
  return String(value).replace(/\s+/g, '').replace(/[^A-Za-z0-9/-]/g, '').toUpperCase();
}

function tidyRoom(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/^room\s*/i, 'Room ')
    .trim();
}

function extractCode(text) {
  const match = String(text).match(CODE_PATTERN);
  return match ? match[0] : '';
}

function extractFaculty(text) {
  const match = String(text).match(FACULTY_PATTERN);
  return match ? match[0] : '';
}

function extractRoom(text) {
  const match = String(text).match(ROOM_PATTERN);
  if (!match) return '';
  return match[0].replace(/\s+/g, ' ').trim();
}

function detectDay(text) {
  const value = String(text || '');
  for (const [pattern, day] of DAY_REGEXES) {
    if (pattern.test(value)) return day;
  }

  const lower = value.toLowerCase();
  for (const [alias, day] of DAY_ALIASES) {
    if (lower.includes(alias)) {
      return day;
    }
  }
  return null;
}

function isNoiseLine(text) {
  return NOISE_PATTERNS.some((pattern) => pattern.test(text)) && !extractTimeRange(text);
}

function looksLikeMetadata(text) {
  return Boolean(
    extractCode(text) ||
    extractFaculty(text) ||
    extractRoom(text) ||
    isTimeOnly(text)
  );
}

function extractTimeRange(text) {
  const value = String(text).replace(/\u2013|\u2014|\bto\b/ig, '-');
  const rangeMatch = value.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i);
  if (rangeMatch) {
    return { raw: rangeMatch[0], start: rangeMatch[1], end: rangeMatch[2] };
  }

  const singleMatch = value.match(/\b\d{1,2}(?::\d{2})\s*(?:AM|PM)?\b|\b\d{1,2}\s*(?:AM|PM)\b/i);
  if (singleMatch) {
    return { raw: singleMatch[0], start: singleMatch[0], end: '' };
  }

  return null;
}

function normalizeTimeRange(match) {
  const start = parseTime(match.start, match.end);
  const end = match.end ? parseTime(match.end, match.start) : addMinutes(start, 60);

  if (!start || !end) return null;
  if (!isValidSchedule(start, end)) return null;

  return { startTime: start, endTime: end };
}

function parseTime(raw, meridiemHint = '') {
  const text = String(raw).trim().toUpperCase().replace(/\./g, '');
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return '';

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3] || String(meridiemHint).match(/(AM|PM)/i)?.[1] || '';

  if (meridiem) {
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
  }

  if (!meridiem && hour < 8) {
    hour += 12;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function addMinutes(time, minutes) {
  const [hours, mins] = String(time).split(':').map(Number);
  const date = new Date(2000, 0, 1, hours, mins || 0, 0, 0);
  date.setMinutes(date.getMinutes() + minutes);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function isTimeOnly(value) {
  return /^\d{1,2}(?::\d{2})?\s*(AM|PM)?$/i.test(String(value).trim());
}

function isValidSchedule(startTime, endTime) {
  return Boolean(startTime && endTime && startTime < endTime);
}

function dedupe(entries) {
  const map = new Map();

  for (const entry of entries) {
    const key = buildKey(entry);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, entry);
      continue;
    }

    map.set(key, {
      ...existing,
      name: existing.name || entry.name,
      code: existing.code || entry.code,
      faculty: existing.faculty || entry.faculty,
      room: existing.room || entry.room,
    });
  }

  return [...map.values()];
}

function buildKey(entry) {
  return [
    normalizeKey(entry.name),
    normalizeKey(entry.code),
    entry.day,
    entry.startTime,
    entry.endTime,
    normalizeKey(entry.room),
  ].join('|');
}

function normalizeKey(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sortByDayThenTime(a, b) {
  if (a.day !== b.day) return a.day - b.day;
  return a.startTime.localeCompare(b.startTime);
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/([A-Za-z])\-\n([A-Za-z])/g, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanLine(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .replace(/[|]+/g, ' | ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function smartTitleCase(value = '') {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9/-]+$/.test(word) && word.length <= 4) return word.toUpperCase();
      if (/^(?:MTH|CSE|ECE|EEE|IT|ME|CE|BT|CHE|PHY|MAT|BIO|ENG|HIS|LAB)$/i.test(word)) {
        return word.toUpperCase();
      }

      const lower = word.toLowerCase();
      if (lower.startsWith('dr.')) return 'Dr.' + word.slice(3);
      if (lower.startsWith('prof.')) return 'Prof.' + word.slice(5);

      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ')
    .replace(/\bAnd\b/g, 'and');
}

function emptyResult(error) {
  return {
    success: false,
    subjects: [],
    error,
  };
}

function formatError(error) {
  if (!error) return 'Unable to parse timetable.';
  if (error instanceof Error) return error.message || 'Unable to parse timetable.';
  return String(error.message || error.error || error || 'Unable to parse timetable.');
}