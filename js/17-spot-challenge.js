// Band Tracker — js/17-spot-challenge.js — Spot challenges (shared-spot mistake tallies).
// Plain script sharing global scope; load order is set in index.html.
//
// When two students share ("double-block") a field spot, a director watches
// each of them march it once in a rehearsal and tallies their mistakes; whoever
// makes fewer marches the spot that weekend. This file is that tally sheet:
//
//   • 'spot-challenges' — the shared spots in one show (a dropdown switches
//     shows; it starts on the Field Chart's show, or asks "Which show are you
//     watching?"). Tick the pair(s) you're about to watch (up to SC_MAX_WATCH
//     at once) and tap Watch. That show's recent results are listed underneath.
//   • 'spot-challenge'  — the tally sheet. One pair gets the full sheet (big
//     "+ Mistake" button per student, tally marks, who's ahead, reset/delete);
//     2–4 pairs get a compact screen with one row of buttons per pair, sized to
//     fill the phone so each button stays easy to hit while watching the field.
//     Params: { showId, label, date? } for one pair, { spots:[{showId,label}] }
//     for several (always today).
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

// Pairs ticked on the picker for multi-pair watching: [{ showId, label }].
// Kept for the session so coming back to the list keeps the selection.
const SC_MAX_WATCH = 4;
let _scSelected = [];
// The show the picker is showing pairs for (null = not chosen yet this session;
// then it defaults to the Field Chart's current show, or asks).
let _scShowId = null;

function _scSelIdx(showId, label) {
  return _scSelected.findIndex(x => x.showId === showId && x.label === label);
}

// The spots the open tally sheet covers, from the route params.
function _scSpots(params) {
  if (params && Array.isArray(params.spots) && params.spots.length) return params.spots;
  return (params && params.showId) ? [{ showId: params.showId, label: params.label }] : [];
}

// The pair container a tap patches in place — keyed by a DOM-safe id.
function _scPairKey(showId, label) {
  return spotChallengeId('p', showId, label);
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
  const allSpots = sharedSpotsFromShows(STATE.shows);
  const date  = today();

  // One show at a time. Shows with at least one shared spot, in list order.
  const shows = [];
  allSpots.forEach(sp => { if (!shows.some(x => x.id === sp.showId)) shows.push({ id: sp.showId, name: sp.show }); });
  const showId = _scCurrentShowId(shows);
  if (shows.length > 1 && !showId) return _scShowQuestionHtml(shows, allSpots);
  const spots = allSpots.filter(sp => sp.showId === showId);

  // Drop ticks for spots that are no longer shared (re-assigned since).
  _scSelected = _scSelected.filter(x => spots.some(sp => sp.showId === x.showId && sp.label === x.label));
  const full = _scSelected.length >= SC_MAX_WATCH;

  const spotRow = sp => {
    const doc  = _scDoc(date, sp.showId, sp.label);
    const nums = _scNums(sp.showId, sp.label, date, doc);
    const any  = nums.some(n => _scCount(doc, n) > 0);
    const on   = _scSelIdx(sp.showId, sp.label) >= 0;
    return `
      <button class="sc-spot-row${on ? ' sc-spot-on' : ''}${full && !on ? ' sc-spot-dim' : ''}" aria-pressed="${on}"
              onclick="scToggleSpot('${esc(sp.showId)}','${esc(sp.label)}')">
        <span class="sc-check" aria-hidden="true">${on ? '✓' : ''}</span>
        <span class="badge badge-primary sc-spot-label">${esc(sp.label)}</span>
        <span class="sc-spot-names">${nums.map(n => esc(_scName(n))).join(' <span class="sc-vs">vs</span> ')}</span>
        ${any ? `<span class="sc-spot-score">${nums.map(n => _scCount(doc, n)).join(' – ')}</span>` : ''}
      </button>`;
  };

  const showName = (shows.find(x => x.id === showId) || {}).name || 'Show';
  // With 2+ shows the heading is a dropdown to switch shows.
  const heading = shows.length > 1
    ? `<label class="sc-show-pick">
         <span class="sc-show-pick-lbl">Show</span>
         <span class="sc-show-select-wrap"><select class="form-input sc-show-select" aria-label="Which show are you watching?" onchange="scPickShow(this.value)">
           ${shows.map(x => `<option value="${esc(x.id)}" ${x.id === showId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
         </select><span class="sc-show-caret" aria-hidden="true">▾</span></span>
       </label>`
    : `<span class="section-title">${esc(showName)}</span>`;
  const spotCards = `
    <div class="sec-card">
      <div class="sec-hdr sec-hdr-open" style="cursor:default">${heading}</div>
      <div class="sc-spot-list">${spots.map(spotRow).join('')}</div>
    </div>`;

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
    .filter(c => !showId || c.showId === showId)
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
      Tick the pairs you're about to watch — up to ${SC_MAX_WATCH} at once — then tap <strong>Watch</strong>. Tap <strong>+ Mistake</strong> each time a student misses something while marching the spot; fewer mistakes wins the spot.
    </p>
    ${spots.length ? spotCards : empty}
    ${results.length ? `
    <div class="sec-card">
      <div class="sec-hdr sec-hdr-open" style="cursor:default"><span class="section-title">Recent results</span></div>
      <div class="sc-spot-list">${results.map(resultRow).join('')}</div>
    </div>` : ''}
    ${_scSelected.length ? `
    <div class="sc-watch-bar">
      <button class="btn btn-secondary" onclick="scClearSelection()">Clear</button>
      <button class="btn btn-primary sc-watch-btn" onclick="scWatchSelected()">Watch ${_scSelected.length} pair${_scSelected.length !== 1 ? 's' : ''} ›</button>
    </div>` : ''}
  </div>`;
}

// Which show the picker is on: the one picked this session, else the show of
// the chart open on the Field Chart tab, else the only show with shared spots.
// null means "ask" (2+ shows and no way to tell).
function _scCurrentShowId(shows) {
  const has = id => id && shows.some(x => x.id === id);
  if (has(_scShowId)) return _scShowId;
  const active = (typeof _activeShow === 'function') ? _activeShow() : null;
  if (active && has(active.id)) return active.id;
  return shows.length === 1 ? shows[0].id : null;
}

// Asked when the band has shared spots in 2+ shows and none is chosen yet.
function _scShowQuestionHtml(shows, allSpots) {
  return `<div class="songs-page">
    <div class="sec-card">
      <div class="sec-hdr sec-hdr-open" style="cursor:default"><span class="section-title">Which show are you watching?</span></div>
      <div class="sc-spot-list">${shows.map(x => {
        const n = allSpots.filter(sp => sp.showId === x.id).length;
        return `<button class="sc-spot-row" onclick="scPickShow('${esc(x.id)}')">
          <span class="sc-spot-names">${esc(x.name)}</span>
          <span class="sc-spot-count">${n} shared spot${n !== 1 ? 's' : ''} ›</span>
        </button>`;
      }).join('')}</div>
    </div>
  </div>`;
}

// Switch the picker to another show. Ticks from the old show are dropped so
// "Watch N pairs" never includes pairs that aren't on screen.
function scPickShow(showId) {
  _scShowId = showId;
  _scSelected = _scSelected.filter(x => x.showId === showId);
  render();
}

function scToggleSpot(showId, label) {
  const i = _scSelIdx(showId, label);
  if (i >= 0) _scSelected.splice(i, 1);
  else if (_scSelected.length >= SC_MAX_WATCH) { showToast(`Up to ${SC_MAX_WATCH} pairs at once.`); return; }
  else _scSelected.push({ showId, label });
  render();
}

function scClearSelection() {
  _scSelected = [];
  render();
}

function scWatchSelected() {
  if (!_scSelected.length) return;
  if (_scSelected.length === 1) navigate('spot-challenge', { ..._scSelected[0] });
  else navigate('spot-challenge', { spots: _scSelected.map(x => ({ ...x })) });
}

// ── View: the tally sheet ─────────────────────────────────────────────────────

function viewSpotChallenge(params) {
  if (!canRecord()) return `<div class="empty-state"><p>Directors only.</p></div>`;
  const spots = _scSpots(params);
  if (spots.length > 1) return _scMultiHtml(spots);
  const { showId, label } = spots[0] || {};
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
  const lead = _scSoleLeader(doc, nums);
  return `<div class="sc-page" id="sc-root" data-sc-pair="${esc(_scPairKey(showId, label))}">
    <div class="sc-head">
      <div class="sc-head-spot"><span class="badge badge-primary sc-spot-label">${esc(label)}</span> ${esc(showName)}</div>
      <div class="sc-head-date">${isToday ? 'Today' : esc(fmtDate(date))}</div>
    </div>
    ${nums.length < 2 ? `<p class="setting-hint" style="margin:0 0 10px">Only one student is on this spot now.</p>` : ''}
    <div class="sc-grid">${nums.map(n => _scCardHtml(showId, label, n, doc, lead)).join('')}</div>
    <div class="sc-verdict" role="status">${_scVerdictHtml(doc, nums)}</div>
    ${_scSongsHtml(nums)}
    <div class="sc-foot">
      <button class="btn btn-secondary btn-sm" onclick="scResetPrompt()">Reset tallies</button>
      ${STATE.isAdmin && doc ? `<button class="btn btn-sm btn-danger" onclick="scDeletePrompt()">Delete sheet</button>` : ''}
    </div>
    <p class="setting-hint" style="margin-top:14px">Tallies are kept separately from rehearsal marks and aren't shown to students.</p>
  </div>`;
}

function _scCardHtml(showId, label, num, doc, lead) {
  const n    = _scCount(doc, num);
  const name = _scName(num);
  const inst = STATE.students[num]?.instrument || '';
  const a    = `'${esc(showId)}','${esc(label)}','${esc(num)}'`;
  return `
    <div class="sc-card${lead === num ? ' sc-lead' : ''}" data-sc-num="${esc(num)}">
      <div class="sc-card-name">${esc(name)}</div>
      ${inst ? `<div class="sc-card-sub">${esc(inst)}</div>` : ''}
      <div class="sc-card-count sc-n" aria-live="polite">${n}</div>
      <div class="sc-card-tally">${_scTallyHtml(n)}</div>
      <button class="btn sc-add-btn" onclick="scTally(${a},1)" aria-label="Add a mistake for ${esc(name)}">+ Mistake</button>
      <button class="btn btn-secondary btn-sm sc-undo-btn" onclick="scTally(${a},-1)" aria-label="Remove a mistake for ${esc(name)}">Undo</button>
    </div>`;
}

// Several pairs at once (today): one row per pair, each student a big tap
// target showing their name and count. The rows share the screen height, so
// with fewer pairs each button is taller. Tapping a pair's heading opens its
// full sheet (tally marks, reset, delete).
function _scMultiHtml(spots) {
  const date = today();
  const multiShow = new Set(spots.map(sp => sp.showId)).size > 1;
  const rows = spots.map(({ showId, label }) => {
    const show = (STATE.shows || {})[showId];
    const doc  = _scDoc(date, showId, label);
    const nums = _scNums(showId, label, date, doc);
    const lead = _scSoleLeader(doc, nums);
    const songTotals = _scSongTotals(nums);
    const cells = nums.map(num => {
      const name = _scName(num);
      const a = `'${esc(showId)}','${esc(label)}','${esc(num)}'`;
      return `
        <div class="sc-mcell${lead === num ? ' sc-lead' : ''}" data-sc-num="${esc(num)}">
          <button class="sc-mbtn" onclick="scTally(${a},1)" aria-label="Add a mistake for ${esc(name)} on ${esc(label)}">
            <span class="sc-mbtn-name">${esc(name)}</span>
            <span class="sc-mbtn-line">
              <span class="sc-mbtn-count sc-n">${_scCount(doc, num)}</span>
              ${songTotals[num] ? `<span class="sc-mbtn-songs${songTotals.more === num ? ' sc-songs-more' : ''}" title="Songs memorized this season">♪ ${songTotals[num]}</span>` : ''}
            </span>
          </button>
          <button class="sc-mundo" onclick="scTally(${a},-1)" aria-label="Remove a mistake for ${esc(name)} on ${esc(label)}">Undo</button>
        </div>`;
    }).join('');
    return `
      <div class="sc-pair" data-sc-pair="${esc(_scPairKey(showId, label))}">
        <button class="sc-pair-head" onclick="navigate('spot-challenge',{showId:'${esc(showId)}',label:'${esc(label)}'})" aria-label="Open the full sheet for ${esc(label)}">
          <span class="badge badge-primary sc-spot-label">${esc(label)}</span>
          ${multiShow ? `<span class="sc-pair-show">${esc(show?.name || 'Show')}</span>` : ''}
          <span class="sc-verdict sc-pair-verdict" role="status">${_scShortVerdictHtml(doc, nums)}</span>
          <span class="sc-pair-open" aria-hidden="true">›</span>
        </button>
        ${nums.length ? `<div class="sc-pair-btns" style="grid-template-columns:repeat(${nums.length},1fr)">${cells}</div>`
                      : `<p class="setting-hint">No one is on this spot now.</p>`}
      </div>`;
  }).join('');
  return `<div class="sc-multi" id="sc-root">${rows}</div>`;
}

// ── Song memorization comparison ──────────────────────────────────────────────
// Directors weigh memorization alongside the mistake tally, so the sheet shows
// each student's passed songs for the season and per song category. Read from
// STATE.songs (directors + staff can read songs; students never see this page).

function _scSongsOn() {
  return featureOn('songs') && (STATE.songs || []).length > 0;
}

// The one student with strictly the most passed songs in a row (null on a tie
// or with fewer than two comparable students).
function _scMostPassed(values) {
  const vals = values.filter(v => v.passed != null);
  if (vals.length < 2) return null;
  const max = Math.max(...vals.map(v => v.passed));
  const top = vals.filter(v => v.passed === max);
  return top.length === 1 ? top[0].num : null;
}

// Season totals for the compact multi-pair buttons: { num: '5/8', more: num }.
function _scSongTotals(nums) {
  if (!_scSongsOn()) return {};
  const out = {};
  const vals = nums.map(num => {
    if (memExcluded(STATE.students[num] || {})) return { num, passed: null };
    const sm = songMemorizationSummary(STATE.songs, num, []);
    out[num] = `${sm.passed}/${sm.total}`;
    return { num, passed: sm.passed };
  });
  out.more = _scMostPassed(vals);
  return out;
}

// The full sheet's table: a season-total row, then one row per song category.
// The student with more songs passed in a row is highlighted.
function _scSongsHtml(nums) {
  if (!_scSongsOn() || !nums.length) return '';
  const cats = STATE.songCategories || [];
  const sums = {};
  nums.forEach(num => {
    sums[num] = memExcluded(STATE.students[num] || {}) ? null : songMemorizationSummary(STATE.songs, num, cats);
  });
  const any = nums.find(n => sums[n]);
  if (!any) return '';
  const rowHtml = (label, pick, cls = '') => {
    const vals = nums.map(num => ({ num, ...(sums[num] ? pick(sums[num]) : { passed: null }) }));
    const more = _scMostPassed(vals);
    return `<tr class="${cls}"><th scope="row">${esc(label)}</th>${vals.map(v => v.passed == null
      ? `<td class="sc-songs-na">${sums[v.num] ? '—' : 'Excluded'}</td>`
      : `<td class="${more === v.num ? 'sc-songs-more' : ''}">${more === v.num ? '✓ ' : ''}${v.passed}<span class="sc-songs-of">/${v.total}</span></td>`).join('')}</tr>`;
  };
  const catRows = sums[any].cats.map(c => rowHtml(c.cat, sm => sm.cats.find(x => x.cat === c.cat) || { passed: 0, total: 0 })).join('');
  return `
    <div class="sc-songs">
      <div class="sc-songs-title">Songs memorized</div>
      <table class="sc-songs-table">
        <thead><tr><th></th>${nums.map(n => `<th scope="col">${esc(_scName(n).split(/\s+/)[0])}</th>`).join('')}</tr></thead>
        <tbody>
          ${rowHtml('This season', sm => ({ passed: sm.passed, total: sm.total }), 'sc-songs-total')}
          ${catRows}
        </tbody>
      </table>
    </div>`;
}

// The one student with the fewest mistakes (null before any tally, on a tie,
// or with fewer than two students) — they get the green outline.
function _scSoleLeader(doc, nums) {
  if (nums.length < 2 || !nums.some(n => _scCount(doc, n) > 0)) return null;
  const { leaders, tie } = spotChallengeLeaders(doc?.counts, nums);
  return tie ? null : leaders[0];
}

function _scVerdictHtml(doc, nums) {
  if (nums.length < 2) return '';
  if (!nums.some(n => _scCount(doc, n) > 0)) return 'No mistakes tallied yet.';
  const { leaders, tie } = spotChallengeLeaders(doc?.counts, nums);
  if (tie) return `Tied at ${_scCount(doc, leaders[0])} — ${leaders.map(n => esc(_scName(n))).join(' & ')}`;
  return `<strong>${esc(_scName(leaders[0]))}</strong> has the fewest mistakes`;
}

// One-line verdict for a pair's heading on the multi-pair screen.
function _scShortVerdictHtml(doc, nums) {
  if (nums.length < 2 || !nums.some(n => _scCount(doc, n) > 0)) return '';
  const { leaders, tie } = spotChallengeLeaders(doc?.counts, nums);
  if (tie) return 'Tied';
  const first = _scName(leaders[0]).split(/\s+/)[0];
  return `<strong>${esc(first)}</strong> ahead`;
}

// Update just one pair's counts, tally marks, leader outline and verdict in
// place after a tap, so feedback is instant and the buttons under the finger
// aren't rebuilt. The snapshot echo re-renders the full view a moment later
// via renderFromData().
function _scPatch(showId, label, date) {
  if (_view !== 'spot-challenge') return;
  const box = document.querySelector(`[data-sc-pair="${CSS.escape(_scPairKey(showId, label))}"]`);
  if (!box) return;
  const doc  = _scDoc(date, showId, label);
  const nums = _scNums(showId, label, date, doc);
  const lead = _scSoleLeader(doc, nums);
  nums.forEach(num => {
    const el = box.querySelector(`[data-sc-num="${CSS.escape(num)}"]`);
    if (!el) return;
    const n = _scCount(doc, num);
    const ct = el.querySelector('.sc-n');
    const tl = el.querySelector('.sc-card-tally');
    if (ct) ct.textContent = n;
    if (tl) tl.innerHTML = _scTallyHtml(n);
    el.classList.toggle('sc-lead', lead === num);
  });
  const v = box.querySelector('.sc-verdict');
  if (v) v.innerHTML = v.classList.contains('sc-pair-verdict') ? _scShortVerdictHtml(doc, nums) : _scVerdictHtml(doc, nums);
}

// ── Actions ───────────────────────────────────────────────────────────────────

// +1 / −1 a student's mistake tally for one spot. Creates the day's sheet on
// the first tap. increment() keeps simultaneous tallies from two devices from
// overwriting each other. The date is the open sheet's (a past sheet can be
// corrected); the multi-pair screen is always today.
function scTally(showId, label, num, delta) {
  if (!canRecord()) return;
  const date = (_params && _params.date) || today();
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
  _scPatch(showId, label, date);
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
