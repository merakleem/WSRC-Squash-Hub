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

// Brand-adjacent and deliberately all dark: each one is at least 4.5:1 against
// white, so the initials stay legible whichever colour a name lands on.
const AVATAR_COLORS = [
  '#1e2758', '#2d4a7c', '#3a3d8f', '#5a3576',
  '#7c2f4a', '#8a3f2a', '#7a5320', '#4a5f24',
  '#1c5f3a', '#15605c', '#175e78', '#44506b',
];

/**
 * A player's colour, stable for a given name. Keyed on the name rather than the
 * id because an avatar is sometimes drawn from a row that carries no id, and the
 * same person must not change colour between two views of the same list.
 */
export function avatarColor(name) {
  const str = String(name || '');
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Avatar markup for a player: their photo when set, initials otherwise.
 * `className` carries the size modifier (e.g. 'ldr-avatar ldr-avatar-sm').
 * Initials avatars carry their colour as --avatar-bg so each surface decides
 * how to use it; a photo needs none, since the image covers the circle.
 */
export function avatarHTML(player, className) {
  const name = player?.name || '';
  if (player?.photo_path) {
    return `<div class="${className} has-photo"><img src="${esc(player.photo_path)}" alt="${esc(name)}" loading="lazy"></div>`;
  }
  return `<div class="${className}" style="--avatar-bg:${avatarColor(name)}">${esc(playerInitials(name))}</div>`;
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
