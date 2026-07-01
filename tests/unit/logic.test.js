// Unit tests for the pure logic in js/00-logic.js (no Firebase, no emulator).
// Run with:  npm run test:unit
//
// These cover the math that determines what directors and students actually
// see: leaderboard scoring, the published settings/public stats, auto marks,
// pseudonyms and CSV import parsing.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const L = require('../../js/00-logic.js');

// ── Fixtures (shapes mirror app state) ────────────────────────────────────────

const W = L.lbWeights({}); // defaults: pos 1, neg 1, absent 1, late 0.5, song 1
const ALL_ON = { marksOn: true, attendanceOn: true, countNegative: true };

const students = {
  '42': { number: '42', name: 'Sam' },
  '7':  { number: '7',  name: 'Riley' },
};
const entries = {
  r1: {
    '42': { positives: 3, mistakes: 1, attendance: 'present' },
    '7':  { positives: 0, mistakes: 2, attendance: 'absent' },
  },
  r2: {
    '42': { positives: 1, mistakes: 0, attendance: 'late' },
  },
};
const songs = [
  { id: 's1', title: 'Anthem', dueDate: '2026-09-01', category: 'Stand Tunes',
    statuses: { 42: { status: 'passed' }, 7: { status: 'failed' } } },
  { id: 's2', title: 'Fanfare', statuses: {} },
];

// ── Pseudonyms ────────────────────────────────────────────────────────────────

describe('pseudonymFor', () => {
  it('is deterministic for the same id + salt', () => {
    assert.strictEqual(L.pseudonymFor('42', 'salt'), L.pseudonymFor('42', 'salt'));
  });
  it('produces "Adjective Animal" from the word lists', () => {
    const [adj, ani] = L.pseudonymFor('42', 'salt').split(' ');
    assert.ok(L.FAKE_ADJECTIVES.includes(adj));
    assert.ok(L.FAKE_ANIMALS.includes(ani));
  });
  it('changes when the salt changes (re-randomize feature)', () => {
    const ids = ['1','2','3','4','5','6','7','8','9','10'];
    const changed = ids.filter(id => L.pseudonymFor(id, 'a') !== L.pseudonymFor(id, 'b'));
    assert.ok(changed.length > 0, 'salt change should rename at least one of 10 students');
  });
});

// ── Weights ───────────────────────────────────────────────────────────────────

describe('lbWeights', () => {
  it('applies defaults for missing values', () => {
    assert.deepStrictEqual(L.lbWeights(undefined),
      { positive: 1, negative: 1, absent: 1, late: 0.5, song: 1 });
  });
  it('keeps explicit values, including zero', () => {
    const w = L.lbWeights({ positive: 2, late: 0 });
    assert.strictEqual(w.positive, 2);
    assert.strictEqual(w.late, 0);
    assert.strictEqual(w.negative, 1);
  });
});

// ── Scoring ───────────────────────────────────────────────────────────────────

describe('scoreStudentsCore', () => {
  const rows = () => L.scoreStudentsCore(students, entries, songs, W, ALL_ON, 'salt');
  const row  = (num) => rows().find(r => r.docId === num);

  it('scores = songs·w + positives·w − mistakes·w − absences·w − lates·w', () => {
    // #42: 1 song + (3+1) positives − 1 mistake − 0 absences − 0.5 late = 3.5
    assert.strictEqual(row('42').score, 1 + 4 - 1 - 0.5);
    // #7: 0 songs + 0 positives − 2 mistakes − 1 absence = −3
    assert.strictEqual(row('7').score, -3);
  });
  it('totals positives and mistakes across rehearsals', () => {
    assert.strictEqual(row('42').positives, 4);
    assert.strictEqual(row('42').mistakes, 1);
  });
  it('ignores mistakes when countNegative is off', () => {
    const r = L.scoreStudentsCore(students, entries, songs, W,
      { ...ALL_ON, countNegative: false }, 'salt').find(r => r.docId === '7');
    assert.strictEqual(r.score, -1); // only the absence counts
  });
  it('ignores marks entirely when the Marks feature is off', () => {
    const r = L.scoreStudentsCore(students, entries, songs, W,
      { ...ALL_ON, marksOn: false }, 'salt').find(r => r.docId === '42');
    assert.strictEqual(r.score, 1 - 0.5); // song − late only
    assert.strictEqual(r.positives, 0);
  });
  it('ignores attendance when the Attendance feature is off', () => {
    const r = L.scoreStudentsCore(students, entries, songs, W,
      { ...ALL_ON, attendanceOn: false }, 'salt').find(r => r.docId === '7');
    assert.strictEqual(r.score, -2); // mistakes only, absence not deducted
  });
  it('respects custom weights', () => {
    const w = L.lbWeights({ positive: 2, song: 10 });
    const r = L.scoreStudentsCore(students, entries, songs, w, ALL_ON, 'salt')
      .find(r => r.docId === '42');
    assert.strictEqual(r.score, 10 + 8 - 1 - 0.5);
  });
});

// ── Published stats (settings/public payload) ─────────────────────────────────

describe('buildPublicStats', () => {
  const flags = { ...ALL_ON, songsOn: true, statsOn: true, leaderboardEnabled: true };
  const args  = { students, entries, songs, weights: W, salt: 'salt', flags,
                  rehearsals: [
                    { id: 'r1', date: '2026-06-01', label: 'Sectionals' },
                    { id: 'r2', date: '2026-06-08' },
                  ] };

  it('counts absences per rehearsal', () => {
    const { rehearsals } = L.buildPublicStats(args);
    assert.deepStrictEqual(rehearsals, [
      { date: '2026-06-01', label: 'Sectionals', absent: 1 },
      { date: '2026-06-08', label: '', absent: 0 },
    ]);
  });
  it('aggregates song progress without leaking per-student statuses', () => {
    const { songs: rows } = L.buildPublicStats(args);
    assert.deepStrictEqual(rows[0],
      { id: 's1', title: 'Anthem', dueDate: '2026-09-01', category: 'Stand Tunes', passed: 1, remaining: 1 });
    assert.strictEqual(rows[1].passed, 0);
    assert.ok(!('statuses' in rows[0]));
  });
  it('publishes a leaderboard of {num, name, score} sorted by score', () => {
    const { leaderboard } = L.buildPublicStats(args);
    assert.deepStrictEqual(Object.keys(leaderboard[0]).sort(), ['name', 'num', 'score']);
    assert.strictEqual(leaderboard[0].num, '42'); // higher score first
    assert.ok(leaderboard[0].score >= leaderboard[1].score);
    assert.strictEqual(leaderboard[0].name, L.pseudonymFor('42', 'salt'));
  });
  it('publishes NO leaderboard while it is disabled', () => {
    assert.strictEqual(
      L.buildPublicStats({ ...args, flags: { ...flags, leaderboardEnabled: false } }).leaderboard,
      null);
    assert.strictEqual(
      L.buildPublicStats({ ...args, flags: { ...flags, statsOn: false } }).leaderboard,
      null);
  });
  it('publishes no song rows when the Songs feature is off', () => {
    assert.deepStrictEqual(
      L.buildPublicStats({ ...args, flags: { ...flags, songsOn: false } }).songs, []);
  });
  it('excludes memorization-excluded students from song aggregates', () => {
    // Riley (#7) is a majorette: drop her from the denominator (and her own
    // statuses) so "remaining" reflects only students who memorize music.
    const studs = {
      '42': { number: '42', name: 'Sam' },
      '7':  { number: '7',  name: 'Riley', instrument: 'Majorette' },
    };
    const { songs: rows } = L.buildPublicStats(
      { ...args, students: studs, memExclusions: ['Majorette'] });
    assert.strictEqual(rows[0].passed, 1);     // only Sam passed
    assert.strictEqual(rows[0].remaining, 0);  // Sam is the only eligible student
  });
});

// ── Rehearsal scope ───────────────────────────────────────────────────────────

describe('rehearsalIncludesStudent', () => {
  const brassFr = { instrument: 'Trumpet', section: 'Brass', grade: '9th' };
  it('includes everyone when there is no scope', () => {
    assert.strictEqual(L.rehearsalIncludesStudent(brassFr, null), true);
    assert.strictEqual(L.rehearsalIncludesStudent(brassFr, undefined), true);
  });
  it('includes everyone when the scope is all-empty', () => {
    assert.strictEqual(
      L.rehearsalIncludesStudent(brassFr, { instruments: [], sections: [], grades: [] }), true);
  });
  it('matches on instrument (leading number stripped)', () => {
    assert.strictEqual(L.rehearsalIncludesStudent({ instrument: '3 Trumpet' }, { instruments: ['Trumpet'] }), true);
    assert.strictEqual(L.rehearsalIncludesStudent({ instrument: 'Flute' }, { instruments: ['Trumpet'] }), false);
  });
  it('matches on section or grade (union across categories)', () => {
    assert.strictEqual(L.rehearsalIncludesStudent({ section: 'Brass' }, { sections: ['Brass'] }), true);
    assert.strictEqual(L.rehearsalIncludesStudent({ grade: '9th' }, { grades: ['9th'] }), true);
    // A flute freshman is in scope for a "9th grade" rehearsal even though the
    // instrument doesn't match — any matching category includes the student.
    assert.strictEqual(
      L.rehearsalIncludesStudent({ instrument: 'Flute', grade: '9th' }, { instruments: ['Trumpet'], grades: ['9th'] }), true);
  });
  it('excludes a student who matches no selected group', () => {
    assert.strictEqual(
      L.rehearsalIncludesStudent({ instrument: 'Flute', section: 'Woodwinds', grade: '10th' },
        { instruments: ['Trumpet'], sections: ['Brass'], grades: ['9th'] }), false);
  });
});

describe('rehearsalScopeLabel', () => {
  it('is empty for the full band', () => {
    assert.strictEqual(L.rehearsalScopeLabel(null), '');
  });
  it('joins instruments, sections and labelled grades', () => {
    assert.strictEqual(
      L.rehearsalScopeLabel({ instruments: ['Trumpet'], sections: ['Brass'], grades: ['9th'] }),
      'Trumpet, Brass, 9th Grade');
  });
});

// ── Memorization exclusions ───────────────────────────────────────────────────

describe('isMemorizationExcluded', () => {
  it('is false when there are no exclusions', () => {
    assert.strictEqual(L.isMemorizationExcluded({ instrument: 'Majorette' }, []), false);
    assert.strictEqual(L.isMemorizationExcluded({ instrument: 'Majorette' }, undefined), false);
  });
  it('matches on instrument (leading number stripped, like normInstrument)', () => {
    assert.strictEqual(L.isMemorizationExcluded({ instrument: 'Majorette' }, ['Majorette']), true);
    assert.strictEqual(L.isMemorizationExcluded({ instrument: '12 Majorette' }, ['Majorette']), true);
    assert.strictEqual(L.isMemorizationExcluded({ instrument: 'Flute' }, ['Majorette']), false);
  });
  it('matches on section', () => {
    assert.strictEqual(L.isMemorizationExcluded({ section: 'Color Guard' }, ['Color Guard']), true);
  });
  it('accepts a Set of exclusions', () => {
    assert.strictEqual(L.isMemorizationExcluded({ instrument: 'Majorette' }, new Set(['Majorette'])), true);
  });
  it('is false for a student with no instrument or section', () => {
    assert.strictEqual(L.isMemorizationExcluded({}, ['Majorette']), false);
    assert.strictEqual(L.isMemorizationExcluded(null, ['Majorette']), false);
  });
});

// ── Auto marks ────────────────────────────────────────────────────────────────

describe('auto marks', () => {
  const onTime    = { condition: 'on_time',     when: 'start', note: 'On time',     type: 'positive' };
  const noMistake = { condition: 'no_mistakes', when: 'end',   note: 'Clean run',   type: 'positive' };

  it('absent students never earn auto marks', () => {
    assert.strictEqual(L.checkAutoMarkCondition(onTime, 'absent', 0), false);
    assert.strictEqual(L.checkAutoMarkCondition({ condition: 'present' }, 'absent', 0), false);
  });
  it('on_time fails for late, passes for present', () => {
    assert.strictEqual(L.checkAutoMarkCondition(onTime, 'late', 0), false);
    assert.strictEqual(L.checkAutoMarkCondition(onTime, 'present', 0), true);
  });
  it('no_mistakes checks the mistake count', () => {
    assert.strictEqual(L.checkAutoMarkCondition(noMistake, 'present', 0), true);
    assert.strictEqual(L.checkAutoMarkCondition(noMistake, 'present', 2), false);
  });
  it("'start' marks need submitted attendance; 'end' marks need an ended rehearsal", () => {
    const entry = { attendance: 'present', events: [] };
    assert.strictEqual(L.computeAutoMarkEvents(entry, {}, [onTime, noMistake], 1).length, 0);
    assert.strictEqual(L.computeAutoMarkEvents(entry, { attendanceSubmitted: true }, [onTime, noMistake], 1).length, 1);
    assert.strictEqual(L.computeAutoMarkEvents(entry, { attendanceSubmitted: true, ended: true }, [onTime, noMistake], 1).length, 2);
  });
  it('is idempotent: re-running replaces previous auto events instead of stacking', () => {
    const r = { attendanceSubmitted: true, ended: true };
    const once  = L.computeAutoMarkEvents({ attendance: 'present', events: [] }, r, [onTime], 1);
    const twice = L.computeAutoMarkEvents({ attendance: 'present', events: once }, r, [onTime], 2);
    assert.strictEqual(once.length, 1);
    assert.strictEqual(twice.length, 1);
  });
  it('keeps manual events and counts their mistakes', () => {
    const manual = [{ type: 'mistake', note: 'phasing' }];
    const r = { ended: true };
    const evts = L.computeAutoMarkEvents({ attendance: 'present', events: manual }, r, [noMistake], 1);
    assert.deepStrictEqual(evts, manual); // mistake blocks the clean-run bonus
  });
  it('stamps auto events as system-generated', () => {
    const evts = L.computeAutoMarkEvents({ events: [] }, { ended: true }, [noMistake], 99);
    assert.deepStrictEqual(evts[0],
      { type: 'positive', note: 'Clean run', ts: 99, by: 'system', auto: true });
  });
});

// ── CSV import parsing ────────────────────────────────────────────────────────

describe('CSV parsing', () => {
  it('handles quoted fields, embedded commas and escaped quotes', () => {
    assert.deepStrictEqual(
      L.parseCSVLine('42,"Smith, Sam","He said ""hi""",Trumpet'),
      ['42', 'Smith, Sam', 'He said "hi"', 'Trumpet']);
  });
  it('splits lines on CRLF and skips blank lines', () => {
    assert.deepStrictEqual(L.parseCSV('a,b\r\n\r\n1,2\n'), [['a', 'b'], ['1', '2']]);
  });
  it('detects columns by alias, case-insensitively', () => {
    const map = L.detectCols(['Student #', 'NAME', 'Inst', 'Grade Level']);
    assert.deepStrictEqual(map, { number: 0, name: 1, instrument: 2, grade: 3 });
  });
  it('detects custom fields by their label without overriding built-ins', () => {
    const map = L.detectCols(['Number', 'Shoe Size'], [{ key: 'shoe', label: 'Shoe Size' }]);
    assert.deepStrictEqual(map, { number: 0, shoe: 1 });
  });
  it('normalizes grades to ordinal form', () => {
    assert.strictEqual(L.normalizeGrade('9'), '9th');
    assert.strictEqual(L.normalizeGrade('Grade 12'), '12th');
    assert.strictEqual(L.normalizeGrade('Senior'), 'Senior'); // unknown → unchanged
  });
});

// ── Filter + sort engine ──────────────────────────────────────────────────────

describe('filterAndSortStudents', () => {
  const mkF = (over = {}) => ({
    search: '', sortField: 'name', sortDir: 'asc',
    instruments: [], sections: [], grades: [], ...over,
  });
  const pool = [
    { number: '1', name: 'Cass',  instrument: '12 Trumpet', grade: '9th',  section: 'Brass' },
    { number: '2', name: 'Ana',   instrument: 'Flute',      grade: '12th', section: 'Woodwinds' },
    { number: '3', name: 'Blake', instrument: 'Tuba',       grade: '9th',  section: 'Brass' },
  ];

  it('searches across name, number and normalized instrument', () => {
    assert.deepStrictEqual(L.filterAndSortStudents(pool, mkF({ search: 'trump' })).map(s => s.number), ['1']);
    assert.deepStrictEqual(L.filterAndSortStudents(pool, mkF({ search: '3' })).map(s => s.number), ['3']);
    assert.deepStrictEqual(L.filterAndSortStudents(pool, mkF({ search: 'ana' })).map(s => s.number), ['2']);
  });
  it('ORs within a category and ANDs across categories', () => {
    assert.deepStrictEqual(
      L.filterAndSortStudents(pool, mkF({ instruments: ['Trumpet', 'Tuba'] })).map(s => s.number),
      ['3', '1']); // Blake before Cass alphabetically
    assert.deepStrictEqual(
      L.filterAndSortStudents(pool, mkF({ instruments: ['Trumpet', 'Tuba'], grades: ['9th'], sections: ['Brass'] })).map(s => s.number),
      ['3', '1']);
    assert.deepStrictEqual(
      L.filterAndSortStudents(pool, mkF({ instruments: ['Trumpet'], grades: ['12th'] })).map(s => s.number),
      []);
  });
  it('sorts by score order for instruments (flute before trumpet before tuba)', () => {
    assert.deepStrictEqual(
      L.filterAndSortStudents(pool, mkF({ sortField: 'instrument' })).map(s => s.instrument),
      ['Flute', '12 Trumpet', 'Tuba']);
  });
  it('sorts by scoreMap fields with missing entries last (desc)', () => {
    const scores = { 1: { score: 5 }, 2: { score: 9 } }; // 3 missing → -1
    assert.deepStrictEqual(
      L.filterAndSortStudents(pool, mkF({ sortField: 'score', sortDir: 'desc' }), scores).map(s => s.number),
      ['2', '1', '3']);
  });
  it('respects sortDir and does not mutate the input array', () => {
    const copy = [...pool];
    const out = L.filterAndSortStudents(pool, mkF({ sortDir: 'desc' }));
    assert.deepStrictEqual(out.map(s => s.name), ['Cass', 'Blake', 'Ana']);
    assert.deepStrictEqual(pool, copy);
  });
});

// ── Seasons ───────────────────────────────────────────────────────────────────

describe('suggestSeasonLabel', () => {
  it('treats June onward as the start of the next school year', () => {
    assert.strictEqual(L.suggestSeasonLabel('2026-06-01'), '2026-27');
    assert.strictEqual(L.suggestSeasonLabel('2026-07-15'), '2026-27');
    assert.strictEqual(L.suggestSeasonLabel('2026-12-31'), '2026-27');
  });
  it('keeps January–May in the school year that started the prior fall', () => {
    assert.strictEqual(L.suggestSeasonLabel('2026-01-10'), '2025-26');
    assert.strictEqual(L.suggestSeasonLabel('2026-05-31'), '2025-26');
  });
  it('pads the short year across a century boundary', () => {
    assert.strictEqual(L.suggestSeasonLabel('2099-09-01'), '2099-00');
  });
  it('returns empty for garbage input', () => {
    assert.strictEqual(L.suggestSeasonLabel(''), '');
    assert.strictEqual(L.suggestSeasonLabel('not-a-date'), '');
    assert.strictEqual(L.suggestSeasonLabel(null), '');
  });
});
