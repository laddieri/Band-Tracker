// Band Tracker — js/03-router.js — Router, filter state/engine/bar, debounce, utilities, feature flags.
// Plain script sharing global scope; load order is set in index.html.

// ── Router ────────────────────────────────────────────────────────────────────

let _view   = 'rehearsals';
let _params = {};
let _authMode = 'signin'; // 'signin' | 'signup' — which director auth screen to show
let _pendingVerification = false; // true after signup until email is verified
let _studentStep = null;  // null | 'code' | 'choose' | 'setpin' | 'pin' — student sign-in wizard
let _studentCode = '';    // the code entered in the student wizard

// Stamp the initial history entry so popstate always has a valid state.
history.replaceState({ view: _view, params: _params }, '');

// Set just before we call history.back() ourselves to unwind an orphaned modal
// sentinel (see _unwindModalSentinels) so the resulting popstate is treated as
// bookkeeping, not a user Back press.
let _suppressModalPop = false;

// OS back gesture / hardware back button.
window.addEventListener('popstate', e => {
  // If a modal is open, this back press should close it — not navigate.
  const overlay = document.getElementById('modal-overlay');
  if (overlay && !overlay.classList.contains('hidden')) {
    overlay.classList.add('hidden');
    // Back closed the modal and the browser already popped its sentinel. If more
    // sentinels remain beneath (nested modals), unwind them too so the next Back
    // returns to the real previous view.
    if (history.state?.modal) _unwindModalSentinels();
    return;
  }
  // A history.back() we issued to drop an orphaned sentinel (closeModal cleanup):
  // don't re-navigate, but keep unwinding if more sentinels are stacked.
  if (_suppressModalPop) {
    _suppressModalPop = false;
    if (history.state?.modal) _unwindModalSentinels();
    return;
  }
  // Sentinel-only entry (modal was closed before back fired) — skip it.
  if (e.state?.modal) return;
  const { view = 'rehearsals', params = {} } = e.state || {};
  navigate(view, params, true); // true = don't push another entry
});

// Pop any modal history sentinel(s) sitting on top of the stack. openModal
// pushes one per open; closing without navigating (the ✕/Close button, the
// backdrop, Escape) leaves it orphaned as the current entry, so the next Back
// press is spent stepping off it instead of returning to the previous view —
// the "Back does nothing / needs a second tap" bug. Popping it restores the
// stack to exactly what it was before the modal opened.
function _unwindModalSentinels() {
  // Only when the overlay is actually closed. A sentinel that's current while
  // the overlay is still open belongs to a live modal (e.g. a
  // `closeModal(); showOtherModal()` chain that reopened one) — leave it.
  const overlay = document.getElementById('modal-overlay');
  const open    = overlay && !overlay.classList.contains('hidden');
  if (!open && history.state?.modal) {
    _suppressModalPop = true;
    history.back();
  }
}

function navigate(view, params = {}, _fromHistory = false) {
  if (_view === 'rehearsal' && view !== 'rehearsal') {
    _activeNum = null; _trackerFilter = _mkFilter('name', 'asc'); _drillSelectedNums = [];
  }
  if (_view === 'song' && view !== 'song') {
    _songFilter           = _mkFilter('name', 'asc');
    _songStatusFilter     = null;
    _songGroupMode        = false;
    _songGroup            = new Set();
  }
  if (_view === 'task' && view !== 'task') {
    _taskFilter       = _mkFilter('name', 'asc');
    _taskStatusFilter = null;
  }
  if (_view === 'leaderboard' && view !== 'leaderboard') {
    _lbFilter = _mkFilter('score', 'desc');
  }
  if (_view === 'dashboard' && view !== 'dashboard') {
    _activeNum = null; _trackerFilter = _mkFilter('name', 'asc'); _drillSelectedNums = [];
    _dashRid = null;
  }
  if (_view === 'attendance' && view !== 'attendance') {
    _attModifyMode       = false;
    _attPresentCollapsed = true;
    _attAbsentCollapsed  = true;
    _attSummaryStatus    = '';
    _attFilter           = _mkFilter('name', 'asc');
  }
  if (_view === 'roster' && view !== 'roster') {
    _rosterFilter = _mkFilter('name', 'asc');
  }
  if (_view === 'attendance-tab' && view !== 'attendance-tab') {
    _attTabFilter       = _mkFilter('absences', 'desc');
    _attTabRecentStatus = '';
  }
  if (view === 'drill' && _view !== 'drill') _drillZoomReset(); // start the chart at fit
  if (_view === 'drill' && view !== 'drill' && typeof _drillPlayStop === 'function') _drillPlayStop();
  _view   = view;
  _params = params;
  if (!_fromHistory) {
    // If the current history entry is a modal sentinel, replace it so pressing
    // back skips cleanly to the view before the modal rather than landing on an
    // orphaned sentinel with no view state.
    if (history.state?.modal) history.replaceState({ view, params }, '');
    else                      history.pushState   ({ view, params }, '');
  }
  render();
  document.getElementById('main-content').scrollTop = 0;
}

// ── Rehearsal state ───────────────────────────────────────────────────────────

let _activeNum  = null;
let _songStatusFilter        = null;      // song page: 'passed' | 'failed' | 'not_attempted' | null (all)
let _taskStatusFilter        = null;      // task page: 'done' | 'not_done' | null (all)
let _songGroupMode           = false;     // song page: building a group pass-off list
let _songGroup               = new Set(); // student numbers (strings) in the group list
let _songCatCollapsed        = new Set(); // category names that are currently collapsed
let _dashRid        = null; // null = all rehearsals
let _activeRid      = null; // which open rehearsal is currently being marked
let _attModifyMode           = false; // true = show edit UI even when attendance is submitted
let _attPresentCollapsed     = true;  // collapsed state of the "marked present" section
let _attAbsentCollapsed      = true;  // collapsed state of the "marked absent" section
let _attSummaryStatus        = '';    // quick-filter on submitted summary: ''|'absent'|'late'|'present'
let _blockAttIdx    = 0;     // column index in the "take attendance by block" flow
let _blockAttReview = false; // true = showing the block-attendance review/submit screen
let _blockAttShowId = null;  // null = group by roster column; a showId = group by that show's field spots
let _drillData       = null; // parsed Pyware sections: [{letter, performers:[label]}]
let _drillPages      = null; // distinct formation frames: [{label,section,num,stepsX,stepsY}][]
let _drillCurrentSet = 0;    // currently viewed frame index in chart modal
let _drillFlipV      = false; // chart vertical flip (Pyware "facing" orientation)
let _drillFileName   = null; // original filename of the stored .3dj
let _drillZoomScale  = 1.0;  // current pinch-zoom scale for the fullscreen chart
let _drillDotLabelsOn = false; // true once zoomed in far enough to print spot labels inside the dots
let _drillLabelMode   = 0;    // dot labels: 0 = none, 1 = drill labels, 2 = student names
let _drillTraceLabel  = null; // performer label currently traced/highlighted in the viewer
let _drillSelLabel    = null; // performer tapped for the info panel (gets a bold callout)
let _drillInfoEdit    = false; // info panel: false = marking (default), true = edit who's on the spot
let _drillFieldWhite  = (typeof localStorage !== 'undefined' && localStorage.getItem('drillFieldWhite') === '1'); // field fill: white vs green
let _drillShowNotes   = (typeof localStorage === 'undefined' || localStorage.getItem('drillShowNotes') !== '0'); // show a set's Pyware instruction text (default on)
let _drillHighlightShared = (typeof localStorage === 'undefined' || localStorage.getItem('drillHighlightShared') !== '0'); // ring + count badge on spots shared by 2+ students (default on)
let _drillSearchQuery = '';   // text in the Drill-tab performer search box
let _drillSearchOpen  = false; // Drill-tab search box revealed (tap 🔍 to open)
let _drillTocOpen     = false; // Drill-tab set list (table of contents) revealed
let _drillControlsOpen = false; // Drill-tab control row (⚙ next to the chart name)
let _drillSelectMode  = false; // strip taps select sets (for trace/playback) vs navigate
let _drillTraceSets   = [];    // selected page indices to trace/animate through (<2 = all)
let _drillPlaying     = false; // animation running
let _drillPlayCount   = 0;     // current animation count
let _drillPlayTimer   = null;  // setInterval handle
let _drillPlayStart   = 0;
let _drillPlayEnd     = 0;
let _drillChartSelect = false; // fullscreen chart context: true = select performers, false = view
let _drillSelectedNums = []; // student numbers selected via drill
let _pendingSegment    = ''; // currently selected rehearsal segment in mark modal
let _pendingMarkAllFilter = null; // { instruments:[], grades:[] } snapshot for multi-select mark-all
let _pendingLogoData   = null; // null=no change, ''=clear, dataURL=new logo
let _pendingBandColor  = null; // null=no change, ''=default, hex=new band color
const _BRAND_DEFAULT_COLOR = '#2563eb'; // app default --primary
let _pendingConfirm    = null; // callback for generic confirmation modal
let _pendingSongFail   = null; // { sid, num, note } held while showing the portal-warning confirmation
let _sspContext        = null; // student number whose song-summary modal is being edited (re-open it after a change)

// ── Unified filter state ──────────────────────────────────────────────────────

function _mkFilter(sortField, sortDir) {
  // draft holds the staged instrument/section/grade selections while the filter
  // panel is open; nothing filters the list until "Apply filter" copies it into
  // the arrays above. null when the panel is closed. See applyFilter/cancelFilter.
  // `sorts` holds optional layered tie-breakers ([{field,dir}, …]) applied
  // after the primary sortField, surfaced by views that pass { multiSort:true }
  // to renderFilterBar. Empty by default → single-sort behavior.
  return { search: '', sortField, sortDir, sorts: [], instruments: [], sections: [], grades: [], panelOpen: false, draft: null };
}
let _rosterFilter  = _mkFilter('name',     'asc');
let _trackerFilter = _mkFilter('name',     'asc');
let _attFilter     = _mkFilter('name',     'asc');
let _attTabFilter       = _mkFilter('absences', 'desc');
let _attTabRecentStatus = ''; // quick-filter on Most Recent chips: ''|'absent'|'late'|'present'
let _rhViewMode = (typeof localStorage !== 'undefined' && localStorage.getItem('rhViewMode')) || 'list'; // 'list' | 'calendar'
let _rhTypeFilter = (typeof localStorage !== 'undefined' && localStorage.getItem('rhTypeFilter')) || 'all'; // 'all' | 'rehearsal' | 'performance'
let _rhCalMonth = ''; // 'YYYY-MM' shown in the rehearsals calendar (set to current month on first open)
let _lbFilter      = _mkFilter('score',    'desc');
let _songFilter       = _mkFilter('name',     'asc');
let _songRosterFilter = _mkFilter('passed',   'desc');
let _taskFilter       = _mkFilter('name',     'asc');

// ── Debounce store for note fields ────────────────────────────────────────────

const _debounce = {};

function debounced(key, fn, ms = 800) {
  clearTimeout(_debounce[key]);
  _debounce[key] = setTimeout(fn, ms);
}

// ── Filter bar renderer ───────────────────────────────────────────────────────
// (filterAndSortStudents — the engine behind every list view — lives in
// js/00-logic.js so it's unit-testable.)

function renderFilterBar(viewId, f, sortOptions, { hideSearch = false, extra = '', multiSort = false } = {}) {
  const activeCount = f.instruments.length + f.sections.length + f.grades.length;
  const instruments = instrumentsInRoster();
  const sections    = sectionsInRoster();
  const grades      = gradesInRoster();

  const panel = f.panelOpen ? (() => {
    // Selections are staged in the draft; the list doesn't change until Apply.
    // Fall back to the applied arrays if a draft wasn't initialized (defensive).
    const draft = f.draft || { instruments: f.instruments, sections: f.sections, grades: f.grades };
    const draftCount = draft.instruments.length + draft.sections.length + draft.grades.length;
    const checkGroup = (title, items, selected, field) => !items.length ? '' : `
      <div class="sfb-group">
        <div class="sfb-group-label">${title}</div>
        <div class="sfb-checks">
          ${items.map(item => `
            <label class="sfb-check-label">
              <input type="checkbox" class="sfb-checkbox" ${selected.includes(item)?'checked':''}
                     onchange="toggleFilterItem('${viewId}','${esc(field)}','${esc(item)}',this.checked)">
              <span>${esc(item)}</span>
            </label>`).join('')}
        </div>
      </div>`;
    const groups = [
      checkGroup('Instrument', instruments, draft.instruments, 'instruments'),
      checkGroup('Grade',      grades,      draft.grades,      'grades'),
      checkGroup('Section',    sections,    draft.sections,    'sections'),
    ].join('');
    return `<div class="sfb-panel">
      ${groups || '<p class="sfb-empty-msg">No filter options yet — add instrument, section, or grade to students to enable filters.</p>'}
      ${groups ? `
      <div class="sfb-panel-actions">
        ${activeCount ? `<button class="sfb-clear-btn" onclick="clearFilter('${viewId}')">Clear all filters</button>` : '<span></span>'}
        <div class="sfb-panel-btns">
          <button class="btn btn-secondary btn-sm" onclick="cancelFilter('${viewId}')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="applyFilter('${viewId}')" ${draftCount ? '' : 'disabled'}>
            Apply filter${draftCount ? ` (${draftCount})` : ''}
          </button>
        </div>
      </div>` : ''}
    </div>`;
  })() : '';

  return `
    <div class="sfb-wrap">
      ${hideSearch ? '' : `<div class="search-wrap" style="margin-bottom:8px">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input class="search-input" type="search" id="sfb-search-${esc(viewId)}"
               placeholder="Search by name or number…"
               aria-label="Search students" value="${esc(f.search)}"
               oninput="updateFilter('${viewId}','search',this.value)" autocomplete="off">
      </div>`}
      <div class="sfb-row">
        <div class="sfb-sort-wrap">
          <select class="sfb-sort-select" aria-label="Sort by" onchange="updateFilter('${viewId}','sortField',this.value)">
            ${sortOptions.map(o => `<option value="${esc(o.value)}" ${f.sortField===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}
          </select>
          <button class="sfb-dir-btn" onclick="updateFilter('${viewId}','sortDir','${f.sortDir==='asc'?'desc':'asc'}')" title="Reverse sort" aria-label="Reverse sort order">
            ${f.sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
        <button class="sfb-filter-btn ${activeCount?'sfb-filter-active':''}"
                onclick="updateFilter('${viewId}','panelOpen',${!f.panelOpen})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
          Filters${activeCount ? ` (${activeCount})` : ''}
        </button>
        ${extra}
      </div>
      ${multiSort ? _renderSortLayers(viewId, f, sortOptions) : ''}
      ${panel}
    </div>`;
}

// The layered-sort controls under the primary sort row: one "then by" row per
// entry in f.sorts (field select + direction toggle + remove), and an
// "+ Add sort level" button while unused sortable fields remain. Each row's
// field select omits fields already used by the primary and preceding layers,
// so you can't stack the same field twice.
function _renderSortLayers(viewId, f, sortOptions) {
  const layers = f.sorts || [];
  const rows = layers.map((layer, idx) => {
    const usedBefore = new Set([f.sortField, ...layers.slice(0, idx).map(l => l.field)]);
    // Keep this layer's own field selectable even though it's "used".
    const opts = sortOptions.filter(o => o.value === layer.field || !usedBefore.has(o.value));
    return `
      <div class="sfb-row sfb-row-secondary">
        <span class="sfb-then-label">then by</span>
        <div class="sfb-sort-wrap">
          <select class="sfb-sort-select" aria-label="Then sort by"
                  onchange="updateSortLayer('${viewId}',${idx},'field',this.value)">
            ${opts.map(o => `<option value="${esc(o.value)}" ${layer.field===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}
          </select>
          <button class="sfb-dir-btn"
                  onclick="updateSortLayer('${viewId}',${idx},'dir','${layer.dir==='asc'?'desc':'asc'}')"
                  title="Reverse this sort" aria-label="Reverse this sort order">
            ${layer.dir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
        <button class="sfb-sort-remove" onclick="removeSortLayer('${viewId}',${idx})"
                title="Remove this sort level" aria-label="Remove this sort level">×</button>
      </div>`;
  }).join('');
  const used = new Set([f.sortField, ...layers.map(l => l.field)]);
  const canAdd = sortOptions.some(o => !used.has(o.value));
  const addBtn = canAdd
    ? `<button class="sfb-add-sort" onclick="addSortLayer('${viewId}')">+ Add sort level</button>`
    : '';
  return rows + addBtn;
}

// ── Filter event handlers ─────────────────────────────────────────────────────

function _getFilterObj(viewId) {
  return { roster: _rosterFilter, tracker: _trackerFilter, att: _attFilter, 'att-tab': _attTabFilter, lb: _lbFilter, song: _songFilter, 'song-roster': _songRosterFilter, task: _taskFilter }[viewId];
}

// Re-renders replace the whole view, so anything the user was typing in loses
// focus — and on mobile that closes the keyboard mid-word. Remember the focused
// field (by id) and its caret, then put both back once the new HTML is in.
// Prefer not re-rendering at all while typing (see _refreshFilterList); this is
// the net for the cases that must, including Firestore snapshots landing
// mid-keystroke.
//
// It only ever fires for a field the user is *actively typing in*. Anything else
// they touch — Back, a filter chip, a student row — clears the latch below, so
// the keyboard closes on a tap the way it should instead of springing back.
let _typingId = '';
let _typingAt = 0;
const _TYPING_WINDOW_MS = 2500;

document.addEventListener('input', e => {
  const el = e.target;
  if (el && el.id && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    _typingId = el.id;
    _typingAt = Date.now();
  }
}, true);

// A press anywhere other than the field being typed in ends "actively typing",
// so the next re-render lets the keyboard close (Back, a filter chip, a row…).
['pointerdown', 'touchstart', 'mousedown'].forEach(evt =>
  document.addEventListener(evt, e => {
    if (_typingId && e.target !== document.getElementById(_typingId)) { _typingId = ''; _typingAt = 0; }
  }, true));

function _captureFocus() {
  const el = document.activeElement;
  if (!el || !el.id || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return null;
  if (el.id !== _typingId || Date.now() - _typingAt > _TYPING_WINDOW_MS) return null;
  let start = null, end = null;
  try { start = el.selectionStart; end = el.selectionEnd; } catch {} // not all input types expose a caret
  return { id: el.id, start, end };
}

function _restoreFocus(snap) {
  if (!snap) return;
  if (snap.id !== _typingId || Date.now() - _typingAt > _TYPING_WINDOW_MS) return; // they moved on
  const main = document.getElementById('main-content');
  const el   = document.getElementById(snap.id);
  if (!el || el === document.activeElement || !main || !main.contains(el)) return;
  el.focus({ preventScroll: true });
  if (snap.start != null) { try { el.setSelectionRange(snap.start, snap.end); } catch {} }
}

// Firestore snapshots can land at any moment — including the echo of this
// client's own debounced note saves — and each one re-renders the whole view.
// If a field in the view is focused when that happens, the mobile keyboard
// slams shut as the field is destroyed, and the focus-restore net above pops
// it back open: to the user the keyboard opens and closes on its own. So
// data-driven re-renders go through renderFromData(), which parks the render
// while an editable field has focus and flushes it once focus moves on. STATE
// is current the whole time — only the DOM update waits.
//
// The same parking covers two more mid-interaction hazards (both hit hardest
// on iOS, where every local write echoes straight back through its listener
// as a full re-render moments after the tap that made it):
//   • A finger on the screen, or a just-finished tap: replacing the DOM
//     between touchstart and the browser's click dispatch retargets the tap
//     at a dead node, so the click never fires ("taps don't register" while
//     stepping through attendance by block — each tap's own write echo was
//     rebuilding the view under the next tap).
//   • An open rehearsal-card ⋯ menu: it's a .hidden class toggle, not STATE,
//     so any re-render resets it shut while the user is aiming at Delete.
let _renderDeferred = false;

// Timestamps of the last pointer press/release anywhere. A tap is "busy" from
// finger-down until shortly after finger-up — the settle window covers the
// browser's touchend → click dispatch plus the write echo that follows a tap.
let _ptrDownAt = 0, _ptrUpAt = 0;
const _PTR_SETTLE_MS   = 350;
const _PTR_HELD_MAX_MS = 10000; // self-heal if an up/cancel event was missed

const _ptrEvts = window.PointerEvent
  ? { down: ['pointerdown'], up: ['pointerup', 'pointercancel'] }
  : { down: ['touchstart', 'mousedown'], up: ['touchend', 'touchcancel', 'mouseup'] };
_ptrEvts.down.forEach(t => document.addEventListener(t, () => { _ptrDownAt = Date.now(); }, true));
_ptrEvts.up.forEach(t => document.addEventListener(t, () => { _ptrUpAt = Date.now(); _scheduleRenderFlush(); }, true));

function _pointerBusy() {
  const now = Date.now();
  if (_ptrDownAt > _ptrUpAt) return now - _ptrDownAt < _PTR_HELD_MAX_MS; // finger still down
  return now - _ptrUpAt < _PTR_SETTLE_MS;
}

// Transient DOM-only UI that a re-render would silently reset.
function _transientMenuOpen() {
  return !!document.querySelector('.rh-card-menu-list:not(.hidden)');
}

// Retry net for renders parked on taps/menus (focus-parked renders are flushed
// by the focusout listener below instead). Re-checks until the way is clear.
let _renderFlushTimer = null;
function _scheduleRenderFlush() {
  if (!_renderDeferred || _renderFlushTimer) return;
  _renderFlushTimer = setTimeout(() => {
    _renderFlushTimer = null;
    _tryFlushDeferredRender();
  }, 400);
}

function _tryFlushDeferredRender() {
  if (!_renderDeferred) return;
  if (_editableHasFocus()) return; // focusout will bring us back here
  if (_pointerBusy() || _transientMenuOpen()) { _scheduleRenderFlush(); return; }
  _renderDeferred = false;
  render();
}

function _editableHasFocus() {
  const el = document.activeElement;
  if (!el) return false;
  // SELECT counts: on mobile a focused select means its native option picker
  // is (or is about to be) open, and replacing the element dismisses it — the
  // options "flash and vanish" (e.g. the drill spot-assign dropdown).
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
  if (el.tagName !== 'INPUT') return false;
  // Only controls that raise the on-screen keyboard (or a native picker)
  // defer; checkboxes, radios and buttons don't hold a keyboard open.
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type);
}

function renderFromData() {
  if (_editableHasFocus() || _pointerBusy() || _transientMenuOpen()) {
    _renderDeferred = true;
    _scheduleRenderFlush(); // no-op net for the focus case (focusout flushes it)
    return;
  }
  render();
}

// Flush a parked render once focus settles somewhere non-editable. The small
// delay lets focus hop between fields (e.g. PIN 1 → PIN 2) without a render
// sneaking in mid-hop.
document.addEventListener('focusout', () => {
  if (!_renderDeferred) return;
  setTimeout(_tryFlushDeferredRender, 120);
}, true);

// Note: no focus restore here on purpose. This path runs when the user taps a
// sort/filter control, and re-focusing the search box would pop the keyboard
// back up over the filter panel they just opened. Typing goes through
// _refreshFilterList, which never replaces the input in the first place.
function _rerenderForFilter(viewId) {
  const mc = document.getElementById('main-content');
  const st = mc ? mc.scrollTop : 0;
  switch (viewId) {
    case 'roster':  mc.innerHTML = viewRoster(); break;
    case 'att-tab': mc.innerHTML = viewAttendanceTab(); break;
    case 'att':     mc.innerHTML = viewAttendance(_params.rid); break;
    case 'tracker': reRender(_params.rid); break;
    case 'lb':           mc.innerHTML = viewLeaderboard(); break;
    case 'song':         mc.innerHTML = viewSong(_params.sid); break;
    case 'song-roster':  mc.innerHTML = viewSongs(); break;
    case 'task':         mc.innerHTML = viewTask(_params.tid); break;
  }
  if (mc) mc.scrollTop = st;
}

// Partial update of just the results list for a view, leaving the filter bar
// (and its focused search input) untouched. Used while typing in search so the
// keyboard/focus isn't lost to a full re-render. Returns false if the view has
// no dedicated list container (caller should fall back to a full re-render).
function _refreshFilterList(viewId) {
  const lists = {
    roster:    ['roster-list',       () => { const sm = _rosterScoreMap(); return rosterRows(filterAndSortStudents(Object.values(DB.getStudents()), _rosterFilter, sm), sm); }],
    'att-tab': () => {
      const rl = document.getElementById('att-tab-recent-list');
      const sl = document.getElementById('att-tab-season-list');
      if (!rl && !sl) return false;
      const mc = document.getElementById('main-content');
      const st = mc ? mc.scrollTop : 0;
      if (rl) rl.innerHTML = _buildRecentListHtml();
      if (sl) sl.innerHTML = _buildSeasonListHtml();
      if (mc) mc.scrollTop = st;
      return true;
    },
    tracker:      ['tracker-suggestions', () => _trackerListHtml(_params.rid)],
    // The attendance screen has two shapes: the marking roster, and the
    // read-only summary once attendance is submitted.
    att: () => {
      const rid  = _params.rid;
      const list = document.getElementById('att-student-list');
      const sum  = document.getElementById('att-summary-list');
      if (!list && !sum) return false;
      const mc = document.getElementById('main-content');
      const st = mc ? mc.scrollTop : 0;
      if (list) {
        const r = STATE.rehearsals.find(x => x.id === rid);
        list.innerHTML = buildAttBodyHtml(rid, rehearsalStudents(r), STATE.entries[rid] || {});
      }
      if (sum) sum.innerHTML = _buildAttSummaryRows(rid);
      if (mc) mc.scrollTop = st;
      return true;
    },
    lb:           ['lb-rank-list',      () => _buildLbRankRows()],
    'song-roster':['song-roster-list', () => _buildSongRosterRows()],
    song:         ['song-student-list', () => {
      const song = STATE.songs.find(s => s.id === _params.sid);
      // Exclude memorization-exempt students (e.g. majorettes), same as the
      // initial viewSong render — otherwise they reappear on search/sort/filter.
      return song ? songStudentRows(_params.sid, Object.values(DB.getStudents()).filter(s => !memExcluded(s)), song.statuses || {}) : '';
    }],
    task:         ['task-student-list', () => _taskStudentRows(_params.tid)],
  };
  const entry = lists[viewId];
  if (!entry) return false;
  if (typeof entry === 'function') return entry();
  const el = document.getElementById(entry[0]);
  if (!el) return false;
  const mc = document.getElementById('main-content');
  const st = mc ? mc.scrollTop : 0;
  el.innerHTML = entry[1]();
  if (mc) mc.scrollTop = st;
  return true;
}

function updateFilter(viewId, field, value) {
  const f = _getFilterObj(viewId);
  if (!f) return;
  // Opening the panel stages a draft from the applied filters; toggling it shut
  // via the Filters button acts like Cancel (discard the draft, applied stays).
  if (field === 'panelOpen') {
    f.panelOpen = value;
    f.draft = value ? { instruments: [...f.instruments], sections: [...f.sections], grades: [...f.grades] } : null;
    _rerenderForFilter(viewId);
    return;
  }
  f[field] = value;
  // Changing the primary field can collide with a layered tie-breaker; drop the
  // duplicate so the same field never appears in two sort rows.
  if (field === 'sortField') _dedupeSortLayers(f);
  // While typing in search, update only the list so the input keeps focus
  // (a full re-render would replace the input and dismiss the keyboard).
  if (field === 'search' && _refreshFilterList(viewId)) return;
  _rerenderForFilter(viewId);
}

// ── Layered sort handlers ─────────────────────────────────────────────────────
// The sort options a view offers, needed by the add/update handlers (which,
// unlike the renderer, aren't handed the list). Only views passing
// { multiSort:true } to renderFilterBar need an entry here.
function _sortOptionsFor(viewId) {
  switch (viewId) {
    case 'roster': return rosterSortOptions();
    default:       return [];
  }
}

// Keep each sort field to a single row: drop any layer whose field repeats the
// primary or an earlier layer. Mirrors the de-duplication in sortKeys().
function _dedupeSortLayers(f) {
  const seen = new Set([f.sortField]);
  f.sorts = (f.sorts || []).filter(l => {
    if (!l.field || seen.has(l.field)) return false;
    seen.add(l.field);
    return true;
  });
}

// Add a tie-breaker layer defaulted to the first still-unused field, so the new
// row is meaningful the moment it appears (no placeholder "pick a field" state).
function addSortLayer(viewId) {
  const f = _getFilterObj(viewId);
  if (!f) return;
  const used = new Set([f.sortField, ...(f.sorts || []).map(l => l.field)]);
  const next = _sortOptionsFor(viewId).find(o => !used.has(o.value));
  if (!next) return;
  f.sorts = [...(f.sorts || []), { field: next.value, dir: 'asc' }];
  _rerenderForFilter(viewId);
}

function updateSortLayer(viewId, idx, key, value) {
  const f = _getFilterObj(viewId);
  if (!f || !f.sorts || !f.sorts[idx]) return;
  f.sorts = f.sorts.map((l, i) => i === idx ? { ...l, [key]: value } : l);
  if (key === 'field') _dedupeSortLayers(f);
  _rerenderForFilter(viewId);
}

function removeSortLayer(viewId, idx) {
  const f = _getFilterObj(viewId);
  if (!f || !f.sorts) return;
  f.sorts = f.sorts.filter((_, i) => i !== idx);
  _rerenderForFilter(viewId);
}

// Toggling a checkbox only stages the choice in the draft — the list is not
// re-filtered until applyFilter(). Re-render so the panel (Apply button state,
// count) reflects the change; the visible list stays put (applied arrays are
// untouched).
function toggleFilterItem(viewId, field, item, checked) {
  const f = _getFilterObj(viewId);
  if (!f) return;
  if (!f.draft) f.draft = { instruments: [...f.instruments], sections: [...f.sections], grades: [...f.grades] };
  if (checked) { if (!f.draft[field].includes(item)) f.draft[field].push(item); }
  else f.draft[field] = f.draft[field].filter(x => x !== item);
  _rerenderForFilter(viewId);
}

// Commit the staged draft to the applied filters and close the panel. No-op
// when nothing is selected (the Apply button is disabled in that state).
function applyFilter(viewId) {
  const f = _getFilterObj(viewId);
  if (!f || !f.draft) return;
  if (!(f.draft.instruments.length + f.draft.sections.length + f.draft.grades.length)) return;
  f.instruments = [...f.draft.instruments];
  f.sections    = [...f.draft.sections];
  f.grades      = [...f.draft.grades];
  f.panelOpen = false;
  f.draft = null;
  _rerenderForFilter(viewId);
}

// Discard the staged draft and close the panel; applied filters are unchanged.
function cancelFilter(viewId) {
  const f = _getFilterObj(viewId);
  if (!f) return;
  f.panelOpen = false;
  f.draft = null;
  _rerenderForFilter(viewId);
}

// Remove all applied filters immediately (the panel's escape hatch, since Apply
// can't commit an empty selection). Keeps the panel open with an empty draft so
// the user can pick fresh filters.
function clearFilter(viewId) {
  const f = _getFilterObj(viewId);
  if (!f) return;
  f.instruments = [];
  f.sections    = [];
  f.grades      = [];
  if (f.panelOpen) f.draft = { instruments: [], sections: [], grades: [] };
  _rerenderForFilter(viewId);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${months[m-1]} ${day}, ${y}`;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d    = new Date(ts);
  const h    = d.getHours();
  const m    = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${m}${ampm}`;
}

function fmtDateFromTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Combined date + time, e.g. "Jun 12, 2026 · 3:45pm" — used to show exactly
// when a song was passed off or failed.
function fmtDateTime(ts) {
  if (!ts) return '';
  return `${fmtDateFromTs(ts)} · ${fmtTime(ts)}`;
}

function currentWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun … 6=Sat
  const daysToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now); mon.setDate(now.getDate() + daysToMon);
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  const fmt = d =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { mon: fmt(mon), fri: fmt(fri) };
}

function fmtShort(d) {
  if (!d) return '';
  const [, m, day] = d.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m-1]} ${day}`;
}

// Display label for a mark/status author. New data stamps director uids
// (entries are student-readable, so emails must stay out of them); the uid is
// resolved through STATE.dirNames. Legacy data stamped emails directly.
function dirLabel(author) {
  if (!author) return '';
  const email = author.includes('@') ? author : STATE.dirNames[author];
  return email ? email.split('@')[0] : 'Director';
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showToast(msg) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 2700);
}

// ── Exporting data out of the app ─────────────────────────────────────────────

// Hand the user a generated CSV as a download.
function _downloadCsv(filename, text) {
  try {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { console.error('CSV download failed:', e); showToast('Could not download the file.'); }
}

// Open a self-contained HTML document in a new tab and send it to the print
// dialog — how the app "exports a PDF" without a PDF library. Returns false if
// the pop-up was blocked so the caller can stop.
function _printHtmlDocument(html) {
  const win = window.open('', '_blank');
  if (!win) { showToast('Allow pop-ups to export a PDF.'); return false; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
  return true;
}

// Surface a failed Firestore write to the user. With offline persistence,
// latency compensation makes a REJECTED write look successful in the UI (the
// listener shows the optimistic data, then it silently vanishes when the
// server rejects it) — so failures must be shouted, not just logged. Writes
// don't reject for being offline (they queue); a rejection means the server
// refused the data (rules, invalid data, doc too large), so retrying the same
// edit usually needs a fix, not a better connection. Rate-capped so a burst of
// failures (e.g. a batch) produces one toast, not a storm.
let _lastSaveErrToastAt = 0;
function _toastSaveError(e, what = 'A change') {
  console.error(`${what} failed to save:`, e);
  const now = Date.now();
  if (now - _lastSaveErrToastAt < 6000) return;
  _lastSaveErrToastAt = now;
  const code = e?.code ? ` (${e.code})` : '';
  showToast(`${what} couldn't be saved${code}. Refresh and try again.`);
}

function handleModalClick(e) {
  if (e.target === document.getElementById('modal-overlay')) dismissModal();
}

let _modalReturnFocus = null; // element to refocus when the modal closes
let _modalBackHandler = null; // when set, dismissing returns to a parent modal instead of fully closing

// Dismiss the current modal (✕ button, Escape, backdrop tap). If the modal was
// opened over a parent modal (e.g. a portal sub-list popped up over the
// director's "preview student view"), hand back to that parent instead of
// tearing the whole overlay down — otherwise dismissing a sub-list would drop
// the user all the way back to the page behind the preview.
function dismissModal() {
  const back = _modalBackHandler;
  _modalBackHandler = null;
  if (back) { back(); return; }
  closeModal();
}

function closeModal() {
  const overlay  = document.getElementById('modal-overlay');
  const wasOpen  = !overlay.classList.contains('hidden');
  overlay.classList.add('hidden');
  drillChartCollapse();
  // Send focus back where the user was before the modal took over.
  if (wasOpen && _modalReturnFocus && document.contains(_modalReturnFocus)) {
    try { _modalReturnFocus.focus(); } catch {}
  }
  _modalReturnFocus = null;
  _modalBackHandler = null;
  // Drop the history sentinel openModal pushed so a later Back press goes to the
  // previous view, not off an orphaned modal entry. Deferred a tick: a
  // `closeModal(); navigate(...)` caller replaces the sentinel synchronously in
  // navigate(), and by the time this runs there's nothing left to unwind.
  if (wasOpen) setTimeout(_unwindModalSentinels, 0);
}

function _modalFocusables() {
  const dialog = document.getElementById('modal-dialog');
  return [...dialog.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter(el => !el.disabled && el.offsetParent !== null);
}

// `backHandler`, when given, is invoked instead of closeModal() on dismiss so
// the modal returns to a parent modal (see dismissModal). Any plain openModal
// call clears it, so a fresh top-level modal never inherits a stale back path.
function openModal(html, backHandler = null) {
  _modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  _modalBackHandler = backHandler;
  document.getElementById('modal-body').innerHTML = `
    <div class="modal-top-row">
      <div class="modal-handle"></div>
      <button class="modal-close-btn" onclick="dismissModal()" aria-label="${backHandler ? 'Back' : 'Close'}">${backHandler ? '‹' : '✕'}</button>
    </div>
    ${html}`;
  document.getElementById('modal-overlay').classList.remove('hidden');
  // One sentinel per open overlay: if a modal is already the current history
  // entry — a `closeModal(); showOtherModal()` chain, or a modal swapping its
  // own body — replace it rather than stacking a second sentinel that Back would
  // then have to step through.
  if (history.state?.modal) history.replaceState({ modal: true }, '');
  else                      history.pushState   ({ modal: true }, '');
  // Focus the first control after the close button, falling back to close —
  // keyboard/screen-reader users land inside the dialog, not behind it.
  const focusables = _modalFocusables();
  (focusables[1] || focusables[0])?.focus();
}

// Escape closes the modal; Tab cycles within it (focus trap) while it's open.
document.addEventListener('keydown', e => {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    dismissModal();
    return;
  }
  if (e.key === 'Tab') {
    const els = _modalFocusables();
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    const inDialog = document.getElementById('modal-dialog').contains(document.activeElement);
    if (!inDialog) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

// ── Feature modules ───────────────────────────────────────────────────────────
// Band-wide toggles configured in Band Settings. Stats depends on Marks (it's
// built from mark data), so it's only "on" when both are enabled.
//
// Gating strategy (keep new feature-specific UI consistent with this):
//   • Songs has its own collection, so it's gated at the DATA layer via
//     DB.getSongs() (returns [] when off). Read song data through DB.getSongs()
//     in every DISPLAY site and it disappears everywhere automatically. Only
//     song mutations use STATE.songs directly.
//   • Marks & Attendance are fields on shared `entries` docs (no clean
//     accessor), so they're gated per-SECTION with featureOn() in the views
//     that blend features. Those cross-cutting surfaces are: viewLeaderboard
//     (Stats), viewStudent (roster detail), viewStudentPortal, viewRehearsals
//     /viewHome/viewRoster cards. If you add mark/attendance UI to any shared
//     view, gate it here too.
//   • Tabs + a router guard (see render) hide whole disabled views.
function featureOn(name) {
  const f = STATE.features || {};
  switch (name) {
    case 'attendance': return f.attendance !== false;
    case 'marks':      return f.marks      !== false;
    case 'songs':      return f.songs      !== false;
    case 'stats':      return f.stats !== false && f.marks !== false;
    case 'drill':      return f.drill      !== false;
    // Opt-in (=== true), unlike the others: a new tab shouldn't appear for
    // existing bands whose settings doc predates this feature.
    case 'tasks':      return f.tasks      === true;
    default:           return true;
  }
}

// Like featureOn() but also checks the per-feature student portal visibility
// toggle. Use this everywhere student-facing UI is rendered (portal, student
// leaderboard view) so directors can enable a feature internally while keeping
// it hidden from the student portal.
function portalFeatureOn(name) {
  if (!featureOn(name)) return false;
  const pv = STATE.portalVisible || {};
  switch (name) {
    case 'attendance': return pv.attendance !== false;
    case 'marks':      return pv.marks      !== false;
    case 'songs':      return pv.songs      !== false;
    case 'stats':      return pv.stats      !== false;
    case 'tasks':      return pv.tasks      !== false;
    default:           return true;
  }
}

// Maps a router view to the feature it belongs to (for hiding disabled views).
const VIEW_FEATURE = {
  'attendance-tab': 'attendance',
  'attendance':     'attendance',
  'dashboard':      'marks',
  'rehearsal':      'marks',
  'leaderboard':    'stats',
  'songs':          'songs',
  'song':           'songs',
  'drill':          'drill',
  'tasks':          'tasks',
  'task':           'tasks',
};
