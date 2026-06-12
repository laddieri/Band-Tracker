// Band Tracker — js/05-auth-views.js — Login/signup/verify, onboarding, brand settings, season reset.
// Plain script sharing global scope; load order is set in index.html.

// ── Auth views ────────────────────────────────────────────────────────────────

function viewLogin() {
  if (_authMode === 'signup') return viewSignup();
  return `
    <div class="login-view">
      ${STATE.bandLogo
        ? `<img src="${STATE.bandLogo}" class="login-logo-img" alt="Band Logo">`
        : `<div class="login-logo">🎺</div>`}
      <div class="login-title">${esc(STATE.bandName || 'Band Tracker')}</div>

      <div class="login-section-label">Students</div>
      <div id="student-code-error"></div>
      <div class="form-group">
        <input class="form-input" id="student-code" type="text"
               placeholder="Enter your student code"
               autocomplete="off" autocapitalize="characters" spellcheck="false"
               style="text-transform:uppercase;letter-spacing:.1em;font-size:1.1rem;text-align:center"
               onkeydown="if(event.key==='Enter')loginWithStudentCode()">
      </div>
      <button class="btn btn-primary btn-full btn-lg" onclick="loginWithStudentCode()">View My Page</button>

      <div class="login-divider"><span>Directors</span></div>

      <div id="auth-error"></div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" id="auth-email" type="email"
               placeholder="director@school.edu" autocomplete="email"
               onkeydown="if(event.key==='Enter')doLogin()">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input class="form-input" id="auth-password" type="password"
               placeholder="••••••••" autocomplete="current-password"
               onkeydown="if(event.key==='Enter')doLogin()">
      </div>
      <button class="btn btn-secondary btn-full" onclick="doLogin()">Director Sign In</button>
      <div style="text-align:center;margin-top:12px">
        <button class="btn-link" onclick="setAuthMode('signup')"
          style="background:none;border:none;color:var(--primary);text-decoration:underline;cursor:pointer;font-size:.85rem">
          New director? Create an account
        </button>
      </div>
    </div>
  `;
}

function viewSignup() {
  return `
    <div class="login-view">
      <div class="login-logo">🎺</div>
      <div class="login-title">Create Director Account</div>
      <p style="color:var(--text-muted);font-size:.85rem;text-align:center;margin:-8px 0 16px">
        Set up your account — you’ll name your band on the next step.
      </p>

      <div id="auth-error"></div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" id="signup-email" type="email"
               placeholder="director@school.edu" autocomplete="email"
               onkeydown="if(event.key==='Enter')doSignup()">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input class="form-input" id="signup-password" type="password"
               placeholder="At least 6 characters" autocomplete="new-password"
               onkeydown="if(event.key==='Enter')doSignup()">
      </div>
      <div class="form-group">
        <label class="form-label">Confirm Password</label>
        <input class="form-input" id="signup-password-confirm" type="password"
               placeholder="Re-enter your password" autocomplete="new-password"
               onkeydown="if(event.key==='Enter')doSignup()">
      </div>
      <button class="btn btn-primary btn-full btn-lg" onclick="doSignup()">Create Account</button>

      <div style="text-align:center;margin-top:16px">
        <button class="btn-link" onclick="setAuthMode('signin')"
          style="background:none;border:none;color:var(--text-muted);text-decoration:underline;cursor:pointer;font-size:.85rem">
          ← Back to sign in
        </button>
      </div>
    </div>
  `;
}

function setAuthMode(mode) {
  _authMode = mode;
  render();
}

async function loginWithStudentCode() {
  const raw  = document.getElementById('student-code')?.value.trim();
  const code = raw?.toUpperCase();
  if (!code) { showStudentCodeError('Please enter your student code.'); return; }
  try {
    _pendingStudentCode = code;
    localStorage.setItem('bandStudentCode', code);
    await auth.signInAnonymously();
  } catch(e) {
    _pendingStudentCode = '';
    localStorage.removeItem('bandStudentCode');
    showStudentCodeError('Unable to connect. Please try again.');
  }
}

function showStudentCodeError(msg) {
  const el = document.getElementById('student-code-error');
  if (el) el.innerHTML = `<div class="auth-error">${esc(msg)}</div>`;
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) el.innerHTML = `<div class="auth-error">${esc(msg)}</div>`;
}

function authMsg(code) {
  const map = {
    'auth/user-not-found':        'No account found with that email.',
    'auth/wrong-password':        'Incorrect password.',
    'auth/invalid-email':         'Invalid email address.',
    'auth/email-already-in-use':  'An account already exists with that email.',
    'auth/weak-password':         'Password must be at least 6 characters.',
    'auth/too-many-requests':     'Too many attempts. Try again later.',
    'auth/invalid-credential':    'Incorrect email or password.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

async function doLogin() {
  const email = document.getElementById('auth-email')?.value.trim();
  const pass  = document.getElementById('auth-password')?.value;
  if (!email || !pass) { showAuthError('Email and password are required.'); return; }
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch(e) {
    showAuthError(authMsg(e.code));
  }
}

async function doSignup() {
  const email    = document.getElementById('signup-email')?.value.trim();
  const pass     = document.getElementById('signup-password')?.value;
  const passConf = document.getElementById('signup-password-confirm')?.value;
  if (!email || !pass) { showAuthError('Email and password are required.'); return; }
  if (pass !== passConf) { showAuthError('Passwords do not match.'); return; }
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.sendEmailVerification();
    _pendingVerification = true;
    render();
  } catch(e) {
    showAuthError(authMsg(e.code));
  }
}

function viewVerificationPending() {
  const email = STATE.user?.email || 'your email address';
  return `
    <div class="login-view">
      <div class="login-logo">📬</div>
      <div class="login-title">Check your inbox</div>
      <p style="color:var(--text-muted);font-size:.85rem;text-align:center;margin:-8px 0 20px">
        We sent a verification link to<br><strong>${esc(email)}</strong>
      </p>
      <div id="verify-msg"></div>
      <button class="btn btn-primary btn-full btn-lg" onclick="checkEmailVerified()">
        I've verified my email
      </button>
      <button class="btn btn-secondary btn-full" style="margin-top:10px" onclick="resendVerification()">
        Resend email
      </button>
      <div style="text-align:center;margin-top:20px">
        <button class="btn-link" onclick="doLogout()"
          style="background:none;border:none;color:var(--text-muted);text-decoration:underline;cursor:pointer;font-size:.85rem">
          Sign out
        </button>
      </div>
    </div>
  `;
}

async function checkEmailVerified() {
  try {
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      _pendingVerification = false;
      STATE.user = auth.currentUser;
      render();
    } else {
      const el = document.getElementById('verify-msg');
      if (el) el.innerHTML = `<div class="auth-error" style="margin-bottom:12px">Email not yet verified — please click the link in the email first.</div>`;
    }
  } catch(e) {
    const el = document.getElementById('verify-msg');
    if (el) el.innerHTML = `<div class="auth-error" style="margin-bottom:12px">Could not check verification status. Please try again.</div>`;
  }
}

async function resendVerification() {
  try {
    await auth.currentUser.sendEmailVerification();
    const el = document.getElementById('verify-msg');
    if (el) el.innerHTML = `<div style="color:var(--success);font-size:.85rem;text-align:center;margin-bottom:12px">Verification email resent.</div>`;
  } catch(e) {
    const el = document.getElementById('verify-msg');
    if (el) el.innerHTML = `<div class="auth-error" style="margin-bottom:12px">Could not resend — please wait a moment and try again.</div>`;
  }
}

// ── Onboarding (create / join a band) ──────────────────────────────────────────

function viewOnboarding() {
  return `
    <div class="login-view">
      <div class="login-logo">🎺</div>
      <div class="login-title">Set up your band</div>
      <p style="color:var(--text-muted);font-size:.85rem;text-align:center;margin:-8px 0 16px">
        Signed in as ${esc(STATE.user?.email || '')}
      </p>

      <div class="login-section-label">Create a new band</div>
      <div id="onboard-create-error"></div>
      <div class="form-group">
        <input class="form-input" id="onboard-band-name" type="text"
               placeholder="e.g. Lincoln High School Band"
               onkeydown="if(event.key==='Enter')createBand()">
      </div>
      <div class="form-group">
        <input class="form-input" id="onboard-access-code" type="text"
               placeholder="Access code"
               autocomplete="off" autocapitalize="characters" spellcheck="false"
               style="text-transform:uppercase;letter-spacing:.1em;text-align:center"
               onkeydown="if(event.key==='Enter')createBand()">
      </div>
      <button class="btn btn-primary btn-full btn-lg" onclick="createBand()">Create Band</button>

      <div class="login-divider"><span>or</span></div>

      <div class="login-section-label">Join an existing band</div>
      <div id="onboard-join-error"></div>
      <div class="form-group">
        <input class="form-input" id="onboard-invite-code" type="text"
               placeholder="Enter invite code"
               autocomplete="off" autocapitalize="characters" spellcheck="false"
               style="text-transform:uppercase;letter-spacing:.1em;text-align:center"
               onkeydown="if(event.key==='Enter')joinBandWithInvite()">
      </div>
      <button class="btn btn-secondary btn-full" onclick="joinBandWithInvite()">Join Band</button>

      <div style="text-align:center;margin-top:24px">
        <button class="btn-link" onclick="doLogout()"
          style="background:none;border:none;color:var(--text-muted);text-decoration:underline;cursor:pointer;font-size:.85rem">
          Sign out
        </button>
      </div>
    </div>
  `;
}

function onboardErr(id, msg) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="auth-error">${esc(msg)}</div>`;
}

async function createBand() {
  const name       = document.getElementById('onboard-band-name')?.value.trim();
  const accessCode = document.getElementById('onboard-access-code')?.value.trim().toUpperCase();
  if (!name)       { onboardErr('onboard-create-error', 'Please enter a band name.'); return; }
  if (!accessCode) { onboardErr('onboard-create-error', 'An access code is required to create a band.'); return; }
  try {
    const orgRef = db.collection('orgs').doc();
    const orgId  = orgRef.id;
    // Order matters for the security rules: create the org (createdBy = me, with
    // a valid access code), then my director membership, then seed settings.
    await orgRef.set({
      name, plan: 'free', createdBy: STATE.user.uid, accessCode,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('members').doc(STATE.user.uid).set({
      orgId, role: 'director', email: STATE.user.email || ''
    });
    await orgRef.collection('settings').doc('presets').set({ bandName: name }, { merge: true });

    STATE.needsOnboarding = false;
    STATE.loading = true;
    render();
    startListeners();
  } catch (e) {
    console.error('createBand failed:', e);
    if (e.code === 'permission-denied') {
      onboardErr('onboard-create-error', 'That access code isn’t valid. Please check and try again.');
    } else {
      onboardErr('onboard-create-error', 'Could not create the band. Please try again.');
    }
  }
}

async function joinBandWithInvite() {
  const code = document.getElementById('onboard-invite-code')?.value.trim().toUpperCase();
  if (!code) { onboardErr('onboard-join-error', 'Please enter an invite code.'); return; }
  try {
    const snap = await db.collection('inviteCodes').doc(code).get();
    if (!snap.exists) { onboardErr('onboard-join-error', 'Invite code not found.'); return; }
    const { orgId } = snap.data();
    await db.collection('members').doc(STATE.user.uid).set({
      orgId, role: 'director', email: STATE.user.email || '', inviteCode: code
    });

    STATE.needsOnboarding = false;
    STATE.loading = true;
    render();
    startListeners();
  } catch (e) {
    console.error('joinBandWithInvite failed:', e);
    onboardErr('onboard-join-error', 'Could not join the band. Please try again.');
  }
}

async function doLogout() {
  closeModal();
  localStorage.removeItem('bandStudentCode');
  localStorage.removeItem('bandStudentNum');
  await auth.signOut();
}

function showUserMenu() {
  if (STATE.user?.isAnonymous) {
    const s = STATE.students[STATE.studentNum];
    openModal(`
      <div class="modal-title">Student View</div>
      <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:20px">
        Viewing as<br><strong style="color:var(--text)">${esc(s?.name || 'Student #' + STATE.studentNum)}</strong>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-full" onclick="toggleTheme()">${document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}</button>
        <button class="btn btn-secondary btn-full" onclick="closeModal()">Close</button>
        <button class="btn btn-danger btn-full" onclick="doLogout()">Exit Student View</button>
      </div>
    `);
    return;
  }
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  openModal(`
    <div class="modal-title">Account</div>
    <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:20px">
      Signed in as<br><strong style="color:var(--text)">${esc(STATE.user?.email || '')}</strong><br>
      <span style="font-size:0.8rem">${STATE.isAdmin ? '⭐ Admin' : 'Director'}</span>
    </div>
    <div class="modal-actions">
      ${STATE.isAdmin ? `
        <button class="btn btn-secondary btn-full" onclick="closeModal();navigate('roster')">Manage Roster</button>
        <button class="btn btn-secondary btn-full" onclick="closeModal();showBrandSettingsModal()">Band Settings</button>
      ` : ''}
      <button class="btn btn-secondary btn-full" onclick="toggleTheme()">${isDark ? '☀️ Light Mode' : '🌙 Dark Mode'}</button>
      <button class="btn btn-secondary btn-full" onclick="closeModal()">Close</button>
      <button class="btn btn-danger btn-full" onclick="doLogout()">Sign Out</button>
    </div>
  `);
}

// ── Brand settings ────────────────────────────────────────────────────────────

function showBrandSettingsModal() {
  if (!STATE.isAdmin) return;
  _pendingLogoData = null;
  const currentLogo = STATE.bandLogo;
  openModal(`
    <div class="modal-title">Band Settings</div>

    <div class="form-group">
      <label class="form-label">Band Name</label>
      <input class="form-input" id="brand-name-input" type="text"
             placeholder="e.g. Lincoln High School Band"
             value="${esc(STATE.bandName)}">
    </div>

    <div class="form-group">
      <label class="form-label">Logo</label>
      <div class="brand-logo-area" id="brand-logo-area">
        ${currentLogo
          ? `<img src="${currentLogo}" class="brand-logo-preview" id="brand-logo-preview" alt="Current logo">`
          : `<div class="brand-logo-placeholder" id="brand-logo-preview" style="display:none"></div>`}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <label class="btn btn-secondary" style="cursor:pointer;margin:0">
          ${currentLogo ? 'Replace Logo' : 'Upload Logo'}
          <input type="file" accept="image/*" style="display:none" onchange="handleLogoUpload(event)">
        </label>
        ${currentLogo ? `<button class="btn btn-secondary" onclick="removeBrandLogo()">Remove</button>` : ''}
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Features</label>
      <p style="font-size:.75rem;color:var(--text-muted);margin:-2px 0 8px">
        Turn off features your band doesn’t use. Existing data is kept and
        reappears if you turn a feature back on.
      </p>
      ${[
        ['attendance', 'Attendance', 'Track who’s absent, late, or present'],
        ['marks',      'Marks / Student Feedback', 'Log positive and mistake marks during rehearsals'],
        ['songs',      'Songs', 'Music memorization with pass/fail tracking'],
        ['stats',      'Stats / Leaderboard', 'Rankings built from marks (needs Marks on)'],
      ].map(([key, label, desc]) => {
        const featOn   = STATE.features?.[key] !== false;
        const portalOn = STATE.portalVisible?.[key] !== false;
        return `
        <div class="feat-toggle-row">
          <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0 4px;cursor:pointer">
            <input type="checkbox" id="feat-${key}" ${featOn ? 'checked' : ''}
              style="margin-top:3px;width:18px;height:18px;flex-shrink:0"
              onchange="handleFeatToggle('${key}')">
            <span>
              <span style="font-weight:600">${label}</span>
              <span style="display:block;font-size:.75rem;color:var(--text-muted)">${desc}</span>
            </span>
          </label>
          <label class="feat-portal-lbl${!featOn ? ' feat-portal-lbl-dim' : ''}" id="feat-portal-lbl-${key}">
            <input type="checkbox" id="feat-portal-${key}" ${portalOn ? 'checked' : ''}${!featOn ? ' disabled' : ''}>
            <span>Show to students</span>
          </label>
        </div>`;
      }).join('')}
    </div>

    <div class="form-group">
      <label class="form-label">Negative Marks</label>
      <p style="font-size:.75rem;color:var(--text-muted);margin:-2px 0 8px">
        Controls how mistake marks (marching feedback) appear to students.
        Does not affect attendance.
      </p>
      ${[
        ['neg-show-portal',  !STATE.hideNegativeFromPortal, 'Show in student portal',        'Students can see their negative marks and feedback notes'],
        ['neg-count-score',  STATE.countNegativeInScore,    'Count in leaderboard score',     'Subtract negative marks from students\' leaderboard scores'],
      ].map(([id, checked, label, desc]) => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;cursor:pointer">
          <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}
            style="margin-top:3px;width:18px;height:18px;flex-shrink:0">
          <span>
            <span style="font-weight:600">${label}</span>
            <span style="display:block;font-size:.75rem;color:var(--text-muted)">${desc}</span>
          </span>
        </label>`).join('')}
    </div>

    <div class="form-group">
      <label class="form-label">Co-director invite code</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <code id="invite-code-display"
          style="font-size:1.1rem;letter-spacing:.15em;padding:6px 12px;background:var(--surface-2,#eee);border-radius:6px">
          ${STATE.org?.inviteCode ? esc(STATE.org.inviteCode) : '— none —'}
        </code>
        <button class="btn btn-secondary" onclick="generateInviteCode()">
          ${STATE.org?.inviteCode ? 'Regenerate' : 'Generate'}
        </button>
      </div>
      <p style="font-size:.75rem;color:var(--text-muted);margin-top:6px">
        Share this code with another director so they can join this band.
        Regenerating revokes the old code.
      </p>
    </div>

    <div class="form-group">
      <label class="form-label">Directors</label>
      <div id="directors-list" style="font-size:.9rem">Loading…</div>
    </div>

    <div class="form-group">
      <label class="form-label" style="color:var(--danger)">Start a new season</label>
      <p style="font-size:.75rem;color:var(--text-muted);margin:-2px 0 8px">
        Permanently clears rehearsal history, attendance and marks (and
        optionally song progress) while keeping your roster, student codes and
        settings. Do this between seasons so student records don't accumulate
        forever.
      </p>
      <button class="btn btn-secondary" style="color:var(--danger)" onclick="showNewSeasonModal()">
        Start New Season…
      </button>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveBrandSettings()">Save</button>
    </div>
  `);
  loadDirectorsList();
}

async function loadDirectorsList() {
  const el = document.getElementById('directors-list');
  if (!el || !STATE.orgId) return;
  try {
    const snap = await db.collection('members')
      .where('orgId', '==', STATE.orgId)
      .where('role', '==', 'director')
      .get();
    const me      = STATE.user?.uid;
    const founder = STATE.org?.createdBy;
    const rows = snap.docs.map(d => {
      const uid   = d.id;
      const email = d.data().email || uid;
      const tags  = (uid === founder ? ' (owner)' : '') + (uid === me ? ' (you)' : '');
      const remove = uid === founder
        ? ''
        : `<button class="btn btn-danger" style="padding:4px 10px;font-size:.78rem;width:auto;margin:0"
             onclick="removeDirector('${esc(uid)}','${esc(email).replace(/'/g, "\\'")}')">Remove</button>`;
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,#eee)">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(email)}${tags}</span>
        ${remove}
      </div>`;
    }).join('');
    el.innerHTML = rows || '<span style="color:var(--text-muted)">No directors found.</span>';
  } catch (e) {
    console.error('loadDirectorsList failed:', e);
    el.innerHTML = '<span style="color:var(--text-muted)">Could not load directors.</span>';
  }
}

function removeDirector(uid, label) {
  const isSelf = uid === STATE.user?.uid;
  showConfirmModal(
    isSelf ? 'Remove yourself as a director?' : `Remove ${esc(label)}?`,
    isSelf ? 'You will lose access to this band.'
           : `<strong>${esc(label)}</strong> will lose access to this band.`,
    async () => {
      try {
        await db.collection('members').doc(uid).delete();
        if (isSelf) {
          // We removed our own membership — re-resolve, which routes us to onboarding.
          startListeners();
          return;
        }
        showToast('Director removed.');
      } catch (e) {
        console.error('removeDirector failed:', e);
        showToast('Could not remove director.');
      }
      // The confirm dialog replaced the Band Settings modal — bring it back.
      showBrandSettingsModal();
    }
  );
}

async function generateInviteCode() {
  if (!STATE.isAdmin || !STATE.orgId) return;
  const code = genStudentCode();
  try {
    const old = STATE.org?.inviteCode;
    await db.collection('inviteCodes').doc(code).set({ orgId: STATE.orgId });
    await db.collection('orgs').doc(STATE.orgId).set({ inviteCode: code }, { merge: true });
    if (old && old !== code) {
      await db.collection('inviteCodes').doc(old).delete().catch(() => {});
    }
    if (STATE.org) STATE.org.inviteCode = code; // optimistic; org listener will confirm
    showToast('Invite code generated.');
    showBrandSettingsModal();
  } catch (e) {
    console.error('generateInviteCode failed:', e);
    showToast('Could not generate invite code.');
  }
}

function handleLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 192;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      _pendingLogoData = canvas.toDataURL('image/png');
      const preview = document.getElementById('brand-logo-preview');
      if (preview) {
        preview.src   = _pendingLogoData;
        preview.style.display = '';
        preview.className = 'brand-logo-preview';
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeBrandLogo() {
  _pendingLogoData = '';
  showBrandSettingsModal(); // re-open without current logo so Remove btn disappears
}

function handleFeatToggle(key) {
  const featEl     = document.getElementById(`feat-${key}`);
  const portalLbl  = document.getElementById(`feat-portal-lbl-${key}`);
  const portalEl   = document.getElementById(`feat-portal-${key}`);
  if (!featEl || !portalLbl || !portalEl) return;
  const on = featEl.checked;
  portalEl.disabled = !on;
  portalLbl.classList.toggle('feat-portal-lbl-dim', !on);
}

async function saveBrandSettings() {
  const name = document.getElementById('brand-name-input')?.value.trim() || '';
  const logo = _pendingLogoData !== null ? _pendingLogoData : STATE.bandLogo;
  _pendingLogoData = null;
  const readFeat = (key) => {
    const el = document.getElementById(`feat-${key}`);
    return el ? el.checked : (STATE.features?.[key] !== false);
  };
  const readPortal = (key) => {
    const el = document.getElementById(`feat-portal-${key}`);
    return el ? el.checked : (STATE.portalVisible?.[key] !== false);
  };
  const features = {
    attendance: readFeat('attendance'),
    marks:      readFeat('marks'),
    songs:      readFeat('songs'),
    stats:      readFeat('stats'),
  };
  const portalVisible = {
    attendance: readPortal('attendance'),
    marks:      readPortal('marks'),
    songs:      readPortal('songs'),
    stats:      readPortal('stats'),
  };
  const hideNegativeFromPortal = !(document.getElementById('neg-show-portal')?.checked ?? true);
  const countNegativeInScore   = !!(document.getElementById('neg-count-score')?.checked ?? true);
  STATE.bandName               = name;
  STATE.bandLogo               = logo;
  STATE.features               = features;
  STATE.portalVisible          = portalVisible;
  STATE.hideNegativeFromPortal = hideNegativeFromPortal;
  STATE.countNegativeInScore   = countNegativeInScore;
  await orgCol('settings').doc('presets').set(
    { bandName: name, bandLogo: logo, features, portalVisible, hideNegativeFromPortal, countNegativeInScore },
    { merge: true }
  );
  closeModal();
  showToast('Band settings saved.');
  render();
}

// ── Season reset ──────────────────────────────────────────────────────────────
// Clears the per-season records (rehearsals, entries, optionally song
// progress) while keeping the roster, student codes and settings. Exists so
// marks/attendance about students don't accumulate across years.

function showNewSeasonModal() {
  if (!STATE.isAdmin) return;
  const rehearsalCount = STATE.rehearsals.length;
  const entryCount     = Object.values(STATE.entries).reduce((n, re) => n + Object.keys(re).length, 0);
  openModal(`
    <div class="modal-handle"></div>
    <div class="modal-title" style="color:var(--danger)">Start New Season</div>
    <p style="font-size:.9rem;line-height:1.6;margin-bottom:8px">
      This permanently deletes <strong>${rehearsalCount} rehearsal${rehearsalCount !== 1 ? 's' : ''}</strong>
      and <strong>${entryCount} attendance/marks record${entryCount !== 1 ? 's' : ''}</strong>.
      Your roster, student codes and settings are kept.
    </p>
    <p style="font-size:.8rem;color:var(--text-muted);line-height:1.5;margin-bottom:12px">
      Tip: run <code>scripts/backup-firestore.js</code> first if you want to
      keep a copy of this season's records.
    </p>
    <label style="display:flex;align-items:flex-start;gap:10px;padding:6px 0;cursor:pointer">
      <input type="checkbox" id="season-clear-songs" checked
        style="margin-top:3px;width:18px;height:18px;flex-shrink:0">
      <span style="font-size:.88rem">
        <span style="font-weight:600">Reset song progress</span>
        <span style="display:block;font-size:.75rem;color:var(--text-muted)">Clear every student's pass/fail results (keeps the song list)</span>
      </span>
    </label>
    <label style="display:flex;align-items:flex-start;gap:10px;padding:6px 0 12px;cursor:pointer">
      <input type="checkbox" id="season-delete-songs"
        style="margin-top:3px;width:18px;height:18px;flex-shrink:0">
      <span style="font-size:.88rem">
        <span style="font-weight:600">Also delete the songs themselves</span>
        <span style="display:block;font-size:.75rem;color:var(--text-muted)">Remove the whole song list, not just the results</span>
      </span>
    </label>
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label">Type <strong>RESET</strong> to confirm</label>
      <input class="form-input" id="season-reset-confirm" type="text"
             placeholder="RESET" autocomplete="off"
             oninput="document.getElementById('season-reset-btn').disabled = this.value !== 'RESET'">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="season-reset-btn" disabled onclick="startNewSeason()">Start New Season</button>
    </div>
  `);
  setTimeout(() => document.getElementById('season-reset-confirm')?.focus(), 80);
}

async function startNewSeason() {
  if (!STATE.isAdmin) return;
  const clearSongProgress = !!document.getElementById('season-clear-songs')?.checked;
  const deleteSongs       = !!document.getElementById('season-delete-songs')?.checked;
  closeModal();
  showToast('Clearing season data…');

  const CHUNK = 500;
  const deleteAll = async (snap) => {
    for (let i = 0; i < snap.docs.length; i += CHUNK) {
      const batch = db.batch();
      snap.docs.slice(i, i + CHUNK).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  };

  try {
    // Query the collections directly so orphaned docs are removed too.
    await deleteAll(await orgCol('entries').get());
    await deleteAll(await orgCol('rehearsals').get());

    if (deleteSongs) {
      await deleteAll(await orgCol('songs').get());
    } else if (clearSongProgress) {
      const songsSnap = await orgCol('songs').get();
      for (let i = 0; i < songsSnap.docs.length; i += CHUNK) {
        const batch = db.batch();
        songsSnap.docs.slice(i, i + CHUNK).forEach(doc => batch.update(doc.ref, { statuses: {} }));
        await batch.commit();
      }
    }

    if (deleteSongs || clearSongProgress) {
      // Clear the per-student songStatuses mirrors (what students see).
      const nums = Object.keys(STATE.students).filter(num =>
        STATE.students[num]?.songStatuses && Object.keys(STATE.students[num].songStatuses).length);
      for (let i = 0; i < nums.length; i += CHUNK) {
        const batch = db.batch();
        nums.slice(i, i + CHUNK).forEach(num =>
          batch.update(orgCol('students').doc(num), { songStatuses: {} }));
        await batch.commit();
      }
    }
  } catch (e) {
    console.error('season reset failed:', e);
    showToast('Season reset failed partway — check your connection and retry.');
    return;
  }

  _activeRid = null;
  showToast('New season started.');
  navigate('rehearsals');
}
