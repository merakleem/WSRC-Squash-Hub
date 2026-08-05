// ===== UTILS =====
export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ===== AVATARS =====

// Single source of truth for initials; the ladder and profile previously
// disagreed (two letters vs one).
export function playerInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Avatar markup for a player: their photo when set, initials otherwise.
 * `className` carries the size modifier (e.g. 'ldr-avatar ldr-avatar-sm').
 */
export function avatarHTML(player, className) {
  const name = player?.name || '';
  if (player?.photo_path) {
    return `<div class="${className} has-photo"><img src="${esc(player.photo_path)}" alt="${esc(name)}" loading="lazy"></div>`;
  }
  return `<div class="${className}">${esc(playerInitials(name))}</div>`;
}

// ===== TOAST =====
export function toast(msg, type = 'default') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }, 3000);
}

// ===== MODAL =====
export const modal = {
  open(title, bodyHTML, { wide = false, medium = false } = {}) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHTML;
    document.getElementById('modal').classList.toggle('modal-wide', wide);
    document.getElementById('modal').classList.toggle('modal-medium', medium && !wide);
    document.getElementById('modalOverlay').classList.add('open');
  },
  close() {
    document.getElementById('modal').classList.remove('modal-wide');
    document.getElementById('modalOverlay').classList.remove('open');
  },
};

document.getElementById('modalClose').addEventListener('click', () => modal.close());
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalOverlay')) modal.close();
});
