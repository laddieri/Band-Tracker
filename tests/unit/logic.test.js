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

describe('taskAppliesToStudent', () => {
  const maj = { number: '7', instrument: 'Majorette', section: 'Aux' };
  const tpt = { number: '3', instrument: 'Trumpet', section: 'Brass', grade: '9th' };
  const sax = { number: '5', instrument: '2 Alto Sax', section: 'Woodwind', grade: '11th' };

  it('applies to everyone by default (applyMode all, no groups)', () => {
    const t = { applyMode: 'all', groups: {} };
    assert.ok(L.taskAppliesToStudent(maj, t));
    assert.ok(L.taskAppliesToStudent(tpt, t));
  });
  it('all mode exempts the chosen groups (a majorette still does a form)', () => {
    const t = { applyMode: 'all', groups: { instruments: ['Majorette'] } };
    assert.strictEqual(L.taskAppliesToStudent(maj, t), false);
    assert.strictEqual(L.taskAppliesToStudent(tpt, t), true);
  });
  it('include mode applies ONLY to the chosen groups', () => {
    const t = { applyMode: 'include', groups: { sections: ['Brass'] } };
    assert.strictEqual(L.taskAppliesToStudent(tpt, t), true);
    assert.strictEqual(L.taskAppliesToStudent(maj, t), false);
  });
  it('strips a leading instrument number when matching (like normInstrument)', () => {
    const t = { applyMode: 'include', groups: { instruments: ['Alto Sax'] } };
    assert.ok(L.taskAppliesToStudent(sax, t)); // '2 Alto Sax' → 'Alto Sax'
  });
  it('matches by grade', () => {
    const t = { applyMode: 'include', groups: { grades: ['9th'] } };
    assert.ok(L.taskAppliesToStudent(tpt, t));
    assert.strictEqual(L.taskAppliesToStudent(sax, t), false);
  });
  it('individual overrides win: exempt removes an applying student, include adds an exempt-group one', () => {
    const exempt = { applyMode: 'all', groups: {}, exemptStudents: ['3'] };
    assert.strictEqual(L.taskAppliesToStudent(tpt, exempt), false);
    const incl = { applyMode: 'all', groups: { instruments: ['Majorette'] }, includeStudents: ['7'] };
    assert.strictEqual(L.taskAppliesToStudent(maj, incl), true);
  });
});

describe('isDoneLate', () => {
  // Local-time helper: build an epoch ms for a given local Y-M-D (noon, to dodge
  // DST edges) so the comparison matches how the app derives the completion day.
  const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).getTime();

  it('is false when the due date or completion time is missing', () => {
    assert.strictEqual(L.isDoneLate('', at(2026, 8, 10)), false);
    assert.strictEqual(L.isDoneLate('2026-08-10', 0), false);
    assert.strictEqual(L.isDoneLate('2026-08-10', undefined), false);
    assert.strictEqual(L.isDoneLate('', 0), false);
  });
  it('is false when completed before the due date', () => {
    assert.strictEqual(L.isDoneLate('2026-08-10', at(2026, 8, 1)), false);
  });
  it('is false when completed ON the due date (finishing on time)', () => {
    assert.strictEqual(L.isDoneLate('2026-08-10', at(2026, 8, 10)), false);
  });
  it('is true when completed the day after the due date', () => {
    assert.strictEqual(L.isDoneLate('2026-08-10', at(2026, 8, 11)), true);
  });
  it('is true when completed well after the due date (crossing a month)', () => {
    assert.strictEqual(L.isDoneLate('2026-08-31', at(2026, 9, 1)), true);
  });
  it('is false for a bad timestamp', () => {
    assert.strictEqual(L.isDoneLate('2026-08-10', NaN), false);
  });
});

describe('buildPublicStats', () => {
  const flags = { ...ALL_ON, songsOn: true, statsOn: true, leaderboardEnabled: true };
  const args  = { students, entries, songs, weights: W, salt: 'salt', flags,
                  rehearsals: [
                    { id: 'r1', date: '2026-06-01', label: 'Sectionals' },
                    { id: 'r2', date: '2026-06-08' },
                  ] };

  it('counts attendance per rehearsal (present = roster − absent − late)', () => {
    const { rehearsals } = L.buildPublicStats(args);
    assert.deepStrictEqual(rehearsals, [
      { date: '2026-06-01', label: 'Sectionals', absent: 1, late: 0, present: 1 },
      { date: '2026-06-08', label: '', absent: 0, late: 1, present: 1 },
    ]);
  });
  it('leaves present at 0 for an untouched (unsubmitted, no marks) rehearsal', () => {
    const rehearsals = [{ id: 'r3', date: '2026-06-15', label: '' }];
    const { rehearsals: rows } = L.buildPublicStats({ ...args, rehearsals });
    assert.deepStrictEqual(rows, [{ date: '2026-06-15', label: '', absent: 0, late: 0, present: 0 }]);
  });
  it('derives present from the roster when everyone is present on submit', () => {
    // No absent/late entries, but attendance was submitted → present = full roster.
    const rehearsals = [{ id: 'r4', date: '2026-06-22', label: '', attendanceSubmitted: true }];
    const { rehearsals: rows } = L.buildPublicStats({ ...args, entries: {}, rehearsals });
    assert.deepStrictEqual(rows, [{ date: '2026-06-22', label: '', absent: 0, late: 0, present: 2 }]);
  });
  it('aggregates song progress without leaking per-student statuses', () => {
    const { songs: rows } = L.buildPublicStats(args);
    assert.deepStrictEqual(rows[0],
      { id: 's1', title: 'Anthem', dueDate: '2026-09-01', category: 'Stand Tunes', passed: 1, remaining: 1 });
    assert.strictEqual(rows[1].passed, 0);
    assert.ok(!('statuses' in rows[0]));
  });
  it('aggregates task check-offs (student-visible only; done of applicable, no PII)', () => {
    const tasks = [
      { id: 't1', title: 'Form', dueDate: '2026-09-01', studentVisible: true,
        applyMode: 'all', groups: {}, statuses: { 42: { done: true } } },
      { id: 't2', title: 'Hidden', studentVisible: false, applyMode: 'all', groups: {}, statuses: {} },
    ];
    const { tasks: rows } = L.buildPublicStats({ ...args, tasks, flags: { ...flags, tasksOn: true } });
    assert.deepStrictEqual(rows, [{ id: 't1', title: 'Form', dueDate: '2026-09-01', done: 1, total: 2 }]);
    assert.ok(!('statuses' in rows[0]));
  });
  it('publishes no task rows when the Tasks feature is off', () => {
    const tasks = [{ id: 't1', title: 'Form', studentVisible: true, applyMode: 'all', groups: {}, statuses: {} }];
    assert.deepStrictEqual(
      L.buildPublicStats({ ...args, tasks, flags: { ...flags, tasksOn: false } }).tasks, []);
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
  it('drops hidden-from-students rehearsals from the rows and the leaderboard', () => {
    // Hide r1 (which holds #7's only entry — an absence — and some of #42's marks).
    const rehearsals = [
      { id: 'r1', date: '2026-06-01', label: 'Sectionals', hiddenFromStudents: true },
      { id: 'r2', date: '2026-06-08' },
    ];
    const { rehearsals: rows, leaderboard } = L.buildPublicStats({ ...args, rehearsals });
    // Only the visible rehearsal has a row.
    assert.deepStrictEqual(rows, [{ date: '2026-06-08', label: '', absent: 0, late: 1, present: 1 }]);
    // #7's single entry was the hidden absence, so their published score is 0
    // (the absence can't leak through a lowered rank).
    assert.strictEqual(leaderboard.find(r => r.num === '7').score, 0);
    // #42 keeps only r2: 1 song + 1 positive − 0.5 late = 1.5.
    assert.strictEqual(leaderboard.find(r => r.num === '42').score, 1.5);
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

// ── Event type (rehearsal vs performance) ─────────────────────────────────────

describe('event type', () => {
  it('treats an absent type as a rehearsal', () => {
    assert.strictEqual(L.eventType({}), 'rehearsal');
    assert.strictEqual(L.eventType(null), 'rehearsal');
    assert.strictEqual(L.isPerformance({}), false);
    assert.strictEqual(L.eventTypeLabel({}), 'Rehearsal');
  });
  it('treats an unrecognized type as a rehearsal', () => {
    assert.strictEqual(L.eventType({ type: 'wat' }), 'rehearsal');
    assert.strictEqual(L.isPerformance({ type: 'wat' }), false);
  });
  it('recognizes a performance', () => {
    assert.strictEqual(L.eventType({ type: 'performance' }), 'performance');
    assert.strictEqual(L.isPerformance({ type: 'performance' }), true);
    assert.strictEqual(L.eventTypeLabel({ type: 'performance' }), 'Performance');
  });
});

// ── Rehearsal ordering ────────────────────────────────────────────────────────

describe('compareRehearsalsDesc', () => {
  const sorted = list => [...list].sort(L.compareRehearsalsDesc).map(r => r.id);

  it('puts the most recent date first', () => {
    const list = [
      { id: 'a', date: '2026-03-01' },
      { id: 'b', date: '2026-03-14' },
      { id: 'c', date: '2026-02-28' },
    ];
    assert.deepStrictEqual(sorted(list), ['b', 'a', 'c']);
  });

  it('orders same-date rehearsals by start time, latest first', () => {
    const list = [
      { id: 'morning', date: '2026-03-01', startedAt: 1_700_000_000_000 },
      { id: 'evening', date: '2026-03-01', startedAt: 1_700_000_900_000 },
      { id: 'noon',    date: '2026-03-01', startedAt: 1_700_000_400_000 },
    ];
    assert.deepStrictEqual(sorted(list), ['evening', 'noon', 'morning']);
  });

  it('sorts rehearsals with no startedAt after timed ones on the same date', () => {
    const list = [
      { id: 'legacy', date: '2026-03-01' },
      { id: 'timed',  date: '2026-03-01', startedAt: 1_700_000_000_000 },
    ];
    assert.deepStrictEqual(sorted(list), ['timed', 'legacy']);
  });

  it('falls back to the (time-prefixed) id so the order is stable', () => {
    const older = 'kzz1abcde', newer = 'kzz2abcde'; // genId(): base36 Date.now() + random
    const list = [{ id: older, date: '2026-03-01' }, { id: newer, date: '2026-03-01' }];
    assert.deepStrictEqual(sorted(list), [newer, older]);
    assert.strictEqual(L.compareRehearsalsDesc(list[0], list[0]), 0);
  });

  it('tolerates missing dates', () => {
    const list = [{ id: 'a' }, { id: 'b', date: '2026-03-01' }];
    assert.deepStrictEqual(sorted(list), ['b', 'a']);
  });
});

describe('rehearsalStreak', () => {
  const sam = { number: '42', name: 'Sam' };
  // Newest → oldest: r4, r3, r2, r1
  const rehs = [
    { id: 'r1', date: '2026-03-01', attendanceSubmitted: true },
    { id: 'r2', date: '2026-03-08', attendanceSubmitted: true },
    { id: 'r3', date: '2026-03-15', attendanceSubmitted: true },
    { id: 'r4', date: '2026-03-22', attendanceSubmitted: true },
  ];

  it('counts consecutive attended rehearsals from the most recent', () => {
    // present (no entry) on r4/r3, late on r2, absent on r1 → streak stops at r1
    const entries = {
      r2: { '42': { attendance: 'late' } },
      r1: { '42': { attendance: 'absent' } },
    };
    assert.strictEqual(L.rehearsalStreak(rehs, entries, sam), 3);
  });

  it('treats a rehearsal with no entry as attended (the "present" case)', () => {
    assert.strictEqual(L.rehearsalStreak(rehs, {}, sam), 4);
  });

  it('a late still counts as attended (it is not an absence)', () => {
    const entries = { r4: { '42': { attendance: 'late' } } };
    assert.strictEqual(L.rehearsalStreak(rehs, entries, sam), 4);
  });

  it('returns 0 when the most recent counted rehearsal is an absence', () => {
    const entries = { r4: { '42': { attendance: 'absent' } } };
    assert.strictEqual(L.rehearsalStreak(rehs, entries, sam), 0);
  });

  it('ignores rehearsals where attendance was never submitted', () => {
    const list = [
      { id: 'r1', date: '2026-03-01', attendanceSubmitted: true },
      { id: 'r2', date: '2026-03-08' }, // not submitted — skipped entirely
      { id: 'r3', date: '2026-03-15', attendanceSubmitted: true },
    ];
    const entries = { r1: { '42': { attendance: 'absent' } } };
    // r3 attended, r2 skipped, r1 absent → streak of 1
    assert.strictEqual(L.rehearsalStreak(list, entries, sam), 1);
  });

  it('skips hidden rehearsals so they neither break nor extend the streak', () => {
    const list = [
      { id: 'r1', date: '2026-03-01', attendanceSubmitted: true },
      { id: 'r2', date: '2026-03-08', attendanceSubmitted: true, hiddenFromStudents: true },
      { id: 'r3', date: '2026-03-15', attendanceSubmitted: true },
    ];
    // r2 hidden holds an absence but is skipped; r3 and r1 attended → streak 2
    const entries = { r2: { '42': { attendance: 'absent' } } };
    assert.strictEqual(L.rehearsalStreak(list, entries, sam), 2);
  });

  it('only counts rehearsals whose scope includes the student', () => {
    const flute = { number: '9', instrument: 'Flute', section: 'Woodwinds' };
    const list = [
      { id: 'r1', date: '2026-03-01', attendanceSubmitted: true },
      { id: 'r2', date: '2026-03-08', attendanceSubmitted: true,
        scope: { sections: ['Brass'] } }, // flute not in scope — skipped
      { id: 'r3', date: '2026-03-15', attendanceSubmitted: true },
    ];
    assert.strictEqual(L.rehearsalStreak(list, {}, flute), 2);
  });

  it('returns 0 with no student', () => {
    assert.strictEqual(L.rehearsalStreak(rehs, {}, null), 0);
  });

  it('does not credit a student for rehearsals held before they joined', () => {
    // Joined 2026-03-16 — only r4 (2026-03-22) is on/after that date.
    const joined = { number: '42', name: 'Newbie', createdAt: Date.parse('2026-03-16T09:00:00') };
    assert.strictEqual(L.rehearsalStreak(rehs, {}, joined), 1);
  });

  it('counts a rehearsal held on the join day', () => {
    const joined = { number: '42', name: 'Newbie', createdAt: Date.parse('2026-03-15T20:00:00') };
    // r3 (2026-03-15) and r4 (2026-03-22) count; r1/r2 predate the join.
    assert.strictEqual(L.rehearsalStreak(rehs, {}, joined), 2);
  });

  it('honors an explicit entry even on a rehearsal that predates the student', () => {
    const joined = { number: '42', name: 'Newbie', createdAt: Date.parse('2026-03-22T09:00:00') };
    // Only r4 is on/after the join, but a director recorded r1 as absent — that
    // explicit record is honored, so walking newest-first stops the streak at r1.
    const entries = { r1: { '42': { attendance: 'absent' } } };
    // r4 counts (+1), r3/r2 predate with no entry (skipped), r1 explicit absence → stop.
    assert.strictEqual(L.rehearsalStreak(rehs, entries, joined), 1);
  });

  it('keeps the old behavior for students without a createdAt', () => {
    assert.strictEqual(L.rehearsalStreak(rehs, {}, sam), 4);
  });
});

describe('rehearsalsAttended', () => {
  const sam = { number: '42', name: 'Sam' };
  const rehs = [
    { id: 'r1', date: '2026-03-01', attendanceSubmitted: true },
    { id: 'r2', date: '2026-03-08', attendanceSubmitted: true },
    { id: 'r3', date: '2026-03-15', attendanceSubmitted: true },
    { id: 'r4', date: '2026-03-22', attendanceSubmitted: true },
  ];

  it('lists attended rehearsals newest-first with present/late status', () => {
    const entries = {
      r2: { '42': { attendance: 'late' } },
      r1: { '42': { attendance: 'absent' } }, // absent → not attended
    };
    const res = L.rehearsalsAttended(rehs, entries, sam);
    assert.deepStrictEqual(res.map(x => x.rehearsal.id), ['r4', 'r3', 'r2']);
    assert.deepStrictEqual(res.map(x => x.status), ['present', 'present', 'late']);
  });

  it('counts a no-entry rehearsal as attended (present)', () => {
    const res = L.rehearsalsAttended(rehs, {}, sam);
    assert.strictEqual(res.length, 4);
    assert.ok(res.every(x => x.status === 'present'));
  });

  it('excludes absences, unsubmitted, hidden and out-of-scope rehearsals', () => {
    const flute = { number: '9', instrument: 'Flute', section: 'Woodwinds' };
    const list = [
      { id: 'a', date: '2026-03-01', attendanceSubmitted: true },
      { id: 'b', date: '2026-03-08' }, // not submitted
      { id: 'c', date: '2026-03-15', attendanceSubmitted: true, hiddenFromStudents: true },
      { id: 'd', date: '2026-03-22', attendanceSubmitted: true, scope: { sections: ['Brass'] } },
      { id: 'e', date: '2026-03-29', attendanceSubmitted: true },
    ];
    const entries = { a: { '9': { attendance: 'absent' } } };
    const res = L.rehearsalsAttended(list, entries, flute);
    assert.deepStrictEqual(res.map(x => x.rehearsal.id), ['e']);
  });

  it('excludes rehearsals held before the student joined the roster', () => {
    // Joined 2026-03-15 — r3 and r4 are on/after; r1/r2 predate and are dropped.
    const joined = { number: '42', name: 'Newbie', createdAt: Date.parse('2026-03-15T09:00:00') };
    const res = L.rehearsalsAttended(rehs, {}, joined);
    assert.deepStrictEqual(res.map(x => x.rehearsal.id), ['r4', 'r3']);
  });

  it('still lists a pre-join rehearsal that carries an explicit entry', () => {
    const joined = { number: '42', name: 'Newbie', createdAt: Date.parse('2026-03-22T09:00:00') };
    const entries = { r1: { '42': { attendance: 'late' } } };
    const res = L.rehearsalsAttended(rehs, entries, joined);
    assert.deepStrictEqual(res.map(x => x.rehearsal.id), ['r4', 'r1']);
    assert.deepStrictEqual(res.map(x => x.status), ['present', 'late']);
  });

  it('returns [] with no student', () => {
    assert.deepStrictEqual(L.rehearsalsAttended(rehs, {}, null), []);
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

// ── Student code export (CSV) ─────────────────────────────────────────────────

describe('buildStudentCodesCsv', () => {
  const roster = [
    { number: '7',  name: 'Riley Ames',  instrument: '12 Trumpet', studentCode: 'ab3k9xzq' },
    { number: '42', name: 'Smith, Sam',  instrument: 'Flute' }, // no code yet
  ];

  it('writes a header plus one row per student, codes upper-cased', () => {
    assert.deepStrictEqual(L.buildStudentCodesCsv(roster).split('\n'), [
      'Student Number,Name,Instrument,Student Code',
      '7,Riley Ames,Trumpet,AB3K9XZQ',
      '42,"Smith, Sam",Flute,',
    ]);
  });

  it('drops the instrument column when the field is off', () => {
    assert.deepStrictEqual(L.buildStudentCodesCsv(roster, { includeInstrument: false }).split('\n'), [
      'Student Number,Name,Student Code',
      '7,Riley Ames,AB3K9XZQ',
      '42,"Smith, Sam",',
    ]);
  });

  it('keeps a header-only file for an empty selection', () => {
    assert.strictEqual(L.buildStudentCodesCsv([]), 'Student Number,Name,Instrument,Student Code');
  });

  it('quotes cells containing commas, quotes or newlines', () => {
    assert.strictEqual(L.csvCell('plain'), 'plain');
    assert.strictEqual(L.csvCell('a,b'), '"a,b"');
    assert.strictEqual(L.csvCell('say "hi"'), '"say ""hi"""');
    assert.strictEqual(L.csvCell('one\ntwo'), '"one\ntwo"');
    assert.strictEqual(L.csvCell(null), '');
  });
});

// ── Customizable data export (tables → CSV / PDF) ─────────────────────────────

describe('tableToCsv', () => {
  const cols = [{ key: 'a', label: 'Col A' }, { key: 'b', label: 'Col B' }];

  it('writes the header from labels and one row per record, reading by key', () => {
    assert.deepStrictEqual(
      L.tableToCsv(cols, [{ a: '1', b: 'x' }, { a: '2', b: 'y' }]).split('\n'),
      ['Col A,Col B', '1,x', '2,y']);
  });

  it('quotes values and treats missing keys as blank', () => {
    assert.deepStrictEqual(
      L.tableToCsv(cols, [{ a: 'a,b' }]).split('\n'),
      ['Col A,Col B', '"a,b",']);
  });

  it('keeps a header-only file for no rows', () => {
    assert.strictEqual(L.tableToCsv(cols, []), 'Col A,Col B');
  });
});

describe('pickColumns', () => {
  const table = { columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }],
                  rows: [{ a: 1, b: 2, c: 3 }] };

  it('keeps only the chosen columns, in the table order, rows untouched', () => {
    const out = L.pickColumns(table, ['c', 'a']);
    assert.deepStrictEqual(out.columns.map(c => c.key), ['a', 'c']);
    assert.strictEqual(out.rows, table.rows);
  });

  it('keeps everything when keys is null', () => {
    assert.strictEqual(L.pickColumns(table, null), table);
  });
});

describe('tableToPrintHtml', () => {
  it('escapes labels and values into a self-contained document', () => {
    const html = L.tableToPrintHtml({
      title: 'A & B', subtitle: 'sub',
      columns: [{ key: 'n', label: '<Name>' }],
      rows: [{ n: 'Tom & "Jerry"' }],
    });
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /&lt;Name&gt;/);
    assert.match(html, /Tom &amp; &quot;Jerry&quot;/);
    assert.match(html, /<title>A &amp; B<\/title>/);
  });

  it('shows a placeholder row when there is no data', () => {
    const html = L.tableToPrintHtml({ title: 'T', columns: [{ key: 'a', label: 'A' }], rows: [] });
    assert.match(html, /No data for this selection/);
  });
});

describe('buildRosterExportTable', () => {
  const students = [
    { number: '7',  name: 'Riley Ames', instrument: '12 Trumpet', section: 'Brass', grade: '10',
      shirt: 'M', notes: 'captain', studentCode: 'ab3k9xzq' },
    { number: '42', name: 'Sam',        instrument: 'Flute' },
  ];

  it('normalizes instrument, upper-cases the code, reads custom fields by key', () => {
    const cols = [
      { key: 'number', label: 'Student Number' },
      { key: 'name', label: 'Name' },
      { key: 'instrument', label: 'Instrument' },
      { key: 'shirt', label: 'Shirt Size' }, // custom field, value at s.shirt
      { key: 'studentCode', label: 'Student Code' },
    ];
    const { rows } = L.buildRosterExportTable(students, cols);
    assert.deepStrictEqual(rows[0], { number: '7', name: 'Riley Ames', instrument: 'Trumpet', shirt: 'M', studentCode: 'AB3K9XZQ' });
    assert.deepStrictEqual(rows[1], { number: '42', name: 'Sam', instrument: 'Flute', shirt: '', studentCode: '' });
  });

  it('returns exactly the columns it was given', () => {
    const cols = [{ key: 'number', label: 'Student Number' }];
    assert.deepStrictEqual(L.buildRosterExportTable(students, cols).columns, cols);
  });
});

describe('buildMarksExportTable', () => {
  const students = [{ number: '7', name: 'Riley' }, { number: '9', name: 'Sam' }];
  const rehearsals = [
    { id: 'r1', date: '2026-08-01', label: 'Camp' },
    { id: 'r2', date: '2026-08-05', label: '' },
  ];
  const entries = {
    r1: { '7': { positives: 2, mistakes: 1, attendance: 'late', by: 'uid1' } },
    r2: { '9': { positives: 0, mistakes: 0, attendance: 'absent' } },
  };
  const authorLabel = uid => (uid === 'uid1' ? 'director-j' : '');

  it('detail mode: one row per recorded student×event, author via label not uid', () => {
    const { columns, rows } = L.buildMarksExportTable(rehearsals, entries, students, { mode: 'detail', authorLabel });
    assert.deepStrictEqual(columns, L.MARKS_DETAIL_COLS);
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0], {
      date: '2026-08-01', label: 'Camp', number: '7', name: 'Riley',
      attendance: 'Late', positives: 2, mistakes: 1, recordedBy: 'director-j',
    });
    assert.strictEqual(rows[1].attendance, 'Absent');
    assert.strictEqual(rows[1].recordedBy, ''); // no author stamped
    // never emits a raw uid
    assert.ok(!rows.some(r => r.recordedBy === 'uid1'));
  });

  it('summary mode: one row per student, totals across the range', () => {
    const { columns, rows } = L.buildMarksExportTable(rehearsals, entries, students, { mode: 'summary' });
    assert.deepStrictEqual(columns, L.MARKS_SUMMARY_COLS);
    assert.deepStrictEqual(rows[0], { number: '7', name: 'Riley', positives: 2, mistakes: 1, absences: 0, lates: 1 });
    assert.deepStrictEqual(rows[1], { number: '9', name: 'Sam',   positives: 0, mistakes: 0, absences: 1, lates: 0 });
  });
});

describe('buildLeaderboardExportTable', () => {
  it('ranks by score descending with real names', () => {
    const scored = [
      { s: { number: '7', name: 'Riley' }, score: 3.14159, positives: 4, mistakes: 1 },
      { s: { number: '9', name: 'Sam' },   score: 9,       positives: 9, mistakes: 0 },
    ];
    const { rows } = L.buildLeaderboardExportTable(scored);
    assert.deepStrictEqual(rows[0], { rank: 1, name: 'Sam',   number: '9', score: 9,    positives: 9, mistakes: 0 });
    assert.deepStrictEqual(rows[1], { rank: 2, name: 'Riley', number: '7', score: 3.14, positives: 4, mistakes: 1 });
  });
});

describe('buildSongsExportTable', () => {
  const students = [{ number: '7', name: 'Riley' }, { number: '9', name: 'Sam' }];
  const songs = [
    { id: 's1', title: 'Opener', statuses: { '7': { status: 'passed' }, '9': { status: 'failed' } } },
    { id: 's2', title: 'Ballad', statuses: { '7': { status: 'passed' } } },
  ];

  it('builds a per-song matrix with a passed count', () => {
    const { columns, rows } = L.buildSongsExportTable(students, songs);
    assert.deepStrictEqual(columns.map(c => c.label), ['Student Number', 'Name', 'Opener', 'Ballad', 'Songs Passed']);
    assert.deepStrictEqual(rows[0], { number: '7', name: 'Riley', 'song:s1': 'Passed', 'song:s2': 'Passed', passedCount: 2 });
    assert.deepStrictEqual(rows[1], { number: '9', name: 'Sam',   'song:s1': 'Try Again', 'song:s2': '', passedCount: 0 });
  });
});

describe('buildTasksExportTable', () => {
  const students = [{ number: '7', name: 'Riley' }, { number: '9', name: 'Sam' }];
  // Task applies to everyone by default; task t2 only includes student 7.
  const tasks = [
    { id: 't1', title: 'Fees', statuses: { '7': { done: true } } },
    { id: 't2', title: 'Solo', includeStudents: ['7'], applyMode: 'include', statuses: {} },
  ];

  it('marks Done/Not done, and blank where a task does not apply', () => {
    const { columns, rows } = L.buildTasksExportTable(students, tasks);
    assert.deepStrictEqual(columns.map(c => c.label), ['Student Number', 'Name', 'Fees', 'Solo']);
    assert.strictEqual(rows[0]['task:t1'], 'Done');
    assert.strictEqual(rows[0]['task:t2'], 'Not done'); // applies to 7, not done
    assert.strictEqual(rows[1]['task:t1'], 'Not done'); // applies, no status
    assert.strictEqual(rows[1]['task:t2'], '');         // does not apply to 9
  });
});

describe('buildSongRosterExportTable', () => {
  const students = [{ number: '7', name: 'Riley' }, { number: '9', name: 'Sam' }, { number: '5', name: 'Lee' }];
  const song = { id: 's1', title: 'Opener', statuses: {
    '7': { status: 'passed', updatedAt: 1000, note: '' },
    '9': { status: 'failed', updatedAt: 2000, note: 'watch bar 12' },
  } };
  const fmtTs = ts => `t${ts}`;

  it('one row per student: status, formatted date, note', () => {
    const { columns, rows } = L.buildSongRosterExportTable(students, song, fmtTs);
    assert.deepStrictEqual(columns.map(c => c.key), ['number', 'name', 'status', 'date', 'note']);
    assert.deepStrictEqual(rows[0], { number: '7', name: 'Riley', status: 'Passed',    date: 't1000', note: '' });
    assert.deepStrictEqual(rows[1], { number: '9', name: 'Sam',   status: 'Try Again', date: 't2000', note: 'watch bar 12' });
    assert.deepStrictEqual(rows[2], { number: '5', name: 'Lee',   status: '',          date: '',      note: '' });
  });
});

describe('buildTaskRosterExportTable', () => {
  const students = [{ number: '7', name: 'Riley' }, { number: '9', name: 'Sam' }];
  // Applies to everyone; only student 9 excluded via exemptStudents.
  const task = { id: 't1', title: 'Fees', exemptStudents: ['9'],
    statuses: { '7': { done: true, updatedAt: 1000 } } };
  const fmtTs = ts => `t${ts}`;

  it('marks Done with a date, and N/A where the task does not apply', () => {
    const { columns, rows } = L.buildTaskRosterExportTable(students, task, fmtTs);
    assert.deepStrictEqual(columns.map(c => c.key), ['number', 'name', 'status', 'date']);
    assert.deepStrictEqual(rows[0], { number: '7', name: 'Riley', status: 'Done', date: 't1000' });
    assert.deepStrictEqual(rows[1], { number: '9', name: 'Sam',   status: 'N/A',  date: '' });
  });

  it('marks Not done with no date when applicable but unrecorded', () => {
    const t2 = { id: 't2', title: 'Solo', statuses: {} };
    const { rows } = L.buildTaskRosterExportTable([{ number: '3', name: 'Ash' }], t2, fmtTs);
    assert.deepStrictEqual(rows[0], { number: '3', name: 'Ash', status: 'Not done', date: '' });
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
  it('breaks ties on a layered secondary sort field', () => {
    const tied = [
      { number: '1', name: 'Sam', grade: '12th' },
      { number: '2', name: 'Sam', grade: '9th'  },
      { number: '3', name: 'Amy', grade: '11th' },
    ];
    // Primary name asc; ties (both "Sam") ordered by grade asc → 9th before 12th.
    assert.deepStrictEqual(
      L.filterAndSortStudents(tied, mkF({ sortField: 'name', sorts: [{ field: 'grade', dir: 'asc' }] })).map(s => s.number),
      ['3', '2', '1']);
    // Each layer's direction is honored independently of the primary.
    assert.deepStrictEqual(
      L.filterAndSortStudents(tied, mkF({ sortField: 'name', sorts: [{ field: 'grade', dir: 'desc' }] })).map(s => s.number),
      ['3', '1', '2']);
  });
  it('applies three sort layers left-to-right as tie-breakers', () => {
    const rows = [
      { number: '10', name: 'Sam', grade: '9th' },
      { number: '4',  name: 'Sam', grade: '9th' },
      { number: '7',  name: 'Sam', grade: '12th' },
    ];
    // name (all tie) → grade asc (9th before 12th) → number asc within 9th.
    assert.deepStrictEqual(
      L.filterAndSortStudents(rows, mkF({
        sortField: 'name',
        sorts: [{ field: 'grade', dir: 'asc' }, { field: 'number', dir: 'asc' }],
      })).map(s => s.number),
      ['4', '10', '7']);
  });
  it('ignores a layer whose field repeats an earlier key', () => {
    assert.deepStrictEqual(
      L.filterAndSortStudents(pool, mkF({ sortField: 'name', sorts: [{ field: 'name', dir: 'desc' }] })).map(s => s.name),
      ['Ana', 'Blake', 'Cass']);
  });
});

describe('sortKeys', () => {
  it('prepends the primary and de-duplicates repeated fields', () => {
    assert.deepStrictEqual(
      L.sortKeys({ sortField: 'name', sortDir: 'asc', sorts: [
        { field: 'grade', dir: 'desc' }, { field: 'name', dir: 'asc' }, { field: 'number' },
      ] }),
      [{ field: 'name', dir: 'asc' }, { field: 'grade', dir: 'desc' }, { field: 'number', dir: 'asc' }]);
  });
  it('drops empty-field layers and defaults missing direction to asc', () => {
    assert.deepStrictEqual(
      L.sortKeys({ sortField: 'grade', sortDir: 'desc', sorts: [{ field: '' }, { field: 'name' }] }),
      [{ field: 'grade', dir: 'desc' }, { field: 'name', dir: 'asc' }]);
  });
});

// ── Printed code-slip order ───────────────────────────────────────────────────

describe('studentLastName', () => {
  it('takes the last word of "First Last"', () => {
    assert.strictEqual(L.studentLastName('Ana Diaz'), 'diaz');
    assert.strictEqual(L.studentLastName('Cass Q. Miller'), 'miller');
  });
  it('takes the part before the comma of "Last, First"', () => {
    assert.strictEqual(L.studentLastName('Diaz, Ana'), 'diaz');
  });
  it('skips generational suffixes but keeps a lone last initial', () => {
    assert.strictEqual(L.studentLastName('Sam Boone Jr.'), 'boone');
    assert.strictEqual(L.studentLastName('Sam Boone III'), 'boone');
    assert.strictEqual(L.studentLastName('Alex V'), 'v');
  });
  it('handles a missing or single-word name', () => {
    assert.strictEqual(L.studentLastName(''), '');
    assert.strictEqual(L.studentLastName(undefined), '');
    assert.strictEqual(L.studentLastName('Prince'), 'prince');
  });
});

describe('compareStudentsByInstrumentThenLastName', () => {
  const sort = pool => [...pool].sort(L.compareStudentsByInstrumentThenLastName).map(s => s.name);

  it('orders by instrument score order, then last name', () => {
    const pool = [
      { number: '1', name: 'Cass Adams',  instrument: 'Tuba' },
      { number: '2', name: 'Ana Zimmer',  instrument: '12 Flute' },
      { number: '3', name: 'Blake Young', instrument: 'Trumpet' },
      { number: '4', name: 'Dana Baker',  instrument: 'Trumpet' },
    ];
    assert.deepStrictEqual(sort(pool), ['Ana Zimmer', 'Dana Baker', 'Blake Young', 'Cass Adams']);
  });
  it('groups same-rank instruments by their own name', () => {
    const pool = [
      { number: '1', name: 'Ana Adams',  instrument: 'Tenor Sax' },
      { number: '2', name: 'Blake Cole', instrument: 'Alto Sax' },
      { number: '3', name: 'Cass Bell',  instrument: 'Tenor Sax' },
    ];
    assert.deepStrictEqual(sort(pool), ['Blake Cole', 'Ana Adams', 'Cass Bell']);
  });
  it('sends students with no instrument to the end', () => {
    const pool = [
      { number: '1', name: 'Ana Adams',  instrument: '' },
      { number: '2', name: 'Blake Cole', instrument: 'Kazoo' }, // unknown, but recorded
      { number: '3', name: 'Cass Bell',  instrument: 'Tuba' },
    ];
    assert.deepStrictEqual(sort(pool), ['Cass Bell', 'Blake Cole', 'Ana Adams']);
  });
  it('falls back to full name then number for identical last names', () => {
    const pool = [
      { number: '9', name: 'Sam Bell', instrument: 'Tuba' },
      { number: '2', name: 'Sam Bell', instrument: 'Tuba' },
      { number: '5', name: 'Ana Bell', instrument: 'Tuba' },
    ];
    assert.deepStrictEqual(
      [...pool].sort(L.compareStudentsByInstrumentThenLastName).map(s => s.number),
      ['5', '2', '9']);
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

// ── Pyware drill file parsing (.3dj / .3da) ───────────────────────────────────
// The parsers are pure byte-wrangling (js/00-logic.js). We build synthetic
// buffers here rather than commit multi-MB Pyware exports; the byte layouts
// mirror the real files reverse-engineered from Pyware 3D output.

// Build a minimal .3da ("3DAP") buffer. `frames` is an array of frames; each
// frame is an array of { x, y, sym } of length N (raw signed grid units, and
// the ASCII section symbol). Layout matches the real export: a single PAGE
// block whose header is [u16][u16][u16 frameCount][u16 N], then each frame is
// N 14-byte records (u16 index, i32 X, i32 Y, i32 whose low byte is the symbol)
// separated by a 4-byte inter-frame header.
// `notes` (optional) is parallel to frames: notes[k] is the page text for
// frame k, written into the inter-frame header that precedes frame k+1 as
// [u16 blockLen][text] just before the next frame's [u16 N] — exactly how real
// .3da files carry each page's Pyware text box.
// `cast` (optional) is the drill writer's performer numbers in index order,
// written ahead of the PAGE block as the real CAST block:
// 'CAST'[u32 blockLen][u16 N] then [u16 index][lenstr number][lenstr extra] per
// performer, where a lenstr is [u16 len][ASCII] and len counts its own 2 bytes.
function build3da(frames, N, notes = [], cast = null) {
  const REC = 14;
  const hdrSize = fi => (fi > 0 && notes[fi - 1]) ? (2 + notes[fi - 1].length + 2) : (fi > 0 ? 4 : 0);
  let interTotal = 0;
  for (let fi = 1; fi < frames.length; fi++) interTotal += hdrSize(fi);
  const castBody = cast ? 2 + cast.reduce((t, nm) => t + 2 + (2 + String(nm).length) + 2, 0) : 0;
  const castSize = cast ? 8 + castBody : 0;
  const size = 6 /*3DAP+2*/ + castSize + 4 /*PAGE*/ + 8 /*hdr*/ +
    frames.length * N * REC + interTotal + 4 /*END */;
  const ab = new ArrayBuffer(size);
  const dv = new DataView(ab);
  const u8 = new Uint8Array(ab);
  let o = 0;
  const putStr = s => { for (const ch of s) u8[o++] = ch.charCodeAt(0); };
  putStr('3DAP'); u8[o++] = 0x01; u8[o++] = 0x00;
  if (cast) {
    putStr('CAST');
    dv.setUint32(o, castBody, false); o += 4;
    dv.setUint16(o, N, false); o += 2;
    cast.forEach((nm, i) => {
      const s = String(nm);
      dv.setUint16(o, i + 1, false); o += 2;
      dv.setUint16(o, 2 + s.length, false); o += 2; putStr(s);
      dv.setUint16(o, 2, false); o += 2; // the empty trailing field
    });
  }
  putStr('PAGE');
  dv.setUint16(o, 9, false); o += 2;
  dv.setUint16(o, 0, false); o += 2;
  dv.setUint16(o, frames.length, false); o += 2;
  dv.setUint16(o, N, false); o += 2;
  frames.forEach((frame, fi) => {
    if (fi > 0) {
      const nt = notes[fi - 1];
      if (nt) { dv.setUint16(o, 2 + nt.length, false); o += 2; putStr(nt); }
      else    { dv.setUint16(o, 0, false); o += 2; }
      dv.setUint16(o, N, false); o += 2; // performer count precedes the records
    }
    frame.forEach((p, e) => {
      dv.setUint16(o, e + 1, false); o += 2;
      dv.setInt32(o, p.x, false); o += 4;
      dv.setInt32(o, p.y, false); o += 4;
      dv.setInt32(o, p.sym.charCodeAt(0) & 0xff, false); o += 4; // low byte = symbol
    });
  });
  putStr('END ');
  return ab;
}

describe('Pyware .3da parser', () => {
  it('reads performer positions and maps raw units to field steps', () => {
    // Raw .3da coordinates are centered on the 50 at 1000 units per yard (625
    // per step): west goal at raw X -50000, front sideline at raw Y +26250.
    const frame = [
      { x: -50000, y: 26250, sym: 'A' }, // -> stepsX 0,  stepsY 0  (west goal, front sideline)
      { x: 0,      y: 8750,  sym: 'A' }, // -> stepsX 80, stepsY 28 (50-yd line, front hash)
    ];
    const { pages, sections } = L._parsePywareFile(build3da([frame], 2));
    assert.strictEqual(pages.length, 1);
    assert.deepStrictEqual(sections, [{ letter: 'A', performers: ['A1', 'A2'] }]);
    const byLabel = Object.fromEntries(pages[0].performers.map(p => [p.label, p]));
    // Rank within a section is front-to-back (ascending stepsY): the front
    // performer (stepsY 0) is A1.
    assert.strictEqual(byLabel.A1.stepsX, 0);
    assert.strictEqual(byLabel.A1.stepsY, 0);
    assert.strictEqual(byLabel.A2.stepsX, 80);
    assert.strictEqual(byLabel.A2.stepsY, 28);
  });

  it('assigns section letters and per-section ranks', () => {
    const frame = [
      { x: 0, y: 10000, sym: 'A' },
      { x: 0, y: 30000, sym: 'A' }, // higher y => lower stepsY => ranks ahead
      { x: 0, y: 10000, sym: 'B' },
    ];
    const { sections } = L._parsePywareFile(build3da([frame], 3));
    assert.deepStrictEqual(sections, [
      { letter: 'A', performers: ['A1', 'A2'] },
      { letter: 'B', performers: ['B1'] },
    ]);
  });

  it("uses the file's own performer numbers (CAST) instead of field order", () => {
    // A real pregame block: one column of four M's front-to-back, whose drill
    // numbers run 1, 4, 3, 2 — NOT the order they stand in. Deriving labels from
    // position would rename every one of them.
    const frame = [
      { x: 15000, y: 13750, sym: 'M' },
      { x: 15000, y: 11250, sym: 'M' },
      { x: 15000, y: 8750,  sym: 'M' },
      { x: 15000, y: 6250,  sym: 'M' },
    ];
    const { pages, sections } = L._parsePywareFile(build3da([frame], 4, [], ['1', '4', '3', '2']));
    const frontToBack = pages[0].performers.slice().sort((a, b) => a.stepsY - b.stepsY);
    assert.deepStrictEqual(frontToBack.map(p => p.label), ['M1', 'M4', 'M3', 'M2']);
    // The section list is still ordered by number, not by field position.
    assert.deepStrictEqual(sections, [{ letter: 'M', performers: ['M1', 'M2', 'M3', 'M4'] }]);
  });

  it('keeps a CAST label bound to the same performer as the drill moves', () => {
    const f0 = [{ x: 0, y: 2500, sym: 'A' }, { x: 0, y: 0, sym: 'A' }];
    const f1 = [{ x: 0, y: 0, sym: 'A' }, { x: 0, y: 2500, sym: 'A' }]; // the two swap places
    const { pages } = L._parsePywareFile(build3da([f0, f1, f1], 2, ['', 'set 2'], ['7', '3']));
    const at = c => pages.find(p => p.count === c).performers.map(p => p.label);
    assert.deepStrictEqual(at(0), ['A7', 'A3']);
    assert.deepStrictEqual(at(1), ['A7', 'A3']); // record order is the stable performer order
  });

  it('falls back to front-to-back ranks when CAST names collide', () => {
    // Two performers in one section sharing a number can't be told apart, so the
    // derived labels are safer than ambiguous ones.
    const frame = [
      { x: 0, y: 2500, sym: 'A' },
      { x: 0, y: 0,    sym: 'A' },
    ];
    const { pages } = L._parsePywareFile(build3da([frame], 2, [], ['2', '2']));
    const frontToBack = pages[0].performers.slice().sort((a, b) => a.stepsY - b.stepsY);
    assert.deepStrictEqual(frontToBack.map(p => p.label), ['A1', 'A2']);
  });

  it('ignores a CAST block whose performer count does not match', () => {
    const frame = [{ x: 0, y: 2500, sym: 'A' }, { x: 0, y: 0, sym: 'A' }];
    const ab = build3da([frame], 2, [], ['5', '9']);
    new DataView(ab).setUint16(10, 3, false); // CAST claims 3 performers
    const labels = L._parsePywareFile(ab).pages[0].performers.map(p => p.label).sort();
    assert.deepStrictEqual(labels, ['A1', 'A2']);
  });

  it("reads a set's Pyware instruction text (page note), preserving line breaks", () => {
    const F = [{ x: 0, y: 0, sym: 'A' }, { x: 1250, y: 0, sym: 'A' }];
    // note for frame 0 lives in the header before frame 1; frame 1 has none.
    const { pages } = L._parsePywareFile(build3da([F, F], 2, ['Fight Song:\nMT 16\n']));
    const noted = pages.filter(p => p.note);
    assert.strictEqual(noted.length, 1);
    assert.strictEqual(noted[0].count, 0);
    assert.strictEqual(noted[0].note, 'Fight Song:\nMT 16'); // trailing whitespace trimmed, internal \n kept
    // a page without text carries no note field at all
    assert.ok(pages.every(p => p.note === undefined || typeof p.note === 'string'));
  });

  it('promotes an annotated frame to its own set even without a geometric bend', () => {
    // Three identical frames (no motion ⇒ no geometric sets past 0), but frame 1
    // carries page text, so it must appear as a set with that note.
    const F = [{ x: 0, y: 0, sym: 'A' }, { x: 1250, y: 0, sym: 'A' }];
    const { pages } = L._parsePywareFile(build3da([F, F, F], 2, ['', 'Halt 8']));
    const noted = pages.find(p => p.note === 'Halt 8');
    assert.ok(noted, 'the annotated frame became a set');
    assert.strictEqual(noted.count, 1);
  });

  it('detects marked sets geometrically where trajectories bend', () => {
    const N = 80;
    const frameAt = t => Array.from({ length: N }, (_, e) => {
      // Straight line out to count 4, then a sharp bend back for every performer.
      const x = t <= 4 ? t * 1250 : (8 - t) * 1250;
      return { x, y: e * 1250 - 40000, sym: String.fromCharCode(65 + (e % 4)) };
    });
    const frames = Array.from({ length: 9 }, (_, t) => frameAt(t));
    const { pages } = L._parsePywareFile(build3da(frames, N));
    const counts = pages.map(p => p.count);
    assert.ok(counts.includes(0), 'set 0 is always present');
    assert.ok(counts.includes(4), 'the bend at count 4 is a marked set');
    assert.ok(pages.length >= 2);
  });
});

describe('drillSpotNums', () => {
  it('normalizes string / array / empty to an array of number strings', () => {
    assert.deepStrictEqual(L.drillSpotNums('42'), ['42']);
    assert.deepStrictEqual(L.drillSpotNums(['42', 7]), ['42', '7']);
    assert.deepStrictEqual(L.drillSpotNums(''), []);
    assert.deepStrictEqual(L.drillSpotNums(undefined), []);
  });
});

describe('drillSpotLabelParts (section letter + rank)', () => {
  it('splits letters from the trailing number', () => {
    assert.deepStrictEqual(L.drillSpotLabelParts('M1'), { section: 'M', rank: 1 });
    assert.deepStrictEqual(L.drillSpotLabelParts('a12'), { section: 'A', rank: 12 });
    assert.deepStrictEqual(L.drillSpotLabelParts('BD3'), { section: 'BD', rank: 3 });
  });
  it('handles a number-only or letter-only label', () => {
    assert.deepStrictEqual(L.drillSpotLabelParts('7'), { section: '?', rank: 7 });
    assert.deepStrictEqual(L.drillSpotLabelParts('X'), { section: 'X', rank: 0 });
    assert.deepStrictEqual(L.drillSpotLabelParts(''), { section: '?', rank: 0 });
  });
});

describe('drillSpotStripOthers (one spot per student per show)', () => {
  it('removes the student from other spots, keeping the target label', () => {
    const m = { A1: '42', B2: '42' };
    L.drillSpotStripOthers(m, 'B2', '42');
    assert.deepStrictEqual(m, { A1: [], B2: '42' }); // A1 emptied to a cleared []
  });
  it('accepts a numeric argument (coerced to string)', () => {
    const m = { A1: '42' };
    L.drillSpotStripOthers(m, 'B2', 42);
    assert.deepStrictEqual(m, { A1: [] });
  });
  it('preserves a shared spot, dropping only the moved student from it', () => {
    const m = { A1: ['42', '7'], C3: '9' };
    L.drillSpotStripOthers(m, 'C3', '42'); // 42 moves to C3 (caller sets C3 after)
    assert.deepStrictEqual(m, { A1: '7', C3: '9' }); // A1 collapses to the single partner
  });
  it('leaves the mapping untouched when the student holds no other spot', () => {
    const m = { A1: '7', B2: '9' };
    L.drillSpotStripOthers(m, 'A1', '7');
    assert.deepStrictEqual(m, { A1: '7', B2: '9' });
  });
});

describe('drillMappingDiff (spot-history events from a mapping edit)', () => {
  it('reports an assignment as an add and a cleared spot as a remove', () => {
    assert.deepStrictEqual(L.drillMappingDiff({}, { M1: '42' }),
      [{ label: 'M1', num: '42', action: 'add' }]);
    assert.deepStrictEqual(L.drillMappingDiff({ M1: '42' }, {}),
      [{ label: 'M1', num: '42', action: 'remove' }]);
    assert.deepStrictEqual(L.drillMappingDiff({ M1: '42' }, { M1: [] }),
      [{ label: 'M1', num: '42', action: 'remove' }]);
  });

  it('reports a reassignment as remove + add on the same label', () => {
    assert.deepStrictEqual(L.drillMappingDiff({ M1: '42' }, { M1: '7' }), [
      { label: 'M1', num: '42', action: 'remove' },
      { label: 'M1', num: '7',  action: 'add' },
    ]);
  });

  it('reports a student moving spots as a remove on the old label and an add on the new', () => {
    assert.deepStrictEqual(L.drillMappingDiff({ A1: '42' }, { A1: [], M3: '42' }), [
      { label: 'A1', num: '42', action: 'remove' },
      { label: 'M3', num: '42', action: 'add' },
    ]);
  });

  it('diffs shared spots per student and ignores unchanged spots and format changes', () => {
    assert.deepStrictEqual(L.drillMappingDiff(
      { A1: ['42', '7'], B2: '9', C3: '5' },
      { A1: '42',        B2: ['9'], C3: '5' }
    ), [{ label: 'A1', num: '7', action: 'remove' }]);
    assert.deepStrictEqual(L.drillMappingDiff({ A1: '42' }, { A1: ['42'] }), []);
  });
});

describe('spotHistorySpans (assignment spans from history events)', () => {
  it('pairs add/remove into a closed span and leaves a current assignment open', () => {
    const events = [
      { label: 'M1', num: '42', action: 'add',    at: 100 },
      { label: 'M1', num: '42', action: 'remove', at: 200 },
      { label: 'X5', num: '42', action: 'add',    at: 200 },
    ];
    const spans = L.spotHistorySpans(events, { X5: '42' });
    assert.deepStrictEqual(spans, [
      { num: '42', label: 'X5', start: 200, end: null, current: true },
      { num: '42', label: 'M1', start: 100, end: 200,  current: false },
    ]);
  });

  it('tolerates unordered events and duplicate adds', () => {
    const events = [
      { label: 'M1', num: '42', action: 'remove', at: 300 },
      { label: 'M1', num: '42', action: 'add',    at: 100 },
      { label: 'M1', num: '42', action: 'add',    at: 150 }, // dup — original start kept
    ];
    assert.deepStrictEqual(L.spotHistorySpans(events, {}),
      [{ num: '42', label: 'M1', start: 100, end: 300, current: false }]);
  });

  it('surfaces pre-tracking assignments: current with no add, and a remove with no add', () => {
    // Assigned before history existed, still assigned now.
    assert.deepStrictEqual(L.spotHistorySpans([], { M1: '42' }),
      [{ num: '42', label: 'M1', start: null, end: null, current: true }]);
    // Assigned before history existed, later removed.
    assert.deepStrictEqual(
      L.spotHistorySpans([{ label: 'M1', num: '42', action: 'remove', at: 500 }], {}),
      [{ num: '42', label: 'M1', start: null, end: 500, current: false }]);
  });

  it('handles shared spots and sorts current first, then most recently ended', () => {
    const events = [
      { label: 'A1', num: '42', action: 'add',    at: 100 },
      { label: 'A1', num: '7',  action: 'add',    at: 100 },
      { label: 'A1', num: '42', action: 'remove', at: 400 },
      { label: 'B2', num: '42', action: 'add',    at: 400 },
      { label: 'B2', num: '42', action: 'remove', at: 600 },
    ];
    const spans = L.spotHistorySpans(events, { A1: '7' });
    assert.deepStrictEqual(spans, [
      { num: '7',  label: 'A1', start: 100, end: null, current: true },
      { num: '42', label: 'B2', start: 400, end: 600,  current: false },
      { num: '42', label: 'A1', start: 100, end: 400,  current: false },
    ]);
  });
});

describe('applyDrillSpotCsv (per-drill spot CSV, merge by student)', () => {
  const roster = new Set(['1', '42', '7', '9']);

  it('assigns from a roster-style sheet (Student Number + Spot), labels upper-cased', () => {
    const csv = 'Student Number,Name,Spot\n42,Sam,a1\n7,Riley,m3\n';
    const r = L.applyDrillSpotCsv({}, csv, roster);
    assert.deepStrictEqual(r.mapping, { A1: '42', M3: '7' });
    assert.strictEqual(r.assigned, 2);
  });

  it('shares a spot when two students name the same label', () => {
    const r = L.applyDrillSpotCsv({}, 'Student Number,Spot\n42,A1\n7,A1\n', roster);
    assert.deepStrictEqual(r.mapping, { A1: ['42', '7'] });
    assert.strictEqual(r.shared, 1);
  });

  it('merges by student: only listed students change, others untouched', () => {
    // 42 already at A1, 9 already at Z9; sheet moves 42 to B2, leaves 9 alone.
    const r = L.applyDrillSpotCsv({ A1: '42', Z9: '9' }, 'Student Number,Spot\n42,B2\n', roster);
    assert.deepStrictEqual(r.mapping, { B2: '42', Z9: '9' });
  });

  it('a blank spot un-assigns that student', () => {
    const r = L.applyDrillSpotCsv({ A1: '42' }, 'Student Number,Spot\n42,\n', roster);
    assert.deepStrictEqual(r.mapping, {});
    assert.strictEqual(r.cleared, 1);
  });

  it('removing one student from a shared spot leaves the other', () => {
    const r = L.applyDrillSpotCsv({ A1: ['42', '7'] }, 'Student Number,Spot\n7,\n', roster);
    assert.deepStrictEqual(r.mapping, { A1: '42' });
  });

  it('reports roster-unknown numbers without touching the map', () => {
    const r = L.applyDrillSpotCsv({ A1: '42' }, 'Student Number,Spot\n999,B2\n', roster);
    assert.deepStrictEqual(r.mapping, { A1: '42' });
    assert.deepStrictEqual(r.unknown, [{ label: 'B2', number: '999' }]);
  });

  it('flags a missing spot or number column', () => {
    assert.strictEqual(L.applyDrillSpotCsv({}, 'Name,Instrument\nJane,Trumpet\n', roster).error, 'columns');
  });
});

// ── Carrying spot assignments across a re-uploaded drill file ────────────────

describe('drillRelabelMapping', () => {
  // A column of four performers. `labels` names them front-to-back; `dx` shifts
  // the whole formation (the .3da calibration fix moved every dot 8 steps).
  const col = (labels, dx = 0) => labels.map((label, i) => ({
    label, section: label[0], stepsX: 100 + dx, stepsY: 20 + i * 4,
  }));
  const pagesOf = (...frames) => frames.map((performers, i) => ({ count: i * 16, performers }));

  it('moves each spot to the label the new file gives that performer', () => {
    // Same four bodies, same dots: the old parse numbered them by field order,
    // the new one by the file's own numbers (1, 4, 3, 2), 8 steps west.
    const oldPages = pagesOf(col(['M1', 'M2', 'M3', 'M4'], 8));
    const newPages = pagesOf(col(['M1', 'M4', 'M3', 'M2']));
    const res = L.drillRelabelMapping(oldPages, newPages, { M1: '10', M2: '20', M3: '30', M4: '40' });
    assert.strictEqual(res.matched, 4);
    assert.strictEqual(res.offsetX, -8);
    // The student who was 2nd from the front is still 2nd from the front.
    assert.deepStrictEqual(res.mapping, { M1: '10', M4: '20', M3: '30', M2: '40' });
    assert.deepStrictEqual(res.moves.map(m => `${m.from}->${m.to}`), ['M2->M4', 'M4->M2']);
    assert.strictEqual(res.changed, true);
  });

  it('leaves an unchanged mapping alone', () => {
    const p = pagesOf(col(['M1', 'M2', 'M3', 'M4']));
    const res = L.drillRelabelMapping(p, p, { M1: '10', M3: '30' });
    assert.strictEqual(res.changed, false);
    assert.deepStrictEqual(res.mapping, { M1: '10', M3: '30' });
  });

  it('carries shared spots and explicitly cleared ones', () => {
    const oldPages = pagesOf(col(['A1', 'A2', 'A3', 'A4']));
    const newPages = pagesOf(col(['A4', 'A3', 'A2', 'A1']));
    const res = L.drillRelabelMapping(oldPages, newPages, { A1: ['10', '11'], A2: [], A3: '30' });
    assert.deepStrictEqual(res.mapping, { A4: ['10', '11'], A3: [], A2: '30' });
    // A cleared spot moves too, but isn't reported as a student who changed number.
    assert.deepStrictEqual(res.moves.filter(m => m.nums.length).map(m => m.to), ['A4', 'A2']);
  });

  it('uses every shared set to tell performers on the same dot apart', () => {
    // Two performers stacked at set 1, splitting apart at set 2.
    const stacked = labels => [
      { label: labels[0], section: 'B', stepsX: 40, stepsY: 10 },
      { label: labels[1], section: 'B', stepsX: 40, stepsY: 10 },
    ];
    const split = labels => [
      { label: labels[0], section: 'B', stepsX: 30, stepsY: 10 },
      { label: labels[1], section: 'B', stepsX: 50, stepsY: 10 },
    ];
    const oldPages = pagesOf(stacked(['B1', 'B2']), split(['B1', 'B2']));
    const newPages = pagesOf(stacked(['B9', 'B7']), split(['B9', 'B7']));
    const res = L.drillRelabelMapping(oldPages, newPages, { B1: '10', B2: '20' });
    assert.deepStrictEqual(res.mapping, { B9: '10', B7: '20' });
  });

  it('pairs almost nothing when the two files are different drills', () => {
    const oldPages = pagesOf(col(['M1', 'M2', 'M3', 'M4']));
    const newPages = pagesOf([
      { label: 'M1', section: 'M', stepsX: 12, stepsY: 60 },
      { label: 'M2', section: 'M', stepsX: 44, stepsY: 3  },
      { label: 'M3', section: 'M', stepsX: 81, stepsY: 77 },
      { label: 'M4', section: 'M', stepsX: 20, stepsY: 41 },
    ]);
    const res = L.drillRelabelMapping(oldPages, newPages, { M1: '10' });
    assert.ok(res.matched < res.total * 0.9, 'the caller can reject this pairing');
  });

  it('keeps an unpairable assignment rather than dropping it', () => {
    const oldPages = pagesOf(col(['M1', 'M2', 'M3', 'M4']));
    const newPages = pagesOf(col(['M1', 'M2', 'M3', 'M4']));
    // "Z9" isn't in either parse (a stale spot from an older file).
    const res = L.drillRelabelMapping(oldPages, newPages, { M1: '10', Z9: '99' });
    assert.strictEqual(res.mapping.Z9, '99');
    assert.deepStrictEqual(res.unmatched, ['Z9']);
  });

  it('survives a missing or empty old payload without inventing pairs', () => {
    const newPages = pagesOf(col(['M1', 'M2', 'M3', 'M4']));
    const res = L.drillRelabelMapping([], newPages, { M1: '10' });
    assert.strictEqual(res.matched, 0);
    assert.strictEqual(res.changed, false);
    assert.deepStrictEqual(res.mapping, { M1: '10' }); // nothing lost
  });
});

describe('Pyware file format dispatch', () => {
  const buf = bytes => new Uint8Array(bytes).buffer;
  const strBytes = s => [...s].map(c => c.charCodeAt(0));

  it('rejects a .3dz ZIP package with a helpful code', () => {
    assert.throws(() => L._parsePywareFile(buf([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])),
      /E_DRILL_ZIP/);
  });

  it('flags the encrypted newer .3dj format', () => {
    // 3DJV signature, no PAGE blocks, contains the PYJAVA marker.
    const bytes = strBytes('3DJV').concat(new Array(16).fill(0)).concat(strBytes('PYJAVA2'));
    assert.throws(() => L._parsePywareFile(buf(bytes)), /E_DRILL_ENCRYPTED/);
  });

  it('rejects a file that is not a Pyware drill at all', () => {
    assert.throws(() => L._parsePywareFile(buf(strBytes('HELLOWORLD'))),
      /does not look like a Pyware/);
  });
});
