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
  it('drops hidden-from-students rehearsals from the rows and the leaderboard', () => {
    // Hide r1 (which holds #7's only entry — an absence — and some of #42's marks).
    const rehearsals = [
      { id: 'r1', date: '2026-06-01', label: 'Sectionals', hiddenFromStudents: true },
      { id: 'r2', date: '2026-06-08' },
    ];
    const { rehearsals: rows, leaderboard } = L.buildPublicStats({ ...args, rehearsals });
    // Only the visible rehearsal has a row.
    assert.deepStrictEqual(rows, [{ date: '2026-06-08', label: '', absent: 0 }]);
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
function build3da(frames, N, notes = []) {
  const REC = 14;
  const hdrSize = fi => (fi > 0 && notes[fi - 1]) ? (2 + notes[fi - 1].length + 2) : (fi > 0 ? 4 : 0);
  let interTotal = 0;
  for (let fi = 1; fi < frames.length; fi++) interTotal += hdrSize(fi);
  const size = 6 /*3DAP+2*/ + 4 /*PAGE*/ + 8 /*hdr*/ +
    frames.length * N * REC + interTotal + 4 /*END */;
  const ab = new ArrayBuffer(size);
  const dv = new DataView(ab);
  const u8 = new Uint8Array(ab);
  let o = 0;
  const putStr = s => { for (const ch of s) u8[o++] = ch.charCodeAt(0); };
  putStr('3DAP'); u8[o++] = 0x01; u8[o++] = 0x00;
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
    // west goal at raw X -55000, front sideline at raw Y +26250, 625 units/step.
    const frame = [
      { x: -55000, y: 26250, sym: 'A' }, // -> stepsX 0,  stepsY 0  (west goal, front sideline)
      { x: -5000,  y: 8750,  sym: 'A' }, // -> stepsX 80, stepsY 28 (50-yd line, front hash)
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
