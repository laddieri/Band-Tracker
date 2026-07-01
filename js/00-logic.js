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
function buildPublicStats({ students, entries, rehearsals, songs, weights, flags, salt, memExclusions }) {
  const studentList = Object.values(students);
  // Song progress is measured over students who actually memorize music, so
  // excluded groups (e.g. majorettes) don't inflate the "remaining" counts.
  const memList = studentList.filter(s => !isMemorizationExcluded(s, memExclusions));
  const total   = memList.length;

  const rehearsalRows = rehearsals.map(r => ({
    date:   r.date,
    label:  r.label || '',
    absent: Object.values(entries[r.id] || {}).filter(e => e.attendance === 'absent').length,
  }));

  const songRows = (flags.songsOn ? songs : []).map(song => {
    const passed = memList.filter(s => song.statuses?.[String(s.number)]?.status === 'passed').length;
    return {
      id: song.id, title: song.title || '', dueDate: song.dueDate || '',
      category: song.category || '', passed, remaining: Math.max(0, total - passed),
    };
  });

  // Pseudonymized ranking — published only while the leaderboard is enabled.
  // Rows carry the student number so each student can find their own row;
  // names and per-event details are never included.
  const leaderboard = (flags.leaderboardEnabled && flags.statsOn)
    ? scoreStudentsCore(students, entries, flags.songsOn ? songs : [], weights, flags, salt)
        .sort((a, b) => b.score - a.score)
        .map(({ docId, name, score }) => ({ num: docId, name, score }))
    : null;

  return { rehearsals: rehearsalRows, songs: songRows, leaderboard };
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
  column:     ['column','col','letter','column letter','file'],
  row:        ['row','rank','row number','set'],
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

// ── Seasons ───────────────────────────────────────────────────────────────────

// Suggest a season label for a date, e.g. '2026-07-01' → '2026-27'. Marching
// seasons straddle calendar years like school years; June onward counts as the
// start of the next school year (summer band camp belongs to the fall season).
function suggestSeasonLabel(dateStr) {
  const [y, m] = String(dateStr || '').split('-').map(Number);
  if (!y || !m) return '';
  const startY = m >= 6 ? y : y - 1;
  return `${startY}-${String((startY + 1) % 100).padStart(2, '0')}`;
}

// ── Node export (browser ignores this) ────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FAKE_ADJECTIVES, FAKE_ANIMALS, _strHash, pseudonymFor,
    rehearsalIncludesStudent, rehearsalScopeLabel,
    isMemorizationExcluded,
    lbWeights, scoreStudentsCore, buildPublicStats,
    checkAutoMarkCondition, computeAutoMarkEvents,
    parseCSVLine, parseCSV, COL_ALIASES, normalizeGrade, detectCols,
    suggestSeasonLabel,
  };
}
