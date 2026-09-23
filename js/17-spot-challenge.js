// Band Tracker — js/17-spot-challenge.js — Spot challenges (shared-spot mistake tallies).
// Plain script sharing global scope; load order is set in index.html.
//
// When two students share ("double-block") a field spot, a director watches
// each of them march it once in a rehearsal and tallies their mistakes; whoever
// makes fewer marches the spot that weekend. This file is that tally sheet:
//
//   • 'spot-challenges' — every shared spot across the band's shows (pick the
//     pair you're about to watch) plus recent results.
//   • 'spot-challenge'  — the tally sheet for one spot on one day: a big
//     "+ Mistake" button per student, tally marks, and who's ahead.
//
// Data: orgs/{orgId}/spotChallenges/{date_showId_label} =
//   { showId, show, label, date, nums, counts:{num:n}, season?, updatedAt, updatedBy }
// One doc per spot per day (spotChallengeId in js/00-logic.js), so re-opening
// the same pair on the same day resumes its sheet. Taps write counts with
// FieldValue.increment so two people tallying at once (one watching each
// student) never overwrite each other. Directors and staff read + tally;
// only directors delete a sheet; students can't read it (see firestore.rules).
// Separate from rehearsal marks — tallies don't touch entries or scores.

// ── Data helpers ──────────────────────────────────────────────────────────────

function _scDoc(date, showId, label) {
  const id = spotChallengeId(date, showId, label);
  return (STATE.spotChallenges || []).find(c => c.id === id) || null;
}

// The students on a sheet: whoever is on the spot now (today's sheet only —
// a past sheet shouldn't pick up someone assigned since), plus anyone the
// sheet already recorded, so a tally never vanishes when the spot is re-assigned.
function _scNums(showId, label, date, doc) {
  const out = [];
  const add = n => { n = String(n); if (n && !out.includes(n)) out.push(n); };
  (doc?.nums || []).forEach(add);
  Object.keys(doc?.counts || {}).forEach(n => { if (Number(doc.counts[n]) > 0) add(n); });
  if (date === today() || !doc) {
    const show = (STATE.shows || {})[showId];
    drillSpotNums(show?.mapping?.[label]).forEach(add);
  }
  return out;
}

function _scName(num) {
  const s = STATE.students[num];
  return s ? (s.name || `#${num}`) : `#${num}`;
}

function _scCount(doc, num) {
  return Math.max(0, Number(doc?.counts?.[num]) || 0);
}

// ── Tally marks ───────────────────────────────────────────────────────────────

// Classic tally marks: groups of four strokes crossed by a fifth. Each group is
// its own small SVG so a long run wraps onto the next line.
function _scTallyHtml(n) {
  if (!n) return `<span class="sc-tally-none">No mistakes yet</span>`;
  const groups = [];
  for (let left = n; left > 0; left -= 5) {
    const k = Math.min(5, left);
    let lines = '';
    for (let i = 0; i < Math.min(4, k); i++) {
      const x = 5 + i * 6;
      lines += `<line x1="${x}" y1="3" x2="${x}" y2="25"/>`;
    }
    if (k === 5) lines += `<line x1="1" y1="21" x2="27" y2="7"/>`;
    groups.push(`<svg class="sc-tally-group" viewBox="0 0 28 28" aria-hidden="true">${lines}</svg>`);
  }
  return groups.join('');
}

// ── View: pick a shared spot ──────────────────────────────────────────────────

function viewSpotChallenges() {
  if (!canRecord()) return `<div class="empty-state"><p>Directors only.</p></div>`;
  const spots = sharedSpotsFromShows(STATE.shows);
  const date  = today();

  const spotRow = sp => {
    const doc  = _scDoc(date, sp.showId, sp.label);
    const nums = _scNums(sp.showId, sp.label, date, doc);
    const any  = nums.some(n => _scCount(doc, n) > 0);
    return `
      <button class="sc-spot-row" onclick="navigate('spot-challenge',{showId:'${esc(sp.showId)}',label:'${esc(sp.label)}'})">
        <span class="badge badge-primary sc-spot-label">${esc(sp.label)}</span>
        <span class="sc-spot-names">${nums.map(n => esc(_scName(n))).join(' <span class="sc-vs">vs</span> ')}</span>
        <span class="sc-spot-score">${any ? nums.map(n => _scCount(doc, n)).join(' – ') : 'Watch ›'}</span>
      </button>`;
  };

  const byShow = {};
  spots.forEach(sp => { (byShow[sp.showId] = byShow[sp.showId] || { name: sp.show, rows: [] }).rows.push(sp); });
  const spotCards = Object.keys(byShow).map(sid => `
    <div class="sec-card">
      <div class="sec-hdr sec-hdr-open" style="cursor:default"><span class="section-title">${esc(byShow[sid].name)}</span></div>
      <div class="sc-spot-list">${byShow[sid].rows.map(spotRow).join('')}</div>
    </div>`).join('');

  const empty = `
    <div class="empty-state" style="padding:32px 20px">
      <div class="empty-icon">👥</div>
      <p>No shared spots yet.</p>
      <p style="color:var(--text-muted);max-width:320px;margin:6px auto 0">
        Put two students on the same spot in a show (Field Chart → tap a dot → ⋯) and it shows up here to watch.
      </p>
    </div>`;

  // Recent results: past and today's sheets that have at least one tally.
  const results = (STATE.spotChallenges || [])
    .filter(c => Object.values(c.counts || {}).some(v => Number(v) > 0))
    .slice(0, 40);
  const resultRow = c => {
    const nums = _scNums(c.showId, c.label, c.date, c);
    const { leaders, tie } = spotChallengeLeaders(c.counts, nums);
    return `
      <button class="sc-result-row" onclick="navigate('spot-challenge',{showId:'${esc(c.showId)}',label:'${esc(c.label)}',date:'${esc(c.date)}'})">
        <div class="sc-result-top">
          <span>${esc(fmtShort(c.date))} · ${esc(c.show || 'Show')} · <strong>${esc(c.label)}</strong></span>
          ${tie ? '<span class="badge badge-neutral">Tied</span>' : ''}
        </div>
        <div class="sc-result-scores">${nums.map(n => {
          const lead = !tie && leaders.includes(n);
          return `<span class="${lead ? 'sc-result-lead' : ''}">${lead ? '✓ ' : ''}${esc(_scName(n))} ${_scCount(c, n)}</span>`;
        }).join('<span class="sc-vs">·</span>')}</div>
      </button>`;
  };

  return `<div class="songs-page">
    <p class="setting-hint" style="margin:0 0 12px">
      Pick the pair you're about to watch. Tap <strong>+ Mistake</strong> each time a student misses something while marching the spot — fewer mistakes wins the spot.
    </p>
    ${spots.length ? spotCards : empty}
    ${results.length ? `
    <div class="sec-card">
      <div class="sec-hdr sec-hdr-open" style="cursor:default"><span class="section-title">Recent results</span></div>
      <div class="sc-spot-list">${results.map(resultRow).join('')}</div>
    </div>` : ''}
  </div>`;
}

// ── View: the tally sheet ─────────────────────────────────────────────────────

function viewSpotChallenge(params) {
  if (!canRecord()) return `<div class="empty-state"><p>Directors only.</p></div>`;
  const { showId, label } = params || {};
  const date = (params && params.date) || today();
  const show = (STATE.shows || {})[showId];
  const doc  = _scDoc(date, showId, label);
  const nums = _scNums(showId, label, date, doc);
  const showName = show?.name || doc?.show || 'Show';

  if (!nums.length) {
    return `<div class="empty-state" style="padding:32px 20px">
      <p>No one is on ${esc(label || 'this spot')} in ${esc(showName)}.</p>
      <button class="btn btn-primary" style="margin-top:12px" onclick="navigate('spot-challenges')">Pick a shared spot</button>
    </div>`;
  }

  const isToday = date === today();
  return `<div class="sc-page" id="sc-root">
    <div class="sc-head">
      <div class="sc-head-spot"><span class="badge badge-primary sc-spot-label">${esc(label)}</span> ${esc(showName)}</div>
      <div class="sc-head-date">${isToday ? 'Today' : esc(fmtDate(date))}</div>
    </div>
    ${nums.length < 2 ? `<p class="setting-hint" style="margin:0 0 10px">Only one student is on this spot now.</p>` : ''}
    <div class="sc-grid">${nums.map(n => _scCardHtml(n, doc)).join('')}</div>
    <div class="sc-verdict" id="sc-verdict" role="status">${_scVerdictHtml(doc, nums)}</div>
    <div class="sc-foot">
      <button class="btn btn-secondary btn-sm" onclick="scResetPrompt()">Reset tallies</button>
      ${STATE.isAdmin && doc ? `<button class="btn btn-sm btn-danger" onclick="scDeletePrompt()">Delete sheet</button>` : ''}
    </div>
    <p class="setting-hint" style="margin-top:14px">Tallies are kept separately from rehearsal marks and aren't shown to students.</p>
  </div>`;
}

function _scCardHtml(num, doc) {
  const n    = _scCount(doc, num);
  const name = _scName(num);
  const inst = STATE.students[num]?.instrument || '';
  const lead = _scIsSoleLeader(doc, num);
  return `
    <div class="sc-card${lead ? ' sc-card-lead' : ''}" id="sc-card-${esc(num)}">
      <div class="sc-card-name">${esc(name)}</div>
      ${inst ? `<div class="sc-card-sub">${esc(inst)}</div>` : ''}
      <div class="sc-card-count" id="sc-ct-${esc(num)}" aria-live="polite">${n}</div>
      <div class="sc-card-tally" id="sc-tally-${esc(num)}">${_scTallyHtml(n)}</div>
      <button class="btn sc-add-btn" onclick="scTally('${esc(num)}',1)" aria-label="Add a mistake for ${esc(name)}">+ Mistake</button>
      <button class="btn btn-secondary btn-sm sc-undo-btn" onclick="scTally('${esc(num)}',-1)" aria-label="Remove a mistake for ${esc(name)}">Undo</button>
    </div>`;
}

function _scIsSoleLeader(doc, num) {
  const nums = _scNums(_params.showId, _params.label, _params.date || today(), doc);
  if (nums.length < 2 || !nums.some(n => _scCount(doc, n) > 0)) return false;
  const { leaders, tie } = spotChallengeLeaders(doc?.counts, nums);
  return !tie && leaders[0] === num;
}

function _scVerdictHtml(doc, nums) {
  if (nums.length < 2) return '';
  if (!nums.some(n => _scCount(doc, n) > 0)) return 'No mistakes tallied yet.';
  const { leaders, tie } = spotChallengeLeaders(doc?.counts, nums);
  if (tie) return `Tied at ${_scCount(doc, leaders[0])} — ${leaders.map(n => esc(_scName(n))).join(' & ')}`;
  return `<strong>${esc(_scName(leaders[0]))}</strong> has the fewest mistakes`;
}

// Update just the counts, tally marks and verdict in place after a tap, so
// feedback is instant and the buttons under the finger aren't rebuilt. The
// snapshot echo re-renders the full view a moment later via renderFromData().
function _scPatch() {
  if (_view !== 'spot-challenge' || !document.getElementById('sc-root')) return;
  const date = _params.date || today();
  const doc  = _scDoc(date, _params.showId, _params.label);
  const nums = _scNums(_params.showId, _params.label, date, doc);
  nums.forEach(num => {
    const n = _scCount(doc, num);
    const ct = document.getElementById(`sc-ct-${num}`);
    const tl = document.getElementById(`sc-tally-${num}`);
    const cd = document.getElementById(`sc-card-${num}`);
    if (ct) ct.textContent = n;
    if (tl) tl.innerHTML = _scTallyHtml(n);
    if (cd) cd.classList.toggle('sc-card-lead', _scIsSoleLeader(doc, num));
  });
  const v = document.getElementById('sc-verdict');
  if (v) v.innerHTML = _scVerdictHtml(doc, nums);
}

// ── Actions ───────────────────────────────────────────────────────────────────

// +1 / −1 a student's mistake tally on the open sheet. Creates the day's sheet
// on the first tap. increment() keeps simultaneous tallies from two devices
// from overwriting each other.
function scTally(num, delta) {
  if (!canRecord()) return;
  const { showId, label } = _params;
  const date = _params.date || today();
  let doc = _scDoc(date, showId, label);
  if (delta < 0 && _scCount(doc, num) <= 0) return; // nothing to undo
  const nums = _scNums(showId, label, date, doc);
  const show = (STATE.shows || {})[showId];
  const id   = spotChallengeId(date, showId, label);

  // Optimistic local update so the count moves on the tap itself.
  if (!doc) {
    doc = { id, showId, label, date, nums, counts: {} };
    STATE.spotChallenges = [doc, ...(STATE.spotChallenges || [])];
  }
  doc.counts = { ...(doc.counts || {}), [num]: _scCount(doc, num) + delta };
  _scPatch();
  if (delta > 0 && navigator.vibrate) { try { navigator.vibrate(12); } catch {} }

  orgCol('spotChallenges').doc(id).set({
    showId, label, date, nums,
    show: show?.name || doc.show || 'Show',
    ...(STATE.activeSeason ? { season: STATE.activeSeason } : {}),
    counts: { [num]: firebase.firestore.FieldValue.increment(delta) },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: STATE.user?.uid || null,
  }, { merge: true });
}

function scResetPrompt() {
  if (!canRecord()) return;
  const date = _params.date || today();
  const doc  = _scDoc(date, _params.showId, _params.label);
  if (!doc || !Object.values(doc.counts || {}).some(v => Number(v) > 0)) { showToast('Nothing to reset.'); return; }
  showConfirmModal('Reset tallies?', `Set every mistake count on ${esc(_params.label)} back to 0.`, () => {
    const counts = {};
    Object.keys(doc.counts || {}).forEach(n => { counts[n] = 0; });
    doc.counts = { ...counts };
    orgCol('spotChallenges').doc(doc.id).update({
      counts,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: STATE.user?.uid || null,
    }).catch(_ignoreNotFound);
    render();
  }, 'Reset');
}

function scDeletePrompt() {
  if (!STATE.isAdmin) return;
  const date = _params.date || today();
  const doc  = _scDoc(date, _params.showId, _params.label);
  if (!doc) return;
  showConfirmModal('Delete this tally sheet?', `Removes the ${esc(fmtDate(date))} tallies for ${esc(_params.label)}. This can't be undone.`, () => {
    STATE.spotChallenges = STATE.spotChallenges.filter(c => c.id !== doc.id);
    orgCol('spotChallenges').doc(doc.id).delete();
    navigate('spot-challenges');
    showToast('Tally sheet deleted.');
  }, 'Delete');
}
