// Band Tracker — js/00-logic.js — Pure logic: pseudonyms, scoring, published
// stats, auto-marks, CSV parsing. No Firebase, no STATE, no DOM — every
// function takes its inputs as arguments so it can be unit-tested with
// `npm run test:unit` (tests/unit/logic.test.js). Add tests when you change
// anything here. Thin wrappers elsewhere bind these to STATE.
// Plain script sharing global scope; load order is set in index.html. The
// CommonJS guard at the bottom makes the same file requireable from Node.

// ── Pseudonyms ────────────────────────────────────────────────────────────────

const FAKE_ADJECTIVES = [
  'Fluffy','Speedy','Grumpy','Happy','Sleepy','Bouncy','Sparkly','Wobbly',
  'Snappy','Fuzzy','Silly','Jolly','Brave','Clever','Dizzy','Fancy',
  'Gentle','Hungry','Jumpy','Lazy','Mighty','Noisy','Orange','Peppy',
  'Quirky','Rusty','Sassy','Tiny','Vivid','Wavy','Zappy','Cheeky',
  'Dozy','Eager','Frisky','Goofy','Hasty','Inky','Lumpy','Misty',
  'Nutty','Plucky','Rainy','Soggy','Wacky','Zippy','Bumpy','Curly',
  'Droopy','Flaky'
];
const FAKE_ANIMALS = [
  'Panda','Giraffe','Alligator','Penguin','Flamingo','Hedgehog','Capybara',
  'Platypus','Narwhal','Axolotl','Wombat','Lemur','Tapir','Okapi','Quokka',
  'Pangolin','Echidna','Manatee','Sloth','Armadillo','Salamander','Gecko',
  'Chameleon','Toucan','Cockatoo','Cassowary','Kiwi','Meerkat','Mongoose',
  'Ocelot','Wolverine','Badger','Otter','Ferret','Chinchilla','Capybara',
  'Binturong','Tarantula','Axolotl','Dugong','Aardvark','Numbat','Kakapo',
  'Fossa','Saiga','Blobfish','Tardigrade','Mudskipper','Shoebill','Potoo'
];

function _strHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h, 31) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}

// Deterministic leaderboard pseudonym for a student id under a given salt.
function pseudonymFor(id, salt) {
  const h   = _strHash(String(id) + (salt || ''));
  const adj = FAKE_ADJECTIVES[h % FAKE_ADJECTIVES.length];
  const ani = FAKE_ANIMALS[Math.floor(h / FAKE_ADJECTIVES.length) % FAKE_ANIMALS.length];
  return `${adj} ${ani}`;
}

// ── Event type (rehearsal vs performance) ─────────────────────────────────────

// An event doc is a rehearsal or a performance. The type lives in the doc's
// `type` field, but the field is only written for performances — an absent (or
// unrecognized) value reads as a rehearsal, so every pre-existing doc, and the
// common case, needs nothing stored. This is a presentation distinction only:
// attendance, marks, streaks and the leaderboard treat both the same.
function eventType(r) {
  return r && r.type === 'performance' ? 'performance' : 'rehearsal';
}
function isPerformance(r) {
  return eventType(r) === 'performance';
}
// Singular noun for headings/messages ("New Performance", "Event not found").
function eventTypeLabel(r) {
  return isPerformance(r) ? 'Performance' : 'Rehearsal';
}

// ── Rehearsal scope ───────────────────────────────────────────────────────────

// A rehearsal can target a subset of the band. `scope` is
// { instruments, sections, grades } (any may be omitted/empty). A student is
// included when they match ANY selected value across the three categories.
// No scope, or an all-empty scope, means the full band attends.
function rehearsalIncludesStudent(student, scope) {
  if (!scope) return true;
  const instruments = scope.instruments || [];
  const sections    = scope.sections    || [];
  const grades      = scope.grades      || [];
  if (!instruments.length && !sections.length && !grades.length) return true;
  if (!student) return false;
  const inst = String(student.instrument || '').replace(/^\d+\s*/, '').trim();
  return instruments.includes(inst)
      || sections.includes(String(student.section || ''))
      || grades.includes(String(student.grade || ''));
}

// Human-readable label for a rehearsal scope (badges/headers). '' = full band.
function rehearsalScopeLabel(scope) {
  if (!scope) return '';
  const parts = [
    ...(scope.instruments || []),
    ...(scope.sections    || []),
    ...(scope.grades      || []).map(g => /^\d/.test(g) ? `${g} Grade` : g),
  ];
  return parts.join(', ');
}

// ── Rehearsal ordering ────────────────────────────────────────────────────────

// Newest-first order for every rehearsal list: by date, then — for rehearsals
// sharing a date — by the time the rehearsal was started (`startedAt`, epoch
// ms, stamped at creation), then by id so the order is stable. Rehearsals
// created before `startedAt` existed fall back to the id, which genId() builds
// from a base36 `Date.now()` prefix, so their relative order still tracks
// creation time. Use this everywhere rehearsals are sorted (the Firestore
// listeners, the local optimistic insert, the list view).
function compareRehearsalsDesc(a, b) {
  const byDate = String(b?.date || '').localeCompare(String(a?.date || ''));
  if (byDate) return byDate;
  const ta = Number(a?.startedAt) || 0;
  const tb = Number(b?.startedAt) || 0;
  if (ta !== tb) return tb - ta;
  return String(b?.id || '').localeCompare(String(a?.id || ''));
}

// ── Rehearsal attendance streak ───────────────────────────────────────────────

// Whether a rehearsal happened before a student joined the roster, so a missing
// entry doc can NOT be read as "present". The "present" case writes no entry, so
// the attendance helpers treat "no entry" as attended — but that only holds for
// students who were on the roster when attendance was taken. A student created
// afterwards never had the chance to attend, and without this guard inherits a
// full streak (and "attended" history) from every historical rehearsal.
// Applies only when we know when the student was created (`createdAt`, epoch ms);
// students predating that field keep the old behavior. Compared by calendar date
// (the rehearsal's primary sort key) so a rehearsal held on the student's join
// day still counts.
function rehearsalPredatesStudent(rehearsal, student) {
  const created = Number(student?.createdAt);
  const date = rehearsal?.date;
  if (!created || !date) return false;
  const d = new Date(created);
  const createdDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(date) < createdDate;
}

// How many of the most recent consecutive rehearsals a student attended without
// an absence. Only rehearsals where attendance was actually taken
// (`attendanceSubmitted`) and that include the student (rehearsal scope) count;
// they're walked newest-first and the streak stops at the first absence.
// A 'late' still counts as attended — it isn't an absence — and a rehearsal with
// no entry for the student (the common "present" case, which writes no entry
// doc) counts as attended too. Rehearsals a director hid from students
// (`hiddenFromStudents`) are skipped entirely — they "shouldn't count", so they
// neither break nor extend the streak — keeping the number identical in the
// director roster and the student's own portal. Rehearsals that predate the
// student (`rehearsalPredatesStudent`) are skipped as well unless the student has
// an explicit entry for them — a newly added student didn't miss rehearsals held
// before they existed, but an explicit record from a director is honored.
//   `rehearsals` — array of rehearsal docs; `entries` — STATE.entries shape
//   ({ [rehearsalId]: { [studentNumber]: entry } }); `student` — the student doc
//   (needs its number + scope fields).
function rehearsalStreak(rehearsals, entries, student) {
  if (!student) return 0;
  const num = String(student.number);
  const ordered = (rehearsals || [])
    .filter(r => r && r.attendanceSubmitted && !r.hiddenFromStudents
              && rehearsalIncludesStudent(student, r.scope)
              && (entries?.[r.id]?.[num] || !rehearsalPredatesStudent(r, student)))
    .sort(compareRehearsalsDesc);
  let streak = 0;
  for (const r of ordered) {
    if (entries?.[r.id]?.[num]?.attendance === 'absent') break;
    streak++;
  }
  return streak;
}

// Every rehearsal a student attended, newest-first. "Attended" uses the same
// universe as the streak — rehearsals where attendance was taken
// (`attendanceSubmitted`), that include the student (scope), and aren't hidden
// from students — minus the ones they were marked absent for. A 'late' still
// counts as attended (it isn't an absence), and a rehearsal with no entry for
// the student (the common "present" case, which writes no entry doc) counts as
// attended too. Rehearsals that predate the student (`rehearsalPredatesStudent`)
// are excluded unless they carry an explicit entry, mirroring the streak — a new
// student didn't attend rehearsals held before they joined. Each returned item is
// `{ rehearsal, status }`, where `status` is 'present' or 'late'. The portal's
// "N Attended" pill is this list's length and its modal is the list itself.
function rehearsalsAttended(rehearsals, entries, student) {
  if (!student) return [];
  const num = String(student.number);
  return (rehearsals || [])
    .filter(r => r && r.attendanceSubmitted && !r.hiddenFromStudents
              && rehearsalIncludesStudent(student, r.scope)
              && (entries?.[r.id]?.[num] || !rehearsalPredatesStudent(r, student))
              && entries?.[r.id]?.[num]?.attendance !== 'absent')
    .sort(compareRehearsalsDesc)
    .map(r => ({ rehearsal: r, status: entries?.[r.id]?.[num]?.attendance === 'late' ? 'late' : 'present' }));
}

// ── Memorization exclusions ───────────────────────────────────────────────────

// Whether a student is excluded from song memorization. `exclusions` is a flat
// list of instrument and/or section names (e.g. ['Majorette']); a student is
// excluded when their instrument (leading number stripped, like normInstrument)
// or section matches any of them. Used to keep groups that don't memorize music
// out of the memorization lists and song progress aggregates.
function isMemorizationExcluded(student, exclusions) {
  if (!student || !exclusions) return false;
  const set = exclusions instanceof Set ? exclusions : new Set(exclusions);
  if (!set.size) return false;
  const inst = String(student.instrument || '').replace(/^\d+\s*/, '').trim();
  const sect = String(student.section || '').trim();
  return (!!inst && set.has(inst)) || (!!sect && set.has(sect));
}

// ── Task applicability ────────────────────────────────────────────────────────
// A "task" (e.g. turn in the handbook form) applies to a configurable set of
// students, independent of song-memorization exclusions. `groups` selects by
// instrument/section/grade (OR across categories, same instrument-number strip
// as rehearsalIncludesStudent); empty groups match no one.
function _taskMatchesGroups(student, groups) {
  if (!student || !groups) return false;
  const instruments = groups.instruments || [];
  const sections    = groups.sections    || [];
  const grades      = groups.grades      || [];
  if (!instruments.length && !sections.length && !grades.length) return false;
  const inst = String(student.instrument || '').replace(/^\d+\s*/, '').trim();
  return instruments.includes(inst)
      || sections.includes(String(student.section || ''))
      || grades.includes(String(student.grade || ''));
}

// Whether a task applies to a student. Resolution order: an individual include
// wins, then an individual exempt, then the group rule — `applyMode:'include'`
// means only the chosen groups; anything else ('all', the default) means
// everyone EXCEPT the chosen (exempt) groups. Pure: takes the task doc + a
// student, touches no STATE.
function taskAppliesToStudent(student, task) {
  if (!student || !task) return false;
  const num = String(student.number);
  if ((task.includeStudents || []).map(String).includes(num)) return true;
  if ((task.exemptStudents  || []).map(String).includes(num)) return false;
  const inGroups = _taskMatchesGroups(student, task.groups);
  return task.applyMode === 'include' ? inGroups : !inGroups;
}

// ── Done-late flag (songs + tasks) ────────────────────────────────────────────

// Whether a completion recorded at `updatedAt` (epoch ms) landed after its
// `dueDate` (a 'YYYY-MM-DD' string) had already passed — i.e. it got done, but
// late. Both must be present. The completion's own local calendar day is
// compared against the due date, so finishing ON the due date is on time and the
// day after is late. Pure: shared by songs (passed after due) and tasks (done
// after due). Returns false when either input is missing, so a song/task with no
// due date is never flagged.
function isDoneLate(dueDate, updatedAt) {
  if (!dueDate || !updatedAt) return false;
  const d = new Date(updatedAt);
  if (isNaN(d)) return false;
  const doneDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return doneDate > dueDate;
}

// ── Leaderboard scoring ───────────────────────────────────────────────────────

// Resolve stored weights to effective values (missing → defaults).
function lbWeights(w) {
  w = w || {};
  return {
    positive: w.positive ?? 1,
    negative: w.negative ?? 1,
    absent:   w.absent   ?? 1,
    late:     w.late     ?? 0.5,
    song:     w.song     ?? 1,
  };
}

// Score every student. Inputs mirror the app's state shapes:
//   students: { docId: studentDoc }      (docId === student number)
//   entries:  { rehearsalId: { studentNumber: entry } }
//   songs:    [ { statuses: { num: { status } } } ]
//   weights:  resolved via lbWeights()
//   flags:    { marksOn, attendanceOn, countNegative }
function scoreStudentsCore(students, entries, songs, weights, flags, salt) {
  const w = weights;
  return Object.entries(students).map(([docId, s]) => {
    const songPoints = songs.reduce((sum, song) => {
      return sum + (song.statuses?.[String(s.number)]?.status === 'passed' ? 1 : 0);
    }, 0);
    const score = songPoints * w.song + Object.values(entries).reduce((sum, rehEntries) => {
      const e = rehEntries[String(s.number)];
      if (!e) return sum;
      return sum + (flags.marksOn ? (e.positives || 0) * w.positive : 0)
                 - (flags.marksOn && flags.countNegative ? (e.mistakes || 0) * w.negative : 0)
                 - (flags.attendanceOn && e.attendance === 'absent' ? w.absent : 0)
                 - (flags.attendanceOn && e.attendance === 'late'   ? w.late   : 0);
    }, 0);
    return { docId, s, score, name: pseudonymFor(docId, salt),
      positives: flags.marksOn ? Object.values(entries).reduce((sum, re) => sum + (re[String(s.number)]?.positives || 0), 0) : 0,
      mistakes:  flags.marksOn ? Object.values(entries).reduce((sum, re) => sum + (re[String(s.number)]?.mistakes  || 0), 0) : 0 };
  });
}

// ── Published student-safe stats (settings/public payload) ────────────────────

// Builds the derived `stats` object director clients publish for students:
// per-rehearsal absence counts, song progress aggregates and the
// pseudonymized leaderboard (null while disabled).
//   flags: { songsOn, statsOn, marksOn, attendanceOn, countNegative,
//            leaderboardEnabled }
//   memExclusions: instrument/section names excluded from memorization
function buildPublicStats({ students, entries, rehearsals, songs, tasks, weights, flags, salt, memExclusions }) {
  const studentList = Object.values(students);
  // Song progress is measured over students who actually memorize music, so
  // excluded groups (e.g. majorettes) don't inflate the "remaining" counts.
  const memList = studentList.filter(s => !isMemorizationExcluded(s, memExclusions));
  const total   = memList.length;

  // Rehearsals a director flagged hidden-from-students are dropped from every
  // student-facing aggregate: the per-rehearsal absence row AND the leaderboard
  // scores (so a hidden absence can't leak through a lowered rank). The
  // director's own live views score from the full data and are unaffected.
  const visRehearsals = rehearsals.filter(r => !r.hiddenFromStudents);
  const visEntries = {};
  for (const r of visRehearsals) if (entries[r.id]) visEntries[r.id] = entries[r.id];

  // Per-rehearsal attendance tallies, all aggregate — no per-student data.
  // Attendance recording only stamps absences and lates; everyone else is
  // present by default (see submitAttendance). So present is the in-scope
  // roster minus absent/late, exactly as the director attendance views derive
  // it — NOT a count of "present" entries (those usually don't exist). Present
  // is only meaningful once attendance is under way, so it's left at 0 for a
  // rehearsal with no submitted flag and no absent/late marks; the portal card
  // then filters those untouched rehearsals out.
  const rehearsalRows = visRehearsals.map(r => {
    const es      = Object.values(entries[r.id] || {});
    const absent  = es.filter(e => e.attendance === 'absent').length;
    const late    = es.filter(e => e.attendance === 'late').length;
    const inScope = r.scope
      ? studentList.filter(s => rehearsalIncludesStudent(s, r.scope)).length
      : studentList.length;
    const counted = !!r.attendanceSubmitted || absent > 0 || late > 0;
    return {
      date:    r.date,
      label:   r.label || '',
      absent,
      late,
      present: counted ? Math.max(0, inScope - absent - late) : 0,
    };
  });

  const songRows = (flags.songsOn ? songs : []).map(song => {
    const passed = memList.filter(s => song.statuses?.[String(s.number)]?.status === 'passed').length;
    return {
      id: song.id, title: song.title || '', dueDate: song.dueDate || '',
      category: song.category || '', passed, remaining: Math.max(0, total - passed),
    };
  });

  // Task check-off progress: aggregate only (done of applicable), and only for
  // tasks the director marked student-visible. Applicability is per task, so
  // each row measures over the students that task actually applies to — a
  // majorette shows up here for a form even though she's exempt from songs.
  const taskRows = (flags.tasksOn ? (tasks || []) : [])
    .filter(t => t.studentVisible !== false)
    .map(task => {
      const applicable = studentList.filter(s => taskAppliesToStudent(s, task));
      const done = applicable.filter(s => task.statuses?.[String(s.number)]?.done).length;
      return {
        id: task.id, title: task.title || '', dueDate: task.dueDate || '',
        done, total: applicable.length,
      };
    });

  // Pseudonymized ranking — published only while the leaderboard is enabled.
  // Rows carry the student number so each student can find their own row;
  // names and per-event details are never included.
  const leaderboard = (flags.leaderboardEnabled && flags.statsOn)
    ? scoreStudentsCore(students, visEntries, flags.songsOn ? songs : [], weights, flags, salt)
        .sort((a, b) => b.score - a.score)
        .map(({ docId, name, score }) => ({ num: docId, name, score }))
    : null;

  return { rehearsals: rehearsalRows, songs: songRows, tasks: taskRows, leaderboard };
}

// ── Auto marks ────────────────────────────────────────────────────────────────

function checkAutoMarkCondition(mark, att, mistakes) {
  if (att === 'absent') return false;
  switch (mark.condition) {
    case 'on_time':     return att !== 'late';
    case 'no_mistakes': return mistakes === 0;
    case 'present':     return true;
    default:            return true;
  }
}

// Recomputes an entry's events with auto marks applied: previous auto events
// are stripped and re-derived from the manual events + attendance, so the
// result is stable no matter how often it runs.
function computeAutoMarkEvents(entry, rehearsal, autoMarks, now = Date.now()) {
  const att        = entry.attendance || 'present';
  const baseEvents = (entry.events || []).filter(e => !e.auto);
  const mistakes   = baseEvents.filter(e => e.type === 'mistake').length;
  const events     = [...baseEvents];
  for (const mark of autoMarks) {
    const whenOk = mark.when === 'start' ? !!rehearsal.attendanceSubmitted : !!rehearsal.ended;
    if (!whenOk) continue;
    if (checkAutoMarkCondition(mark, att, mistakes)) {
      events.push({ type: mark.type || 'positive', note: mark.note, ts: now, by: 'system', auto: true });
    }
  }
  return events;
}

// ── CSV import parsing ────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i+1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { fields.push(field.trim()); field = ''; }
      else field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function parseCSV(text) {
  return text.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
    .split('\n').filter(l => l.trim()).map(parseCSVLine);
}

const COL_ALIASES = {
  number:     ['number','student number','student #','student no','student id','id','#','num','no.','no'],
  name:       ['name','student name','full name','first name','last name','student'],
  instrument: ['instrument','instruments','inst'],
  section:    ['section','part','group','ensemble'],
  grade:      ['grade','grade level','year','class year'],
  notes:      ['notes','note','comments','comment','director notes']
};

function normalizeGrade(val) {
  const num = val.replace(/[^\d]/g, '');
  const mapped = { '8':'8th','9':'9th','10':'10th','11':'11th','12':'12th' };
  return mapped[num] || val;
}

function detectCols(headers, customFields = []) {
  const norm = headers.map(h => h.toLowerCase().trim());
  const map = {};
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    const idx = norm.findIndex(h => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  for (const cf of customFields) {
    const idx = norm.findIndex(h => h === cf.label.toLowerCase().trim());
    if (idx !== -1 && map[cf.key] === undefined) map[cf.key] = idx;
  }
  return map;
}

// ── CSV output ────────────────────────────────────────────────────────────────

// A CSV cell, quoted if it contains a comma, quote or newline.
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The shareable roster of sign-in codes: one row per student, sorted by the
// caller. Students without a code get an empty cell so the gaps are obvious in
// a spreadsheet. Director-only data — the download wrapper in js/06-roster.js
// gates on STATE.isAdmin.
function buildStudentCodesCsv(students, { includeInstrument = true } = {}) {
  const header = ['Student Number', 'Name', ...(includeInstrument ? ['Instrument'] : []), 'Student Code'];
  const rows = students.map(s => [
    s.number,
    s.name || '',
    ...(includeInstrument ? [normInstrument(s.instrument)] : []),
    (s.studentCode || '').toUpperCase(),
  ].map(csvCell).join(','));
  return [header.join(','), ...rows].join('\n');
}

// ── Customizable data export (tables → CSV / printable PDF) ───────────────────
// A "table" is { columns:[{key,label}], rows:[{<key>:value}] }. Two renderers
// turn one into a CSV string (tableToCsv) or a self-contained printable HTML
// document (tableToPrintHtml — the app "exports PDF" by printing this). The
// per-dataset builders below produce full tables from plain data; the
// STATE-gathering wrappers and the column-picker UI live in js/15-export.js.
// All pure — no Firebase, STATE or DOM — so they're unit-testable from Node.

function tableToCsv(columns, rows) {
  const header = columns.map(c => csvCell(c.label)).join(',');
  const body   = rows.map(r => columns.map(c => csvCell(r[c.key] ?? '')).join(','));
  return [header, ...body].join('\n');
}

// HTML-escape for the printable document. esc() lives in a view file; keep
// 00-logic.js free of cross-file deps so it stays requireable from Node.
function _escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function tableToPrintHtml({ title, subtitle, columns, rows }) {
  const head = columns.map(c => `<th>${_escHtml(c.label)}</th>`).join('');
  const body = rows.length
    ? rows.map(r => `<tr>${columns.map(c => `<td>${_escHtml(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" class="none-msg">No data for this selection.</td></tr>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${_escHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 32px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
  td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .none-msg { color: #666; font-style: italic; }
  @media print {
    body { padding: 16px; }
    @page { margin: 1cm; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>${_escHtml(title)}</h1>
  ${subtitle ? `<div class="meta">${_escHtml(subtitle)}</div>` : ''}
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

// Narrow a full table to the caller's chosen columns (rows are untouched — the
// renderers only read the keys they're given). `keys` null/undefined = keep all.
function pickColumns(table, keys) {
  if (!keys) return table;
  const set = new Set(keys);
  return { columns: table.columns.filter(c => set.has(c.key)), rows: table.rows };
}

// Roster export. `columns` is the available column set (the wrapper builds it
// from the band's enabled + custom fields); values read straight off the student
// doc, with instrument normalized and the sign-in code upper-cased.
function buildRosterExportTable(students, columns) {
  const rows = students.map(s => {
    const row = {};
    for (const c of columns) {
      if (c.key === 'instrument')       row[c.key] = normInstrument(s.instrument);
      else if (c.key === 'studentCode') row[c.key] = (s.studentCode || '').toUpperCase();
      else                              row[c.key] = s[c.key] ?? '';
    }
    return row;
  });
  return { columns, rows };
}

const MARKS_DETAIL_COLS = [
  { key: 'date',       label: 'Date' },
  { key: 'label',      label: 'Event' },
  { key: 'number',     label: 'Student Number' },
  { key: 'name',       label: 'Name' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'positives',  label: 'Positive Marks' },
  { key: 'mistakes',   label: 'Mistake Marks' },
  { key: 'recordedBy', label: 'Recorded By' },
];
const MARKS_SUMMARY_COLS = [
  { key: 'number',    label: 'Student Number' },
  { key: 'name',      label: 'Name' },
  { key: 'positives', label: 'Positive Marks' },
  { key: 'mistakes',  label: 'Mistake Marks' },
  { key: 'absences',  label: 'Absences' },
  { key: 'lates',     label: 'Lates' },
];

// Marks / attendance export. `rehearsals` should already be date-filtered by the
// caller; `entries` is keyed rehearsalId → { studentNumber → entry }.
//   mode 'detail'  — one row per recorded student×event.
//   mode 'summary' — one row per student, totals across the range.
// `authorLabel` maps an author uid to a display label (dirLabel) — never emails.
function buildMarksExportTable(rehearsals, entries, students, opts = {}) {
  const { mode = 'detail', authorLabel = (x => x) } = opts;
  const byNum = {};
  for (const s of students) byNum[String(s.number)] = s;

  if (mode === 'summary') {
    const agg = {};
    const ensure = num => (agg[num] || (agg[num] = { positives: 0, mistakes: 0, absences: 0, lates: 0 }));
    for (const s of students) ensure(String(s.number));
    for (const r of rehearsals) {
      for (const [num, e] of Object.entries(entries[r.id] || {})) {
        const a = ensure(num);
        a.positives += e.positives || 0;
        a.mistakes  += e.mistakes  || 0;
        if (e.attendance === 'absent') a.absences++;
        else if (e.attendance === 'late') a.lates++;
      }
    }
    const rows = students.map(s => {
      const a = agg[String(s.number)];
      return { number: s.number, name: s.name || '', positives: a.positives,
               mistakes: a.mistakes, absences: a.absences, lates: a.lates };
    });
    return { columns: MARKS_SUMMARY_COLS, rows };
  }

  const rows = [];
  for (const r of rehearsals) {
    for (const [num, e] of Object.entries(entries[r.id] || {})) {
      const att = e.attendance ? e.attendance.charAt(0).toUpperCase() + e.attendance.slice(1) : '';
      rows.push({
        date:       r.date || '',
        label:      r.label || '',
        number:     num,
        name:       byNum[num]?.name || '',
        attendance: att,
        positives:  e.positives || 0,
        mistakes:   e.mistakes || 0,
        recordedBy: authorLabel(e.by || e.updatedBy || ''),
      });
    }
  }
  return { columns: MARKS_DETAIL_COLS, rows };
}

// Leaderboard export from scoreStudentsCore() output (director view — real
// names, not the student-facing pseudonyms). Ranked by score, highest first.
function buildLeaderboardExportTable(scored) {
  const columns = [
    { key: 'rank',      label: 'Rank' },
    { key: 'name',      label: 'Name' },
    { key: 'number',    label: 'Student Number' },
    { key: 'score',     label: 'Score' },
    { key: 'positives', label: 'Positive Marks' },
    { key: 'mistakes',  label: 'Mistake Marks' },
  ];
  const rows = scored.slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((e, i) => ({
      rank:      i + 1,
      name:      e.s?.name || '',
      number:    e.s?.number ?? '',
      score:     Math.round((e.score || 0) * 100) / 100,
      positives: e.positives || 0,
      mistakes:  e.mistakes || 0,
    }));
  return { columns, rows };
}

// Song memorization matrix: one row per student, one column per song
// (Passed / Try Again / blank), plus a passed count.
function buildSongsExportTable(students, songs) {
  const columns = [
    { key: 'number', label: 'Student Number' },
    { key: 'name',   label: 'Name' },
    ...songs.map(sg => ({ key: `song:${sg.id}`, label: sg.title || 'Untitled' })),
    { key: 'passedCount', label: 'Songs Passed' },
  ];
  const rows = students.map(s => {
    const num = String(s.number);
    const row = { number: s.number, name: s.name || '' };
    let passed = 0;
    for (const sg of songs) {
      const st = sg.statuses?.[num]?.status;
      row[`song:${sg.id}`] = st === 'passed' ? 'Passed' : st === 'failed' ? 'Try Again' : '';
      if (st === 'passed') passed++;
    }
    row.passedCount = passed;
    return row;
  });
  return { columns, rows };
}

// Task check-off matrix: one row per student, one column per task
// (Done / Not done, or blank when the task doesn't apply to that student).
function buildTasksExportTable(students, tasks) {
  const columns = [
    { key: 'number', label: 'Student Number' },
    { key: 'name',   label: 'Name' },
    ...tasks.map(t => ({ key: `task:${t.id}`, label: t.title || 'Untitled' })),
  ];
  const rows = students.map(s => {
    const num = String(s.number);
    const row = { number: s.number, name: s.name || '' };
    for (const t of tasks) {
      row[`task:${t.id}`] = taskAppliesToStudent(s, t)
        ? (t.statuses?.[num]?.done ? 'Done' : 'Not done')
        : '';
    }
    return row;
  });
  return { columns, rows };
}

// One song across a (usually filtered) set of students — "who has passed this
// song?" One row per student: status, when it was recorded, and any note.
// `fmtTs` formats an epoch-ms stamp for display (kept out of 00-logic.js).
function buildSongRosterExportTable(students, song, fmtTs = (x => x)) {
  const columns = [
    { key: 'number', label: 'Student Number' },
    { key: 'name',   label: 'Name' },
    { key: 'status', label: 'Status' },
    { key: 'date',   label: 'Date' },
    { key: 'note',   label: 'Note' },
  ];
  const statuses = song?.statuses || {};
  const rows = students.map(s => {
    const st = statuses[String(s.number)] || {};
    const status = st.status === 'passed' ? 'Passed' : st.status === 'failed' ? 'Try Again' : '';
    return { number: s.number, name: s.name || '', status,
             date: st.updatedAt ? fmtTs(st.updatedAt) : '', note: st.note || '' };
  });
  return { columns, rows };
}

// One task across a (usually filtered) set of students — "who has completed this
// task?" One row per student: Done / Not done, or N/A where the task doesn't
// apply to that student (see taskAppliesToStudent). `fmtTs` as above.
function buildTaskRosterExportTable(students, task, fmtTs = (x => x)) {
  const columns = [
    { key: 'number', label: 'Student Number' },
    { key: 'name',   label: 'Name' },
    { key: 'status', label: 'Status' },
    { key: 'date',   label: 'Date' },
  ];
  const statuses = task?.statuses || {};
  const rows = students.map(s => {
    if (!taskAppliesToStudent(s, task)) return { number: s.number, name: s.name || '', status: 'N/A', date: '' };
    const st = statuses[String(s.number)] || {};
    return { number: s.number, name: s.name || '', status: st.done ? 'Done' : 'Not done',
             date: st.done && st.updatedAt ? fmtTs(st.updatedAt) : '' };
  });
  return { columns, rows };
}

// ── Per-drill spot assignments (CSV) ─────────────────────────────────────────
// A drill's spot map links each performer label ("A1", "M1") to a student
// number, per show. Bulk-assigned from a two-column CSV (label + student
// number); the viewer UI (js/12-drill.js) applies the returned delta.

const DRILL_LABEL_ALIASES = ['label','spot','position','pos','drill label','drill spot','dot','performer'];

// Normalize a stored spot value (string, array, or empty) to an array of
// student-number strings. A spot can hold more than one student (shared spots).
function drillSpotNums(v) {
  if (Array.isArray(v)) return v.map(x => String(x)).filter(Boolean);
  return (v === 0 || v) ? [String(v)].filter(Boolean) : [];
}

// Split a field-spot label into its section letter(s) and rank number, e.g.
// "M1" → { section:'M', rank:1 }, "A12" → { section:'A', rank:12 }. A label with
// no trailing number keeps the whole label as the section and rank 0.
function drillSpotLabelParts(label) {
  const m = /^([A-Za-z]*)(\d+)$/.exec(String(label || '').trim());
  if (m) return { section: (m[1] || '?').toUpperCase(), rank: parseInt(m[2], 10) };
  return { section: (String(label || '').trim() || '?').toUpperCase(), rank: 0 };
}

// Enforce "one spot per student per show": pull `num` out of every spot except
// `keepLabel`, so a student never holds two spots in the same show. Shared spots
// (2+ students at ONE label) are preserved — only the student's OTHER labels are
// touched. An emptied spot becomes an explicit `[]` ("cleared"). Mutates and
// returns `mapping`.
function drillSpotStripOthers(mapping, keepLabel, num) {
  const s = String(num);
  Object.keys(mapping || {}).forEach(lbl => {
    if (lbl === keepLabel) return;
    const arr = drillSpotNums(mapping[lbl]);
    if (!arr.includes(s)) return;
    const rest = arr.filter(n => n !== s);
    mapping[lbl] = rest.length === 1 ? rest[0] : rest; // [] ⇒ explicitly cleared
  });
  return mapping;
}

// The assignment changes between two spot maps, as [{ label, num, action }]
// with action 'add' | 'remove'. Feeds the director-only spot-history log: every
// mapping write appends its diff so "who marched which spot, and when" survives
// reassignments. Deterministic order (label, then number, removes before adds)
// so identical edits produce identical event lists.
function drillMappingDiff(oldMapping, newMapping) {
  const events = [];
  const labels = new Set([...Object.keys(oldMapping || {}), ...Object.keys(newMapping || {})]);
  [...labels].sort().forEach(label => {
    const before = new Set(drillSpotNums((oldMapping || {})[label]));
    const after  = new Set(drillSpotNums((newMapping || {})[label]));
    const removed = [...before].filter(n => !after.has(n)).sort();
    const added   = [...after].filter(n => !before.has(n)).sort();
    removed.forEach(num => events.push({ label, num, action: 'remove' }));
    added.forEach(num => events.push({ label, num, action: 'add' }));
  });
  return events;
}

// Fold a show's spot-history events into assignment spans: who held which spot,
// from when to when. `events` are { label, num, action, at? } in any order (at =
// ms epoch); `currentMapping` is the show's live map, which marks open spans as
// current and surfaces assignments that predate history tracking (start null).
// A remove with no matching add (also pre-tracking) yields a span with start
// null. Returns [{ num, label, start, end, current }] with current spans first,
// then most recently ended.
function spotHistorySpans(events, currentMapping) {
  const sorted = (events || [])
    .filter(e => e && e.label && (e.num === 0 || e.num))
    .slice()
    .sort((a, b) => (a.at || 0) - (b.at || 0));

  const open  = {}; // "num|label" → span still open
  const spans = [];
  sorted.forEach(e => {
    const num = String(e.num);
    const key = `${num}|${e.label}`;
    if (e.action === 'add') {
      if (open[key]) return; // duplicate add — keep the original start
      const span = { num, label: e.label, start: e.at || null, end: null, current: false };
      open[key] = span;
      spans.push(span);
    } else if (e.action === 'remove') {
      if (open[key]) { open[key].end = e.at || null; delete open[key]; }
      else spans.push({ num, label: e.label, start: null, end: e.at || null, current: false });
    }
  });

  // Reconcile with the live map: assignments in it are current (adding an
  // untracked span when history never saw the add), anything else stays closed.
  const cur = new Set();
  Object.keys(currentMapping || {}).forEach(label =>
    drillSpotNums(currentMapping[label]).forEach(n => cur.add(`${n}|${label}`)));
  Object.values(open).forEach(span => { span.current = cur.has(`${span.num}|${span.label}`); });
  cur.forEach(key => {
    if (open[key]) return;
    const [num, label] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
    spans.push({ num, label, start: null, end: null, current: true });
  });

  return spans.sort((a, b) =>
    (b.current - a.current)
    || ((b.end ?? Infinity) - (a.end ?? Infinity))
    || ((b.start || 0) - (a.start || 0)));
}

// Apply a spot CSV to a drill's current mapping, merging by STUDENT so partial
// sheets are safe: every student listed in the sheet is re-placed at the spot in
// their row (a blank spot ⇒ unassigned); students not in the sheet are left
// alone; two rows that name the same spot share it. Column detection accepts
// either orientation — a Label/Spot column plus a Student Number column — so the
// roster-style template (one row per student) and a spot-style sheet both work.
// A label row with no number clears that spot. Returns the new mapping (single
// student ⇒ string, multiple ⇒ array) plus stats. `validNumbers` is a Set/array
// of roster numbers as strings; an empty set skips the roster check.
function applyDrillSpotCsv(currentMapping, text, validNumbers) {
  const rows = parseCSV(text);
  const base = { mapping: { ...(currentMapping || {}) }, assigned: 0, cleared: 0, shared: 0, unknown: [], rows: 0 };
  if (!rows.length) return base;
  const headers  = rows[0].map(h => (h || '').toLowerCase().trim());
  const labelIdx = headers.findIndex(h => DRILL_LABEL_ALIASES.includes(h));
  const numIdx   = headers.findIndex(h => COL_ALIASES.number.includes(h));
  if (labelIdx === -1 || numIdx === -1) return { ...base, error: 'columns' };
  const valid = validNumbers instanceof Set ? validNumbers : new Set(validNumbers || []);

  // Working label → Set(numbers) from the current mapping.
  const next = {};
  for (const [lbl, v] of Object.entries(currentMapping || {})) {
    const arr = drillSpotNums(v);
    if (arr.length) next[lbl] = new Set(arr);
  }

  const mentioned = new Set();   // valid students in the sheet (to re-place)
  const assign = [];             // [{label, num}] valid spot rows
  const clearLabels = new Set(); // labels emptied by a number-less row
  const unknown = [];
  let seen = 0;
  for (let i = 1; i < rows.length; i++) {
    const num   = (rows[i][numIdx]   || '').trim();
    const label = (rows[i][labelIdx] || '').trim().toUpperCase();
    if (!num && !label) continue;
    const known = !valid.size || valid.has(num);
    if (num && !known) { if (label) unknown.push({ label, number: num }); continue; }
    if (num) mentioned.add(num);           // known number: re-place it
    if (!label) continue;                  // student with no spot ⇒ just unassign
    seen++;
    if (!num) { clearLabels.add(label); continue; } // spot with no number ⇒ clear it
    assign.push({ label, num });
  }

  // Re-place: pull every mentioned student out of their current spot(s)…
  for (const set of Object.values(next)) for (const n of mentioned) set.delete(n);
  // …then drop them at the spot named in their row.
  let assigned = 0;
  for (const { label, num } of assign) { (next[label] = next[label] || new Set()).add(num); assigned++; }
  for (const lbl of clearLabels) delete next[lbl];

  // Materialize: single ⇒ string, multiple ⇒ array; drop empties.
  const mapping = {};
  let shared = 0;
  for (const [lbl, set] of Object.entries(next)) {
    const arr = [...set];
    if (!arr.length) continue;
    mapping[lbl] = arr.length === 1 ? arr[0] : arr;
    if (arr.length > 1) shared++;
  }
  let cleared = 0;
  for (const n of mentioned) {
    let placed = false;
    for (const set of Object.values(next)) if (set.has(n)) { placed = true; break; }
    if (!placed) cleared++;
  }
  return { mapping, assigned, cleared, shared, unknown, rows: seen };
}

// ── Instruments, grades, and the list filter/sort engine ─────────────────────

// Strip the numeric prefix some imports carry ("12 Trumpet" → "Trumpet").
function normInstrument(str) {
  return (str || '').replace(/^\d+\s*/, '').trim();
}

// Score order: groups of names that all share the same rank position.
// Includes full names, abbreviations, and plurals to handle any stored variant.
const _SCORE_ORDER = [
  ['Majorette','Majorettes'],
  ['Piccolo'],
  ['Flute','Flutes'],
  ['Oboe'],
  ['Bassoon'],
  ['Clarinet','Clarinets'],
  ['Bass Clarinet'],
  ['Sax','Saxophone','Saxophones','Alto Sax','Alto Saxophone','Tenor Sax','Tenor Saxophone','Bari Sax','Bari Saxophone','Baritone Sax','Baritone Saxophone'],
  ['Trumpet','Trumpets'],
  ['Mellophone','Mello','Mellos','French Horn','Horn','Horns'],
  ['Trombone','Trombones'],
  ['Bass Trombone'],
  ['Baritone','Baritone/Euphonium','Euphonium','Baritones'],
  ['Tuba','Tubas'],
  ['Snare Drum','Snare','Tenor Drums','Tenors','Tenor','Bass Drum','Cymbals','Marimba','Xylophone','Vibraphone','Percussion','Perc','Pit'],
  ['Color Guard','Guard'],
  ['Drum Major','Drum Majors'],
  ['Other'],
];
const _INSTR_IDX = new Map();
_SCORE_ORDER.forEach((names, i) => names.forEach(n => _INSTR_IDX.set(n.toLowerCase(), i)));
function instrOrder(name) {
  return _INSTR_IDX.get((normInstrument(name) || '').toLowerCase()) ?? _SCORE_ORDER.length;
}

// Generational suffixes that must not be mistaken for a surname. A lone letter
// (a last initial, "Alex V") is left alone — dropping it would lose the only
// sorting signal there is.
const _NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

// Surname for alphabetizing. Handles both shapes a roster import can carry:
// "Last, First" (comma wins) and "First Middle Last". Returns lowercase, or ''
// when there's no name to go on.
function studentLastName(name) {
  const n = (name || '').trim();
  if (!n) return '';
  if (n.includes(',')) return n.slice(0, n.indexOf(',')).trim().toLowerCase();
  const parts = n.split(/\s+/);
  while (parts.length > 1 && _NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase().replace(/\./g, ''))) {
    parts.pop();
  }
  return parts[parts.length - 1].toLowerCase();
}

// Hand-out order for the printed code slips: score order by instrument, then
// alphabetical by last name. Within one score rank we also sort on the
// instrument's own name so same-rank instruments (Alto vs Tenor Sax, snares vs
// pit) come off the printer in one stack per instrument. Students with no
// instrument recorded sort to the very end.
function compareStudentsByInstrumentThenLastName(a, b) {
  const ia = normInstrument(a.instrument), ib = normInstrument(b.instrument);
  const ra = ia ? instrOrder(ia) : Number.MAX_SAFE_INTEGER;
  const rb = ib ? instrOrder(ib) : Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  return ia.toLowerCase().localeCompare(ib.toLowerCase())
    || studentLastName(a.name).localeCompare(studentLastName(b.name))
    || (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
    || String(a.number).localeCompare(String(b.number));
}

const GRADE_LEVELS = ['8th','9th','10th','11th','12th'];

// The comparable value for one student under one sort field: a string for
// alphabetical fields, a number for ordinal/score ones. Missing values sort to
// the end of an ascending list (score-ish → -1, so descending puts them last).
// `scoreMap` supplies the per-student values for score-ish fields.
function studentSortValue(s, field, scoreMap) {
  switch (field) {
    case 'name':       return (s.name||'').toLowerCase();
    case 'number':     return +s.number||0;
    case 'instrument': return instrOrder(s.instrument);
    case 'section':    return (s.section||'').toLowerCase();
    case 'grade':      return GRADE_LEVELS.indexOf(s.grade||'');
    case 'score': case 'positives': case 'mistakes': case 'passed': case 'missing': case 'done':
      return scoreMap?.[s.number]?.[field] ?? -1;
    case 'absences':   return scoreMap?.[s.number]?.absences ?? 0;
    case 'lates':      return scoreMap?.[s.number]?.lates ?? 0;
    case 'attStatus': {
      const order = { absent: 0, late: 1, present: 2, undefined: 2 };
      return order[scoreMap?.[s.number]?.att] ?? 2;
    }
    case 'songStatus': {
      const order = { passed: 0, failed: 1, not_attempted: 2 };
      return order[scoreMap?.[s.number]?.status] ?? 2;
    }
    default: return (s.name||'').toLowerCase();
  }
}

// One field's contribution to the sort, honoring direction.
function _studentFieldCmp(a, b, field, dir, scoreMap) {
  const va = studentSortValue(a, field, scoreMap);
  const vb = studentSortValue(b, field, scoreMap);
  const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va - vb);
  return dir === 'asc' ? cmp : -cmp;
}

// The ordered sort keys for a filter: the primary (f.sortField/f.sortDir)
// followed by any additional layers in f.sorts ([{field,dir}, …]). Layers that
// repeat an earlier field are dropped (sorting by the same field twice is a
// no-op), so the result is de-duplicated and each field appears once.
function sortKeys(f) {
  const keys = [];
  const seen = new Set();
  for (const k of [{ field: f.sortField, dir: f.sortDir }, ...(f.sorts || [])]) {
    if (!k || !k.field || seen.has(k.field)) continue;
    seen.add(k.field);
    keys.push({ field: k.field, dir: k.dir || 'asc' });
  }
  return keys;
}

// The engine behind every filterable list view (roster, tracker, attendance,
// leaderboard, songs). `f` is a filter object from _mkFilter (search, sort
// field/dir, optional layered `sorts`, instruments/sections/grades arrays);
// `scoreMap` supplies the per-student values for score-ish sort fields. Each
// sort key beyond the first breaks ties in the previous one, so "name, then
// grade, then number" reads left-to-right as layered tie-breakers.
function filterAndSortStudents(students, f, scoreMap) {
  let pool = [...students];
  // search
  if (f.search) {
    const q = f.search.toLowerCase();
    pool = pool.filter(s =>
      (s.name||'').toLowerCase().includes(q) ||
      String(s.number).includes(q) ||
      normInstrument(s.instrument).toLowerCase().includes(q)
    );
  }
  // filters — OR within category, AND across categories
  if (f.instruments.length) pool = pool.filter(s => f.instruments.includes(normInstrument(s.instrument)));
  if (f.grades.length)      pool = pool.filter(s => f.grades.includes(s.grade || ''));
  if (f.sections.length)    pool = pool.filter(s => f.sections.includes(s.section || ''));
  // sort — apply each key in order, the first non-tie deciding.
  const keys = sortKeys(f);
  pool.sort((a, b) => {
    for (const k of keys) {
      const cmp = _studentFieldCmp(a, b, k.field, k.dir, scoreMap);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return pool;
}

// ── Seasons ───────────────────────────────────────────────────────────────────

// ── Re-uploading a drill file: carrying spots across a relabel ───────────────
// Two parses of the same drill can name the same physical performer
// differently — the .3da CAST label fix below did exactly that to files
// imported before it — which would leave every student standing at someone
// else's dot. Both parses describe the same bodies in the same formations, so
// pair performers by WHERE THEY STAND and carry the spot map across that
// pairing.

// Pair old→new performer labels by position. Pages are matched by set count
// (falling back to list order), and a constant whole-field offset between the
// parses is measured from the first shared set and removed first — the .3da X
// calibration fix shifted every dot 8 steps. A pair is accepted only when the
// two are each other's closest match AND agree at EVERY shared set within `tol`
// steps, so two genuinely different drills pair almost nothing and the caller
// can tell from `matched`/`total`.
function drillPositionPairs(oldPages, newPages, tol = 0.25) {
  const oldP = Array.isArray(oldPages) ? oldPages : [];
  const newP = Array.isArray(newPages) ? newPages : [];
  const none = { pairs: {}, matched: 0, total: 0, offsetX: 0, offsetY: 0 };
  if (!oldP.length || !newP.length) return none;

  const byCount = {};
  oldP.forEach(pg => { if (pg && byCount[pg.count] === undefined) byCount[pg.count] = pg; });
  let pagePairs = [];
  newP.forEach(pg => { const o = pg && byCount[pg.count]; if (o) pagePairs.push([o, pg]); });
  if (!pagePairs.length) {
    const n = Math.min(oldP.length, newP.length);
    for (let i = 0; i < n; i++) pagePairs.push([oldP[i], newP[i]]);
  }
  // Only sets where both parses list the same number of performers are usable.
  pagePairs = pagePairs.filter(([o, n]) => {
    const a = (o && o.performers) || [], b = (n && n.performers) || [];
    return a.length && a.length === b.length;
  });
  if (!pagePairs.length) return none;

  const mean = (arr, f) => arr.reduce((t, p) => t + f(p), 0) / arr.length;
  const [o0, n0] = pagePairs[0];
  const offsetX = mean(n0.performers, p => p.stepsX) - mean(o0.performers, p => p.stepsX);
  const offsetY = mean(n0.performers, p => p.stepsY) - mean(o0.performers, p => p.stepsY);

  // Each label's trajectory across the shared sets. A label missing from a set
  // — or listed twice in one — can't be paired safely, so it's dropped.
  const tracks = (which, dx, dy) => {
    const t = {}, bad = new Set();
    pagePairs.forEach((pp, i) => {
      pp[which].performers.forEach(p => {
        const a = (t[p.label] = t[p.label] || []);
        if (a.length !== i) { bad.add(p.label); return; }
        a.push([p.stepsX + dx, p.stepsY + dy]);
      });
    });
    bad.forEach(k => delete t[k]);
    Object.keys(t).forEach(k => { if (t[k].length !== pagePairs.length) delete t[k]; });
    return t;
  };
  const oldT = tracks(0, offsetX, offsetY), newT = tracks(1, 0, 0);

  const dev = (a, b) => {
    let m = 0;
    for (let i = 0; i < a.length; i++) {
      m = Math.max(m, Math.abs(a[i][0] - b[i][0]), Math.abs(a[i][1] - b[i][1]));
      if (m > tol) return Infinity;
    }
    return m;
  };
  const bestOld = {}, bestNew = {};
  const oldLabels = Object.keys(oldT), newLabels = Object.keys(newT);
  oldLabels.forEach(ol => newLabels.forEach(nl => {
    const d = dev(oldT[ol], newT[nl]);
    if (d === Infinity) return;
    if (!bestOld[ol] || d < bestOld[ol].d) bestOld[ol] = { lbl: nl, d };
    if (!bestNew[nl] || d < bestNew[nl].d) bestNew[nl] = { lbl: ol, d };
  }));

  const pairs = {};
  let matched = 0;
  oldLabels.forEach(ol => {
    const b = bestOld[ol];
    if (b && bestNew[b.lbl] && bestNew[b.lbl].lbl === ol) { pairs[ol] = b.lbl; matched++; }
  });
  return { pairs, matched, total: oldLabels.length, offsetX, offsetY };
}

// Carry a label→student spot map from an old parse of a drill onto a new one,
// keeping every student on the same physical dot. Returns the rewritten mapping
// plus the list of moves, so the caller can show a director exactly which
// numbers change before saving; `matched`/`total` let the caller reject a
// pairing that clearly isn't the same drill. Assignments whose label couldn't be
// paired keep their old label (unless something else moved into it) and are
// reported in `unmatched` rather than silently dropped.
function drillRelabelMapping(oldPages, newPages, mapping) {
  const pos = drillPositionPairs(oldPages, newPages);
  const src = mapping || {};
  const next = {}, moves = [], unmatched = [];
  Object.keys(src).forEach(lbl => {
    const to = pos.pairs[lbl];
    if (!to) { if (drillSpotNums(src[lbl]).length) unmatched.push(lbl); return; }
    next[to] = src[lbl];
    if (to !== lbl) moves.push({ from: lbl, to, nums: drillSpotNums(src[lbl]) });
  });
  Object.keys(src).forEach(lbl => {
    if (!pos.pairs[lbl] && !Object.prototype.hasOwnProperty.call(next, lbl)) next[lbl] = src[lbl];
  });
  const rank = l => { const p = drillSpotLabelParts(l); return [p.section, p.rank]; };
  moves.sort((a, b) => {
    const [as, ar] = rank(a.from), [bs, br] = rank(b.from);
    return as === bs ? ar - br : as.localeCompare(bs);
  });
  return {
    mapping: next, moves, unmatched,
    matched: pos.matched, total: pos.total,
    offsetX: pos.offsetX, offsetY: pos.offsetY,
    changed: moves.length > 0,
  };
}

// Suggest a season label for a date, e.g. '2026-07-01' → '2026-27'. Marching
// seasons straddle calendar years like school years; June onward counts as the
// start of the next school year (summer band camp belongs to the fall season).
function suggestSeasonLabel(dateStr) {
  const [y, m] = String(dateStr || '').split('-').map(Number);
  if (!y || !m) return '';
  const startY = m >= 6 ? y : y - 1;
  return `${startY}-${String((startY + 1) % 100).padStart(2, '0')}`;
}

// ── Pyware drill file parsing (pure; the viewer UI lives in js/12-drill.js) ───
//
// Two on-disk formats, both reverse-engineered against real Pyware exports and
// verified so that every set's yard lines and step depths line up:
//
// .3dj ("3DJV") — the classic binary. One PAGE block per animation frame, each
//   a run of 20-byte performer records:
//     byte 1      = stable performer id (follows a performer across frames)
//     byte 8      = section/symbol letter (ASCII)
//     bytes 13-14 = X (big-endian) · bytes 15-16 = Y (big-endian)
//   Positions live in a fixed grid: 120 units = 1 step, the west goal line at
//   X 23168, the sidelines at Y 27728 / 37808 (84 steps apart).
//
// .3da ("3DAP") — a newer *plaintext* "analog" export. A single PAGE block
//   holds every animation frame back-to-back. The PAGE header is
//   [u16][u16][u16 frameCount][u16 performerCount]; then each frame is N
//   14-byte records (frames separated by a short, sometimes text-annotated
//   header):
//     bytes 0-1   = performer index 1..N (stable across frames)
//     bytes 2-5   = X (signed, big-endian) · bytes 6-9 = Y (signed, big-endian)
//     bytes 10-13 = a word whose low byte is the section symbol (ASCII)
//   A CAST block ahead of the PAGE block names every performer: [u16 count]
//   then one record per performer of [u16 index][lenstr number][lenstr extra],
//   where a "lenstr" is [u16 len][ASCII] and len counts its own 2 bytes. That
//   number is the drill writer's own label ("M1" is symbol M + number 1), which
//   does NOT follow field order — see _pywareAssembleDrill.
//   Positions are signed and measured from the CENTER of the field (the 50, on
//   the 50/50 line): 625 units = 1 marching step, i.e. 1000 units = 1 yard, as
//   the file's own field description states in yards (BORD -50 -26.25 50 26.25,
//   a VTMJ yard-line major every 5, HZHS hashes at ±8.75). So the west goal
//   line sits at raw X -50000 and the front sideline at raw Y +26250 (26.25 yd
//   = 42 steps), which puts the front hash at stepsY 28. An earlier guess of
//   -55000 for the west goal shifted every performer 8 steps (5 yards) east.
//   NOTE: this is a different beast from the *encrypted* newer .3dj/.3dz, which
//   stores positions in an unreadable payload (PYJAVA/PG15) and is rejected in
//   the .3dj branch below.
//
// Both formats funnel into _pywareAssembleDrill, which assigns stable drill
// labels, finds the marked sets and emits { pages, sections } for the viewer.

const _PY_WESTGOAL = 23168; // .3dj grid X at the west goal line
const _PY_FRONT_Y  = 37808; // .3dj grid Y at the (default) front sideline
const _PY_UNIT     = 120;   // .3dj grid units per marching step

const _PY3DA_WESTGOAL = -50000; // .3da raw X at the west goal line
const _PY3DA_FRONT_Y  = 26250;  // .3da raw Y at the (default) front sideline
const _PY3DA_UNIT     = 625;    // .3da raw units per marching step

// Scan a byte array for an ASCII marker. _indexOfMarker returns its offset (or
// -1); _hasMarker is just the boolean.
function _indexOfMarker(u8, str, from = 0) {
  const t = [...str].map(c => c.charCodeAt(0));
  outer: for (let i = Math.max(0, from); i <= u8.length - t.length; i++) {
    for (let j = 0; j < t.length; j++) if (u8[i + j] !== t[j]) continue outer;
    return i;
  }
  return -1;
}
function _hasMarker(u8, str) { return _indexOfMarker(u8, str) >= 0; }

// Turn per-frame performer positions into the viewer's { pages, sections }.
// rawFrames: array of frames; each frame is an array of
// { pid, section, stepsX, stepsY } in a stable per-performer order (pid
// identifies a performer across every frame). setCountsHint: marked-set indices
// from a file's own set table when it has one; otherwise sets are detected
// geometrically. frameNotes (optional): per-frame instruction text (the page's
// Pyware text box) keyed by frame index; a frame that carries text is always
// treated as a marked set and its text rides along on that page. namesByPid
// (optional): the file's own performer numbers keyed by stable id — when the
// file names its performers, those names win over derived ranks. Shared by both
// the .3dj and .3da parsers.
function _pywareAssembleDrill(rawFrames, N, setCountsHint, frameNotes, namesByPid) {
  if (!rawFrames.length) throw new Error('No performer position data found in this file.');

  const labelOf = {}, sectionOf = {};
  rawFrames[0].forEach(p => { sectionOf[p.pid] = p.section; });

  // Prefer the labels the drill writer actually assigned, when the file carries
  // them (the .3da CAST block). Pyware numbers performers by the designer's own
  // scheme — inside one column of a block they may run 1, 4, 3, 2 — so deriving
  // a label from field position renames people (dots land on the wrong
  // performer). A file name is only the number; the section symbol prefixes it
  // unless the name already starts with a letter.
  let named = false;
  if (namesByPid) {
    const seen = new Set();
    named = rawFrames[0].every(p => {
      const nm = String(namesByPid[p.pid] == null ? '' : namesByPid[p.pid]).trim();
      if (!nm) return false;
      const lbl = (/^[A-Za-z]/.test(nm) ? nm : p.section + nm).toUpperCase();
      if (seen.has(lbl)) return false; // ambiguous labels are worse than derived ones
      seen.add(lbl);
      labelOf[p.pid] = lbl;
      return true;
    });
    if (!named) for (const k in labelOf) delete labelOf[k];
  }

  // Fallback (every .3dj, and any .3da without a usable CAST block): section
  // letter + front-to-back rank within that section, so "A1" is the front-most
  // of column A. Either way the label is bound to the stable id, so it always
  // means the same physical performer across every set.
  if (!named) {
    const bySec = {};
    rawFrames[0].forEach(p => { (bySec[p.section] = bySec[p.section] || []).push(p); });
    Object.values(bySec).forEach(arr => {
      arr.sort((a, b) => a.stepsY - b.stepsY).forEach((p, idx) => {
        labelOf[p.pid] = p.section + (idx + 1);
      });
    });
  }

  const allFrames = rawFrames.map(f => f.map(p => ({
    label:   labelOf[p.pid]   || p.section,
    section: sectionOf[p.pid] || p.section,
    stepsX:  p.stepsX,
    stepsY:  p.stepsY,
  })));

  // Marked sets: trust the file's own set table when we were handed one;
  // otherwise detect them geometrically — Pyware moves performers in straight
  // lines between sets, so a marked set is a count where many trajectories
  // bend. (Misses sets the whole form marches straight through, so it's only a
  // fallback.)
  let setCounts = Array.isArray(setCountsHint) ? setCountsHint.slice() : [];
  if (setCounts.length < 2 || setCounts[0] !== 0) {
    const maps = allFrames.map(f => { const m = {}; f.forEach(p => m[p.label] = p); return m; });
    setCounts = [0];
    for (let i = 1; i < allFrames.length - 1; i++) {
      let bends = 0;
      for (const lbl in maps[i]) {
        const a = maps[i-1][lbl], b = maps[i][lbl], c = maps[i+1][lbl];
        if (!a || !c) continue;
        if (Math.abs(b.stepsX - (a.stepsX + c.stepsX)/2) > 0.02 ||
            Math.abs(b.stepsY - (a.stepsY + c.stepsY)/2) > 0.02) bends++;
      }
      if (bends >= Math.max(8, Math.round(N * 0.1)) && i - setCounts[setCounts.length-1] > 2) setCounts.push(i);
    }
  }

  // Any frame the drill writer annotated is a named page — make sure it shows
  // up as a set even if the geometry didn't flag it.
  if (Array.isArray(frameNotes)) {
    const seen = new Set(setCounts);
    frameNotes.forEach((nt, i) => { if (nt && allFrames[i] && !seen.has(i)) { setCounts.push(i); seen.add(i); } });
    setCounts.sort((a, b) => a - b);
  }

  // Each page = a marked set (its count + the formation at that count), plus
  // the set's instruction text when the file carried one.
  const pages = setCounts.filter(c => allFrames[c]).map(c => {
    const pg = { count: c, performers: allFrames[c] };
    if (frameNotes && frameNotes[c]) pg.note = frameNotes[c];
    return pg;
  });
  if (!pages.length) pages.push({ count: 0, performers: allFrames[0] });

  // Sections (A,B,…) with their performer labels (A1,A2,…A10 in order).
  const labelNum = lbl => parseInt(lbl.replace(/^\D+/, ''), 10) || 0;
  const secMap = {};
  pages[0].performers.forEach(p => { (secMap[p.section] = secMap[p.section] || []).push(p.label); });
  const sections = Object.keys(secMap).sort().map(letter => ({
    letter,
    performers: secMap[letter].sort((a, b) => labelNum(a) - labelNum(b)),
  }));

  return { pages, sections };
}

function _parsePywareFile(buffer) {
  const u8   = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // A .3dz is a ZIP package (PK\x03\x04), not a drill file — it bundles the
  // .3dj with artwork/audio. Detect it so the user gets a real explanation
  // instead of "not a Pyware file". (E_DRILL_* codes let the caller show a
  // fuller modal; see _onDrillFileLoaded.)
  if (u8[0]===0x50 && u8[1]===0x4B && u8[2]===0x03 && u8[3]===0x04)
    throw new Error('E_DRILL_ZIP:This is a .3dz package (a ZIP bundle), not a drill file.');

  // .3da ("3DAP") — the newer plaintext export. Positions ARE readable here
  // (unlike the encrypted .3dj/.3dz), so parse them directly.
  if (u8[0]===0x33 && u8[1]===0x44 && u8[2]===0x41 && u8[3]===0x50)
    return _parsePyware3da(u8, view);

  if (u8[0]!==0x33||u8[1]!==0x44||u8[2]!==0x4A||u8[3]!==0x56)
    throw new Error('This does not look like a Pyware drill file.');

  return _parsePyware3dj(u8, view);
}

function _parsePyware3dj(u8, view) {
  // Determine the band's performer count. Each PAGE block tags its performer
  // count at byte 8 (big-endian u16); bands vary (we've seen 144 and 148), so
  // take the most common value across all PAGE tags — robust against any
  // coincidental 'PAGE' bytes in the data.
  let N = 0;
  {
    const tally = {};
    for (let i = 0; i < u8.length - 10; i++) {
      if (u8[i]!==0x50||u8[i+1]!==0x41||u8[i+2]!==0x47||u8[i+3]!==0x45) continue;
      const c = view.getUint16(i + 8, false);
      if (c >= 1 && c <= 2000) tally[c] = (tally[c] || 0) + 1;
    }
    let bestCount = 0;
    for (const k in tally) if (tally[k] > bestCount) { bestCount = tally[k]; N = +k; }
  }
  if (!N) {
    // Newer Pyware exports ("PYJAVA"/"PG15" frame blocks) store performer
    // positions in an ENCRYPTED payload (base64 'XLRM'/'CS9W'/'FNXY' blocks,
    // ~8 bits/byte entropy, no compression). There's no plaintext formation to
    // read — confirmed by reverse-engineering the PreGame sample — so no
    // parser can recover it without Pyware's key. Detect it and say so plainly.
    // (A .3da export of the same show IS readable — see _parsePyware3da.)
    if (_hasMarker(u8, 'PYJAVA') || _hasMarker(u8, 'PG15'))
      throw new Error('E_DRILL_ENCRYPTED:This drill was saved in a newer Pyware format that encrypts the performer positions, so the field chart can’t be read.');
    throw new Error('No performer position data found in this file.');
  }

  // Read every PAGE block (one frame of N records), keyed by the stable id.
  const rawFrames = [];
  let firstPage = -1;
  for (let i = 0; i < u8.length - 10; i++) {
    if (u8[i]!==0x50||u8[i+1]!==0x41||u8[i+2]!==0x47||u8[i+3]!==0x45) continue; // 'PAGE'
    if (view.getUint16(i + 8, false) !== N) continue;
    if (firstPage < 0) firstPage = i;
    const base0 = i + 10;
    if (base0 + N * 20 > u8.length) break;
    const frame = [];
    for (let e = 0; e < N; e++) {
      const b = base0 + e * 20;
      const xRaw = (u8[b + 13] << 8) | u8[b + 14];
      const yRaw = (u8[b + 15] << 8) | u8[b + 16];
      frame.push({
        pid:     u8[b + 1],
        section: String.fromCharCode(u8[b + 8]),
        stepsX: (xRaw - _PY_WESTGOAL) / _PY_UNIT, // steps from west goal (0..160)
        stepsY: (_PY_FRONT_Y - yRaw)  / _PY_UNIT, // steps off the front sideline (0..84)
      });
    }
    rawFrames.push(frame);
    i += 9 + N * 20; // skip past this block's records to the next tag
  }

  // Read Pyware's marked-set table, which sits immediately before the PAGE
  // blocks: a run of 18-byte records (count as big-endian u16 at bytes 0-1,
  // byte 14 = 0x01), set 1 (count 0) first. We walk backward from the first
  // PAGE block, which is exactly where the table ends.
  let setCounts = [];
  if (firstPage >= 0) {
    let off = firstPage - 18, prev = Infinity;
    while (off >= 0) {
      const c = view.getUint16(off, false);
      if (c >= prev || u8[off + 14] !== 0x01) break;
      setCounts.unshift(c);
      prev = c;
      if (c === 0) break;
      off -= 18;
    }
  }

  return _pywareAssembleDrill(rawFrames, N, setCounts);
}

function _parsePyware3da(u8, view) {
  const p = _indexOfMarker(u8, 'PAGE');
  if (p < 0 || p + 12 > u8.length)
    throw new Error('No performer position data found in this file.');

  // PAGE header: [u16][u16][u16 frameCount][u16 performerCount], then records.
  const N = view.getUint16(p + 10, false);
  if (!N || N > 2000)
    throw new Error('No performer position data found in this file.');

  const names = _pyware3daCast(u8, view, p, N);

  const REC = 14, start = p + 12;
  const idxAt = o => (u8[o] << 8) | u8[o + 1];
  // A frame is N records with indices 1..N. Frames are separated by a short,
  // occasionally text-annotated header, so after each frame we skip forward to
  // the next index==1 rather than assuming a fixed stride.
  const frameLenAt = o => {
    let r = 0;
    while (o + r * REC + 2 <= u8.length && idxAt(o + r * REC) === r + 1) r++;
    return r;
  };

  const rawFrames = [], frameNotes = [];
  let o = start, guard = 0;
  while (o <= u8.length - REC && rawFrames.length < 5000 && guard++ <= u8.length) {
    if (frameLenAt(o) < N) { o++; continue; }
    const frame = [];
    for (let e = 0; e < N; e++) {
      const b = o + e * REC;
      const sym = u8[b + 13]; // low byte of the 4-byte symbol word
      frame.push({
        pid:     idxAt(b),
        section: String.fromCharCode(sym >= 32 && sym < 127 ? sym : 63), // '?' if not printable
        stepsX:  (view.getInt32(b + 2, false) - _PY3DA_WESTGOAL) / _PY3DA_UNIT, // steps from west goal
        stepsY:  (_PY3DA_FRONT_Y - view.getInt32(b + 6, false)) / _PY3DA_UNIT,  // steps off the front sideline
      });
    }
    rawFrames.push(frame);
    const recEnd = o + N * REC;
    // Advance to the next real frame (a full 1..N run). The bytes in between are
    // this frame's inter-frame header, which may carry the page's instruction
    // text. Bounded so a truncated end-of-file tail can't spin.
    o = recEnd;
    let hop = 0;
    while (o + 2 <= u8.length && frameLenAt(o) < N && hop < 8192) { o++; hop++; }
    frameNotes.push(_pyware3daPageNote(u8, recEnd, o, N));
  }

  return _pywareAssembleDrill(rawFrames, N, undefined, frameNotes, names);
}

// The .3da CAST block: the drill writer's own performer numbers, keyed by the
// performer index the position records use. Layout is
//   'CAST' [u32 blockLen][u16 count] then count records of
//   [u16 index][lenstr number][lenstr extra]
// where a lenstr is [u16 len][ASCII] and len counts its own 2 bytes (so len 2
// is an empty string). Returns { [index]: number } or null when the file has no
// CAST block, or one we can't read end-to-end — the caller then falls back to
// deriving labels from field position. Everything is validated (count matches
// the performer count, records consume exactly blockLen, indices are in range
// and unique) so a coincidental 'CAST' in the payload can't produce garbage.
function _pyware3daCast(u8, view, pageOffset, N) {
  for (let c = _indexOfMarker(u8, 'CAST'); c >= 0 && c < pageOffset;
       c = _indexOfMarker(u8, 'CAST', c + 1)) {
    if (c + 10 > u8.length) break;
    const end = c + 8 + view.getUint32(c + 4, false);
    if (end > u8.length || end > pageOffset) continue;
    if (view.getUint16(c + 8, false) !== N) continue;

    const names = {};
    let o = c + 10, ok = true;
    for (let i = 0; i < N && ok; i++) {
      if (o + 2 > end) { ok = false; break; }
      const idx = view.getUint16(o, false); o += 2;
      if (idx < 1 || idx > N || names[idx] !== undefined) { ok = false; break; }
      let s = '';
      for (let f = 0; f < 2 && ok; f++) {          // the number, then the extra field
        if (o + 2 > end) { ok = false; break; }
        const len = view.getUint16(o, false);
        if (len < 2 || o + len > end) { ok = false; break; }
        if (f === 0) for (let k = o + 2; k < o + len; k++) s += String.fromCharCode(u8[k]);
        o += len;
      }
      names[idx] = s;
    }
    if (ok && o === end) return names;
  }
  return null;
}

// The page's instruction text (its Pyware text box) from a .3da inter-frame
// header. The header ends with the next frame's [u16 performerCount]; an
// annotated page stores [u16 blockLen][ASCII text] immediately before it, where
// blockLen counts the 2-byte length field plus the text. Returns '' when absent.
function _pyware3daPageNote(u8, gapStart, gapEnd, N) {
  const textEnd = gapEnd - 2; // the 2 trailing bytes are the next frame's perfcount
  if (textEnd - gapStart < 3) return '';
  const u16 = q => (u8[q] << 8) | u8[q + 1];
  if (u16(textEnd) !== N) return ''; // confirm the trailing perfcount (no next frame ⇒ no note)
  const printable = b => (b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9;
  for (let q = gapStart; q < textEnd - 1; q++) {
    const blockLen = u16(q);
    if (blockLen < 3 || q + blockLen !== textEnd) continue;
    let ok = true;
    for (let i = q + 2; i < textEnd; i++) if (!printable(u8[i])) { ok = false; break; }
    if (!ok) continue;
    let s = '';
    for (let i = q + 2; i < textEnd; i++) s += String.fromCharCode(u8[i]);
    return s.replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
  }
  return '';
}

// ── Node export (browser ignores this) ────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FAKE_ADJECTIVES, FAKE_ANIMALS, _strHash, pseudonymFor,
    eventType, isPerformance, eventTypeLabel,
    rehearsalIncludesStudent, rehearsalScopeLabel, compareRehearsalsDesc, rehearsalPredatesStudent, rehearsalStreak, rehearsalsAttended,
    isMemorizationExcluded,
    taskAppliesToStudent, _taskMatchesGroups,
    isDoneLate,
    lbWeights, scoreStudentsCore, buildPublicStats,
    checkAutoMarkCondition, computeAutoMarkEvents,
    parseCSVLine, parseCSV, COL_ALIASES, normalizeGrade, detectCols,
    csvCell, buildStudentCodesCsv,
    tableToCsv, tableToPrintHtml, _escHtml, pickColumns,
    buildRosterExportTable, buildMarksExportTable, MARKS_DETAIL_COLS, MARKS_SUMMARY_COLS,
    buildLeaderboardExportTable, buildSongsExportTable, buildTasksExportTable,
    buildSongRosterExportTable, buildTaskRosterExportTable,
    DRILL_LABEL_ALIASES, drillSpotNums, drillSpotStripOthers, drillSpotLabelParts, applyDrillSpotCsv,
    drillMappingDiff, spotHistorySpans,
    drillPositionPairs, drillRelabelMapping,
    suggestSeasonLabel,
    normInstrument, instrOrder, GRADE_LEVELS, filterAndSortStudents, studentSortValue, sortKeys,
    studentLastName, compareStudentsByInstrumentThenLastName,
    _hasMarker, _indexOfMarker, _parsePywareFile, _pywareAssembleDrill, _pyware3daPageNote,
    _pyware3daCast,
  };
}
