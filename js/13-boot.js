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

// ── Boot ──────────────────────────────────────────────────────────────────────

render();
