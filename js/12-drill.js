// Band Tracker — js/12-drill.js — Pyware drill picker, field chart, playback, mapping.
// Plain script sharing global scope; load order is set in index.html.


// ── Pyware drill integration ──────────────────────────────────────────────────
// The file PARSER (_parsePywareFile and the .3dj/.3da format readers) is pure
// byte-wrangling with no STATE/DOM, so it lives in js/00-logic.js where it can be
// unit-tested (tests/unit/logic.test.js). Everything below is the picker, field
// chart, playback and roster-mapping UI that consumes { pages, sections }.



// Tracks which drill's heavy position payload is currently in _drillData/_drillPages.
let _activeDrillLoadedId = null;

// A parsed drill file waiting for the user to pick which show it belongs to
// (set by _onDrillFileLoaded, consumed by _drillCommitImport).
let _drillPendingImport = null;

function _drillFileInput() {
  let inp = document.getElementById('drill-file-input');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id   = 'drill-file-input';
    inp.accept = '.3dj,.3da';
    inp.style.display = 'none';
    inp.onchange = e => { if (e.target.files[0]) _onDrillFileLoaded(e.target.files[0]); e.target.value = ''; };
    document.body.appendChild(inp);
  }
  return inp;
}

// Import a brand-new drill file into the library (always the file dialog).
function drillAddFile() {
  if (!STATE.isAdmin) return;
  _drillPendingReplace = null; // a cancelled replace must not hijack this import
  _drillFileInput().click();
}

// Entry from the tab empty-state / tracker button: pick performers from the
// active drill if one is loaded, otherwise import the first file.
function openDrillPicker() {
  if (!canRecord()) return;
  if (_drillData) { showDrillPickModal(); return; }
  drillAddFile();
}

// Reconcile the loaded chart with the school-wide active drill: load the active
// drill's payload when it changes, and keep its live facing in sync. Called by
// the drills + active-pointer listeners.
function _drillSyncActive() {
  const id = STATE.activeDrillId;
  if (!id) {
    if (_activeDrillLoadedId !== null) {
      _activeDrillLoadedId = null;
      _drillData = null; _drillPages = null; _drillFileName = null; _drillFlipV = false;
      _drillCurrentSet = 0; _drillTraceLabel = null; _drillSelLabel = null; _drillSearchQuery = ''; _drillTraceSets = []; _drillSelectMode = false; if (typeof _drillPlayStop === "function") _drillPlayStop();
    }
    return;
  }
  const meta = STATE.drills[id];
  if (!meta) return; // metadata not arrived yet — wait for the drills listener
  _drillFileName = meta.name || meta.fileName || null;
  if (_activeDrillLoadedId === id) {
    _drillFlipV = !!meta.flipV; // facing can change live
    return;
  }
  _drillLoadPayload(id); // different drill became active — fetch its positions
}

function _drillLoadPayload(id) {
  orgCol('drills').doc(id).collection('data').doc('main').get().then(snap => {
    if (STATE.activeDrillId !== id) return; // superseded while loading
    const p = snap.exists ? snap.data() : {};
    const meta = STATE.drills[id] || {};
    _drillData     = p.sections || [];
    _drillPages    = p.pages || [];
    _drillFlipV    = !!meta.flipV;
    _drillFileName = meta.name || meta.fileName || null;
    _drillCurrentSet = 0; _drillTraceLabel = null; _drillSelLabel = null; _drillSearchQuery = ''; _drillTraceSets = []; _drillSelectMode = false; if (typeof _drillPlayStop === "function") _drillPlayStop();
    _activeDrillLoadedId = id;
    renderFromData();
  }).catch(e => console.error('drill payload load failed:', e));
}

function _onDrillFileLoaded(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = _parsePywareFile(e.target.result);
      if (_drillPendingReplace) { // re-upload of an existing drill, not a new one
        const { drillId } = _drillPendingReplace;
        _drillPendingReplace = null;
        _drillReplaceFileLoaded(drillId, file, parsed);
        return;
      }
      // Remember where import began so we can return there after the chooser
      // (which replaces whatever modal was open).
      const origin = document.getElementById('drill-library-modal') ? 'library'
                   : (_view === 'drill' ? 'tab' : 'picker');
      _drillPendingImport = { file, parsed, origin };
      _showDrillShowChooser(); // ask which show this drill belongs to, then commit
    } catch (err) {
      _showDrillImportError(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

// Step 2 of import: pick the show. Adding the drill to an existing show makes it
// inherit that show's spot map (letters & numbers) with no re-entry; "New show"
// starts a fresh map. Defaults to the show you're already viewing.
function _showDrillShowChooser() {
  const pend = _drillPendingImport;
  if (!pend) return;
  const base = pend.file.name.replace(/\.3d[ja]$/i, '');
  const sel  = _activeShow()?.id || 'new';
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Add “${esc(base)}” to a show</div>
    <p class="modal-sub" style="margin:0 0 12px">A <strong>show</strong> groups charts that share one set of spot assignments. Add this chart to the show it belongs to and it takes on that show's letters &amp; numbers automatically — no re-entry. Or start a new show.</p>
    <div class="drill-show-choices">${_showChooserHtml(sel, base)}</div>
    <div class="modal-actions" style="margin-top:14px">
      <button class="btn btn-secondary" onclick="_drillCancelImport()">Cancel</button>
      <button class="btn btn-primary" onclick="_drillCommitImport()">Add chart</button>
    </div>
  `);
}

function _drillCancelImport() {
  _drillPendingImport = null;
  closeModal();
}

// Radio list of existing shows (+ a "New show" row with a name field), shared by
// the import and "move to show" flows. `selectedId` is a show id or 'new'.
function _showChooserHtml(selectedId, defaultName) {
  const shows = _drillShowsSorted();
  const rows = shows.map(s => {
    const n = Object.values(STATE.drills || {}).filter(d => d.showId === s.id).length;
    return `
      <label class="drill-show-choice">
        <input type="radio" name="drill-show-choice" value="${esc(s.id)}"${selectedId === s.id ? ' checked' : ''}>
        <span class="drill-show-choice-name">${esc(s.name || 'Show')}</span>
        <span class="drill-show-choice-meta">${n} chart${n !== 1 ? 's' : ''}</span>
      </label>`;
  }).join('');
  const newChecked = selectedId === 'new' || !shows.length;
  return `
    ${rows}
    <label class="drill-show-choice drill-show-choice--new">
      <input type="radio" name="drill-show-choice" value="new"${newChecked ? ' checked' : ''}
        onchange="if(this.checked){var i=document.getElementById('drill-new-show-name');if(i)i.focus();}">
      <span class="drill-show-choice-name">＋ New show</span>
    </label>
    <input class="form-input" id="drill-new-show-name" type="text" maxlength="80"
      placeholder="Show name" value="${esc(defaultName || '')}" style="margin-top:8px"
      onfocus="_drillPickNewShow()">`;
}

function _drillPickNewShow() {
  const r = document.querySelector('input[name="drill-show-choice"][value="new"]');
  if (r) r.checked = true;
}

// Shows sorted oldest-first for a stable listing.
function _drillShowsSorted() {
  return Object.values(STATE.shows || {}).sort((a, b) => {
    const ta = a.createdAt?.seconds || 0, tb = b.createdAt?.seconds || 0;
    if (ta !== tb) return ta - tb;
    return (a.name || '').localeCompare(b.name || '');
  });
}

// Resolve the show-chooser's current selection to a show id, creating a new show
// (with an empty map) when "New show" is picked. Returns null on nothing chosen.
function _resolveChosenShowId(defaultName) {
  const sel    = document.querySelector('input[name="drill-show-choice"]:checked');
  const choice = sel ? sel.value : 'new';
  if (choice !== 'new') return choice;
  const nameEl = document.getElementById('drill-new-show-name');
  const name   = (nameEl?.value || '').trim() || defaultName || 'Show';
  const sref   = orgCol('shows').doc();
  const meta   = { name, mapping: {}, createdAt: firebase.firestore.FieldValue.serverTimestamp(), by: STATE.user?.uid || null };
  sref.set(meta).catch(e => _toastSaveError(e, 'The show'));
  STATE.shows[sref.id] = { id: sref.id, ...meta }; // optimistic
  return sref.id;
}

// Step 3 of import: create the drill doc (tagged with its show), store the heavy
// payload, and make it the active chart.
function _drillCommitImport() {
  const pend = _drillPendingImport;
  if (!pend) return;
  const { file, parsed, origin } = pend;
  const base   = file.name.replace(/\.3d[ja]$/i, '');
  const showId = _resolveChosenShowId(base);
  if (!showId) return;
  _drillPendingImport = null;

  const ref  = orgCol('drills').doc();
  const meta = {
    name:           base,
    fileName:       file.name,
    setCount:       parsed.pages.length,
    performerCount: parsed.pages[0]?.performers?.length || 0,
    flipV:          false,
    showId,
    createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
    by:             STATE.user?.uid || null,
  };
  ref.set(meta)
    .then(() => ref.collection('data').doc('main').set({ sections: parsed.sections, pages: parsed.pages }))
    .then(() => orgCol('settings').doc('drill').set({ activeId: ref.id }, { merge: true }))
    .catch(err => { console.error(err); showToast('Could not save the chart.'); });

  // Optimistic local update so the new drill is active immediately.
  STATE.drills[ref.id] = { id: ref.id, ...meta };
  STATE.activeDrillId  = ref.id;
  _activeDrillLoadedId = ref.id;
  _drillData = parsed.sections; _drillPages = parsed.pages;
  _drillFileName = meta.name; _drillFlipV = false;
  _drillTraceLabel = null; _drillSelLabel = null; _drillSearchQuery = ''; _drillTraceSets = []; _drillSelectMode = false; if (typeof _drillPlayStop === "function") _drillPlayStop(); _drillCurrentSet = 0;

  closeModal();
  if (_view === 'drill')          render();
  else if (origin === 'library')  showDrillLibraryModal();
  else                            showDrillPickModal();
}

// Drill import failed. Known, self-inflicted cases (a .3dz package, or the
// newer encrypted Pyware format) get a titled modal explaining what to do;
// anything else falls back to a toast. Messages are tagged 'E_DRILL_*:' by
// _parsePywareFile.
function _showDrillImportError(err) {
  const msg = err?.message || 'Failed to read chart file.';
  const [tag, rest] = msg.includes(':') ? [msg.slice(0, msg.indexOf(':')), msg.slice(msg.indexOf(':') + 1)] : ['', msg];
  const bodies = {
    E_DRILL_ZIP: `
      <p>${esc(rest)}</p>
      <p>Unzip it first and upload the <strong>.3dj</strong> file inside. If that
      .3dj still won’t load, it’s the newer encrypted Pyware format — see below.</p>`,
    E_DRILL_ENCRYPTED: `
      <p>${esc(rest)}</p>
      <p>In Pyware 3D, export this show as a <strong>.3da</strong> file
      (File → Export, the plaintext “analog” format) and upload that instead —
      the app reads <strong>.3da</strong> and <strong>.3dj</strong>. The encrypted
      <strong>.3dj</strong>/<strong>.3dz</strong> package can’t be read without
      Pyware’s key.</p>`,
  };
  const body = bodies[tag];
  if (!body) { showToast(rest); return; }
  openModal(`
    <div class="modal-title">Can’t read this chart file</div>
    ${body}
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="closeModal()">OK</button>
    </div>`);
}

// ── Replacing a drill's file (re-upload) ─────────────────────────────────────
// Re-importing the same drill from Pyware — after a parser fix, or an edit in
// Pyware — would otherwise mean re-entering every spot by hand: the new parse
// can name the same performers differently, so keeping the map by label leaves
// students standing on other people's dots. Instead pair the two parses by
// POSITION (drillRelabelMapping in js/00-logic.js) and move each student's spot
// with the performer they were actually on. Director-only.

let _drillPendingReplace = null; // { drillId } while the file dialog is open
let _drillPendingRelabel = null; // { drillId, file, parsed, res } awaiting confirmation

function drillReplaceFilePrompt(id) {
  if (!STATE.isAdmin || !STATE.drills[id]) return;
  _drillPendingReplace = { drillId: id };
  _drillFileInput().click();
}

// A replacement file has parsed. Nothing assigned yet ⇒ just swap it in.
// Otherwise fetch the parse being replaced and work out where each spot moved.
function _drillReplaceFileLoaded(drillId, file, parsed) {
  const d = STATE.drills[drillId];
  if (!d) return;
  const show     = d.showId ? STATE.shows[d.showId] : null;
  const mapping  = (show ? show.mapping : d.mapping) || {};
  const assigned = Object.keys(mapping).some(k => drillSpotNums(mapping[k]).length);
  if (!assigned) { _drillReplaceCommit(drillId, file, parsed, null); return; }

  orgCol('drills').doc(drillId).collection('data').doc('main').get().then(snap => {
    const oldPages = (snap.exists && snap.data().pages) || [];
    const res = drillRelabelMapping(oldPages, parsed.pages, mapping);
    // Only trust a pairing that covers nearly the whole band — less than that
    // means this file isn't a re-export of the drill it would replace, and
    // guessing would scatter the spot map.
    if (!res.total || res.matched < res.total * 0.9) { _drillReplaceUnmatched(drillId, file, parsed); return; }
    // Labels line up, or only empty spots moved: nothing to ask about.
    if (!res.changed || !res.moves.some(m => m.nums.length)) {
      _drillReplaceCommit(drillId, file, parsed, res.changed ? res.mapping : null);
      return;
    }
    _drillPendingRelabel = { drillId, file, parsed, res };
    _showDrillRelabelModal();
  }).catch(e => {
    console.error('drill replace: could not read the current positions:', e);
    showToast('Could not read this chart’s current positions. Try again.');
  });
}

// The replacement doesn't line up with the drill it would replace. Say so —
// replacing anyway is fine, but the spot numbers stay put and the old positions
// (the only way to move them later) are gone once it's written.
function _drillReplaceUnmatched(drillId, file, parsed) {
  _drillPendingRelabel = { drillId, file, parsed, res: null };
  openModal(`
    <div class="modal-title">This looks like a different chart</div>
    <p>The performers in <strong>${esc(file.name)}</strong> don’t stand where the current file’s performers stand, so the app can’t tell which spot is which.</p>
    <p>You can still replace the file, but the spot assignments will keep their current letters &amp; numbers — check them afterward.</p>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="_drillRelabelCancel()">Cancel</button>
      <button class="btn btn-primary" onclick="_drillRelabelConfirm(false)">Replace anyway</button>
    </div>`);
}

// Show the director exactly which numbers change before anything is written.
function _showDrillRelabelModal() {
  const p = _drillPendingRelabel;
  if (!p || !p.res) return;
  const moved = p.res.moves.filter(m => m.nums.length);
  const names = nums => nums.map(n => STATE.students[n]?.name || `#${n}`).join(' / ');
  const rows = moved.slice(0, 8).map(m => `
    <div class="drill-relabel-row">
      <span class="drill-relabel-who">${esc(names(m.nums))}</span>
      <span class="drill-relabel-move">${esc(m.from)} → <strong>${esc(m.to)}</strong></span>
    </div>`).join('');
  const more = moved.length > 8 ? `<div class="drill-relabel-more">…and ${moved.length - 8} more</div>` : '';
  const off  = Math.abs(p.res.offsetX) > 0.01 || Math.abs(p.res.offsetY) > 0.01;
  openModal(`
    <div class="modal-title">This file numbers the spots differently</div>
    <p>The new file gives ${moved.length} assigned spot${moved.length !== 1 ? 's' : ''} a different letter &amp; number${off ? ', and puts the whole chart in a slightly different place on the field' : ''}. Everyone can keep the dot they’re actually standing on — their spot number just changes to match the new file.</p>
    <div class="drill-relabel-list">${rows}${more}</div>
    <div class="modal-actions" style="flex-direction:column;gap:8px;margin-top:14px">
      <button class="btn btn-primary btn-full" onclick="_drillRelabelConfirm(true)">Keep everyone on their dot</button>
      <button class="btn btn-secondary btn-full" onclick="_drillRelabelConfirm(false)">Keep the spot numbers instead</button>
      <button class="btn btn-secondary btn-full" onclick="_drillRelabelCancel()">Cancel</button>
    </div>`);
}

function _drillRelabelCancel() {
  _drillPendingRelabel = null;
  closeModal();
  showDrillLibraryModal();
}

function _drillRelabelConfirm(carry) {
  const p = _drillPendingRelabel;
  if (!p) return;
  _drillPendingRelabel = null;
  _drillReplaceCommit(p.drillId, p.file, p.parsed, (carry && p.res) ? p.res.mapping : null);
}

// Write the new payload over the drill's old one (its name, show and facing are
// the director's, so they stay), plus the carried-over spot map when asked for.
function _drillReplaceCommit(drillId, file, parsed, newMapping) {
  const d = STATE.drills[drillId];
  if (!d) return;
  const meta = {
    fileName:       file.name,
    setCount:       parsed.pages.length,
    performerCount: parsed.pages[0]?.performers?.length || 0,
  };
  const ref = orgCol('drills').doc(drillId);
  ref.update(meta)
    .then(() => ref.collection('data').doc('main').set({ sections: parsed.sections, pages: parsed.pages }))
    .catch(err => { console.error(err); showToast('Could not save the chart file.'); });
  if (newMapping) _drillSaveMappingFor(drillId, newMapping);

  Object.assign(d, meta); // optimistic; the drills listener will confirm
  if (STATE.activeDrillId === drillId) {
    _drillData = parsed.sections; _drillPages = parsed.pages;
    _activeDrillLoadedId = drillId;
    _drillCurrentSet = 0; _drillTraceLabel = null; _drillSelLabel = null;
    _drillSearchQuery = ''; _drillTraceSets = []; _drillSelectMode = false;
    if (typeof _drillPlayStop === 'function') _drillPlayStop();
  }
  closeModal();
  showToast(newMapping ? 'File replaced — everyone kept their dot.' : 'Chart file replaced.');
  if (_view === 'drill') render(); else showDrillLibraryModal();
}

// One-time migration: the old single drill lived in settings/drill itself. Move
// it into the library under a fixed id (idempotent across racing directors).
function _migrateLegacyDrill(d) {
  const ref = orgCol('drills').doc('legacy');
  ref.set({
    name:           (d.drillFileName || 'Imported chart').replace(/\.3dj$/i, ''),
    fileName:       d.drillFileName || null,
    setCount:       d.drillPages.length,
    performerCount: d.drillPages[0]?.performers?.length || 0,
    flipV:          !!d.drillFlipV,
    createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
    by:             STATE.user?.uid || null,
  })
    .then(() => ref.collection('data').doc('main').set({ sections: d.drillSections, pages: d.drillPages }))
    .then(() => {
      const del = firebase.firestore.FieldValue.delete();
      return orgCol('settings').doc('drill').set(
        { activeId: 'legacy', drillFileName: del, drillSections: del, drillPages: del, drillFlipV: del },
        { merge: true }
      );
    })
    .catch(e => console.error('legacy drill migration failed:', e));
}

// One-time, idempotent migration (director-only): give every ungrouped drill its
// own show carrying its current spot map, so the app has a single home for the
// shared mapping. Existing drills keep working via the drill-doc fallback until
// this runs; afterward the user can regroup drills (move them into one show, or
// pick a show when uploading the next file) so they share one map. A deterministic
// show id keeps racing directors from creating duplicates.
const _drillShowMigrating = new Set();
function _migrateDrillShows() {
  if (!STATE.isAdmin) return; // directors only (staff can't write shows/drills)
  Object.values(STATE.drills || {}).forEach(d => {
    if (!d || d.showId || _drillShowMigrating.has(d.id)) return;
    const showId = 'show_' + d.id; // deterministic ⇒ idempotent across clients
    _drillShowMigrating.add(d.id);
    orgCol('shows').doc(showId).set({
      name:      d.name || d.fileName || 'Show',
      mapping:   d.mapping || {},
      createdAt: d.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
      by:        d.by || STATE.user?.uid || null,
    }, { merge: true })
      .then(() => orgCol('drills').doc(d.id).update({ showId }))
      .catch(e => console.error('drill→show migration failed:', e))
      .finally(() => _drillShowMigrating.delete(d.id));
  });
}

let _drillActiveSection = 0;
let _drillChecked = new Set(); // selected performer indices

// The show the active drill belongs to (null if it isn't grouped into one).
// A show owns the shared label → student spot map for all its drills, so an
// assignment made on one drill carries over to every other drill in the show —
// including files uploaded later — with no re-entry.
function _activeShow() {
  const d = (STATE.drills && STATE.activeDrillId) ? STATE.drills[STATE.activeDrillId] : null;
  const sid = d && d.showId;
  return (sid && STATE.shows) ? (STATE.shows[sid] || null) : null;
}

// The active drill's effective label → student map. When the drill is grouped
// into a show, that's the show's shared map; otherwise it's the drill's own
// (legacy/ungrouped) map. Each show maps independently, so a student can be
// "M1" pregame and "X5" at halftime without collisions.
function _activeDrillMapping() {
  const show = _activeShow();
  if (show) return show.mapping || {};
  const d = (STATE.drills && STATE.activeDrillId) ? STATE.drills[STATE.activeDrillId] : null;
  return (d && d.mapping) || {};
}

// All students at a spot (a spot may be shared by more than one student).
// Resolution per label: the show's (or ungrouped drill's) explicit assignment
// wins — even an empty one, which means the spot was deliberately cleared. Then
// the legacy band-wide pywareMapping. Spots are assigned per show now, so there
// is no roster column/row fallback.
function drillStudentNumsByLabel(label) {
  const m = _activeDrillMapping();
  if (Object.prototype.hasOwnProperty.call(m, label)) return drillSpotNums(m[label]);
  const g = STATE.pywareMapping || {};
  if (Object.prototype.hasOwnProperty.call(g, label)) return drillSpotNums(g[label]);
  return [];
}

// The first student at a spot (single-value callers: trace, profile, etc.).
function drillStudentByLabel(label) {
  const nums = drillStudentNumsByLabel(label);
  return nums.length ? nums[0] : null;
}

// Comma-joined first names of everyone at a spot (for dot labels).
function _drillSpotNames(label) {
  return drillStudentNumsByLabel(label).map(n => {
    const s = STATE.students[n];
    return s ? (s.name ? s.name.split(/\s+/)[0] : `#${n}`) : `#${n}`;
  }).join(' / ');
}

// One performer row in the picker / mapping grid, keyed by drill label ("A1").
function _drillPerfRowHtml(perfLabel) {
  const studentNum = drillStudentByLabel(perfLabel);
  const student    = studentNum ? STATE.students[studentNum] : null;
  const checked    = _drillChecked.has(perfLabel);
  const name       = student ? (student.name || `#${studentNum}`) : perfLabel;
  const sub        = student ? (normInstrument(student.instrument) || '') : '<em>Not mapped</em>';
  return `
    <label class="drill-perf-row${checked ? ' drill-perf-row--checked' : ''}${!studentNum ? ' drill-perf-row--unmapped' : ''}">
      <input type="checkbox" style="display:none" ${checked ? 'checked' : ''}
        onchange="drillTogglePerformer('${esc(perfLabel)}', this.checked)">
      <div class="drill-perf-check">${checked ? '✓' : ''}</div>
      <div class="drill-perf-info">
        <div class="drill-perf-name">${esc(name)}</div>
        <div class="drill-perf-sub">${sub}</div>
      </div>
    </label>`;
}

function showDrillPickModal() {
  if (!_drillData) return;
  _drillChecked = new Set();

  const sections = _drillData;
  const unmappedCount = sections.flatMap(s => s.performers).filter(lbl => !drillStudentNumsByLabel(lbl).length).length;

  const renderSectionTabs = () => sections.map((s, i) =>
    `<button class="drill-tab${i === _drillActiveSection ? ' drill-tab--active' : ''}" onclick="drillSetSection(${i})">${esc(s.letter)}</button>`
  ).join('');

  const renderPerformerGrid = () =>
    sections[_drillActiveSection].performers.map(_drillPerfRowHtml).join('');

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Select from Chart</div>
    ${unmappedCount > 0 ? `
      <div class="drill-map-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        ${unmappedCount} position${unmappedCount !== 1 ? 's' : ''} not yet linked to students.
        <button class="link-btn" onclick="showDrillMappingModal()">Set up mapping</button>
      </div>` : ''}
    <div class="drill-tabs" id="drill-tabs">${renderSectionTabs()}</div>
    <div class="drill-perf-list" id="drill-perf-list">${renderPerformerGrid()}</div>
    <div style="display:flex;gap:8px;padding:4px 0;margin-top:4px">
      <button class="btn btn-sm btn-secondary" style="flex:1" onclick="drillSelectAll()">Select All</button>
      <button class="btn btn-sm btn-secondary" style="flex:1" onclick="drillClearAll()">Clear</button>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 2px">
      <span style="font-size:0.72rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%">${_drillFileName ? esc(_drillFileName) : 'Chart file'}</span>
      <div style="display:flex;gap:10px;flex-shrink:0">
        ${Object.keys(STATE.drills || {}).length > 1 ? `<button class="drill-reload-btn" onclick="showDrillLibraryModal()">Switch chart</button>` : ''}
        ${_drillPages && _drillPages.length ? `<button class="drill-reload-btn" onclick="showDrillChartModal()">View field chart →</button>` : ''}
      </div>
    </div>
    <div class="modal-actions" style="margin-top:4px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="drill-apply-btn" onclick="applyDrillSelection()">Apply to Tracker</button>
    </div>
  `);
}

function drillSetSection(idx) {
  _drillActiveSection = idx;
  const tabsEl = document.getElementById('drill-tabs');
  const listEl = document.getElementById('drill-perf-list');
  if (!tabsEl || !listEl) return;
  tabsEl.querySelectorAll('.drill-tab').forEach((t, i) =>
    t.classList.toggle('drill-tab--active', i === idx));
  listEl.innerHTML = _drillData[idx].performers.map(_drillPerfRowHtml).join('');
}

function drillTogglePerformer(label, checked) {
  if (checked) _drillChecked.add(label); else _drillChecked.delete(label);
  // Update the row's visual state without a full re-render
  const listEl = document.getElementById('drill-perf-list');
  if (listEl) {
    const performers = _drillData[_drillActiveSection].performers;
    const rowIdx = performers.indexOf(label);
    const rows = listEl.querySelectorAll('.drill-perf-row');
    if (rowIdx >= 0 && rows[rowIdx]) {
      rows[rowIdx].classList.toggle('drill-perf-row--checked', checked);
      rows[rowIdx].querySelector('.drill-perf-check').textContent = checked ? '✓' : '';
    }
  }
  const applyBtn = document.getElementById('drill-apply-btn');
  if (applyBtn) applyBtn.disabled = _drillChecked.size === 0;
}

function drillSelectAll() {
  if (!_drillData) return;
  _drillData[_drillActiveSection].performers.forEach(idx => _drillChecked.add(idx));
  drillSetSection(_drillActiveSection);
}

function drillClearAll() {
  if (!_drillData) return;
  _drillData[_drillActiveSection].performers.forEach(idx => _drillChecked.delete(idx));
  drillSetSection(_drillActiveSection);
}

function applyDrillSelection() {
  const unmapped = [];
  const studentNums = [];
  for (const label of _drillChecked) {
    const nums = drillStudentNumsByLabel(label).filter(n => STATE.students[n]);
    if (nums.length) studentNums.push(...nums); // shared spots add everyone
    else unmapped.push(label);
  }
  if (!studentNums.length && !unmapped.length) {
    showToast('Select at least one position.');
    return;
  }
  if (unmapped.length && !studentNums.length) {
    showToast('Selected positions are not mapped to students yet. Set up the mapping first.');
    return;
  }
  if (unmapped.length) {
    showToast(`${unmapped.length} unmapped position${unmapped.length !== 1 ? 's' : ''} skipped.`);
  }
  _drillSelectedNums = studentNums;
  closeModal();
  const rid = _params.rid;
  if (rid) reRender(rid);
}

function clearDrillSelection(rid) {
  _drillSelectedNums = [];
  if (rid) reRender(rid);
}

// ── Pyware Field Chart ────────────────────────────────────────────────────────

const _DRILL_COLORS = [
  '#e74c3c','#e67e22','#f39c12','#2ecc71','#1abc9c',
  '#3498db','#9b59b6','#e91e63','#795548','#607d8b',
];

function showDrillChartModal() {
  if (!_drillPages || !_drillPages.length) {
    showToast('No set position data found in this file.');
    return;
  }
  _drillCurrentSet  = 0;
  _drillChartSelect = true; // opened from the tracker to pick performers
  openModal(`<div id="drill-chart-root">${_drillChartHtml()}</div>`);
}

// Field geometry, shared by the SVG builder and the sticky fullscreen axis so
// the two never drift. 100 yards = 160 steps wide × 84 steps deep.
const _DRILL_GEOM = (() => {
  const SCALE = 3.5; // px per step
  const FW = Math.round(160 * SCALE), FH = Math.round(84 * SCALE);
  const ML = 30, MR = 8, MT = 20, MB = 22;
  return { SCALE, FW, FH, ML, MR, MT, MB, SW: FW + ML + MR, SH: FH + MT + MB };
})();

// Shared field SVG. `positions` is one set's performers. Options:
//   fs         — fullscreen sizing (width:100%) vs fixed width
//   labelMode  — 0 none · 1 drill labels (A1) · 2 mapped student names
//   traceLabel — draw this performer's path across every set + highlight them
//   selectMode — tap toggles selection (tracker) vs opens an info popup (viewer)
function _drillFieldSvg(positions, opts = {}) {
  const { fs = false, labelMode = 0, traceLabel = null, selectMode = false, fsView = false, focusLabel = null, traceIdx = null } = opts;

  // 100 yards = 160 steps wide × 84 steps deep; coords are already in steps
  // (stepsX from the west goal, stepsY off the front sideline).
  const { SCALE, FW, FH, ML, MR, MT, MB, SW, SH } = _DRILL_GEOM;
  const fx = s => (ML + s * SCALE).toFixed(1);
  // Front sideline at the bottom (stepsY = 0); flip swaps front/back to match
  // Pyware's "facing" setting if a file was built the other way.
  const fy = s => (_drillFlipV ? (MT + s * SCALE) : (MT + FH - s * SCALE)).toFixed(1);

  const secColor = {};
  (_drillData || []).forEach((sec, i) => { secColor[sec.letter] = _DRILL_COLORS[i % _DRILL_COLORS.length]; });

  // Field palette — green (default) or white. On a white field the lines/labels
  // flip to dark so they stay legible. Independent of the app's light/dark mode.
  const P = _drillFieldWhite
    ? { field:'#ffffff', border:'#2e7d32', major:'#555', minor:'#cfcfcf', tickMaj:'#888', tickMin:'#ccc', num:'#666', hash:'#8a8a8a', lblFill:'#111', lblStroke:'#fff', focusLine:'#333' }
    : { field:'#1f5c1f', border:'#ffffff', major:'#ffffff', minor:'#5a5', tickMaj:'#aaa', tickMin:'#666', num:'#aaa', hash:'#ffffff', lblFill:'#ffffff', lblStroke:'#000', focusLine:'#ffffff' };

  // Yard lines + numbers (top and bottom)
  let lines = '';
  for (let yd = 0; yd <= 100; yd += 5) {
    const sx = fx(yd * 1.6);
    const major = yd % 10 === 0;
    lines += `<line x1="${sx}" y1="${MT}" x2="${sx}" y2="${MT+FH}" stroke="${major?P.major:P.minor}" stroke-width="${major?'0.8':'0.4'}"/>`;
    lines += `<line x1="${sx}" y1="${MT+FH}" x2="${sx}" y2="${(MT+FH+4).toFixed(1)}" stroke="${major?P.tickMaj:P.tickMin}" stroke-width="${major?'0.8':'0.5'}"/>`;
    // Number the yard lines (both sidelines). The 10-yard lines are always
    // labelled; the 5-yard lines in between are only labelled once zoomed in
    // (_drillDotLabelsOn) — at full-field zoom they'd be too cramped — and get a
    // slightly smaller number so the 10s stay the primary anchors. Goal lines
    // (0/100) stay blank.
    if (yd > 0 && yd < 100 && (major || _drillDotLabelsOn)) {
      const lbl = yd > 50 ? 100 - yd : yd;
      const fsz = major ? 8 : 6;
      lines += `<text x="${sx}" y="${MT-4}" text-anchor="middle" fill="${P.num}" font-size="${fsz}" font-family="sans-serif">${lbl}</text>`;
      lines += `<text x="${sx}" y="${(MT+FH+14).toFixed(1)}" text-anchor="middle" fill="${P.num}" font-size="${fsz}" font-family="sans-serif">${lbl}</text>`;
    }
  }
  // Hash marks (HS: 28 and 56 steps off the front sideline)
  for (const hs of [28, 56]) {
    const hy = fy(hs);
    for (let yd = 0; yd <= 100; yd += 5) {
      const sx = parseFloat(fx(yd * 1.6));
      lines += `<line x1="${(sx-3).toFixed(1)}" y1="${hy}" x2="${(sx+3).toFixed(1)}" y2="${hy}" stroke="${P.hash}" stroke-width="0.5"/>`;
    }
  }

  // Trace path of one performer across the active sets (a selected subset, or
  // every set by default).
  let trace = '';
  if (traceLabel && _drillPages) {
    const idxs = traceIdx || _drillPages.map((_, i) => i);
    const pts = [];
    idxs.forEach(i => {
      const tp = _drillPages[i] && _drillPages[i].performers.find(p => p.label === traceLabel);
      if (tp) pts.push({ i, x: fx(tp.stepsX), y: fy(tp.stepsY) });
    });
    if (pts.length > 1) {
      trace += `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#ffd23f" stroke-width="1.4" stroke-dasharray="3 2" opacity="0.9" pointer-events="none"/>`;
    }
    pts.forEach(p => {
      const cur = p.i === _drillCurrentSet && !_drillPlaying;
      trace += `<circle cx="${p.x}" cy="${p.y}" r="${cur ? 2.6 : 1.8}" fill="#ffd23f" opacity="${cur ? 1 : 0.65}" pointer-events="none"/>`;
    });
  }

  // Performers (+ optional labels)
  let dots = '', labels = '', focus = '';
  for (const p of positions) {
    if (p.stepsX < -10 || p.stepsX > 170 || p.stepsY < -5 || p.stepsY > 90) continue; // safety
    const sx = fx(p.stepsX), sy = fy(p.stepsY);
    const col     = secColor[p.section] || '#888';
    // A spot shared by 2+ students gets a distinct marker below so double-
    // assigned dots are obvious at a glance.
    const spotCount = drillStudentNumsByLabel(p.label).length;
    const shared    = spotCount > 1 && _drillHighlightShared;
    const sel     = selectMode && _drillChecked.has(p.label);
    const isTrace = traceLabel && p.label === traceLabel;
    const isFocus = focusLabel && p.label === focusLabel;
    // Zoomed in, dots grow so the spot letter+number can be printed inside them.
    const baseR = _drillDotLabelsOn ? 5.4 : 3;
    const dotR  = (sel || isTrace || isFocus) ? (_drillDotLabelsOn ? 6.4 : 4.5) : baseR;
    // Every tap target carries its label; the actual pick is resolved by which
    // dot is NEAREST the finger (js/12-drill.js _drillResolveTap), not by paint
    // order, so a dot within ~2 steps of another isn't left unreachable behind it.
    dots += `<circle cx="${sx}" cy="${sy}" r="7" fill="transparent" data-drill-dot="${esc(p.label)}" onclick="_drillDotTap(event)" style="cursor:pointer"/>`;
    if (sel || isTrace) dots += `<circle cx="${sx}" cy="${sy}" r="${_drillDotLabelsOn ? '7.6' : '6.5'}" fill="none" stroke="${isTrace ? '#ffd23f' : '#fff'}" stroke-width="1.8"/>`;
    dots += `<circle cx="${sx}" cy="${sy}" r="${dotR}" fill="${isFocus ? '#ffd23f' : col}" pointer-events="none"/>`;
    // Shared-spot ring: orange with a dark halo so it reads on both the green
    // and white fields, and doesn't clash with the white select / gold trace
    // rings. Sits just outside the dot; always drawn (independent of zoom).
    if (shared) {
      const rr = (dotR + 1.7).toFixed(1);
      dots += `<circle cx="${sx}" cy="${sy}" r="${rr}" fill="none" stroke="#000" stroke-width="1.7" opacity="0.45" pointer-events="none"/>`
           +  `<circle cx="${sx}" cy="${sy}" r="${rr}" fill="none" stroke="#ff8c1a" stroke-width="1" pointer-events="none"/>`;
    }
    if (_drillDotLabelsOn && !isFocus) {
      // The spot label (letter + number) centered inside the dot. Shrinks a
      // touch for 3+ character labels (e.g. "A12") so it stays within the dot.
      const lt  = esc(p.label);
      const fsz = (p.label || '').length >= 3 ? 3.1 : 3.8;
      labels += `<text x="${sx}" y="${sy}" dy="0.34em" text-anchor="middle" font-size="${fsz}" font-weight="700" font-family="sans-serif" fill="#fff" pointer-events="none" style="paint-order:stroke;stroke:#000;stroke-width:0.7px;stroke-linejoin:round">${lt}</text>`;
    }
    // Zoomed in, a small orange badge on shared dots prints exactly how many
    // students are on the spot (2, 3, …).
    if (shared && _drillDotLabelsOn && !isFocus) {
      const bx = (parseFloat(sx) + dotR * 0.95).toFixed(1);
      const by = (parseFloat(sy) - dotR * 0.95).toFixed(1);
      labels += `<circle cx="${bx}" cy="${by}" r="2.5" fill="#ff8c1a" stroke="#000" stroke-width="0.35" pointer-events="none"/>`
             +  `<text x="${bx}" y="${by}" dy="0.34em" text-anchor="middle" font-size="3" font-weight="800" font-family="sans-serif" fill="#fff" pointer-events="none">${spotCount}</text>`;
    }
    if (isFocus) {
      // A tall, unmistakable callout drawn on top so you can always tell which
      // dot was tapped — even when an info panel overlaps the field.
      const y  = parseFloat(sy);
      const ty = (y - 13).toFixed(1);
      focus += `<line x1="${sx}" y1="${(y-4).toFixed(1)}" x2="${sx}" y2="${ty}" stroke="${P.focusLine}" stroke-width="1.1"/>`
            +  `<circle cx="${sx}" cy="${sy}" r="8.5" fill="none" stroke="#ffd23f" stroke-width="2.2"/>`
            +  `<circle cx="${sx}" cy="${sy}" r="8.5" fill="none" stroke="#000" stroke-width="0.7"/>`
            +  `<text x="${sx}" y="${ty}" text-anchor="middle" fill="#111" font-size="6.5" font-weight="700" font-family="sans-serif" pointer-events="none" style="paint-order:stroke;stroke:#ffd23f;stroke-width:6px;stroke-linejoin:round">${esc(p.label)}</text>`;
    }
    // Above-dot label (manual toggle). The in-dot label already prints the drill
    // number when zoomed, so suppress the redundant above-dot "drill #" then;
    // names (labelMode 2) still ride above the dot.
    if (labelMode && !(labelMode === 1 && _drillDotLabelsOn)) {
      let txt = p.label;
      if (labelMode === 2) txt = _drillSpotNames(p.label) || p.label; // one or more names

      const ly = _drillDotLabelsOn ? (parseFloat(sy) - 7).toFixed(1) : (parseFloat(sy) - 5).toFixed(1);
      labels += `<text x="${sx}" y="${ly}" text-anchor="middle" fill="${P.lblFill}" font-size="4.6" font-family="sans-serif" pointer-events="none" style="paint-order:stroke;stroke:${P.lblStroke};stroke-width:0.7px;stroke-linejoin:round">${esc(txt)}</text>`;
    }
  }

  return `
    <svg viewBox="0 0 ${SW} ${SH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="display:block;${fs ? 'width:100%;height:100%' : `width:${SW}px;max-width:100%`}">
      <rect x="${ML}" y="${MT}" width="${FW}" height="${FH}" fill="${P.field}"/>
      <rect x="${ML}" y="${MT}" width="${FW}" height="${FH}" fill="none" stroke="${P.border}" stroke-width="1.2"/>
      ${lines}${trace}${dots}${labels}${focus}
      <text x="${(ML-3)}" y="${fy(0)}" text-anchor="end" fill="#777" font-size="7" font-family="sans-serif" dominant-baseline="middle">F</text>
      <text x="${(ML-3)}" y="${fy(84)}" text-anchor="end" fill="#777" font-size="7" font-family="sans-serif" dominant-baseline="middle">B</text>
    </svg>`;
}

// True when any spot in the active map has more than one student on it.
function _drillHasSharedSpots() {
  const m = _activeDrillMapping();
  return Object.keys(m).some(k => drillSpotNums(m[k]).length > 1);
}

function _drillLegendHtml() {
  const sections = (_drillData || []).map((sec, i) => {
    const c = _DRILL_COLORS[i % _DRILL_COLORS.length];
    return `<span class="drill-chart-leg-item"><svg width="10" height="10" style="flex-shrink:0"><circle cx="5" cy="5" r="4" fill="${c}"/></svg>${esc(sec.letter)}</span>`;
  }).join('');
  // Key for the shared-spot ring, shown only when there's a shared spot to explain
  // and the highlight is turned on.
  const shared = (_drillHighlightShared && _drillHasSharedSpots())
    ? `<span class="drill-chart-leg-item"><svg width="12" height="12" style="flex-shrink:0"><circle cx="6" cy="6" r="3.1" fill="#888"/><circle cx="6" cy="6" r="5" fill="none" stroke="#ff8c1a" stroke-width="1.4"/></svg>Shared spot</span>`
    : '';
  return sections + shared;
}

// Cycle text for the labels toggle button.
const _DRILL_LABEL_TEXT = ['Labels: off', 'Labels: drill #', 'Labels: names'];

function _drillChartHtml(fs = false) {
  const idx       = _drillCurrentSet;
  const positions = _drillPages[idx].performers;
  const total     = _drillPages.length;

  const navLabel     = `Set ${idx + 1} <span style="font-weight:400;color:var(--text-muted)">of ${total} · count ${_drillPages[idx].count}</span>`;
  const prevDisabled = idx <= 0;
  const nextDisabled = idx >= total - 1;

  const legend   = _drillLegendHtml();
  const svgField = _drillFieldSvg(positions, { fs, labelMode: _drillLabelMode, traceLabel: null, selectMode: true });

  const expandIcon = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9"/></svg>`;

  if (fs) {
    return `
      <div class="drill-fs-nav">
        <button class="btn btn-sm btn-secondary" onclick="drillChartNav(-1)"${prevDisabled?' disabled':''}>&#8592;</button>
        <span class="drill-chart-setlabel">${navLabel}</span>
        <button class="btn btn-sm btn-secondary" onclick="drillChartNav(1)"${nextDisabled?' disabled':''}>&#8594;</button>
        <button class="btn btn-sm btn-secondary" onclick="drillChartCycleLabels()" title="Toggle labels">${_drillLabelMode ? '🏷' : '🏷'}</button>
        <button class="btn btn-sm btn-secondary" onclick="drillChartFlip()" title="Flip facing">⇅</button>
        <button class="btn btn-sm btn-secondary" onclick="drillChartCollapse()" title="Exit fullscreen" style="margin-left:4px">&#x2715;</button>
      </div>
      <div class="drill-fs-svg-wrap">${svgField}<div class="drill-fs-axis"></div></div>
      <div class="drill-fs-bottom">
        ${legend ? `<div class="drill-chart-legend" style="flex:1">${legend}</div>` : '<div></div>'}
        <button class="btn btn-primary btn-sm" onclick="applyDrillSelection()">Apply Selection</button>
      </div>`;
  }

  return `
    <div class="modal-title" style="margin-bottom:6px">Field Chart</div>
    <div class="drill-chart-nav">
      <button class="btn btn-sm btn-secondary" onclick="drillChartNav(-1)"${prevDisabled?' disabled':''}>&#8592;</button>
      <span class="drill-chart-setlabel">${navLabel}</span>
      <button class="btn btn-sm btn-secondary" onclick="drillChartNav(1)"${nextDisabled?' disabled':''}>&#8594;</button>
      <button class="btn btn-sm btn-secondary" onclick="drillChartExpand()" title="Fullscreen" style="margin-left:4px">${expandIcon}</button>
    </div>
    <div class="drill-chart-wrap">
      ${svgField}
    </div>
    ${legend ? `<div class="drill-chart-legend">${legend}</div>` : ''}
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:6px">
      <button class="btn btn-sm btn-secondary" onclick="drillChartCycleLabels()">${esc(_DRILL_LABEL_TEXT[_drillLabelMode])}</button>
      <button class="btn btn-sm btn-secondary" onclick="drillChartFlip()">⇅ Flip facing</button>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary" onclick="showDrillPickModal()">&#8592; List</button>
      <button class="btn btn-primary" onclick="applyDrillSelection()">Apply Selection</button>
    </div>`;
}

function drillChartCycleLabels() {
  _drillLabelMode = (_drillLabelMode + 1) % 3;
  _drillChartRefresh();
}

function _drillChartRefresh() {
  // Held until finger-up if a pinch/pan is in flight — see _drillGestureBusy.
  if (_drillGestureBusy) { _drillDeferRender(_drillChartRefresh); return; }
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) {
    fs.innerHTML = _drillChartSelect ? _drillChartHtml(true) : _drillViewFsHtml();
    _drillZoomSetup(fs.querySelector('.drill-fs-svg-wrap')); // keeps current pan/zoom
    return;
  }
  const root = document.getElementById('drill-chart-root');
  if (root) root.innerHTML = _drillChartHtml();
}

function drillChartExpand() {
  const fs = document.getElementById('drill-chart-fs');
  if (!fs) return;
  _drillZoomReset();
  fs.innerHTML = _drillChartSelect ? _drillChartHtml(true) : _drillViewFsHtml();
  fs.classList.remove('hidden');
  document.addEventListener('keydown', _drillChartFsKeydown);
  _drillZoomSetup(fs.querySelector('.drill-fs-svg-wrap'));
}

function drillChartCollapse() {
  const fs = document.getElementById('drill-chart-fs');
  if (!fs || fs.classList.contains('hidden')) return;
  _drillZoomReset();
  fs.classList.add('hidden');
  fs.innerHTML = '';
  document.removeEventListener('keydown', _drillChartFsKeydown);
  // Returning to the Drill tab: rebuild its inline stage (and re-bind zoom to
  // it) so set/flip/trace changes made in the overlay carry over.
  if (!_drillChartSelect && document.getElementById('drill-view-root')) {
    _drillZoomReset();
    _drillViewRerender();
  }
}

// Pinch-to-zoom + single-finger pan for the fullscreen chart.
// touch-action:none gives JS full control; we handle both gestures manually.
let _drillPanX = 0;
let _drillPanY = 0;
let _drillGestureStartScale = 1.0;
let _drillGestureStartPanX  = 0;
let _drillGestureStartPanY  = 0;
let _drillPinchInitDist = 0;
let _drillPinchCX = 0; // pinch center relative to wrap (fixed during gesture)
let _drillPinchCY = 0;
let _drillPanTouchX = 0; // single-finger start
let _drillPanTouchY = 0;
let _drillTapStartX = 0, _drillTapStartY = 0; // for tap-vs-pan discrimination
let _drillTapMoved  = false;
let _drillWasPinch  = false;

function _drillZoomReset() {
  _drillZoomScale = 1.0;
  _drillPanX = 0;
  _drillPanY = 0;
  _drillDotLabelsOn = false; // back to plain dots at 1×
}

// Past this zoom the dots grow and print their spot letter+number inside — no
// need to reach for the labels toggle, the numbers just appear as you zoom in.
// Two thresholds: labels come on at 1.8x and don't drop off again until 1.55x,
// so a wobble right at the line can't flip the chart back and forth.
const _DRILL_DOTLABEL_ZOOM     = 1.8;
const _DRILL_DOTLABEL_ZOOM_OFF = 1.55;

// True while fingers are on the chart. Rebuilding the SVG mid-gesture rips the
// touch target out of the DOM, and iOS then delivers the rest of that gesture to
// the removed node instead of to the wrap — our handlers (and the preventDefault
// they call) stop running, so the browser takes the pinch over and zooms the
// *page*, which reads as the field suddenly jumping off to one side. So nothing
// re-renders the chart while a gesture is live; queued work runs on finger-up.
let _drillGestureBusy   = false;
let _drillPendingRender = null;

// Run a chart re-render now, or hold it until the current gesture ends. Only the
// last request is kept — they all rebuild the same surface from current state.
function _drillDeferRender(fn) {
  if (_drillGestureBusy) { _drillPendingRender = fn; return; }
  fn();
}

// All fingers up (or the gesture was cancelled): flush what the gesture held off.
function _drillEndGesture() {
  _drillGestureBusy = false;
  const pending = _drillPendingRender;
  _drillPendingRender = null;
  _drillMaybeToggleDotLabels(); // apply any threshold crossed mid-gesture
  if (pending) pending();
}

// Called after every zoom change: when the scale crosses the threshold, flip the
// in-dot labels on/off and re-render the active chart surface (preserving the
// current pan/zoom). Only fires on an actual crossing, so panning stays cheap.
function _drillMaybeToggleDotLabels() {
  const want = _drillDotLabelsOn
    ? _drillZoomScale >= _DRILL_DOTLABEL_ZOOM_OFF
    : _drillZoomScale >= _DRILL_DOTLABEL_ZOOM;
  if (want === _drillDotLabelsOn) return;
  if (_drillGestureBusy) return; // re-checked by _drillEndGesture() on finger-up
  _drillDotLabelsOn = want;
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) _drillChartRefresh();
  else if (document.getElementById('drill-stage')) _drillViewRenderSvg();
}

// The chart container (overlay or inline Drill-tab stage) currently being
// pinch-zoomed/panned. Lets the same gesture + axis code drive either one.
let _drillZoomWrap = null;

function _drillZoomSetup(wrap) {
  wrap = wrap || document.querySelector('.drill-fs-svg-wrap');
  if (!wrap) return;
  _drillZoomWrap = wrap;
  // A rebuilt surface means any gesture that was running is gone — its touches
  // can no longer reach us, so don't leave the "busy" latch stuck on.
  _drillGestureBusy   = false;
  _drillPendingRender = null;
  wrap.addEventListener('touchstart',  _drillOnTouchStart,  { passive: false });
  wrap.addEventListener('touchmove',   _drillOnTouchMove,   { passive: false });
  wrap.addEventListener('touchend',    _drillOnTouchEnd,    { passive: false });
  wrap.addEventListener('touchcancel', _drillOnTouchCancel, { passive: false });
  // Desktop: scroll wheel zooms toward the cursor; click-drag pans once zoomed.
  wrap.addEventListener('wheel',      _drillOnWheel,      { passive: false });
  wrap.addEventListener('mousedown',  _drillOnMouseDown);
  _drillApplyZoom(wrap);
}

function _drillApplyZoom(wrap) {
  wrap = wrap || _drillZoomWrap;
  const svg = wrap?.querySelector('svg');
  if (!svg) return;
  const wW = wrap.clientWidth, wH = wrap.clientHeight;
  // A detached (replaced) or not-yet-laid-out wrap measures 0x0. Clamping the
  // pan against that would zero it and snap the view to the field's corner, so
  // leave the pan alone and let the live surface re-apply it.
  if (!wW || !wH) return;
  const sW = (svg.clientWidth  || wW) * _drillZoomScale;
  const sH = (svg.clientHeight || wH) * _drillZoomScale;
  // Centre on any axis with slack (content smaller than the viewport); clamp to
  // the edges on any axis that overflows so panning can't expose dead space.
  _drillPanX = (wW - sW) > 0 ? (wW - sW) / 2 : Math.max(wW - sW, Math.min(0, _drillPanX));
  _drillPanY = (wH - sH) > 0 ? (wH - sH) / 2 : Math.max(wH - sH, Math.min(0, _drillPanY));
  svg.style.transformOrigin = '0 0';
  svg.style.transform = `translate(${_drillPanX}px,${_drillPanY}px) scale(${_drillZoomScale})`;
  wrap.style.cursor = _drillZoomScale > 1.01 ? 'grab' : ''; // hint that you can drag to pan
  _drillRenderFsAxis(wrap);
  _drillMaybeToggleDotLabels(); // print spot labels inside the dots once zoomed in
}

// Sticky yard-number ruler for the zoomed chart: pins a row to both the top and
// bottom edges and tracks the visible yard lines, so a yard reference stays on
// screen no matter how far you pan/zoom.
function _drillRenderFsAxis(wrap) {
  wrap = wrap || _drillZoomWrap;
  const axis = wrap?.querySelector('.drill-fs-axis');
  if (!axis) return;
  const svg = wrap.querySelector('svg');
  if (!svg) { axis.innerHTML = ''; return; }
  const wW = wrap.clientWidth, wH = wrap.clientHeight;
  // Only needed when the field is taller than the viewport (its own top/bottom
  // numbers have scrolled off); otherwise both rows are already on screen.
  if ((svg.clientHeight || wH) * _drillZoomScale <= wH + 1) {
    axis.style.display = 'none'; axis.innerHTML = ''; return;
  }
  axis.style.display = '';

  const { SCALE, ML, SW } = _DRILL_GEOM;
  const k  = wW / SW;                 // px per svg-unit at scale 1 (svg is width:100%)
  const s  = _drillZoomScale;
  const toScreenX = v => _drillPanX + v * k * s;

  let html = '';
  for (let yd = 5; yd <= 95; yd += 5) {
    const major = yd % 10 === 0;
    // 5-yard floating markers only once zoomed in far enough (same threshold as
    // the on-field 5-yard numbers); the 10s always show while the ruler is up.
    if (!major && !_drillDotLabelsOn) continue;
    const xs = toScreenX(ML + yd * 1.6 * SCALE);
    if (xs < 10 || xs > wW - 10) continue; // off-screen horizontally
    const lbl  = yd > 50 ? 100 - yd : yd;
    const left = `left:${xs.toFixed(1)}px`;
    const cls  = major ? '' : ' drill-fs-axis-num--minor';
    html += `<span class="drill-fs-axis-num drill-fs-axis-num--top${cls}" style="${left}">${lbl}</span>`;
    html += `<span class="drill-fs-axis-num drill-fs-axis-num--bottom${cls}" style="${left}">${lbl}</span>`;
  }
  axis.innerHTML = html;
}

let _drillTouchIgnore = false; // touch started on the info panel — let it click through

// The container to measure and transform for this event: the element the
// listener sits on, unless it has been swapped out of the document since the
// gesture began (a detached wrap measures 0x0 and would corrupt the pan).
function _drillWrapFor(e) {
  const t = e.currentTarget;
  return (t && t.isConnected) ? t : (_drillZoomWrap || t);
}

function _drillOnTouchStart(e) {
  // Let the info panel and the instructions overlay handle their own touches
  // (buttons, scrolling) instead of panning/zooming the field underneath.
  if (e.target.closest && e.target.closest('.drill-info-pop, .drill-view-note')) { _drillTouchIgnore = true; return; }
  _drillTouchIgnore = false;
  _drillGestureBusy = true;
  e.preventDefault();
  const wrap = _drillWrapFor(e);
  const rect = wrap.getBoundingClientRect();
  if (e.touches.length >= 2) {
    _drillWasPinch = true;
    const t0 = e.touches[0], t1 = e.touches[1];
    _drillPinchInitDist     = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    _drillGestureStartScale = _drillZoomScale;
    _drillGestureStartPanX  = _drillPanX;
    _drillGestureStartPanY  = _drillPanY;
    _drillPinchCX = (t0.clientX + t1.clientX) / 2 - rect.left;
    _drillPinchCY = (t0.clientY + t1.clientY) / 2 - rect.top;
  } else {
    _drillWasPinch         = false; // first finger down: assume a tap until proven a pan/pinch
    _drillTapMoved         = false;
    _drillTapStartX        = e.touches[0].clientX;
    _drillTapStartY        = e.touches[0].clientY;
    _drillPinchInitDist    = 0;
    _drillPanTouchX        = e.touches[0].clientX;
    _drillPanTouchY        = e.touches[0].clientY;
    _drillGestureStartPanX = _drillPanX;
    _drillGestureStartPanY = _drillPanY;
  }
}

function _drillOnTouchMove(e) {
  if (_drillTouchIgnore) return;
  e.preventDefault();
  const wrap = _drillWrapFor(e);
  if (e.touches.length >= 2 && _drillPinchInitDist) {
    const t0 = e.touches[0], t1 = e.touches[1];
    const dist     = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const newScale = Math.max(1.0, Math.min(6.0, _drillGestureStartScale * dist / _drillPinchInitDist));
    // Zoom around the pinch center: keep the SVG point under _drillPinchCX/CY fixed.
    const r = newScale / _drillGestureStartScale;
    _drillZoomScale = newScale;
    _drillPanX = _drillPinchCX + (_drillGestureStartPanX - _drillPinchCX) * r;
    _drillPanY = _drillPinchCY + (_drillGestureStartPanY - _drillPinchCY) * r;
    _drillApplyZoom(wrap);
  } else if (e.touches.length === 1 && !_drillPinchInitDist) {
    if (Math.hypot(e.touches[0].clientX - _drillTapStartX, e.touches[0].clientY - _drillTapStartY) > 8) _drillTapMoved = true;
    _drillPanX = _drillGestureStartPanX + (e.touches[0].clientX - _drillPanTouchX);
    _drillPanY = _drillGestureStartPanY + (e.touches[0].clientY - _drillPanTouchY);
    _drillApplyZoom(wrap);
  }
}

function _drillOnTouchEnd(e) {
  if (_drillTouchIgnore) {
    // A finger that landed on a panel took the gesture over; still release the
    // latch when everything is up so held-back renders aren't stranded.
    if (e.touches.length === 0) { _drillTouchIgnore = false; _drillEndGesture(); }
    return;
  }
  if (e.touches.length === 0) {
    const wasTap = !_drillWasPinch && !_drillTapMoved;
    _drillWasPinch      = false;
    _drillPinchInitDist = 0;
    // Gesture over: safe to rebuild the chart again (in-dot labels, any render
    // that came in while fingers were down) before anything else touches it.
    _drillEndGesture();
    // A clean single-finger touch with no real movement is a tap — forward it to
    // the dot underneath (preventDefault suppressed the browser's own click), so
    // selecting/inspecting marchers works zoomed too.
    if (wasTap) _drillFsTapAt(e.changedTouches[0]);
    return;
  }
  if (e.touches.length < 2) _drillPinchInitDist = 0;
  if (e.touches.length === 1) {
    // Finger lifted during/after pinch — restart single-touch from new position
    _drillTapMoved         = true; // tail of a multi-finger gesture, never a tap
    _drillPanTouchX        = e.touches[0].clientX;
    _drillPanTouchY        = e.touches[0].clientY;
    _drillGestureStartPanX = _drillPanX;
    _drillGestureStartPanY = _drillPanY;
  }
}

// iOS cancels the whole gesture when the system takes over (call banner, edge
// swipe). Clear the same state as a finger-up, minus the tap forwarding.
function _drillOnTouchCancel(e) {
  if (e.touches.length) return;
  _drillTouchIgnore   = false;
  _drillWasPinch      = false;
  _drillPinchInitDist = 0;
  _drillEndGesture();
}

// True on a mouse/trackpad (fine pointer) — used to surface the desktop hints.
function _drillFinePointer() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: fine)').matches;
}

// Desktop: scroll-wheel zoom, anchored on the cursor so the point under it stays
// put (same idea as the pinch center). Ctrl/⌘ makes trackpad pinch-zoom land
// here too, since browsers report that as a wheel event.
function _drillOnWheel(e) {
  if (e.target.closest && e.target.closest('.drill-info-pop, .drill-view-note')) return; // let panels scroll
  e.preventDefault();
  const wrap = e.currentTarget;
  const rect = wrap.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;                 // lines → px
  else if (e.deltaMode === 2) dy *= wrap.clientHeight; // pages → px
  const start = _drillZoomScale;
  const next  = Math.max(1.0, Math.min(6.0, start * Math.exp(-dy * 0.0015)));
  if (next === start) return;
  const r = next / start;
  _drillZoomScale = next;
  _drillPanX = cx + (_drillPanX - cx) * r; // keep the cursor point fixed
  _drillPanY = cy + (_drillPanY - cy) * r;
  _drillApplyZoom(wrap);
}

// Desktop: click-drag to pan (meaningful once zoomed in). A drag suppresses the
// click that follows so it doesn't also select a dot; a plain click still does.
let _drillMouseMoved = false;
function _drillOnMouseDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest && e.target.closest('.drill-info-pop, .drill-view-note')) return;
  const wrap = e.currentTarget;
  const startX = e.clientX, startY = e.clientY, panX0 = _drillPanX, panY0 = _drillPanY;
  _drillMouseMoved = false;
  const move = ev => {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!_drillMouseMoved && Math.hypot(dx, dy) < 4) return; // small movement = a click
    _drillMouseMoved = true;
    wrap.style.cursor = 'grabbing';
    _drillPanX = panX0 + dx;
    _drillPanY = panY0 + dy;
    _drillApplyZoom(wrap);
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (_drillMouseMoved) {
      wrap.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
    }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// Translate a tap on the zoomable chart (pinch/pan intercepts the browser's own
// click) into a performer pick, resolved by nearest dot rather than paint order.
function _drillFsTapAt(touch) {
  if (!touch) return;
  const svg = _drillZoomWrap && _drillZoomWrap.querySelector('svg');
  if (svg) _drillResolveTap(touch.clientX, touch.clientY, svg);
}

// ── Tap resolution: nearest dot, with a chooser for overlapping spots ──────────
// The transparent tap circles are 7 steps wide, so any two dots within ~2 steps
// overlap and — under the old "topmost element wins" click — the one drawn first
// could never be tapped. Resolve instead by distance to each dot's on-screen
// CENTRE (paint order is irrelevant), and when more than one dot sits under the
// finger, offer a chooser instead of silently guessing.
const _DRILL_TAP_PX   = 24; // a dot counts as tapped within this many screen px
const _DRILL_AMBIG_PX = 12; // rivals this close to the nearest are "too close to call"

// A dot's transparent circle was clicked (desktop) — resolve by finger position.
function _drillDotTap(e) {
  const svg = e && e.currentTarget && e.currentTarget.ownerSVGElement;
  if (svg) _drillResolveTap(e.clientX, e.clientY, svg);
}

// Given a tap at (clientX, clientY) over `svg`, act on the nearest dot, or show a
// chooser when several dots are effectively under the finger. getBoundingClientRect
// gives each dot's true on-screen box (it already reflects the pan/zoom transform),
// so this works identically at every zoom level — zooming in spreads the dots out
// and the chooser stops appearing on its own.
function _drillResolveTap(clientX, clientY, svg) {
  _drillCloseDotChooser();
  if (!svg) return;
  const near = [];
  svg.querySelectorAll('[data-drill-dot]').forEach(el => {
    const r  = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d  = Math.hypot(cx - clientX, cy - clientY);
    if (d <= _DRILL_TAP_PX) near.push({ label: el.getAttribute('data-drill-dot'), d });
  });
  if (!near.length) return;
  near.sort((a, b) => a.d - b.d);
  // Rivals essentially as close as the nearest are ones the finger can't separate.
  const rivals = near.filter(h => h.d <= near[0].d + _DRILL_AMBIG_PX).slice(0, 6);
  if (rivals.length === 1) { _drillDotAction(near[0].label); return; }
  _drillShowDotChooser(rivals.map(r => r.label), clientX, clientY);
}

// Do to a resolved label what a direct tap on it would have done — which depends
// on the surface showing: fullscreen select (tracker) toggles it, fullscreen view
// traces it, the inline Drill-tab stage opens its info panel.
function _drillDotAction(label) {
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) {
    if (_drillChartSelect) drillChartToggle(label); else drillFsTapPerf(label);
  } else if (document.getElementById('drill-chart-root')) {
    drillChartToggle(label); // the non-fullscreen "Select from Drill" chart modal
  } else {
    drillShowPerfInfo(label);
  }
}

// A little menu of the overlapping performers, floated at the tap point (on the
// body so it clears the fullscreen overlay). Dismisses on the next outside tap.
function _drillShowDotChooser(labels, clientX, clientY) {
  _drillCloseDotChooser();
  const el = document.createElement('div');
  el.className = 'drill-dot-chooser';
  el.id = 'drill-dot-chooser';
  el.innerHTML = `<div class="drill-dot-chooser-head">${labels.length} performers here</div>` +
    labels.map(lbl => {
      const names = _drillSpotNames(lbl);
      return `<button class="drill-dot-choice" onclick="_drillDotChoose('${esc(lbl)}')">
        <span class="drill-dot-choice-lbl">${esc(lbl)}</span>
        <span class="drill-dot-choice-name${names ? '' : ' drill-dot-choice-name--none'}">${names ? esc(names) : 'Not mapped'}</span>
      </button>`;
    }).join('');
  document.body.appendChild(el);
  // Placed after append so its real size is known; flip away from the edges.
  const w = el.offsetWidth, h = el.offsetHeight;
  let L = clientX + 12, T = clientY + 12;
  if (L + w > window.innerWidth  - 8) L = clientX - w - 12;
  if (T + h > window.innerHeight - 8) T = clientY - h - 12;
  el.style.left = Math.max(8, L) + 'px';
  el.style.top  = Math.max(8, T) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', _drillDotChooserOutside, true), 0);
}

function _drillDotChooserOutside(e) {
  if (e.target.closest && e.target.closest('.drill-dot-chooser')) return;
  _drillCloseDotChooser();
}

function _drillCloseDotChooser() {
  document.removeEventListener('pointerdown', _drillDotChooserOutside, true);
  const el = document.getElementById('drill-dot-chooser');
  if (el) el.remove();
}

function _drillDotChoose(label) {
  _drillCloseDotChooser();
  _drillDotAction(label);
}

function _drillChartFsKeydown(e) {
  if (e.key === 'Escape')     { drillChartCollapse(); return; }
  if (e.key === 'ArrowLeft')  drillChartNav(-1);
  if (e.key === 'ArrowRight') drillChartNav(1);
  // Keyboard zoom (fullscreen): +/- step, 0 resets — anchored on the centre.
  if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0') _drillKeyZoom(e.key);
}

function _drillKeyZoom(key) {
  const wrap = _drillZoomWrap || document.querySelector('#drill-chart-fs .drill-fs-svg-wrap');
  if (!wrap) return;
  if (key === '0') { _drillZoomReset(); _drillApplyZoom(wrap); return; }
  const start = _drillZoomScale;
  const next  = Math.max(1.0, Math.min(6.0, start * (key === '-' ? 1 / 1.3 : 1.3)));
  if (next === start) return;
  const cx = wrap.clientWidth / 2, cy = wrap.clientHeight / 2, r = next / start;
  _drillZoomScale = next;
  _drillPanX = cx + (_drillPanX - cx) * r;
  _drillPanY = cy + (_drillPanY - cy) * r;
  _drillApplyZoom(wrap);
}

function drillChartNav(delta) {
  const total = _drillPages ? _drillPages.length : 0;
  _drillCurrentSet = Math.max(0, Math.min(total - 1, _drillCurrentSet + delta));
  _drillChartRefresh();
}

function drillChartToggle(label) {
  if (_drillChecked.has(label)) _drillChecked.delete(label);
  else _drillChecked.add(label);
  _drillChartRefresh();
}

function drillChartFlip() {
  _drillFlipV = !_drillFlipV;
  _drillPersistFlip();
  _drillChartRefresh();
}

// ── Pyware Mapping Modal ──────────────────────────────────────────────────────

let _drillMappingSection = 0;

function showDrillMappingModal() {
  if (!STATE.isAdmin || !_drillData) return; // assigning spots is director-only
  _drillMappingSection = 0;
  _renderDrillMappingModal();
}

// The mapping modal's per-label rows for the active section — extracted so a
// single assignment can refresh the list in place (keeping one-spot-per-show
// consistent: assigning a student here removes them from any other row).
function _drillMapRowsHtml() {
  const mapping  = _activeDrillMapping();
  const students = Object.values(STATE.students).sort((a, b) =>
    (a.name || '').localeCompare(b.name || ''));
  const studentOptions = `<option value="">— Not mapped —</option>` +
    students.map(s => `<option value="${esc(s.number)}">${esc(s.name || `#${s.number}`)}${s.instrument ? ` (${esc(normInstrument(s.instrument))})` : ''}</option>`).join('');
  const sec = _drillData[_drillMappingSection];
  return sec.performers.map(label => {
    const explicit = drillSpotNums(mapping[label]);
    // A shared spot (2+ students) is shown read-only here — edit it by tapping
    // the dot on the chart or via CSV, so the dropdown can't silently drop a
    // partner.
    if (explicit.length > 1) {
      const names = explicit.map(n => STATE.students[n]?.name || `#${n}`).join(', ');
      return `
        <div class="drill-map-row">
          <div class="drill-map-pos">${esc(label)}<span class="drill-map-auto">shared</span></div>
          <div class="drill-map-shared">${esc(names)} <span style="color:var(--text-muted)">· tap the dot to edit</span></div>
        </div>`;
    }
    const currentNum = explicit[0] || '';
    return `
      <div class="drill-map-row">
        <div class="drill-map-pos">${esc(label)}</div>
        <select class="drill-map-select form-input" data-label="${esc(label)}"
          onchange="drillMappingChange('${esc(label)}', this.value)">
          ${studentOptions.replace(`value="${esc(currentNum)}"`, `value="${esc(currentNum)}" selected`)}
        </select>
      </div>`;
  }).join('');
}

// Refresh just the mapping list (after an assignment) so a student removed from
// another spot by the one-per-show rule updates without reopening the modal.
function _drillMapListRefresh() {
  const el = document.getElementById('drill-map-list');
  if (el) el.innerHTML = _drillMapRowsHtml();
}

function _renderDrillMappingModal() {
  if (!STATE.isAdmin) return;
  const sections = _drillData;
  const show      = _activeShow();
  const drillName = show ? (show.name || 'this show')
                         : (STATE.drills[STATE.activeDrillId]?.name || _drillFileName || 'this chart');

  const renderSectionTabs = () => sections.map((s, i) =>
    `<button class="drill-tab${i === _drillMappingSection ? ' drill-tab--active' : ''}"
       onclick="drillMappingSetSection(${i})">${esc(s.letter)}</button>`).join('');

  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Spots for ${esc(drillName)}</div>
    <p class="modal-sub" style="margin:0 0 10px">Assign this show's spots to students. ${show ? `Every chart in <strong>${esc(show.name || 'this show')}</strong> shares these assignments, so a new chart file for the show inherits them.` : `Each show maps independently, so a student can have different spots per show.`} Saved automatically.</p>
    <button class="btn btn-secondary btn-full" style="margin-bottom:10px" onclick="showDrillSpotImportModal()">⬆︎ Import / export spots (CSV)</button>
    <div class="drill-tabs">${renderSectionTabs()}</div>
    <div class="drill-map-list" id="drill-map-list">${_drillMapRowsHtml()}</div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function drillMappingSetSection(idx) {
  _drillMappingSection = idx;
  _renderDrillMappingModal();
}

// Persist the active drill's effective spot map. Writes to the SHOW doc when
// the drill is grouped into one (so the change carries across every drill in the
// show), otherwise to the drill doc (ungrouped/legacy). Uses update() (not
// set-merge) so clearing a spot actually removes it — set with merge deep-merges
// maps and would keep cleared keys. A small write that never touches the roster.
function _saveActiveMapping(mapping) {
  if (STATE.activeDrillId) _drillSaveMappingFor(STATE.activeDrillId, mapping);
}

// Same, for any drill by id (the replace-file flow touches a drill that may not
// be the active one).
function _drillSaveMappingFor(drillId, mapping) {
  const drill = drillId ? STATE.drills[drillId] : null;
  if (!drill) return;
  const show = drill.showId ? STATE.shows[drill.showId] : null;
  if (show) {
    const changes = drillMappingDiff(show.mapping || {}, mapping); // diff before the optimistic swap
    show.mapping = mapping; // optimistic; the shows listener will confirm
    orgCol('shows').doc(drill.showId).update({ mapping })
      .catch(e => _toastSaveError(e, 'The spot assignment'));
    _spotHistoryRecord(drill.showId, show.name, changes);
    return;
  }
  drill.mapping = mapping; // optimistic; the drills listener will confirm
  orgCol('drills').doc(drillId).update({ mapping })
    .catch(e => _toastSaveError(e, 'The spot assignment'));
}

// Append a mapping edit's add/remove events to the show's spot-history doc
// (orgs/{orgId}/spotHistory/{showId} — director-ONLY, unlike the show doc, so
// keep any student- or staff-visible surface away from it). One event per
// student per label, stamped with a client-side ms timestamp (serverTimestamp
// isn't allowed inside arrayUnion) and the editor's uid — never an email
// (resolve for display with dirLabel()). The doc also carries the show's name
// so history stays labeled after the show itself is deleted.
function _spotHistoryRecord(showId, showName, changes) {
  if (!STATE.isAdmin || !changes || !changes.length) return;
  const at = Date.now();
  const by = STATE.user?.uid || null;
  const events = changes.map(c => ({ label: c.label, num: String(c.num), action: c.action, at, by }));
  // Optimistic local append so the history views update without a round trip.
  if (!STATE.spotHistory) STATE.spotHistory = {};
  const local = STATE.spotHistory[showId] = STATE.spotHistory[showId] || { id: showId, events: [] };
  local.name   = showName || local.name || 'Show';
  local.events = [...(local.events || []), ...events];
  orgCol('spotHistory').doc(showId).set({
    name:   showName || 'Show',
    events: firebase.firestore.FieldValue.arrayUnion(...events),
  }, { merge: true }).catch(e => _toastSaveError(e, 'The spot history'));
}

// Set a spot to a single student (or clear it) — the mapping modal's dropdown.
function drillMappingChange(label, studentNum) {
  if (!STATE.activeDrillId) return;
  const mapping = { ..._activeDrillMapping() };
  if (studentNum) {
    drillSpotStripOthers(mapping, label, studentNum); // one spot per student per show
    mapping[label] = String(studentNum);
  } else {
    delete mapping[label];
  }
  _saveActiveMapping(mapping);
  _drillMapListRefresh();  // reflect any spot the student was pulled out of
  _drillUnassignedRefresh(); // keep the Drill-tab pill accurate under the modal
}

// Add/remove operate on what the panel actually SHOWS (the effective list),
// then write it back explicitly. This makes the panel WYSIWYG: ✕ always removes
// the person you see, and an emptied spot is stored as an explicit [] ("cleared").
function drillSpotAddStudent(label, num) {
  if (!num || !STATE.activeDrillId) return;
  const mapping = { ..._activeDrillMapping() };
  drillSpotStripOthers(mapping, label, num); // one spot per student per show
  const cur = drillStudentNumsByLabel(label);
  if (!cur.includes(String(num))) cur.push(String(num));
  mapping[label] = cur.length === 1 ? cur[0] : cur;
  _saveActiveMapping(mapping);
  _drillRefreshCurrent();
}

function drillSpotRemoveStudent(label, num) {
  if (!STATE.activeDrillId) return;
  const mapping = { ..._activeDrillMapping() };
  const cur = drillStudentNumsByLabel(label).filter(n => n !== String(num));
  mapping[label] = cur.length === 1 ? cur[0] : cur; // [] ⇒ explicitly cleared
  _saveActiveMapping(mapping);
  _drillRefreshCurrent();
}

function _drillRefreshCurrent() {
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) _drillChartRefresh();
  else if (document.getElementById('drill-view-root')) { _drillViewRenderSvg(); _drillUnassignedRefresh(); }
}

// ── Per-drill spot import / export (CSV) ──────────────────────────────────────
// csvCell (js/00-logic.js) and _downloadCsv (js/03-router.js) do the generic work.

// A roster-oriented template you fill in by hand: one row per student (number +
// name, which you recognise), with a Spot column to write each student's label
// for THIS show. Pre-filled with their current spot. A student sharing a spot
// just gets the same label as their partner. Sorted by name.
function _drillSpotTemplateCsv() {
  // Reverse the current map (label → students) into student → label.
  const spotOf = {};
  const map = _activeDrillMapping();
  Object.keys(map).forEach(lbl => drillSpotNums(map[lbl]).forEach(n => { spotOf[n] = lbl; }));
  const students = Object.values(STATE.students)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '') || String(a.number).localeCompare(String(b.number)));
  const lines = ['Student Number,Name,Spot'];
  students.forEach(s => lines.push([s.number, csvCell(s.name || ''), spotOf[s.number] || ''].join(',')));
  return lines.join('\n');
}

function downloadDrillSpotTemplate() {
  if (!_drillData) return;
  const name = (STATE.drills[STATE.activeDrillId]?.name || 'chart').replace(/[^\w-]+/g, '_');
  _downloadCsv(`${name}-spots.csv`, _drillSpotTemplateCsv());
}

function showDrillSpotImportModal() {
  if (!STATE.isAdmin || !_drillData) return;
  const drillName = _activeShow()?.name || STATE.drills[STATE.activeDrillId]?.name || _drillFileName || 'this chart';
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Import spots — ${esc(drillName)}</div>
    <p class="modal-sub" style="margin:0 0 12px">
      Download the template — a row per student (number + name) — write each student's
      <strong>Spot</strong> for this show next to their name, then re-import. It updates only the
      students in your sheet (blank spot = unassigned); two students can share a spot by giving them
      the same label. Nothing else on the roster is touched.
    </p>
    <button class="btn btn-secondary btn-full" onclick="downloadDrillSpotTemplate()">⬇︎ Download roster template (fill in spots)</button>
    <label class="btn btn-primary btn-full" style="cursor:pointer;margin-top:10px">
      ⬆︎ Choose CSV to import
      <input type="file" accept=".csv,text/csv" style="display:none" onchange="drillSpotImportFile(event)">
    </label>
    <div id="drill-spot-import-msg" style="margin-top:12px"></div>
  `);
}

let _drillSpotPendingResult = null;

function drillSpotImportFile(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const drillName = _activeShow()?.name || STATE.drills[STATE.activeDrillId]?.name || _drillFileName || 'this chart';
  const reader = new FileReader();
  reader.onload = e => {
    const validNums = new Set(Object.keys(STATE.students));
    const current   = _activeDrillMapping();
    let res;
    try { res = applyDrillSpotCsv(current, String(e.target.result || ''), validNums); }
    catch (err) { console.error('spot CSV parse failed:', err); _drillSpotMsg(`<div class="auth-error">Could not read that CSV.</div>`); return; }
    if (res.error === 'columns') {
      _drillSpotMsg(`<div class="auth-error">Couldn't find both a <strong>Spot</strong> (or Label) and a <strong>Student Number</strong> column. Check the header row.</div>`);
      return;
    }
    if (!res.rows) { _drillSpotMsg(`<div class="auth-error">No spot rows found in that file.</div>`); return; }
    _drillSpotPendingResult = res;
    const unknownNote = res.unknown.length
      ? `<div style="color:var(--danger);font-size:.8rem;margin-top:6px">${res.unknown.length} row${res.unknown.length!==1?'s':''} reference a student number not on your roster and were skipped (e.g. ${esc(res.unknown.slice(0,3).map(u=>`${u.label}→#${u.number}`).join(', '))}).</div>`
      : '';
    _drillSpotMsg(`
      <div class="card" style="padding:12px">
        <div style="font-weight:600;margin-bottom:4px">Ready to apply</div>
        <div style="font-size:.85rem;color:var(--text-muted)">
          Assign <strong>${res.assigned}</strong> student${res.assigned!==1?'s':''}${res.cleared?`, unassign <strong>${res.cleared}</strong>`:''}${res.shared?`, <strong>${res.shared}</strong> shared spot${res.shared!==1?'s':''}`:''}.
        </div>
        ${unknownNote}
        <button class="btn btn-primary btn-full" style="margin-top:10px" onclick="drillSpotApplyImport()">Apply to ${esc(drillName)}</button>
      </div>`);
  };
  reader.readAsText(file);
}

function _drillSpotMsg(html) {
  const el = document.getElementById('drill-spot-import-msg');
  if (el) el.innerHTML = html;
}

function drillSpotApplyImport() {
  const res = _drillSpotPendingResult;
  if (!res || !STATE.activeDrillId) return;
  _saveActiveMapping(res.mapping);
  _drillSpotPendingResult = null;
  closeModal();
  showToast(`Spots updated — ${res.assigned} assigned${res.cleared ? `, ${res.cleared} unassigned` : ''}.`);
  if (_view === 'drill') _drillViewRerender();
}

// ── Standalone Field Chart viewer (Drill tab) ─────────────────────────────────
// A top-level, read-only chart: step through sets, jump to any set, toggle dot
// labels, tap a performer for their Pyware-style coordinate, and search to trace
// one performer's path across every set.

function viewDrill() {
  if (!canRecord()) return `<div class="empty-state"><p>Directors only.</p></div>`;
  if (!_drillData || !_drillPages || !_drillPages.length) {
    const hasDrills = Object.keys(STATE.drills || {}).length > 0;
    return `
      <div class="empty-state" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px">
        <div class="empty-icon">🚩</div>
        <p>${hasDrills ? 'No chart selected.' : 'No chart loaded yet.'}</p>
        <p style="color:var(--text-muted);max-width:300px;margin:6px auto 0">
          ${STATE.isAdmin
            ? `Upload a Pyware <strong>.3dj</strong> or <strong>.3da</strong> file to view your field chart, step through sets, label dots, and trace a performer's path.`
            : hasDrills ? `Open the library to pick the field chart to view.` : `A director hasn't added a field chart yet.`}
        </p>
        ${hasDrills
          ? `<button class="btn btn-primary" style="margin-top:14px" onclick="showDrillLibraryModal()">Open Chart Library</button>`
          : (STATE.isAdmin ? `<button class="btn btn-primary" style="margin-top:14px" onclick="drillAddFile()">Load Chart File</button>` : '')}
      </div>`;
  }
  return `<div id="drill-view-root" class="drill-view">${_drillViewInner()}</div>`;
}

// Roster numbers with no spot in the active show's map, sorted by name — the
// students the director still needs to place. Based on explicit assignments
// (the show/drill mapping), not the block-spot auto-match.
function _drillUnassignedNums() {
  const assigned = new Set();
  const m = _activeDrillMapping();
  Object.values(m).forEach(v => drillSpotNums(v).forEach(n => assigned.add(String(n))));
  return Object.keys(STATE.students || {})
    .filter(n => !assigned.has(String(n)))
    .sort((a, b) => (STATE.students[a]?.name || '').localeCompare(STATE.students[b]?.name || '')
                 || String(a).localeCompare(String(b)));
}

// A compact person icon in the view bar showing how many students still need a
// spot in this show; a count badge when some are unplaced, a green tick when all
// are. Tapping opens the full list. Director-only (they do the placing).
function _drillUnassignedBarHtml() {
  if (!STATE.isAdmin || !_drillData) return '';
  const total = Object.keys(STATE.students || {}).length;
  if (!total) return '';
  const n = _drillUnassignedNums().length;
  if (!n) return `
    <button class="drill-unassigned-icon is-ok" onclick="showDrillUnassignedModal()"
            title="All ${total} students are assigned to a spot"
            aria-label="All ${total} students assigned to a spot — view">
      <span class="drill-unassigned-glyph">🧍</span><span class="drill-unassigned-tick">✓</span>
    </button>`;
  return `
    <button class="drill-unassigned-icon has-missing" onclick="showDrillUnassignedModal()"
            title="${n} student${n !== 1 ? 's' : ''} not assigned to a spot in this show"
            aria-label="${n} student${n !== 1 ? 's' : ''} not assigned to a spot — view list">
      <span class="drill-unassigned-glyph">🧍</span><span class="drill-unassigned-badge">${n}</span>
    </button>`;
}

// Refresh just the unassigned pill (after assigning/removing from the field) so
// the count stays live without rebuilding the whole Drill tab.
function _drillUnassignedRefresh() {
  const el = document.getElementById('drill-unassigned-bar');
  if (el) el.innerHTML = _drillUnassignedBarHtml();
}

// The full list of students with no spot in this show, so the director can see
// at a glance who's left to place. Informational — assigning happens by tapping
// a dot on the field.
function showDrillUnassignedModal() {
  if (!STATE.isAdmin) return;
  const nums  = _drillUnassignedNums();
  const show  = _activeShow();
  const where = show ? esc(show.name || 'this show') : 'this chart';
  const rows = nums.map(n => {
    const s     = STATE.students[n];
    const name  = s ? (s.name || `#${n}`) : `#${n}`;
    const instr = s && s.instrument ? normInstrument(s.instrument) : '';
    return `
      <div class="drill-unassigned-row">
        <span class="drill-unassigned-name" onclick="closeModal();navigate('student',{num:'${esc(n)}'})">${esc(name)}</span>
        ${instr ? `<span class="drill-unassigned-instr">${esc(instr)}</span>` : ''}
      </div>`;
  }).join('');
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Not assigned — ${where}</div>
    <p class="modal-sub" style="margin:0 0 10px">${nums.length ? `${nums.length} student${nums.length !== 1 ? 's' : ''} not yet placed at a spot in this show. Tap a dot on the field to assign one — each student holds a single spot per show.` : 'Everyone is assigned to a spot. 🎉'}</p>
    ${nums.length ? `<div class="drill-unassigned-list">${rows}</div>` : ''}
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

function _drillViewInner() {
  const idx   = _drillCurrentSet;
  const total = _drillPages.length;
  const count = Object.keys(STATE.drills || {}).length;
  const name  = STATE.drills[STATE.activeDrillId]?.name || _drillFileName || 'Chart';
  const show  = _activeShow();
  const inShow = show ? Object.values(STATE.drills || {}).filter(d => d.showId === show.id).length : 0;
  const meta  = show
    ? `${esc(show.name || 'Show')} · ${inShow} chart${inShow !== 1 ? 's' : ''} · tap to switch`
    : (count > 1 ? `${count} charts · tap to switch` : 'Tap to manage library');

  return `
    <div class="drill-switcher-row">
      <button class="drill-switcher" onclick="showDrillLibraryModal()">
        <span class="drill-switcher-ico">📚</span>
        <span class="drill-switcher-text">
          <span class="drill-switcher-name">${esc(name)}</span>
          <span class="drill-switcher-meta">${meta}</span>
        </span>
        <span class="drill-switcher-caret">▾</span>
      </button>
      <button class="drill-gear-btn${_drillControlsOpen ? ' is-open' : ''}" id="drill-gear-btn" onclick="drillToggleControls()" aria-expanded="${_drillControlsOpen}" aria-controls="drill-view-bar" title="Chart controls" aria-label="Chart controls">⚙</button>
    </div>

    <div class="drill-view-bar${_drillControlsOpen ? ' is-open' : ''}" id="drill-view-bar">
      <div id="drill-unassigned-bar" class="drill-unassigned-slot">${_drillUnassignedBarHtml()}</div>
      <button class="btn btn-sm ${_drillSearchOpen ? 'btn-primary' : 'btn-secondary'}" id="drill-search-toggle" onclick="drillToggleSearch()" title="Find a performer" aria-label="Find a performer" aria-expanded="${_drillSearchOpen}">🔍</button>
      <button class="btn btn-sm ${_drillPlaying ? 'btn-primary' : 'btn-secondary'}" onclick="drillPlayToggle()" title="Play / pause" aria-label="Play or pause animation">${_drillPlaying ? '⏸' : '▶'}</button>
      <button class="btn btn-sm btn-secondary" onclick="drillViewExpand()" title="Fullscreen" aria-label="Fullscreen">⤢</button>
      <div class="drill-search-wrap${_drillSearchOpen ? ' is-open' : ''}${_drillSearchQuery.trim() ? ' has-q' : ''}" id="drill-search-wrap">
        <input class="drill-search form-input" type="search" id="drill-search-input"
               placeholder="Find a performer or student…"
               value="${esc(_drillSearchQuery)}" autocomplete="off"
               oninput="drillViewSearch(this.value)">
        <button class="drill-search-clear" onclick="drillViewClearSearch()" aria-label="Clear">✕</button>
      </div>
    </div>

    ${_drillSelStatusHtml()}

    <div class="drill-view-strip">
      <button class="drill-nav-arrow" onclick="drillViewNav(-1)"${idx<=0?' disabled':''} aria-label="Previous set">&#8592;</button>
      <button class="drill-toc-btn${_drillTocOpen ? ' is-open' : ''}" id="drill-toc-btn" onclick="drillToggleToc()" aria-expanded="${_drillTocOpen}" aria-controls="drill-set-strip" title="Table of contents">
        <span class="drill-toc-ico">☰</span>
        <span class="drill-toc-label">Set ${idx + 1} <span class="drill-toc-of">of ${total}</span></span>
      </button>
      <button class="drill-nav-arrow" onclick="drillViewNav(1)"${idx>=total-1?' disabled':''} aria-label="Next set">&#8594;</button>
    </div>

    <div class="drill-set-strip${_drillTocOpen ? ' is-open' : ''}" id="drill-set-strip">${_drillSetStripHtml()}</div>

    <div class="drill-fs-svg-wrap drill-view-stage" id="drill-stage">${_drillStageInner()}</div>

    <div class="drill-view-foot">
      <span class="drill-foot-main" id="drill-foot-main">${esc(_drillFootText())}</span>
    </div>`;
}

// The selected-sets / playback status line (only when relevant).
function _drillSelStatusHtml() {
  if (_drillPlaying) {
    return `<div class="drill-sel-status drill-sel-status--play">
      ▶ Playing · <span id="drill-play-count">count ${_drillPlayCount}</span> of ${_drillPlayEnd}</div>`;
  }
  if (_drillSelectMode || _drillTraceSets.length) {
    const n = _drillTraceSets.length;
    return `<div class="drill-sel-status">
      ${_drillSelectMode ? 'Tap sets to include · ' : ''}${n ? `${n} set${n!==1?'s':''} selected` : 'no sets selected (uses all)'}
      ${n ? `<button class="link-btn" onclick="drillClearSets()">clear</button>` : ''}</div>`;
  }
  return '';
}

// SVG + sticky-axis overlay (+ the tapped-performer info panel) for the zoomable
// stage. Rebuilt on its own so the search box above it keeps focus while typing.
function _drillStageInner() {
  return _drillFieldSvg(_drillCurrentPositions(),
    { fs: true, labelMode: _drillLabelMode, traceLabel: _drillTraceLabel, focusLabel: _drillSelLabel,
      selectMode: false, traceIdx: _drillActiveIdx() })
    + `<div class="drill-fs-axis"></div>`
    + _drillNotePanelHtml()               // instructions overlay pinned to the field's bottom
    + (_drillPlaying ? '' : _drillInfoPanelHtml());
}

// The active set indices for tracing/playback: a selected subset (≥2), else all.
function _drillActiveIdx() {
  if (_drillTraceSets && _drillTraceSets.length >= 2) return [..._drillTraceSets].sort((a, b) => a - b);
  return _drillPages ? _drillPages.map((_, i) => i) : [];
}

// Performer positions to render right now: an interpolated frame while playing,
// otherwise the current set's formation.
function _drillCurrentPositions() {
  return _drillPlaying ? _drillFrameAt(_drillPlayCount) : _drillPages[_drillCurrentSet].performers;
}

// Linearly interpolate every performer's position at a given count, using the
// active sets as keyframes (each keyframe sits at its real count).
function _drillFrameAt(count) {
  const pages = _drillActiveIdx().map(i => _drillPages[i]);
  if (!pages.length) return [];
  let seg = 0;
  while (seg < pages.length - 1 && pages[seg + 1].count <= count) seg++;
  const a = pages[seg], b = pages[Math.min(seg + 1, pages.length - 1)];
  const span = b.count - a.count;
  const t = span > 0 ? Math.max(0, Math.min(1, (count - a.count) / span)) : (count >= b.count ? 1 : 0);
  const bMap = {}; b.performers.forEach(p => { bMap[p.label] = p; });
  return a.performers.map(pa => {
    const pb = bMap[pa.label] || pa;
    return {
      label: pa.label, section: pa.section,
      stepsX: pa.stepsX + (pb.stepsX - pa.stepsX) * t,
      stepsY: pa.stepsY + (pb.stepsY - pa.stepsY) * t,
    };
  });
}

// Compact info panel docked to the top of the chart (so it doesn't cover the
// tapped dot the way a bottom-sheet did). Empty when nothing is selected.
function _drillInfoPanelHtml() {
  const label = _drillSelLabel;
  if (!label || !_drillPages) return '';
  const p = _drillPages[_drillCurrentSet].performers.find(x => x.label === label);
  if (!p) return '';
  const nums = drillStudentNumsByLabel(label);           // 0, 1, or more (shared)
  const co   = _drillCoord(p.stepsX, p.stepsY);
  const meta = `Section ${esc(p.section)}` + (nums.length ? '' : ' · <em>not mapped</em>');
  const reh  = (typeof getActiveRehearsal === 'function') ? getActiveRehearsal() : null;
  const rehName = reh ? (reh.label || (typeof fmtDate === 'function' ? fmtDate(reh.date) : '') || 'rehearsal') : '';

  // Assigning is a one-time setup, marking is frequent — so the assign/remove
  // controls stay tucked behind the ⋯ (edit) toggle, and the default view is
  // just names + quick marks. (Admins only; edit is a no-op otherwise.)
  const editing = STATE.isAdmin && _drillInfoEdit;

  // One row per assigned student: name, quick marks (if a rehearsal is open),
  // plus a remove ✕ while editing. Shared spots list everyone here.
  const studentRows = nums.map(num => {
    const st = STATE.students[num];
    const name = st ? (st.name || `#${num}`) : `#${num}`;
    let marks = '';
    if (reh) {
      const ent = (STATE.entries[reh.id] || {})[num] || {};
      const pos = ent.positives || 0, mis = ent.mistakes || 0;
      marks = `
        <button class="btn drill-mark-btn drill-mark-pos" onclick="drillQuickMark('${esc(num)}','positive')" title="Positive" aria-label="Add positive mark for ${esc(name)}">✓${pos ? ` <span class="drill-mark-ct">${pos}</span>` : ''}</button>
        <button class="btn drill-mark-btn drill-mark-neg" onclick="drillQuickMark('${esc(num)}','mistake')" title="Mistake" aria-label="Add mistake for ${esc(name)}">✗${mis ? ` <span class="drill-mark-ct">${mis}</span>` : ''}</button>`;
    }
    return `
      <div class="drill-info-stu">
        <span class="drill-info-stu-name" onclick="navigate('student',{num:'${esc(num)}'})">${esc(name)}</span>
        <span class="drill-info-stu-actions">${marks}${editing ? `<button class="drill-info-stu-x" onclick="drillSpotRemoveStudent('${esc(label)}','${esc(num)}')" title="Remove from spot" aria-label="Remove from spot">✕</button>` : ''}</span>
      </div>`;
  }).join('');

  return `
    <div class="drill-info-pop">
      <div class="drill-info-pop-top">
        ${STATE.isAdmin ? `<button class="drill-info-pop-edit${editing ? ' is-on' : ''}" onclick="drillInfoToggleEdit()" title="Edit who's on this spot" aria-label="Edit spot assignment">⋯</button>` : ''}
        <button class="drill-info-pop-x" onclick="drillCloseInfo()" aria-label="Close">✕</button>
      </div>
      <div class="drill-info-pop-name">${esc(label)}${nums.length > 1 ? ` · <span class="drill-info-shared">shared</span>` : ''}</div>
      <div class="drill-info-pop-meta">${meta}</div>
      <div class="drill-info-pop-coord">${esc(co.lr)}<br>${esc(co.fb)}</div>
      ${reh ? `<div class="drill-info-marks-label">Add to ${esc(rehName)}:</div>` : ''}
      ${studentRows}
      ${editing ? `
      <div class="drill-info-pop-assign">
        <select class="form-input drill-info-assign-sel" onchange="drillSpotAddStudent('${esc(label)}', this.value); this.value=''">
          <option value="">＋ ${nums.length ? 'Add another student…' : 'Assign a student…'}</option>
          ${Object.values(STATE.students).sort((a,b)=>(a.name||'').localeCompare(b.name||''))
            .filter(s => !nums.includes(String(s.number)))
            .map(s => `<option value="${esc(s.number)}">${esc(s.name || `#${s.number}`)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="drill-info-pop-actions">
        <button class="btn btn-sm ${_drillTraceLabel === label ? 'btn-secondary' : 'btn-primary'}" onclick="drillTracePerformer('${esc(label)}')">${_drillTraceLabel === label ? 'Tracing ✓' : 'Trace path'}</button>
        ${(STATE.isAdmin && _activeShow()) ? `<button class="btn btn-sm btn-secondary" onclick="drillSpotHistoryModal('${esc(label)}')">View spot history</button>` : ''}
      </div>
    </div>`;
}

// Director-only: everyone who has ever been assigned to this spot in the active
// show, and for how long. Opened from the tapped-dot info panel.
function drillSpotHistoryModal(label) {
  if (!STATE.isAdmin) return;
  const show = _activeShow();
  if (!show) return; // ungrouped drill — history is tracked per show
  const hist  = (STATE.spotHistory || {})[show.id];
  const spans = spotHistorySpans(hist?.events || [], show.mapping || {})
    .filter(sp => sp.label === label);
  const rows = spans.length
    ? _spotHistRowsHtml(spans, {
        badge: false,
        title: sp => {
          const st = STATE.students[sp.num];
          const name = st ? (st.name || `#${sp.num}`) : `#${sp.num}`;
          return `<span class="clickable" onclick="closeModal();navigate('student',{num:'${esc(sp.num)}'})">${esc(name)}</span>`;
        },
      })
    : `<p style="color:var(--text-muted);text-align:center;padding:14px 0">No one has been assigned to ${esc(label)} in this show yet.</p>`;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Spot ${esc(label)} — ${esc(show.name || 'Show')}</div>
    <p class="modal-sub" style="margin:0 0 10px">Who has marched this spot in this show, and for how long. Directors only.</p>
    ${rows}
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
    </div>
  `);
}

// Toggle the tapped-dot panel between marking (default) and editing who's on
// the spot (the assign/remove controls).
function drillInfoToggleEdit() {
  _drillInfoEdit = !_drillInfoEdit;
  _drillRefreshCurrent();
}

// Add a quick mark to the selected performer's student in the open rehearsal.
function drillQuickMark(num, type) {
  if (!canRecord()) return;
  const reh = getActiveRehearsal();
  if (!reh) { showToast('No open event.'); return; }
  showMarkModal(reh.id, num, type);
}

function _drillFootText() {
  const pg = _drillPages[_drillCurrentSet];
  const base = `Set ${_drillCurrentSet + 1}/${_drillPages.length} · count ${pg.count}`;
  if (_drillTraceLabel) return `${base} · tracing ${_drillTraceDisplay(_drillTraceLabel)}`;
  return `${base} · ${_drillFinePointer() ? 'click a performer for details · scroll to zoom' : 'tap a performer for details'}`;
}

// True if any set carries the drill writer's Pyware instruction text.
function _drillHasNotes() {
  return !!(_drillPages && _drillPages.some(p => p.note));
}

// The instruction panel for the current set (its Pyware text box). Hidden while
// playing, when the toggle is off, or when this set has no text. Shared by the
// Drill tab and the fullscreen viewer, so the toggle behaves the same in both.
function _drillNotePanelHtml() {
  if (!_drillShowNotes || _drillPlaying || !_drillHasNotes()) return '';
  const note = _drillPages[_drillCurrentSet]?.note;
  if (!note) return '';
  return `<div class="drill-view-note">${esc(note).replace(/\n/g, '<br>')}</div>`;
}

function drillToggleNotes() {
  _drillShowNotes = !_drillShowNotes;
  try { localStorage.setItem('drillShowNotes', _drillShowNotes ? '1' : '0'); } catch {}
  // Refresh whichever surface is showing — the fullscreen overlay or the tab.
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) _drillChartRefresh();
  else _drillViewRerender();
}

function _drillSetStripHtml() {
  return _drillPages.map((pg, i) => {
    const cls = (i === _drillCurrentSet ? ' drill-set-chip--active' : '')
              + (_drillTraceSets.includes(i) ? ' drill-set-chip--sel' : '');
    return `<button class="drill-set-chip${cls}" onclick="drillViewGoToSet(${i})">${i + 1}<span class="drill-set-chip-ct">${pg.count}</span></button>`;
  }).join('');
}

// Called by render() after the Drill tab's HTML is in the DOM: wire up
// pinch-zoom/pan on the stage (re-applying the current zoom, so data-driven
// re-renders don't reset the view).
function _drillViewSetup() {
  const stage = document.getElementById('drill-stage');
  if (!stage) return;
  _drillZoomSetup(stage);
  _drillScrollSetChipIntoView();
}

function _drillViewRerender() {
  if (_drillGestureBusy) { _drillDeferRender(_drillViewRerender); return; }
  const root = document.getElementById('drill-view-root');
  if (!root) return;
  root.innerHTML = _drillViewInner();
  _drillViewSetup();
}

// Rebuild only the stage (keeps the search box focused) and re-apply zoom.
function _drillViewRenderSvg() {
  // Never mid-gesture: replacing the SVG would hand the rest of the pinch to the
  // browser (see _drillGestureBusy), which zooms the page instead of the field.
  if (_drillGestureBusy) { _drillDeferRender(_drillViewRenderSvg); return; }
  const stage = document.getElementById('drill-stage');
  if (!stage) return;
  stage.innerHTML = _drillStageInner();
  _drillZoomWrap = stage;
  _drillApplyZoom(stage);
}

function _drillScrollSetChipIntoView() {
  const chip = document.querySelector('.drill-set-chip--active');
  if (chip) chip.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function drillViewNav(delta) {
  _drillCurrentSet = Math.max(0, Math.min(_drillPages.length - 1, _drillCurrentSet + delta));
  _drillViewRerender();
}

function drillViewGoToSet(i) {
  if (_drillSelectMode) {
    // Toggle this set in the trace/playback selection.
    const at = _drillTraceSets.indexOf(i);
    if (at >= 0) _drillTraceSets.splice(at, 1); else _drillTraceSets.push(i);
    _drillViewRerender();
    return;
  }
  _drillCurrentSet = Math.max(0, Math.min(_drillPages.length - 1, i));
  _drillViewRerender();
}

function drillClearSets() {
  _drillTraceSets = [];
  _drillViewRerender();
}

// ── Playback: animate the formation count-by-count through the active sets ─────
const _DRILL_PLAY_MS = 450; // one count per tick

function drillPlayToggle() {
  if (_drillPlaying) { _drillPlayStop(); _drillViewRerender(); return; }
  const idxs = _drillActiveIdx();
  if (idxs.length < 2) { showToast('Select at least 2 sets, or this chart needs more sets.'); return; }
  _drillSelectMode = false;
  _drillPlayStart  = _drillPages[idxs[0]].count;
  _drillPlayEnd    = _drillPages[idxs[idxs.length - 1]].count;
  _drillPlayCount  = _drillPlayStart;
  _drillPlaying    = true;
  _drillSelLabel   = null; // hide the info panel while playing
  _drillViewRerender();
  _drillPlayTimer = setInterval(_drillPlayTick, _DRILL_PLAY_MS);
}

function _drillPlayTick() {
  if (_drillPlayCount >= _drillPlayEnd) {
    const idxs = _drillActiveIdx();
    _drillCurrentSet = idxs[idxs.length - 1]; // land on the final formation
    _drillPlayStop();
    _drillViewRerender();
    return;
  }
  _drillPlayCount += 1;
  _drillViewRenderSvg(); // cheap: just the field
  const el = document.getElementById('drill-play-count');
  if (el) el.textContent = `count ${_drillPlayCount}`;
}

function _drillPlayStop() {
  _drillPlaying = false;
  if (_drillPlayTimer) clearInterval(_drillPlayTimer);
  _drillPlayTimer = null;
}

// Facing is per-drill, stored on its library metadata doc (live for everyone).
function _drillPersistFlip() {
  const id = STATE.activeDrillId;
  if (!id) return;
  if (STATE.drills[id]) STATE.drills[id].flipV = _drillFlipV;
  orgCol('drills').doc(id).set({ flipV: _drillFlipV }, { merge: true }).catch(e => console.error(e));
}

function drillViewSearch(q) {
  _drillSearchQuery = q;
  _drillTraceLabel = _drillResolveLabel(q);
  _drillViewRenderSvg();
  const wrap = document.getElementById('drill-search-wrap');
  if (wrap) wrap.classList.toggle('has-q', !!q.trim());
  const foot = document.getElementById('drill-foot-main');
  if (foot) {
    foot.textContent = (q.trim() && !_drillTraceLabel) ? `No performer matches "${q.trim()}"` : _drillFootText();
  }
}

function drillViewClearSearch() {
  _drillSearchQuery = '';
  _drillTraceLabel = null;
  _drillViewRenderSvg();
  const wrap = document.getElementById('drill-search-wrap');
  if (wrap) wrap.classList.remove('has-q');
  const input = wrap && wrap.querySelector('.drill-search');
  if (input) input.value = '';
  const foot = document.getElementById('drill-foot-main');
  if (foot) foot.textContent = _drillFootText();
}

// The search box is hidden by default; the 🔍 button reveals it (and focuses it
// so the keyboard opens). Toggle done via DOM so a tap doesn't re-render and
// slam the mobile keyboard shut. Collapsing clears any active highlight.
function drillToggleSearch() {
  _drillSearchOpen = !_drillSearchOpen;
  const wrap = document.getElementById('drill-search-wrap');
  const btn  = document.getElementById('drill-search-toggle');
  if (btn) {
    btn.classList.toggle('btn-primary', _drillSearchOpen);
    btn.classList.toggle('btn-secondary', !_drillSearchOpen);
    btn.setAttribute('aria-expanded', _drillSearchOpen ? 'true' : 'false');
  }
  if (wrap) wrap.classList.toggle('is-open', _drillSearchOpen);
  if (_drillSearchOpen) {
    const input = wrap && wrap.querySelector('.drill-search');
    if (input) input.focus();
  } else {
    drillViewClearSearch();
  }
}

// The set list (table of contents) is collapsed by default; the ☰ button reveals
// the individual drill pages so you can jump straight to one. The prev/next
// arrows stay out on the main screen either way. DOM toggle — no re-render.
function drillToggleToc() {
  _drillTocOpen = !_drillTocOpen;
  const strip = document.getElementById('drill-set-strip');
  const btn   = document.getElementById('drill-toc-btn');
  if (strip) strip.classList.toggle('is-open', _drillTocOpen);
  if (btn) {
    btn.classList.toggle('is-open', _drillTocOpen);
    btn.setAttribute('aria-expanded', _drillTocOpen ? 'true' : 'false');
  }
}

// The chart control row (search, play, fullscreen, unassigned, more) is hidden
// by default behind the ⚙ button next to the loaded chart's name. DOM toggle —
// no re-render.
function drillToggleControls() {
  _drillControlsOpen = !_drillControlsOpen;
  const bar = document.getElementById('drill-view-bar');
  const btn = document.getElementById('drill-gear-btn');
  if (bar) bar.classList.toggle('is-open', _drillControlsOpen);
  if (btn) {
    btn.classList.toggle('is-open', _drillControlsOpen);
    btn.setAttribute('aria-expanded', _drillControlsOpen ? 'true' : 'false');
  }
}

function drillViewExpand() {
  _drillChartSelect = false;
  drillChartExpand();
}

// Fullscreen content for the viewer (read-only; taps show a coordinate readout
// in the bottom bar since a modal would sit behind the fullscreen layer).
function _drillViewFsHtml() {
  const idx = _drillCurrentSet, total = _drillPages.length;
  const navLabel = `Set ${idx + 1} <span style="font-weight:400;color:var(--text-muted)">of ${total} · count ${_drillPages[idx].count}</span>`;
  const legend   = _drillLegendHtml();
  const svgField = _drillFieldSvg(_drillPages[idx].performers,
    { fs: true, labelMode: _drillLabelMode, traceLabel: _drillTraceLabel, focusLabel: _drillTraceLabel, selectMode: false, fsView: true, traceIdx: _drillActiveIdx() });

  let readout = '';
  if (_drillTraceLabel) {
    const tp = _drillPages[idx].performers.find(p => p.label === _drillTraceLabel);
    if (tp) {
      const co = _drillCoord(tp.stepsX, tp.stepsY);
      readout = `<span class="drill-fs-trace">${esc(_drillTraceDisplay(_drillTraceLabel))} — ${esc(co.lr)} · ${esc(co.fb)}</span>`;
    }
  }

  return `
    <div class="drill-fs-nav">
      <button class="btn btn-sm btn-secondary" onclick="drillChartNav(-1)"${idx<=0?' disabled':''}>&#8592;</button>
      <span class="drill-chart-setlabel">${navLabel}</span>
      <button class="btn btn-sm btn-secondary" onclick="drillChartNav(1)"${idx>=total-1?' disabled':''}>&#8594;</button>
      <button class="btn btn-sm btn-secondary" onclick="drillChartCycleLabels()" title="Toggle labels">🏷</button>
      <button class="btn btn-sm btn-secondary" onclick="drillChartFlip()" title="Flip facing">⇅</button>
      ${_drillHasNotes() ? `<button class="btn btn-sm ${_drillShowNotes ? 'btn-primary' : 'btn-secondary'}" onclick="drillToggleNotes()" title="Show set instructions">📝</button>` : ''}
      <button class="btn btn-sm btn-secondary" onclick="drillChartCollapse()" title="Exit fullscreen" style="margin-left:4px">&#x2715;</button>
    </div>
    <div class="drill-fs-svg-wrap">${svgField}<div class="drill-fs-axis"></div>${_drillNotePanelHtml()}</div>
    <div class="drill-fs-bottom">
      ${readout || (legend ? `<div class="drill-chart-legend" style="flex:1">${legend}</div>` : '<div></div>')}
    </div>`;
}

function drillFsTapPerf(label) {
  _drillTraceLabel  = label;
  _drillSearchQuery = _drillTraceDisplay(label);
  _drillChartRefresh();
}

// Tap a dot in the inline viewer: mark it with a bold on-chart callout and show
// a compact, non-covering info panel at the top of the chart.
function drillShowPerfInfo(label) {
  if (!_drillPages) return;
  if (!_drillPages[_drillCurrentSet].performers.some(x => x.label === label)) return;
  _drillSelLabel = (_drillSelLabel === label) ? null : label; // tap again to dismiss
  _drillInfoEdit = false; // each new tap opens in marking mode
  _drillViewRenderSvg();
}

function drillCloseInfo() {
  _drillSelLabel = null;
  _drillInfoEdit = false;
  _drillViewRenderSvg();
}

function drillTracePerformer(label) {
  _drillTraceLabel  = label;
  _drillSearchQuery = _drillTraceDisplay(label);
  _drillViewRerender();
}

// "A1" or "A1 · Jane" when mapped — used for the search box + hints.
function _drillTraceDisplay(label) {
  const num = drillStudentByLabel(label);
  const st  = num ? STATE.students[num] : null;
  return st && st.name ? `${label} · ${st.name}` : label;
}

// Resolve a search string to a performer label in the current set: match the
// drill label, else a mapped student's number or name.
function _drillResolveLabel(q) {
  q = (q || '').trim().toLowerCase();
  if (!q) return null;
  const perfs = _drillPages[_drillCurrentSet].performers;
  const byLabel = perfs.find(p => p.label.toLowerCase() === q)
              || perfs.find(p => p.label.toLowerCase().startsWith(q));
  if (byLabel) return byLabel.label;
  for (const p of perfs) {
    for (const num of drillStudentNumsByLabel(p.label)) {
      if (String(num) === q) return p.label;
      const st = STATE.students[num];
      if (st && (st.name || '').toLowerCase().includes(q)) return p.label;
    }
  }
  return null;
}

// Pyware-style coordinate from step offsets. Returns { lr, fb } strings.
function _drillCoord(stepsX, stepsY) {
  // Left–right: nearest 5-yard line + steps inside/outside, Side 1 (west) / 2 (east).
  const yardFromWest = stepsX / 1.6;             // 0..100 from the west endzone
  const n5 = Math.round(yardFromWest / 5) * 5;   // nearest 5-yard line
  const yardLbl = n5 <= 50 ? n5 : 100 - n5;
  const side = n5 === 50 ? '' : (n5 < 50 ? 'Side 1' : 'Side 2');
  const dSteps = Math.round(Math.abs(yardFromWest - n5) * 1.6 * 4) / 4;
  let lr;
  if (n5 === 0 || n5 === 100) {
    lr = `${dSteps ? `${dSteps} steps from ` : 'On '}the ${n5 < 50 ? 'Side 1' : 'Side 2'} goal line`;
  } else if (dSteps < 0.1) {
    lr = `On the ${yardLbl}${side ? ` (${side})` : ''}`;
  } else {
    const inside = (yardFromWest > n5) === (n5 < 50); // toward the 50
    lr = `${dSteps} steps ${inside ? 'inside' : 'outside'} the ${yardLbl}${side ? ` (${side})` : ''}`;
  }

  // Front–back: nearest of front sideline / front hash / back hash / back sideline.
  const refs = [
    { y: 0,  name: 'front sideline' }, { y: 28, name: 'front hash' },
    { y: 56, name: 'back hash' },      { y: 84, name: 'back sideline' },
  ];
  let best = refs[0];
  for (const r of refs) if (Math.abs(stepsY - r.y) < Math.abs(stepsY - best.y)) best = r;
  const dY = Math.round((stepsY - best.y) * 4) / 4;
  const fb = Math.abs(dY) < 0.1
    ? `On the ${best.name}`
    : `${Math.abs(dY)} steps ${dY > 0 ? 'behind' : 'in front of'} the ${best.name}`;
  return { lr, fb };
}

function showDrillOptionsModal() {
  if (!canRecord()) return;
  const has   = !!(_drillData && _drillPages && _drillPages.length);
  const count = Object.keys(STATE.drills || {}).length;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Field Chart Options</div>
    <div class="options-menu">
      <button class="options-menu-item" onclick="closeModal();showDrillLibraryModal()">
        <div class="options-menu-icon">📚</div>
        <div><div class="options-menu-label">Chart Library</div><div class="options-menu-sub">${count ? `${count} chart${count!==1?'s':''} · ${STATE.isAdmin ? 'switch, add or remove' : 'switch charts'}` : (STATE.isAdmin ? 'Add your first chart file' : 'No charts yet')}</div></div>
      </button>
      ${(has && STATE.isAdmin) ? `
      <button class="options-menu-item" onclick="closeModal();showDrillMappingModal()">
        <div class="options-menu-icon">🔗</div>
        <div><div class="options-menu-label">Assign Spots</div><div class="options-menu-sub">This show's spots → students · tap or CSV</div></div>
      </button>` : ''}
      ${(has && _drillPages.length > 1) ? `
      <button class="options-menu-item" onclick="drillMenuSelectSets()">
        <div class="options-menu-icon">⛶</div>
        <div><div class="options-menu-label">Choose sets to animate</div><div class="options-menu-sub">Tap sets in the strip, then press play${_drillTraceSets.length ? ` · ${_drillTraceSets.length} selected` : ''}</div></div>
      </button>` : ''}
    </div>
    ${has ? `
    <div class="drill-opt-section">
      <div class="drill-opt-label">Dot labels</div>
      <div class="drill-lblseg-group" id="drill-lblseg-group">
        ${['Off', 'Chart #', 'Names'].map((t, i) =>
          `<button class="drill-lblseg${_drillLabelMode === i ? ' drill-lblseg--on' : ''}" onclick="drillSetLabelMode(${i})">${t}</button>`
        ).join('')}
      </div>
    </div>
    <div class="drill-opt-section">
      <div class="drill-opt-label">Facing</div>
      <div class="drill-lblseg-group" id="drill-flipseg-group">
        <button class="drill-lblseg${!_drillFlipV ? ' drill-lblseg--on' : ''}" onclick="drillSetFlip(false)">Front</button>
        <button class="drill-lblseg${_drillFlipV ? ' drill-lblseg--on' : ''}" onclick="drillSetFlip(true)">Flipped</button>
      </div>
    </div>
    ${_drillHasNotes() ? `
    <div class="drill-opt-section">
      <div class="drill-opt-label">Set instructions</div>
      <div class="drill-lblseg-group" id="drill-notesseg-group">
        <button class="drill-lblseg${!_drillShowNotes ? ' drill-lblseg--on' : ''}" onclick="drillSetNotes(false)">Hide</button>
        <button class="drill-lblseg${_drillShowNotes ? ' drill-lblseg--on' : ''}" onclick="drillSetNotes(true)">Show</button>
      </div>
    </div>` : ''}
    ${_drillHasSharedSpots() ? `
    <div class="drill-opt-section">
      <div class="drill-opt-label">Shared spots (2+ students)</div>
      <div class="drill-lblseg-group" id="drill-sharedseg-group">
        <button class="drill-lblseg${!_drillHighlightShared ? ' drill-lblseg--on' : ''}" onclick="drillSetHighlightShared(false)">Off</button>
        <button class="drill-lblseg${_drillHighlightShared ? ' drill-lblseg--on' : ''}" onclick="drillSetHighlightShared(true)">Highlight</button>
      </div>
    </div>` : ''}
    <div class="drill-opt-section">
      <div class="drill-opt-label">Field color</div>
      <div class="drill-lblseg-group" id="drill-fieldseg-group">
        <button class="drill-lblseg${!_drillFieldWhite ? ' drill-lblseg--on' : ''}" onclick="drillSetFieldWhite(false)">Green</button>
        <button class="drill-lblseg${_drillFieldWhite ? ' drill-lblseg--on' : ''}" onclick="drillSetFieldWhite(true)">White</button>
      </div>
    </div>` : ''}
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

// Field fill: green vs white (independent of the app's light/dark mode). Updates
// the segmented control in place and re-renders the chart everywhere it shows.
function drillSetFieldWhite(white) {
  _drillFieldWhite = !!white;
  try { localStorage.setItem('drillFieldWhite', white ? '1' : '0'); } catch {}
  document.querySelectorAll('#drill-fieldseg-group .drill-lblseg')
    .forEach((b, i) => b.classList.toggle('drill-lblseg--on', i === (white ? 1 : 0)));
  if (_view === 'drill' && document.getElementById('drill-view-root')) _drillViewRerender();
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) _drillChartRefresh();
}

// Set the dot-label mode from the options menu: update the segmented control in
// place (no modal re-open → no extra history entry) and re-render the chart.
function drillSetLabelMode(n) {
  _drillLabelMode = n;
  document.querySelectorAll('#drill-lblseg-group .drill-lblseg')
    .forEach((b, i) => b.classList.toggle('drill-lblseg--on', i === n));
  if (_view === 'drill' && document.getElementById('drill-view-root')) _drillViewRerender();
}

// Set facing (per-drill, persisted) from the options menu: update the segmented
// control in place and re-render every surface showing the chart.
function drillSetFlip(flip) {
  flip = !!flip;
  if (_drillFlipV !== flip) { _drillFlipV = flip; _drillPersistFlip(); }
  document.querySelectorAll('#drill-flipseg-group .drill-lblseg')
    .forEach((b, i) => b.classList.toggle('drill-lblseg--on', i === (flip ? 1 : 0)));
  if (_view === 'drill' && document.getElementById('drill-view-root')) _drillViewRerender();
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) _drillChartRefresh();
}

// Toggle the set-instruction overlay from the options menu (persisted like the
// old inline 📝 button).
function drillSetNotes(show) {
  show = !!show;
  if (_drillShowNotes !== show) {
    _drillShowNotes = show;
    try { localStorage.setItem('drillShowNotes', show ? '1' : '0'); } catch {}
  }
  document.querySelectorAll('#drill-notesseg-group .drill-lblseg')
    .forEach((b, i) => b.classList.toggle('drill-lblseg--on', i === (show ? 1 : 0)));
  if (_view === 'drill' && document.getElementById('drill-view-root')) _drillViewRerender();
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) _drillChartRefresh();
}

// Toggle the ring + count badge on spots shared by 2+ students, from the options
// menu (persisted). Updates the segmented control in place and re-renders.
function drillSetHighlightShared(on) {
  on = !!on;
  if (_drillHighlightShared !== on) {
    _drillHighlightShared = on;
    try { localStorage.setItem('drillHighlightShared', on ? '1' : '0'); } catch {}
  }
  document.querySelectorAll('#drill-sharedseg-group .drill-lblseg')
    .forEach((b, i) => b.classList.toggle('drill-lblseg--on', i === (on ? 1 : 0)));
  if (_view === 'drill' && document.getElementById('drill-view-root')) _drillViewRerender();
  const fs = document.getElementById('drill-chart-fs');
  if (fs && !fs.classList.contains('hidden')) _drillChartRefresh();
}

// From the options menu: enter set-selection mode and return to the chart so the
// director can tap sets in the strip to build an animation range, then press play.
function drillMenuSelectSets() {
  closeModal();
  if (_drillPlaying) _drillPlayStop();
  _drillSelectMode = true;
  _drillViewRerender();
}

// ── Drill library (multiple stored drills) ────────────────────────────────────

function _drillSortedIds() {
  return Object.keys(STATE.drills || {}).sort((a, b) => {
    const ta = STATE.drills[a].createdAt?.seconds || 0;
    const tb = STATE.drills[b].createdAt?.seconds || 0;
    if (tb !== ta) return tb - ta; // newest first
    return (STATE.drills[a].name || '').localeCompare(STATE.drills[b].name || '');
  });
}

// One drill row in the library list.
function _drillLibRowHtml(id) {
  const d = STATE.drills[id];
  const active = id === STATE.activeDrillId;
  const sets = d.setCount || 0;
  const sub  = `${sets} set${sets !== 1 ? 's' : ''}${d.performerCount ? ` · ${d.performerCount} performers` : ''}`;
  return `
    <div class="drill-lib-row${active ? ' drill-lib-row--active' : ''}">
      <button class="drill-lib-main" onclick="drillActivate('${esc(id)}')">
        <div class="drill-lib-name">${esc(d.name || d.fileName || 'Drill')}${active ? '<span class="drill-lib-badge">active</span>' : ''}</div>
        <div class="drill-lib-sub">${esc(sub)}</div>
      </button>
      ${STATE.isAdmin ? `
      <button class="drill-lib-act" onclick="drillReplaceFilePrompt('${esc(id)}')" title="Replace file (re-upload)" aria-label="Replace file">⟳</button>
      <button class="drill-lib-act" onclick="drillMoveToShowPrompt('${esc(id)}')" title="Move to another show" aria-label="Move to another show">⇄</button>
      <button class="drill-lib-act" onclick="drillRenamePrompt('${esc(id)}')" title="Rename" aria-label="Rename">✎</button>
      <button class="drill-lib-act drill-lib-act--danger" onclick="drillDeletePrompt('${esc(id)}')" title="Delete" aria-label="Delete">🗑</button>` : ''}
    </div>`;
}

function showDrillLibraryModal() {
  if (!canRecord()) return;
  const ids = _drillSortedIds();
  // Group drills by show. `ids` is newest-first, so first-seen order puts the
  // most recently used show on top; each group lists its drills newest-first.
  const groups = new Map(); // showId ('' = ungrouped) → [drillId]
  ids.forEach(id => {
    const sid = STATE.drills[id].showId || '';
    if (!groups.has(sid)) groups.set(sid, []);
    groups.get(sid).push(id);
  });
  // Shows with no drills left (deleted drills, old migrations) would otherwise
  // be invisible everywhere yet still exist — list them so a director can see
  // and delete the leftover instead of it haunting show pickers.
  Object.keys(STATE.shows || {}).forEach(sid => { if (!groups.has(sid)) groups.set(sid, []); });

  const groupsHtml = [...groups.entries()].map(([sid, gids]) => {
    const show     = sid && STATE.shows[sid];
    const showName = show ? (show.name || 'Show') : 'Ungrouped';
    const head = `
      <div class="drill-lib-group-head">
        <span class="drill-lib-group-name">📁 ${esc(showName)}</span>
        ${(show && STATE.isAdmin) ? `<button class="drill-lib-act" onclick="drillShowRenamePrompt('${esc(sid)}')" title="Rename show" aria-label="Rename show">✎</button>` : ''}
        ${(show && STATE.isAdmin && !gids.length) ? `<button class="drill-lib-act drill-lib-act--danger" onclick="drillShowDeletePrompt('${esc(sid)}')" title="Delete show" aria-label="Delete show">🗑</button>` : ''}
      </div>`;
    const body = gids.length
      ? gids.map(_drillLibRowHtml).join('')
      : `<p class="drill-lib-empty">No chart files in this show — it only lingers in show pickers. Delete it if it’s a leftover.</p>`;
    return `<div class="drill-lib-group">${head}<div class="drill-lib-list">${body}</div></div>`;
  }).join('');

  openModal(`
    <div id="drill-library-modal">
      <div class="modal-handle"></div>
      <div class="modal-title">Chart Library</div>
      <p class="modal-sub" style="margin:0 0 10px">Charts are grouped by <strong>show</strong> — all charts in a show share one set of spot assignments. Tap a chart to make it the active field chart for everyone.</p>
      ${groups.size ? groupsHtml : `<p style="color:var(--text-muted);text-align:center;padding:20px 0">No charts saved yet.</p>`}
      ${STATE.isAdmin ? `<button class="btn btn-secondary btn-full" style="margin-top:12px" onclick="drillAddFile()">＋ Add chart file</button>` : ''}
      <div class="modal-actions" style="margin-top:8px">
        <button class="btn btn-secondary btn-full" onclick="closeModal()">Done</button>
      </div>
    </div>
  `);
}

// Rename a show (its shared-map group). Director-only.
function drillShowRenamePrompt(showId) {
  const s = STATE.shows[showId];
  if (!s || !STATE.isAdmin) return;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Rename Show</div>
    <input class="form-input" id="drill-show-rename-input" type="text" maxlength="80"
           value="${esc(s.name || '')}" placeholder="Show name" autocomplete="off">
    <div class="modal-actions" style="margin-top:14px">
      <button class="btn btn-secondary" onclick="showDrillLibraryModal()">Cancel</button>
      <button class="btn btn-primary" onclick="drillShowRenameSave('${esc(showId)}')">Save</button>
    </div>
  `);
  setTimeout(() => { const el = document.getElementById('drill-show-rename-input'); if (el) { el.focus(); el.select(); } }, 50);
}

function drillShowRenameSave(showId) {
  const el = document.getElementById('drill-show-rename-input');
  const name = (el?.value || '').trim();
  if (!name) { showToast('Enter a name.'); return; }
  if (STATE.shows[showId]) STATE.shows[showId].name = name;
  orgCol('shows').doc(showId).set({ name }, { merge: true }).catch(e => console.error(e));
  showDrillLibraryModal();
  if (_view === 'drill' && _activeShow()?.id === showId) { const r = document.getElementById('drill-view-root'); if (r) _drillViewRerender(); }
}

// Delete a show that has no drills left (leftovers from deleted drills or old
// migrations). Only offered for empty shows — deleting a show with drills goes
// through deleting/moving its drills, which already cleans the show up
// (_cleanupEmptyShow). Its spot-history doc is kept: the history outlives the
// production. Director-only.
function drillShowDeletePrompt(showId) {
  const s = STATE.shows[showId];
  if (!s || !STATE.isAdmin) return;
  if (Object.values(STATE.drills || {}).some(d => d.showId === showId)) return; // safety: empty shows only
  showConfirmModal(
    'Delete show?',
    `Remove “${esc(s.name || 'this show')}” and its spot assignments? It has no chart files, so it only appears in show pickers. This can’t be undone.`,
    () => drillShowDelete(showId),
    'Delete', 'btn-danger'
  );
}

function drillShowDelete(showId) {
  delete STATE.shows[showId]; // optimistic; the shows listener will confirm
  orgCol('shows').doc(showId).delete().catch(e => _toastSaveError(e, 'Deleting the show'));
  showDrillLibraryModal();
}

// Move a drill into a different show (or a new one): it takes on that show's
// spot assignments. Director-only.
function drillMoveToShowPrompt(id) {
  const d = STATE.drills[id];
  if (!d || !STATE.isAdmin) return;
  const base = d.name || d.fileName || 'Show';
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Move “${esc(base)}” to a show</div>
    <p class="modal-sub" style="margin:0 0 12px">Pick the show this chart belongs to — it takes on that show's spot assignments. Or start a new show.</p>
    <div class="drill-show-choices">${_showChooserHtml(d.showId || 'new', base)}</div>
    <div class="modal-actions" style="margin-top:14px">
      <button class="btn btn-secondary" onclick="showDrillLibraryModal()">Cancel</button>
      <button class="btn btn-primary" onclick="drillMoveToShowCommit('${esc(id)}')">Move</button>
    </div>
  `);
}

function drillMoveToShowCommit(id) {
  const d = STATE.drills[id];
  if (!d) return;
  const base   = d.name || d.fileName || 'Show';
  const showId = _resolveChosenShowId(base);
  if (!showId || showId === d.showId) { showDrillLibraryModal(); return; }
  const oldShowId = d.showId;
  d.showId = showId; // optimistic
  orgCol('drills').doc(id).set({ showId }, { merge: true })
    .then(() => _cleanupEmptyShow(oldShowId))
    .catch(e => _toastSaveError(e, 'Moving the chart'));
  showDrillLibraryModal();
  if (_view === 'drill' && id === STATE.activeDrillId) render();
}

// Delete a show doc once its last drill has left it, so empty groups don't linger.
function _cleanupEmptyShow(showId) {
  if (!showId || !STATE.shows[showId]) return;
  if (Object.values(STATE.drills || {}).some(d => d.showId === showId)) return; // still in use
  delete STATE.shows[showId];
  orgCol('shows').doc(showId).delete().catch(() => {});
}

function drillActivate(id) {
  if (!STATE.drills[id] || id === STATE.activeDrillId) { closeModal(); if (_view !== 'drill') navigate('drill'); return; }
  STATE.activeDrillId = id;
  orgCol('settings').doc('drill').set({ activeId: id }, { merge: true }).catch(e => console.error(e));
  _drillSyncActive(); // loads the new payload, then re-renders
  closeModal();
  if (_view !== 'drill') navigate('drill'); else render();
}

function drillRenamePrompt(id) {
  const d = STATE.drills[id];
  if (!d) return;
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title">Rename Chart</div>
    <input class="form-input" id="drill-rename-input" type="text" maxlength="80"
           value="${esc(d.name || d.fileName || '')}" placeholder="Chart name" autocomplete="off">
    <div class="modal-actions" style="margin-top:14px">
      <button class="btn btn-secondary" onclick="showDrillLibraryModal()">Cancel</button>
      <button class="btn btn-primary" onclick="drillRenameSave('${esc(id)}')">Save</button>
    </div>
  `);
  setTimeout(() => { const el = document.getElementById('drill-rename-input'); if (el) { el.focus(); el.select(); } }, 50);
}

function drillRenameSave(id) {
  const el = document.getElementById('drill-rename-input');
  const name = (el?.value || '').trim();
  if (!name) { showToast('Enter a name.'); return; }
  if (STATE.drills[id]) STATE.drills[id].name = name;
  if (id === STATE.activeDrillId) _drillFileName = name;
  orgCol('drills').doc(id).set({ name }, { merge: true }).catch(e => console.error(e));
  showDrillLibraryModal();
  if (_view === 'drill') { const r = document.getElementById('drill-view-root'); if (r) _drillViewRerender(); }
}

function drillDeletePrompt(id) {
  const d = STATE.drills[id];
  if (!d) return;
  showConfirmModal(
    'Delete chart?',
    `Remove “${esc(d.name || d.fileName || 'this chart')}” from the library? This can’t be undone. Its show's spot assignments stay for the show's other charts.`,
    () => drillDelete(id),
    'Delete', 'btn-danger'
  );
}

function drillDelete(id) {
  const wasActive = STATE.activeDrillId === id;
  const showId    = STATE.drills[id]?.showId;
  orgCol('drills').doc(id).collection('data').doc('main').delete().catch(() => {});
  orgCol('drills').doc(id).delete().catch(() => {});
  delete STATE.drills[id];
  _cleanupEmptyShow(showId); // drop the show if that was its last drill
  if (wasActive) {
    const next = _drillSortedIds()[0] || null;
    STATE.activeDrillId = next;
    orgCol('settings').doc('drill').set(
      { activeId: next || firebase.firestore.FieldValue.delete() }, { merge: true }
    ).catch(() => {});
    _drillSyncActive();
  }
  showDrillLibraryModal();
  if (_view === 'drill') render();
}
