// Band Tracker — js/13-boot.js — Global click handlers + initial render.
// Plain script sharing global scope; load order is set in index.html.

// ── Rehearsal card dropdown menu ──────────────────────────────────────────────

function toggleRhMenu(rid) {
  const target = document.getElementById(`rh-menu-${rid}`);
  if (!target) return;
  const isHidden = target.classList.contains('hidden');
  document.querySelectorAll('.rh-card-menu-list').forEach(el => el.classList.add('hidden'));
  if (isHidden) target.classList.remove('hidden');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.rh-card-menu-list').forEach(el => el.classList.add('hidden'));
});

// ── Pull-to-refresh ───────────────────────────────────────────────────────────
// Reconnects the live data listeners (or reloads when signed out). The pinned
// header/nav layout means the browser's native pull-to-refresh can't fire, so
// we implement the gesture on #main-content ourselves.

function refreshAppData() {
  if (!STATE.user) { location.reload(); return; }
  showToast('Refreshing…');
  // Re-resolve membership and re-subscribe; the listeners re-render the current
  // view (which _view/_params preserve) once data is back.
  startListeners();
}

(function initPullToRefresh() {
  const main = document.getElementById('main-content');
  const ind  = document.getElementById('ptr-indicator');
  if (!main || !ind) return;

  const RESIST  = 0.5;  // drag-to-travel ratio
  const TRIGGER = 64;   // indicator travel (px) needed to fire a refresh
  const MAX     = 96;   // max indicator travel
  let startY = 0, startX = 0, armed = false, pulling = false, dist = 0;

  const spinner = ind.querySelector('.ptr-spinner');
  const reset = () => {
    ind.classList.add('ptr-snap');
    ind.style.opacity = '0';
    ind.style.transform = 'translateY(0)';
    setTimeout(() => ind.classList.remove('ptr-snap', 'ptr-refreshing'), 260);
  };

  main.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || main.scrollTop > 0) { armed = false; return; }
    armed = true; pulling = false; dist = 0;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    ind.classList.remove('ptr-snap');
  }, { passive: true });

  main.addEventListener('touchmove', e => {
    if (!armed) return;
    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;
    // Only a downward, mostly-vertical drag from the top counts as a pull.
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
      if (pulling) reset();
      armed = false; pulling = false;
      return;
    }
    pulling = true;
    dist = Math.min(MAX, dy * RESIST);
    ind.style.opacity = String(Math.min(1, dist / TRIGGER));
    ind.style.transform = `translateY(${dist}px)`;
    if (e.cancelable) e.preventDefault(); // suppress rubber-banding while pulling
  }, { passive: false });

  main.addEventListener('touchend', () => {
    if (!armed || !pulling) { armed = false; return; }
    armed = false; pulling = false;
    if (dist >= TRIGGER) {
      ind.classList.add('ptr-snap', 'ptr-refreshing');
      ind.style.opacity = '1';
      ind.style.transform = `translateY(${TRIGGER}px)`;
      if (spinner) spinner.style.transform = '';
      refreshAppData();
      setTimeout(reset, 600);
    } else {
      reset();
    }
  }, { passive: true });
})();

// ── Boot ──────────────────────────────────────────────────────────────────────

render();
