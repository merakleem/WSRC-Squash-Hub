// ===== A RUNNING COMPETITION'S PAGE FRAME =====
// The navy hero with its progress bar, the tab bar under it, and the admin's
// Options menu - the same frame for a league and a tournament. The caller fills
// in the words and what each menu item does.
import { esc } from './utils.js';

/**
 * The hero. `status` is the pill text and `statusCls` an extra class on it;
 * `chips` any extra HTML beside it; `right` the progress panel (progressHTML)
 * or a champion block (championHTML).
 */
export function heroHTML({ name, status, statusCls = '', chips = '', meta = '', right = '' }) {
  return `
    <div class="lg-hero">
      <div class="lg-hero-left">
        <div class="lg-hero-title">
          <h2>${esc(name)}</h2>
          <span class="lg-status${statusCls ? ` ${statusCls}` : ''}">${esc(status)}</span>
          ${chips}
        </div>
        ${meta ? `<span class="lg-hero-meta">${meta}</span>` : ''}
      </div>
      ${right}
    </div>`;
}

/** The progress panel: a heading, the dates, and one segment per step ('done' | 'now' | ''). */
export function progressHTML({ label, dates, segs }) {
  return `
      <div class="lg-progress">
        <div class="lg-progress-top">
          <span class="lg-progress-week">${label}</span>
          <span class="lg-progress-dates">${dates}</span>
        </div>
        <div class="lg-segs">${segs.map((s) => `<span class="lg-seg${s === 'done' ? ' lg-seg-done' : s === 'now' ? ' lg-seg-now' : ''}"></span>`).join('')}</div>
      </div>`;
}

/**
 * The admin's Options menu. `items` are { action, label, danger?, attrs? };
 * wireOptionsMenu calls `onAction(action, button)` for the one picked.
 */
export function optionsMenuHTML(items, { label = 'Options' } = {}) {
  return `
    <div class="options-menu" id="optionsMenu">
      <button class="btn btn-outline" id="optionsBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="optionsDropdown">Options <svg width="14" height="14" viewBox="0 0 4 14" fill="currentColor" style="vertical-align:middle;margin-left:2px"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/></svg></button>
      <div class="options-dropdown" id="optionsDropdown" role="menu" aria-label="${esc(label)}">
        ${items.filter(Boolean).map((it) => `<button role="menuitem" class="options-item${it.danger ? ' options-item-danger' : ''}" data-action="${it.action}"${it.attrs || ''}>${it.label}</button>`).join('\n        ')}
      </div>
    </div>`;
}

export function wireOptionsMenu(onAction) {
  const btn = document.getElementById('optionsBtn');
  const drop = document.getElementById('optionsDropdown');
  if (!btn || !drop) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = drop.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  drop.addEventListener('click', (e) => {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    drop.classList.remove('open');
    onAction(item.dataset.action, item);
  });
  document.addEventListener('click', function closeOptions() {
    document.getElementById('optionsDropdown')?.classList.remove('open');
    document.removeEventListener('click', closeOptions);
  });
}
