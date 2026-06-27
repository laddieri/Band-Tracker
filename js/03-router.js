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

// OS back gesture / hardware back button.
window.addEventListener('popstate', e => {
  // If a modal is open, this back press should close it — not navigate.
  const overlay = document.getElementById('modal-overlay');
  if (overlay && !overlay.classList.contains('hidden')) {
    overlay.classList.add('hidden');
    return;
  }
  // Sentinel-only entry (modal was closed before back fired) — skip it.
  if (e.state?.modal) return;
  const { view = 'rehearsals', params = {} } = e.state || {};
  navigate(view, params, true); // true = don't push another entry
});

function navigate(view, params = {}, _fromHistory = false) {
  if (_view === 'rehearsal' && view !== 'rehearsal') {
    _activeNum = null; _trackerFilter = _mkFilter('name', 'asc'); _blockMode = false; _blockPath = []; _drillSelectedNums = [];
    _trackerFilter = _mkFilter('name', 'asc');
  }
  if (_view === 'song' && view !== 'song') {
    _songFilter           = _mkFilter('name', 'asc');
    _songHidePassedFilter = false;
  }
  if (_view === 'leaderboard' && view !== 'leaderboard') {
    _lbFilter = _mkFilter('score', 'desc');
  }
  if (_view === 'dashboard' && view !== 'dashboard') {
    _activeNum = null; _trackerFilter = _mkFilter('name', 'asc'); _blockMode = false; _blockPath = []; _drillSelectedNums = [];
    _trackerFilter = _mkFilter('name', 'asc');
    _dashRid = null; _dashForceHistory = false;
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
let _songHidePassedFilter    = false;
let _songCatCollapsed        = new Set(); // category names that are currently collapsed
let _dashRid        = null; // null = all rehearsals
let _activeRid      = null; // which open rehearsal is currently being marked
let _dashForceHistory = false; // force dashboard into historical view even when rehearsal is open
let _attModifyMode           = false; // true = show edit UI even when attendance is submitted
let _attPresentCollapsed     = true;  // collapsed state of the "marked present" section
let _attAbsentCollapsed      = true;  // collapsed state of the "marked absent" section
let _attSummaryStatus        = '';    // quick-filter on submitted summary: ''|'absent'|'late'|'present'
let _blockAttIdx    = 0;     // column index in the "take attendance by block" flow
let _blockAttReview = false; // true = showing the block-attendance review/submit screen
let _blockMode  = false;
let _blockPath  = []; // [{c0,c1,r0,r1}] — zoom drill path
let _drillData       = null; // parsed Pyware sections: [{letter, performers:[label]}]
let _drillPages      = null; // distinct formation frames: [{label,section,num,stepsX,stepsY}][]
let _drillCurrentSet = 0;    // currently viewed frame index in chart modal
let _drillFlipV      = false; // chart vertical flip (Pyware "facing" orientation)
let _drillFileName   = null; // original filename of the stored .3dj
let _drillZoomScale  = 1.0;  // current pinch-zoom scale for the fullscreen chart
let _drillLabelMode   = 0;    // dot labels: 0 = none, 1 = drill labels, 2 = student names
let _drillTraceLabel  = null; // performer label currently traced/highlighted in the viewer
let _drillSelLabel    = null; // performer tapped for the info panel (gets a bold callout)
let _drillFieldWhite  = (typeof localStorage !== 'undefined' && localStorage.getItem('drillFieldWhite') === '1'); // field fill: white vs green
let _drillSearchQuery = '';   // text in the Drill-tab performer search box
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
let _pendingStudentCode = ''; // code being verified for anonymous student login
let _pendingMarkAllFilter = null; // { instruments:[], grades:[] } snapshot for multi-select mark-all
let _pendingLogoData   = null; // null=no change, ''=clear, dataURL=new logo
let _pendingBandColor  = null; // null=no change, ''=default, hex=new band color
const _BRAND_DEFAULT_COLOR = '#2563eb'; // app default --primary
let _pendingConfirm    = null; // callback for generic confirmation modal
let _pendingSongFail   = null; // { sid, num, note } held while showing the portal-warning confirmation

// ── Unified filter state ──────────────────────────────────────────────────────

function _mkFilter(sortField, sortDir) {
  return { search: '', sortField, sortDir, instruments: [], sections: [], grades: [], panelOpen: false };
}
let _rosterFilter  = _mkFilter('name',     'asc');
let _trackerFilter = _mkFilter('name',     'asc');
let _attFilter     = _mkFilter('name',     'asc');
let _attTabFilter       = _mkFilter('absences', 'desc');
let _attTabRecentStatus = ''; // quick-filter on Most Recent chips: ''|'absent'|'late'|'present'
let _rhViewMode = (typeof localStorage !== 'undefined' && localStorage.getItem('rhViewMode')) || 'list'; // 'list' | 'calendar'
let _rhCalMonth = ''; // 'YYYY-MM' shown in the rehearsals calendar (set to current month on first open)
let _lbFilter      = _mkFilter('score',    'desc');
let _songFilter       = _mkFilter('name',     'asc');
let _songRosterFilter = _mkFilter('passed',   'desc');

// ── Debounce store for note fields ────────────────────────────────────────────

const _debounce = {};

function debounced(key, fn, ms = 800) {
  clearTimeout(_debounce[key]);
  _debounce[key] = setTimeout(fn, ms);
}

// ── Core filter + sort ────────────────────────────────────────────────────────

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
  // sort
  pool.sort((a, b) => {
    let va, vb;
    switch (f.sortField) {
      case 'name':       va = (a.name||'').toLowerCase();          vb = (b.name||'').toLowerCase(); break;
      case 'number':     va = +a.number||0;                        vb = +b.number||0; break;
      case 'instrument': va = instrOrder(a.instrument); vb = instrOrder(b.instrument); break;
      case 'section':    va = (a.section||'').toLowerCase();       vb = (b.section||'').toLowerCase(); break;
      case 'grade':      va = GRADE_LEVELS.indexOf(a.grade||'');   vb = GRADE_LEVELS.indexOf(b.grade||''); break;
      case 'column':     va = (a.column||'').toUpperCase();        vb = (b.column||'').toUpperCase(); break;
      case 'row':        va = +a.row||0;                           vb = +b.row||0; break;
      case 'score': case 'positives': case 'mistakes': case 'passed': case 'missing': {
        va = scoreMap?.[a.number]?.[f.sortField] ?? -1;
        vb = scoreMap?.[b.number]?.[f.sortField] ?? -1;
        break;
      }
      case 'absences':   va = scoreMap?.[a.number]?.absences ?? 0; vb = scoreMap?.[b.number]?.absences ?? 0; break;
      case 'lates':      va = scoreMap?.[a.number]?.lates ?? 0;    vb = scoreMap?.[b.number]?.lates ?? 0; break;
      case 'attStatus': {
        const order = { absent: 0, late: 1, present: 2, undefined: 2 };
        va = order[scoreMap?.[a.number]?.att] ?? 2;
        vb = order[scoreMap?.[b.number]?.att] ?? 2;
        break;
      }
      case 'songStatus': {
        const order = { passed: 0, failed: 1, not_attempted: 2 };
        va = order[scoreMap?.[a.number]?.status] ?? 2;
        vb = order[scoreMap?.[b.number]?.status] ?? 2;
        break;
      }
      default: va = (a.name||'').toLowerCase(); vb = (b.name||'').toLowerCase();
    }
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va - vb);
    return f.sortDir === 'asc' ? cmp : -cmp;
  });
  return pool;
}

// ── Filter bar renderer ───────────────────────────────────────────────────────

function renderFilterBar(viewId, f, sortOptions, { hideSearch = false, extra = '' } = {}) {
  const activeCount = f.instruments.length + f.sections.length + f.grades.length;
  const instruments = instrumentsInRoster();
  const sections    = sectionsInRoster();
  const grades      = gradesInRoster();

  const panel = f.panelOpen ? (() => {
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
      checkGroup('Instrument', instruments, f.instruments, 'instruments'),
      checkGroup('Grade',      grades,      f.grades,      'grades'),
      checkGroup('Section',    sections,    f.sections,    'sections'),
    ].join('');
    return `<div class="sfb-panel">
      ${groups || '<p class="sfb-empty-msg">No filter options yet — add instrument, section, or grade to students to enable filters.</p>'}
      ${activeCount ? `<button class="sfb-clear-btn" onclick="clearFilter('${viewId}')">Clear all filters</button>` : ''}
    </div>`;
  })() : '';

  return `
    <div class="sfb-wrap">
      ${hideSearch ? '' : `<div class="search-wrap" style="margin-bottom:8px">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input class="search-input" type="search" placeholder="Search by name or number…"
               value="${esc(f.search)}"
               oninput="updateFilter('${viewId}','search',this.value)" autocomplete="off">
      </div>`}
      <div class="sfb-row">
        <div class="sfb-sort-wrap">
          <select class="sfb-sort-select" onchange="updateFilter('${viewId}','sortField',this.value)">
            ${sortOptions.map(o => `<option value="${esc(o.value)}" ${f.sortField===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}
          </select>
          <button class="sfb-dir-btn" onclick="updateFilter('${viewId}','sortDir','${f.sortDir==='asc'?'desc':'asc'}')" title="Reverse sort">
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
      ${panel}
    </div>`;
}

// ── Filter event handlers ─────────────────────────────────────────────────────

function _getFilterObj(viewId) {
  return { roster: _rosterFilter, tracker: _trackerFilter, att: _attFilter, 'att-tab': _attTabFilter, lb: _lbFilter, song: _songFilter, 'song-roster': _songRosterFilter }[viewId];
}

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
  }
  if (mc) mc.scrollTop = st;
}

// Partial update of just the results list for a view, leaving the filter bar
// (and its focused search input) untouched. Used while typing in search so the
// keyboard/focus isn't lost to a full re-render. Returns false if the view has
// no dedicated list container (caller should fall back to a full re-render).
function _refreshFilterList(viewId) {
  const lists = {
    roster:    ['roster-list',       () => rosterRows(filterAndSortStudents(Object.values(DB.getStudents()), _rosterFilter))],
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
    lb:           ['lb-rank-list',      () => _buildLbRankRows()],
    'song-roster':['song-roster-list', () => _buildSongRosterRows()],
    song:         ['song-student-list', () => {
      const song = STATE.songs.find(s => s.id === _params.sid);
      return song ? songStudentRows(_params.sid, Object.values(DB.getStudents()), song.statuses || {}) : '';
    }],
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
  f[field] = value;
  // Tracker search drives student lookup: numbers auto-select, names show suggestions.
  if (viewId === 'tracker' && field === 'search') {
    const rid = _params.rid;
    const trimmed = value.trim();
    if (!trimmed || /^\d+$/.test(trimmed)) {
      _activeNum = trimmed || null;
      reRender(rid);
    } else {
      _activeNum = null;
      const el = document.getElementById('tracker-suggestions');
      if (el) {
        const matches = studentSuggestions(trimmed, _trackerFilter.instruments[0] || '', _trackerFilter.grades[0] || '', rehearsalStudents(rid));
        el.innerHTML = matches.length
          ? matches.map(s => `
              <div class="suggestion-row" onclick="pickStudent('${esc(s.number)}','${esc(rid)}')">
                <span class="suggestion-num">#${esc(s.number)}</span>
                <span class="suggestion-name">${esc(s.name || '—')}</span>
                <span class="suggestion-detail">${esc([fmtPos(s.column,s.row),s.instrument].filter(Boolean).join(' · '))}</span>
              </div>`).join('')
          : `<div class="tracker-hint">No students match "${esc(trimmed)}".</div>`;
      } else {
        reRender(rid);
      }
    }
    return;
  }
  // While typing in search, update only the list so the input keeps focus
  // (a full re-render would replace the input and dismiss the keyboard).
  if (field === 'search' && _refreshFilterList(viewId)) return;
  _rerenderForFilter(viewId);
}

function toggleFilterItem(viewId, field, item, checked) {
  const f = _getFilterObj(viewId);
  if (!f) return;
  if (checked) { if (!f[field].includes(item)) f[field].push(item); }
  else f[field] = f[field].filter(x => x !== item);
  _rerenderForFilter(viewId);
}

function clearFilter(viewId) {
  const f = _getFilterObj(viewId);
  if (!f) return;
  f.instruments = [];
  f.sections    = [];
  f.grades      = [];
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

function fmtPos(col, row) {
  if (!col && !row) return '';
  return `${col || ''}${row || ''}`;
}

function normInstrument(str) {
  return (str || '').replace(/^\d+\s*/, '').trim();
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

function handleModalClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  drillChartCollapse();
}

function openModal(html) {
  document.getElementById('modal-body').innerHTML = `
    <div class="modal-top-row">
      <div class="modal-handle"></div>
      <button class="modal-close-btn" onclick="closeModal()" aria-label="Close">✕</button>
    </div>
    ${html}`;
  document.getElementById('modal-overlay').classList.remove('hidden');
  history.pushState({ modal: true }, '');
}

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
};
