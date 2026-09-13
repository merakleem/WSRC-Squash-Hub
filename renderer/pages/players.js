import { state, isAdmin } from '../state.js';
import { esc, toast, modal } from '../utils.js';
// playerProfile.js imports the edit/delete/message entry points from here and
// this page opens profiles from its rows: a cycle, safe because every use is
// inside a function, never at module load.
import { openPlayerProfile } from './playerProfile.js';
import { openPhotoModal } from './playerPhoto.js';

// ===== PLAYERS PAGE =====
// Redesigned per design_handoff_players_page. Admin: search / filter / sort
// table, slide-over panel for edit, add (one · several · CSV import) and bulk
// edit, bulk bar, page-scoped toasts with undo. Player: a plain name list.
// The slide-over is page furniture (not the shared modal): backdrop clicks
// nudge instead of closing, and a dirty panel asks before discarding.

const AVATAR_PALETTE = ['#1e2758', '#3550c8', '#0f7b3f', '#9a5b12', '#6b21a8', '#b3261e', '#0e7490'];
const FIELD_ALIASES = {
  name: ['name', 'player', 'full name', 'player name'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'mobile', 'telephone', 'phone number'],
  member_number: ['member number', 'member #', 'member_number', 'membership number', 'member no'],
  club_locker_rating: ['rating', 'club locker rating', 'club_locker_rating', 'cl rating'],
  is_member: ['member', 'is_member', 'club member', 'membership'],
  exclude_from_ladder: ['exclude from ladder', 'exclude_from_ladder', 'excluded', 'ladder excluded'],
  is_tester: ['tester', 'is_tester'],
};
const FILTER_GROUPS = [
  { label: 'Membership', key: 'member', options: [['yes', 'Club members'], ['no', 'Non-members']] },
  { label: 'Account', key: 'account', options: [['verified', 'Verified'], ['pending', 'Invited, not activated'], ['none', 'No account']] },
  { label: 'Ladder', key: 'ladder', options: [['in', 'On the ladder'], ['out', 'Excluded']] },
  { label: 'Missing data', key: 'data', options: [['noemail', 'No email'], ['norating', 'No rating'], ['nonumber', 'No member number']] },
  { label: 'Other', key: 'data', options: [['tester', 'Tester accounts']] },
];
const DELETE_BODY = 'Their match history stays on record but they are removed from the club list, ladder and all future scheduling. This cannot be undone.';

const pl = {
  query: '',
  filters: [],
  sort: { key: 'name', dir: 1 },
  selected: new Set(),
  ioOpen: false,
  filterOpen: false,
};

// The open slide-over panel, or null. Holds everything the panel needs so a
// row click from the profile page can open it too.
let _panel = null;

function _wrapper() {
  return document.querySelector('.main-wrapper') || document.body;
}

const _initials = (n) => String(n || '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

function _plAvatarHTML(p, size) {
  if (p.photo_path) {
    return `<span class="pl-avatar" style="width:${size}px;height:${size}px"><img src="${esc(p.photo_path)}" alt=""></span>`;
  }
  const bg = AVATAR_PALETTE[(p.id || 0) % AVATAR_PALETTE.length];
  const fs = size >= 50 ? 20 : 13;
  return `<span class="pl-avatar" style="width:${size}px;height:${size}px;background:${bg};font-size:${fs}px">${esc(_initials(p.name))}</span>`;
}

function _acct(p) {
  if (p.account_status === 'verified') return { cls: 'pl-badge--blue', text: 'Verified' };
  if (p.account_status === 'pending') return { cls: 'pl-badge--amber', text: 'Invited' };
  return { cls: 'pl-badge--grey', text: 'No account' };
}

// ---- search / filter / sort ----

function _matchesQuery(p, q) {
  return !q || [p.name, p.email, p.phone, p.member_number].some((v) => String(v || '').toLowerCase().includes(q));
}

function _test(p, k, v) {
  if (k === 'member') return v === 'yes' ? !!p.is_member : !p.is_member;
  if (k === 'account') return p.account_status === v;
  if (k === 'ladder') return v === 'in' ? !p.exclude_from_ladder : !!p.exclude_from_ladder;
  if (k === 'data') {
    return v === 'noemail' ? !p.email
      : v === 'norating' ? p.club_locker_rating == null
      : v === 'nonumber' ? !p.member_number
      : !!p.is_tester;
  }
  return true;
}

function _passes(p, filters) {
  const groups = {};
  filters.forEach((f) => { const [k, v] = f.split(':'); (groups[k] = groups[k] || []).push(v); });
  return Object.entries(groups).every(([k, vs]) => vs.some((v) => _test(p, k, v)));
}

function _filtered() {
  const q = pl.query.trim().toLowerCase();
  const { key, dir } = pl.sort;
  const acctRank = { verified: 0, pending: 1, none: 2 };
  const list = state.players.filter((p) => _matchesQuery(p, q) && _passes(p, pl.filters));
  return list.sort((a, b) => {
    let va, vb;
    if (key === 'rating') {
      // Null ratings sort last in either direction.
      const an = a.club_locker_rating == null, bn = b.club_locker_rating == null;
      if (an !== bn) return an ? 1 : -1;
      va = a.club_locker_rating; vb = b.club_locker_rating;
    } else if (key === 'member') { va = a.is_member ? 0 : 1; vb = b.is_member ? 0 : 1; } else if (key === 'account') { va = acctRank[a.account_status] ?? 2; vb = acctRank[b.account_status] ?? 2; } else {
      va = String(a[key] || '').toLowerCase(); vb = String(b[key] || '').toLowerCase();
      if (!va && vb) return 1;
      if (va && !vb) return -1;
    }
    return (va < vb ? -1 : va > vb ? 1 : a.name.localeCompare(b.name)) * dir;
  });
}

// ---- page toasts (dot + optional Undo, top-centre over the content) ----

function _plToast(text, kind = 'ok', undo = null) {
  let holder = document.getElementById('plToasts');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'plToasts';
    holder.className = 'pl-toasts';
    _wrapper().appendChild(holder);
  }
  const el = document.createElement('div');
  el.className = 'pl-toast';
  el.innerHTML = `<span class="pl-toast-dot pl-toast-dot--${kind}"></span><span>${esc(text)}</span>${undo ? '<button class="pl-toast-undo">Undo</button>' : ''}`;
  holder.appendChild(el);
  const remove = () => { el.remove(); if (!holder.children.length) holder.remove(); };
  const t = setTimeout(remove, undo ? 6000 : 3200);
  if (undo) {
    el.querySelector('.pl-toast-undo').addEventListener('click', () => {
      clearTimeout(t);
      remove();
      undo();
    });
  }
}

// ---- confirm dialog (over the panel, never a second shared modal) ----

function _plConfirm({ title, body, okLabel = 'OK', cancelLabel = 'Cancel', danger = false, onOk }) {
  document.getElementById('plConfirm')?.remove();
  const layer = document.createElement('div');
  layer.id = 'plConfirm';
  layer.className = 'pl-confirm';
  layer.innerHTML = `
    <div class="pl-confirm-card">
      <h3 class="pl-confirm-title">${esc(title)}</h3>
      <p class="pl-confirm-body">${esc(body)}</p>
      <div class="pl-confirm-btns">
        <button class="btn btn-outline" id="plConfirmCancel">${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="plConfirmOk">${esc(okLabel)}</button>
      </div>
    </div>`;
  _wrapper().appendChild(layer);
  document.getElementById('plConfirmCancel').addEventListener('click', () => layer.remove());
  document.getElementById('plConfirmOk').addEventListener('click', () => { layer.remove(); onOk(); });
}

// One page-level key handler: confirm closes first, then the panel (through
// its discard guard), then any open menu.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const confirm = document.getElementById('plConfirm');
  if (confirm) { confirm.remove(); return; }
  if (_panel) { _panelRequestClose(); return; }
  if (pl.ioOpen || pl.filterOpen) { pl.ioOpen = false; pl.filterOpen = false; _renderMenus(); }
});
document.addEventListener('click', (e) => {
  if (!pl.ioOpen && !pl.filterOpen) return;
  if (e.target.closest('[data-menu-root]')) return;
  pl.ioOpen = false;
  pl.filterOpen = false;
  _renderMenus();
});

// ===== THE PAGE =====

export async function renderPlayers() {
  state.players = await window.api.getPlayers();
  pl.selected.clear();
  pl.ioOpen = false;
  pl.filterOpen = false;

  const content = document.getElementById('mainContent');
  document.getElementById('topbarActions').innerHTML = '';

  if (!isAdmin()) {
    document.getElementById('pageTitle').textContent = 'Players';
    content.innerHTML = `
      <div class="pl-public">
        <div class="pl-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input id="plPublicSearch" placeholder="Find a player" autocomplete="off">
        </div>
        <div class="pl-public-card" id="plPublicList"></div>
      </div>`;
    const renderList = () => {
      const q = (document.getElementById('plPublicSearch')?.value || '').trim().toLowerCase();
      const rows = state.players.filter((p) => !q || p.name.toLowerCase().includes(q));
      document.getElementById('plPublicList').innerHTML = rows.map((p) => `
        <div class="pl-public-row" data-id="${p.id}">
          ${_plAvatarHTML(p, 34)}
          <span class="pl-public-name">${esc(p.name)}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
        </div>`).join('') || '<div class="pl-empty"><span class="pl-empty-t">No players match</span></div>';
    };
    renderList();
    document.getElementById('plPublicSearch').addEventListener('input', renderList);
    document.getElementById('plPublicList').addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (id) openPlayerProfile(Number(id));
    });
    return;
  }

  // --- admin ---
  content.classList.add('content--flush');
  _renderPageTitle();
  document.getElementById('topbarActions').innerHTML = `
    <span class="pl-io-anchor" data-menu-root>
      <button class="btn btn-secondary" id="plIoBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>
        Import / Export
        <svg class="pl-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <span id="plIoMenu"></span>
    </span>
    <button class="btn btn-primary" id="plAddBtn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
      Add players
    </button>`;

  content.innerHTML = `
    <div class="pl-page">
      <div class="pl-toolbar">
        <div class="pl-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input id="plSearch" placeholder="Search name, email, phone or member #" autocomplete="off">
          <button id="plSearchClear" class="pl-search-x" hidden aria-label="Clear">&#10005;</button>
        </div>
        <span class="pl-filter-anchor" data-menu-root>
          <button class="pl-filter-btn" id="plFilterBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h18M6 12h12M10 19h4"/></svg>
            Filter
            <span class="pl-filter-count" id="plFilterCount" hidden></span>
          </button>
          <span id="plFilterMenu"></span>
        </span>
        <span class="pl-chips" id="plChips"></span>
        <span class="pl-shown" id="plShown"></span>
      </div>
      <div class="pl-card">
        <div class="pl-grid pl-grid--head" id="plHead"></div>
        <div class="pl-body" id="plBody"></div>
      </div>
    </div>`;

  document.getElementById('plIoBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    pl.ioOpen = !pl.ioOpen;
    pl.filterOpen = false;
    _renderMenus();
  });
  document.getElementById('plAddBtn').addEventListener('click', () => _openPanel('add'));
  document.getElementById('plFilterBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    pl.filterOpen = !pl.filterOpen;
    pl.ioOpen = false;
    _renderMenus();
  });

  const search = document.getElementById('plSearch');
  search.addEventListener('input', () => {
    pl.query = search.value;
    document.getElementById('plSearchClear').hidden = !pl.query;
    _renderTable();
    if (pl.filterOpen) _renderMenus(); // filter counts follow the search
  });
  document.getElementById('plSearchClear').addEventListener('click', () => {
    pl.query = '';
    search.value = '';
    document.getElementById('plSearchClear').hidden = true;
    _renderTable();
  });

  _renderTable();
}

function _renderPageTitle() {
  const members = state.players.filter((p) => p.is_member).length;
  const noAcct = state.players.filter((p) => p.account_status === 'none').length;
  document.getElementById('pageTitle').innerHTML =
    `Players <span class="pl-sum">${state.players.length} players &middot; ${members} members &middot; ${noAcct} without accounts</span>`;
}

function _renderMenus() {
  const io = document.getElementById('plIoMenu');
  if (io) {
    io.innerHTML = !pl.ioOpen ? '' : `
      <div class="pl-menu pl-menu--io">
        <span class="pl-menu-label">Export CSV &middot; all fields</span>
        <button class="pl-menu-row" data-io="all"><span>All players</span><span>${state.players.length}</span></button>
        <button class="pl-menu-row" data-io="view"><span>Current view</span><span>${_filtered().length}</span></button>
        <button class="pl-menu-row" data-io="selected" ${pl.selected.size ? '' : 'disabled'}><span>Selected</span><span>${pl.selected.size}</span></button>
        <div class="pl-menu-rule"></div>
        <button class="pl-menu-row" data-io="import">
          <span class="pl-menu-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15V3M8 7l4-4 4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>Import from CSV&hellip;</span>
        </button>
      </div>`;
    io.querySelectorAll('[data-io]').forEach((b) => b.addEventListener('click', () => {
      pl.ioOpen = false;
      _renderMenus();
      const kind = b.dataset.io;
      if (kind === 'import') return _openPanel('add', { tab: 'import' });
      const list = kind === 'all' ? state.players : kind === 'view' ? _filtered() : state.players.filter((p) => pl.selected.has(p.id));
      _exportCsv(list, kind === 'all' ? 'all' : kind === 'view' ? 'view' : 'selected');
    }));
  }

  const fm = document.getElementById('plFilterMenu');
  if (fm) {
    if (!pl.filterOpen) { fm.innerHTML = ''; } else {
      const q = pl.query.trim().toLowerCase();
      const base = state.players.filter((p) => _matchesQuery(p, q));
      const countFor = (k, v) => base.filter((p) => _passes(p, pl.filters.filter((f) => !f.startsWith(k + ':'))) && _test(p, k, v)).length;
      fm.innerHTML = `
        <div class="pl-menu pl-menu--filter">
          ${FILTER_GROUPS.map((g) => `
            <div class="pl-fgroup">
              <span class="pl-menu-label">${g.label}</span>
              ${g.options.map(([v, l]) => {
                const id = `${g.key}:${v}`;
                return `<label class="pl-frow"><input type="checkbox" data-filter="${id}" ${pl.filters.includes(id) ? 'checked' : ''}><span>${l}</span><span class="pl-frow-n">${countFor(g.key, v)}</span></label>`;
              }).join('')}
            </div>`).join('')}
          <div class="pl-menu-foot">
            <button class="pl-link" id="plFilterClear">Clear all</button>
            <button class="btn btn-primary btn-sm" id="plFilterDone">Done</button>
          </div>
        </div>`;
      fm.querySelectorAll('[data-filter]').forEach((cb) => cb.addEventListener('change', () => {
        const id = cb.dataset.filter;
        pl.filters = pl.filters.includes(id) ? pl.filters.filter((f) => f !== id) : [...pl.filters, id];
        _renderTable();
        _renderMenus();
      }));
      document.getElementById('plFilterClear').addEventListener('click', () => { pl.filters = []; _renderTable(); _renderMenus(); });
      document.getElementById('plFilterDone').addEventListener('click', () => { pl.filterOpen = false; _renderMenus(); });
    }
  }

  const btn = document.getElementById('plFilterBtn');
  if (btn) {
    btn.classList.toggle('pl-filter-btn--on', pl.filters.length > 0);
    const count = document.getElementById('plFilterCount');
    count.hidden = !pl.filters.length;
    count.textContent = pl.filters.length;
  }
}

function _renderTable() {
  const head = document.getElementById('plHead');
  const body = document.getElementById('plBody');
  if (!head || !body) return;
  const shown = _filtered();
  const shownIds = shown.map((p) => p.id);

  const th = (key, label) => `
    <button class="pl-th" data-sort="${key}">${label}
      <svg class="pl-th-arrow${pl.sort.key === key ? ' pl-th-arrow--on' : ''}${pl.sort.key === key && pl.sort.dir === -1 ? ' pl-th-arrow--desc' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>
    </button>`;
  head.innerHTML = `
    <span class="pl-cell-check"><input type="checkbox" id="plSelectAll" title="Select all in view" ${shownIds.length && shownIds.every((id) => pl.selected.has(id)) ? 'checked' : ''}></span>
    ${th('name', 'Player')}${th('email', 'Email')}
    <span class="pl-th-plain">Phone</span>
    ${th('rating', 'Rating')}${th('member', 'Membership')}${th('account', 'Account')}
    <span class="pl-th-plain">Ladder</span><span></span>`;

  body.innerHTML = shown.length === 0
    ? `<div class="pl-empty">
        <span class="pl-empty-t">No players match</span>
        <span class="pl-empty-s">Try a different search or clear some filters.</span>
        <button class="btn btn-outline" id="plClearAll">Clear search and filters</button>
      </div>`
    : shown.map((p) => {
      const a = _acct(p);
      return `
        <div class="pl-grid pl-row${pl.selected.has(p.id) ? ' pl-row--sel' : ''}" data-id="${p.id}">
          <span class="pl-cell-check" data-stop><input type="checkbox" data-check="${p.id}" ${pl.selected.has(p.id) ? 'checked' : ''}></span>
          <span class="pl-cell-player">
            ${_plAvatarHTML(p, 34)}
            <span class="pl-namewrap">
              <span class="pl-nameline"><span class="pl-name">${esc(p.name)}</span>${p.is_tester ? '<span class="pl-testtag" title="Tester account">TEST</span>' : ''}</span>
              <span class="pl-memberline">${p.member_number ? `Member #${esc(p.member_number)}` : 'No member number'}</span>
            </span>
          </span>
          <span class="pl-cell ${p.email ? '' : 'pl-cell--faint'}">${esc(p.email || 'No email')}</span>
          <span class="pl-cell ${p.phone ? '' : 'pl-cell--faint'}">${esc(p.phone || '—')}</span>
          <span class="pl-cell pl-cell-num ${p.club_locker_rating == null ? 'pl-cell--faint' : ''}">${p.club_locker_rating == null ? '—' : Number(p.club_locker_rating).toFixed(2)}</span>
          <span class="pl-cell pl-cell--badge"><span class="pl-badge ${p.is_member ? 'pl-badge--green' : 'pl-badge--grey'}">${p.is_member ? 'Member' : 'Non-member'}</span></span>
          <span class="pl-cell pl-cell--badge"><span class="pl-badge ${a.cls}">${a.text}</span></span>
          <span class="pl-cell pl-cell-ladder${p.exclude_from_ladder ? ' pl-cell-ladder--out' : ''}">${p.exclude_from_ladder ? 'Excluded' : 'On ladder'}</span>
          <span class="pl-cell-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></span>
        </div>`;
    }).join('');

  const shownEl = document.getElementById('plShown');
  if (shownEl) shownEl.textContent = shown.length === state.players.length ? `All ${shown.length}` : `${shown.length} of ${state.players.length}`;
  _renderChips();
  _renderBulkBar();

  head.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.sort;
    pl.sort = { key, dir: pl.sort.key === key ? -pl.sort.dir : 1 };
    _renderTable();
  }));
  document.getElementById('plSelectAll')?.addEventListener('change', () => {
    const all = shownIds.every((id) => pl.selected.has(id));
    shownIds.forEach((id) => { if (all) pl.selected.delete(id); else pl.selected.add(id); });
    _renderTable();
  });
  body.querySelectorAll('[data-check]').forEach((cb) => cb.addEventListener('change', () => {
    const id = Number(cb.dataset.check);
    if (pl.selected.has(id)) pl.selected.delete(id); else pl.selected.add(id);
    _renderTable();
  }));
  body.querySelectorAll('[data-stop]').forEach((el) => el.addEventListener('click', (e) => e.stopPropagation()));
  // Row-open is delegated once — the body element survives re-renders, so a
  // listener per render would stack up.
  if (!body.dataset.wired) {
    body.dataset.wired = '1';
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop]')) return;
      const id = e.target.closest('.pl-row')?.dataset.id;
      if (!id) return;
      const p = state.players.find((x) => x.id === Number(id));
      if (p) _openPanel('edit', { player: p });
    });
  }
  document.getElementById('plClearAll')?.addEventListener('click', () => {
    pl.query = '';
    pl.filters = [];
    const s = document.getElementById('plSearch');
    if (s) { s.value = ''; document.getElementById('plSearchClear').hidden = true; }
    _renderTable();
  });
}

function _renderChips() {
  const holder = document.getElementById('plChips');
  if (!holder) return;
  const labelFor = {};
  FILTER_GROUPS.forEach((g) => g.options.forEach(([v, l]) => { labelFor[`${g.key}:${v}`] = l; }));
  holder.innerHTML = pl.filters.map((id) => `
    <span class="pl-chip">${labelFor[id]}<button data-chip="${id}" aria-label="Remove filter">&#10005;</button></span>`).join('');
  holder.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
    pl.filters = pl.filters.filter((f) => f !== b.dataset.chip);
    _renderTable();
    if (pl.filterOpen) _renderMenus();
  }));
}

// ---- bulk bar ----

function _renderBulkBar() {
  document.getElementById('plBulkBar')?.remove();
  if (!pl.selected.size || state.page !== 'players') return;
  const bar = document.createElement('div');
  bar.id = 'plBulkBar';
  bar.className = 'pl-bulkbar';
  bar.innerHTML = `
    <span class="pl-bulkbar-n">${pl.selected.size} selected</span>
    <span class="pl-bulkbar-rule"></span>
    <button class="pl-bulkbar-btn" id="plBulkInvite">Send invites</button>
    <button class="pl-bulkbar-btn pl-bulkbar-btn--accent" id="plBulkEdit">Edit fields&hellip;</button>
    <button class="pl-bulkbar-ic pl-bulkbar-ic--danger" id="plBulkDelete" title="Delete selected">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
    </button>
    <button class="pl-bulkbar-ic" id="plBulkClear" title="Clear selection">&#10005;</button>`;
  _wrapper().appendChild(bar);

  document.getElementById('plBulkClear').addEventListener('click', () => { pl.selected.clear(); _renderTable(); });
  document.getElementById('plBulkEdit').addEventListener('click', () => _openPanel('bulk'));
  document.getElementById('plBulkDelete').addEventListener('click', () => {
    const ids = [...pl.selected];
    _plConfirm({
      title: `Delete ${ids.length} player${ids.length === 1 ? '' : 's'}?`,
      body: DELETE_BODY,
      okLabel: 'Delete',
      danger: true,
      onOk: async () => {
        let failed = 0;
        for (const id of ids) {
          try { await window.api.deletePlayer(id); } catch (_) { failed++; }
        }
        pl.selected.clear();
        await _refreshPlayers();
        _plToast(failed ? `Deleted ${ids.length - failed}, ${failed} failed` : `${ids.length} player${ids.length === 1 ? '' : 's'} deleted`, failed ? 'err' : 'ok');
      },
    });
  });
  document.getElementById('plBulkInvite').addEventListener('click', async () => {
    const ids = [...pl.selected];
    try {
      const { sent, skipped, failed } = await window.api.bulkSendInvites({ ids });
      pl.selected.clear();
      await _refreshPlayers();
      let msg = `${sent} invite${sent === 1 ? '' : 's'} sent`;
      if (skipped) msg += ` · ${skipped} skipped (no email or already verified)`;
      if (failed) msg += ` · ${failed} failed`;
      _plToast(msg, failed ? 'err' : skipped ? 'warn' : 'ok');
    } catch (e) {
      _plToast(e.message || 'Could not send invites.', 'err');
    }
  });
}

async function _refreshPlayers() {
  state.players = await window.api.getPlayers();
  if (state.page === 'players' && isAdmin()) {
    _renderPageTitle();
    _renderTable();
  }
}

// ---- CSV ----

function _csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function _download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function _exportCsv(list, label) {
  const head = ['name', 'email', 'phone', 'member_number', 'club_locker_rating', 'is_member', 'exclude_from_ladder', 'is_tester', 'account_status'];
  const body = list.map((p) => [
    p.name, p.email, p.phone, p.member_number, p.club_locker_rating ?? '',
    p.is_member ? 'yes' : 'no', p.exclude_from_ladder ? 'yes' : 'no', p.is_tester ? 'yes' : 'no', p.account_status,
  ].map(_csvEscape).join(','));
  _download(`wsrc-players-${label}.csv`, [head.join(','), ...body].join('\n'));
  _plToast(`Exported ${list.length} player${list.length === 1 ? '' : 's'}`);
}

function _parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const _yes = (v) => /^(y|yes|true|1|member)$/i.test(String(v).trim());

function _importPlan(imp) {
  if (!imp) return null;
  const idx = {};
  imp.mapping.forEach((f, i) => { if (f) idx[f] = i; });
  const byEmail = new Map(state.players.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p]));
  const byName = new Map(state.players.map((p) => [p.name.toLowerCase(), p]));
  const items = imp.data.map((r) => {
    const get = (f) => (idx[f] == null ? undefined : String(r[idx[f]] || '').trim());
    const name = get('name') || '';
    if (!name) return { kind: 'bad', name: '(blank)', detail: 'No name', fields: {} };
    const fields = { name };
    ['email', 'phone', 'member_number'].forEach((f) => { const v = get(f); if (v) fields[f] = v; });
    const rating = get('club_locker_rating');
    if (rating) fields.club_locker_rating = parseFloat(rating);
    ['is_member', 'exclude_from_ladder', 'is_tester'].forEach((f) => { const v = get(f); if (v) fields[f] = _yes(v); });
    const existing = (fields.email && byEmail.get(fields.email.toLowerCase())) || byName.get(name.toLowerCase());
    return {
      kind: existing ? 'dupe' : 'new', existing, fields, name,
      detail: [fields.email, fields.member_number && `#${fields.member_number}`].filter(Boolean).join(' · ') || (existing ? `matches ${existing.name}` : '—'),
    };
  });
  return {
    items,
    noName: idx.name == null,
    newCount: items.filter((i) => i.kind === 'new').length,
    dupeCount: items.filter((i) => i.kind === 'dupe').length,
    badCount: items.filter((i) => i.kind === 'bad').length,
  };
}

// ===== SLIDE-OVER PANEL =====

const _blankDraft = () => ({ name: '', email: '', phone: '', member_number: '', club_locker_rating: '', is_member: true, exclude_from_ladder: false, is_tester: false });

function _formFor(p = {}) {
  return {
    name: p.name || '', email: p.email || '', phone: p.phone || '',
    member_number: p.member_number || '',
    club_locker_rating: p.club_locker_rating ?? '',
    is_member: !!p.is_member, exclude_from_ladder: !!p.exclude_from_ladder, is_tester: !!p.is_tester,
  };
}

function _payload(f) {
  return {
    name: String(f.name).trim(),
    email: String(f.email).trim(),
    phone: String(f.phone).trim(),
    member_number: String(f.member_number).trim(),
    club_locker_rating: f.club_locker_rating === '' || f.club_locker_rating == null ? null : parseFloat(f.club_locker_rating),
    is_member: !!f.is_member,
    exclude_from_ladder: !!f.exclude_from_ladder,
    is_tester: !!f.is_tester,
  };
}

function _validateEmail(email, excludeId) {
  if (!email) return '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'That doesn’t look like an email address.';
  const dup = state.players.find((p) => p.id !== excludeId && String(p.email || '').toLowerCase() === email.toLowerCase());
  return dup ? `Already used by ${dup.name}.` : '';
}

function _openPanel(mode, opts = {}) {
  _closePanel(true);
  pl.ioOpen = false;
  pl.filterOpen = false;
  _renderMenus();
  _panel = {
    mode,
    player: opts.player || null,
    tab: opts.tab || 'one',
    dirty: false,
    form: _formFor(mode === 'edit' ? opts.player : _blankDraft()),
    drafts: Array.from({ length: 5 }, _blankDraft),
    pasteOpen: false,
    imp: null,
    bulk: mode === 'bulk' ? {
      mode: 'all',
      fields: { is_member: { on: false, value: '1' }, exclude_from_ladder: { on: false, value: '0' }, is_tester: { on: false, value: '0' }, club_locker_rating: { on: false, value: '' } },
      rows: state.players.filter((p) => pl.selected.has(p.id)).map((p) => ({ id: p.id, ..._formFor(p), changed: false })),
    } : null,
  };
  const wrap = _wrapper();
  const scrim = document.createElement('div');
  scrim.id = 'plScrim';
  scrim.className = 'pl-scrim';
  scrim.addEventListener('click', () => {
    const aside = document.getElementById('plPanel');
    if (!aside) return;
    aside.classList.remove('pl-panel--nudge');
    void aside.offsetWidth;
    aside.classList.add('pl-panel--nudge');
    setTimeout(() => aside.classList.remove('pl-panel--nudge'), 150);
  });
  const aside = document.createElement('aside');
  aside.id = 'plPanel';
  aside.className = 'pl-panel';
  wrap.appendChild(scrim);
  wrap.appendChild(aside);
  _renderPanel();
}

function _closePanel(silent = false) {
  document.getElementById('plScrim')?.remove();
  document.getElementById('plPanel')?.remove();
  _panel = null;
  if (!silent) _renderBulkBar();
}

function _panelRequestClose() {
  if (!_panel) return;
  if (!_panel.dirty) return _closePanel();
  _plConfirm({
    title: 'Discard changes?',
    body: 'You have unsaved edits in this panel. Closing will throw them away.',
    okLabel: 'Discard',
    cancelLabel: 'Keep editing',
    danger: true,
    onOk: () => _closePanel(),
  });
}

function _setDirty() {
  if (!_panel || _panel.dirty) { _updatePanelFooter(); return; }
  _panel.dirty = true;
  _updatePanelFooter();
}

function _updatePanelFooter() {
  if (!_panel) return;
  const note = document.getElementById('plPanelNote');
  if (note && _panel.mode === 'edit') note.textContent = _panel.dirty ? 'Unsaved changes' : '';
  const primary = document.getElementById('plPanelPrimary');
  if (!primary) return;
  if (_panel.mode === 'edit') primary.disabled = !_panel.dirty;
  if (_panel.mode === 'add' && _panel.tab === 'several') {
    const n = _panel.drafts.filter((d) => d.name.trim()).length;
    primary.disabled = !n;
    primary.textContent = n ? `Add ${n} player${n === 1 ? '' : 's'}` : 'Add players';
    const sum = document.getElementById('plDraftSummary');
    if (sum) sum.textContent = n ? `${n} ready to add` : 'Nothing to add yet';
  }
  if (_panel.mode === 'bulk' && _panel.bulk) {
    primary.disabled = _panel.bulk.mode === 'all'
      ? !Object.values(_panel.bulk.fields).some((f) => f.on)
      : !_panel.bulk.rows.some((r) => r.changed);
  }
}

function _panelChrome() {
  const p = _panel;
  let title, sub, primaryLabel, wide = false;
  if (p.mode === 'edit') {
    title = p.player.name;
    const year = String(p.player.created_at || '').slice(0, 4);
    sub = year ? `Player since ${year}` : '';
    primaryLabel = 'Save changes';
  } else if (p.mode === 'add') {
    title = 'Add players';
    sub = p.tab === 'one' ? 'Every field the profile has; only the name is required.'
      : p.tab === 'several' ? 'Type or paste a batch. Everyone is added at once.'
      : 'Bring in a list from a spreadsheet or another system.';
    primaryLabel = p.tab === 'one' ? 'Add player' : p.tab === 'several' ? 'Add players' : 'Import';
    wide = p.tab !== 'one';
  } else {
    title = `Edit ${pl.selected.size} players`;
    sub = p.bulk.mode === 'all' ? 'Apply one change to everyone selected.' : 'Change each player separately.';
    primaryLabel = p.bulk.mode === 'all' ? 'Apply to all' : 'Save changes';
    wide = true;
  }
  return { title, sub, primaryLabel, wide };
}

function _renderPanel() {
  const aside = document.getElementById('plPanel');
  if (!aside || !_panel) return;
  const p = _panel;
  const { title, sub, primaryLabel, wide } = _panelChrome();
  aside.classList.toggle('pl-panel--wide', wide);

  let bodyHTML = '';
  if (p.mode === 'edit' || (p.mode === 'add' && p.tab === 'one')) bodyHTML = _formHTML();
  else if (p.mode === 'add' && p.tab === 'several') bodyHTML = _draftsHTML();
  else if (p.mode === 'add' && p.tab === 'import') bodyHTML = _importHTML();
  else if (p.mode === 'bulk') bodyHTML = _bulkHTML();

  aside.innerHTML = `
    <div class="pl-panel-head">
      <div>
        <h2 class="pl-panel-title">${esc(title)}</h2>
        <span class="pl-panel-sub">${esc(sub)}</span>
      </div>
      <button class="pl-panel-x" id="plPanelX" title="Close (Esc)">&#10005;</button>
    </div>
    ${p.mode === 'add' ? `
      <div class="pl-tabs">
        ${[['one', 'One player'], ['several', 'Several'], ['import', 'Import CSV']].map(([k, l]) =>
          `<button class="pl-tab${p.tab === k ? ' pl-tab--on' : ''}" data-tab="${k}">${l}</button>`).join('')}
      </div>` : ''}
    <div class="pl-panel-body">${bodyHTML}</div>
    <div class="pl-panel-foot">
      ${p.mode === 'edit' ? '<button class="pl-panel-del" id="plPanelDelete">Delete player</button>' : ''}
      <span class="pl-panel-note" id="plPanelNote"></span>
      <button class="btn btn-outline" id="plPanelCancel">Cancel</button>
      ${p.mode === 'add' && p.tab === 'one' ? '<button class="btn btn-outline pl-panel-another" id="plPanelAnother">Save &amp; add another</button>' : ''}
      <button class="btn btn-primary" id="plPanelPrimary">${primaryLabel}</button>
    </div>`;

  document.getElementById('plPanelX').addEventListener('click', _panelRequestClose);
  document.getElementById('plPanelCancel').addEventListener('click', _panelRequestClose);
  document.getElementById('plPanelPrimary').addEventListener('click', () => _panelPrimary(false));
  document.getElementById('plPanelAnother')?.addEventListener('click', () => _panelPrimary(true));
  document.getElementById('plPanelDelete')?.addEventListener('click', () => {
    const player = p.player;
    _plConfirm({
      title: `Delete ${player.name}?`,
      body: DELETE_BODY,
      okLabel: 'Delete',
      danger: true,
      onOk: async () => {
        await window.api.deletePlayer(player.id);
        _closePanel();
        pl.selected.delete(player.id);
        if (state.page === 'playerProfile') window.navigate('players');
        else await _refreshPlayers();
        _plToast(`${player.name} deleted`);
      },
    });
  });
  aside.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    p.tab = b.dataset.tab;
    _renderPanel();
  }));

  if (p.mode === 'edit' || (p.mode === 'add' && p.tab === 'one')) _wireForm();
  else if (p.mode === 'add' && p.tab === 'several') _wireDrafts();
  else if (p.mode === 'add' && p.tab === 'import') _wireImport();
  else if (p.mode === 'bulk') _wireBulk();
  _updatePanelFooter();
}

// --- edit / add-one form ---

function _formHTML() {
  const p = _panel;
  const f = p.form;
  const isEdit = p.mode === 'edit';
  let acct = null;
  if (isEdit) {
    const a = _acct(p.player);
    const status = p.player.account_status;
    acct = {
      badge: `<span class="pl-badge ${a.cls}">${a.text}</span>`,
      hint: status === 'verified' ? 'Has signed in and set a password.'
        : status === 'pending' ? 'Invite sent; link expires after 72 hours.'
        : p.player.email ? 'No account yet. Send an invite so they can sign in.'
        : 'Needs an email before an invite can be sent.',
      action: status === 'verified' ? 'Send password reset' : status === 'pending' ? 'Resend invite' : p.player.email ? 'Send invite' : '',
    };
  }
  return `
    <div class="pl-form">
      ${isEdit ? `
        <div class="pl-photo">
          ${_plAvatarHTML({ ...p.player, name: f.name }, 56)}
          <div class="pl-photo-side">
            <span>Profile photo</span>
            <div>
              <button class="pl-btn-sm" id="plPhotoUpload">Upload&hellip;</button>
              <button class="pl-btn-text" id="plPhotoRemove">Remove</button>
            </div>
          </div>
        </div>` : ''}
      <div class="pl-fgrid">
        <label class="pl-field pl-field--full"><span>Full name <em>*</em></span>
          <input data-f="name" value="${esc(f.name)}" autofocus>
          <span class="pl-field-err" id="plErrName" hidden>Name is required.</span>
        </label>
        <label class="pl-field"><span>Email</span>
          <input data-f="email" type="email" value="${esc(f.email)}">
          <span class="pl-field-err" id="plErrEmail" hidden></span>
        </label>
        <label class="pl-field"><span>Phone</span>
          <input data-f="phone" value="${esc(f.phone)}">
        </label>
        <label class="pl-field"><span>Member number</span>
          <input data-f="member_number" value="${esc(f.member_number)}">
        </label>
        <label class="pl-field"><span>Club Locker rating</span>
          <input data-f="club_locker_rating" type="number" step="0.01" min="0" value="${esc(String(f.club_locker_rating))}">
        </label>
      </div>
      <div class="pl-toggles">
        ${[
          ['is_member', 'Club member', 'Can book courts and see member-only events.'],
          ['exclude_from_ladder', 'Exclude from ladder', 'Still plays leagues; not ranked on the club ladder.'],
          ['is_tester', 'Tester account', 'Gets new features early, to try them out.'],
        ].map(([k, t, hint]) => `
          <label class="pl-toggle">
            <input type="checkbox" data-f="${k}" ${f[k] ? 'checked' : ''}>
            <span><span class="pl-toggle-t">${t}</span><span class="pl-toggle-h">${hint}</span></span>
          </label>`).join('')}
      </div>
      ${acct ? `
        <div class="pl-acct">
          <span class="pl-acct-label">Account</span>
          <div class="pl-acct-row">
            ${acct.badge}
            <span class="pl-acct-hint">${acct.hint}</span>
            ${acct.action ? `<button class="pl-btn-sm" id="plAcctAction">${acct.action}</button>` : ''}
          </div>
          <div class="pl-acct-links">
            <button class="pl-btn-sm" id="plViewProfile">View profile</button>
            <button class="pl-btn-sm" id="plViewAs">View as this player</button>
          </div>
        </div>` : ''}
    </div>`;
}

function _wireForm() {
  const p = _panel;
  const body = document.querySelector('.pl-panel-body');
  body.querySelectorAll('input[data-f]').forEach((input) => {
    const key = input.dataset.f;
    const isCheck = input.type === 'checkbox';
    input.addEventListener(isCheck ? 'change' : 'input', () => {
      p.form[key] = isCheck ? input.checked : input.value;
      if (key === 'name') {
        document.getElementById('plErrName').hidden = !!input.value.trim();
        input.classList.toggle('pl-input--err', !input.value.trim());
      }
      if (key === 'email') {
        const err = _validateEmail(input.value.trim(), p.player?.id);
        const el = document.getElementById('plErrEmail');
        el.hidden = !err;
        el.textContent = err;
        input.classList.toggle('pl-input--err', !!err);
      }
      _setDirty();
    });
  });

  document.getElementById('plPhotoUpload')?.addEventListener('click', () => openPhotoModal(p.player));
  document.getElementById('plPhotoRemove')?.addEventListener('click', async () => {
    try {
      await window.api.deletePlayerPhoto(p.player.id);
      p.player.photo_path = null;
      _plToast('Photo removed');
      _renderPanel();
      await _refreshPlayers();
    } catch (e) { _plToast(e.message || 'Could not remove the photo.', 'err'); }
  });
  document.getElementById('plViewProfile')?.addEventListener('click', () => {
    _closePanel();
    openPlayerProfile(p.player.id);
  });
  document.getElementById('plViewAs')?.addEventListener('click', async () => {
    try {
      await window.api.viewAsPlayer(p.player.id);
      location.href = '/';
    } catch (e) { _plToast(e.message || 'Could not view as that player.', 'err'); }
  });
  document.getElementById('plAcctAction')?.addEventListener('click', async () => {
    const player = p.player;
    try {
      if (player.account_status === 'verified') {
        const result = await window.api.sendReset(player.id);
        if (result.emailSent) _plToast(`Password reset sent to ${player.email}`);
        else showAuthLinkModal('Password Reset Link', result.resetUrl);
      } else {
        const result = await window.api.sendInvite(player.id);
        if (result.emailSent) _plToast(`Invite sent to ${player.email}`);
        else showAuthLinkModal('Invite Link', result.inviteUrl);
        await _refreshPlayers();
        p.player = state.players.find((x) => x.id === player.id) || player;
        _renderPanel();
      }
    } catch (e) { _plToast(e.message || 'Could not send the email.', 'err'); }
  });
}

async function _saveForm(another) {
  const p = _panel;
  const f = p.form;
  const emailError = _validateEmail(String(f.email).trim(), p.player?.id);
  if (!String(f.name).trim() || emailError) {
    document.getElementById('plErrName').hidden = !!String(f.name).trim();
    const el = document.getElementById('plErrEmail');
    el.hidden = !emailError;
    el.textContent = emailError;
    return;
  }
  const data = _payload(f);
  try {
    if (p.mode === 'edit') {
      await window.api.updatePlayer({ id: p.player.id, ...data });
      _closePanel();
      _plToast(`${data.name} updated`);
      if (state.page === 'playerProfile') await openPlayerProfile(p.player.id, { pushHistory: false });
      else await _refreshPlayers();
      if (state.page !== 'players') state.players = await window.api.getPlayers();
    } else {
      await window.api.addPlayer(data);
      _plToast(`${data.name} added`);
      if (another) {
        state.players = await window.api.getPlayers();
        p.form = _formFor(_blankDraft());
        p.dirty = false;
        _renderPanel();
        if (state.page === 'players') { _renderPageTitle(); _renderTable(); }
      } else {
        _closePanel();
        await _refreshPlayers();
      }
    }
  } catch (e) {
    _plToast(e.message || 'Could not save.', 'err');
  }
}

// --- add several ---

function _draftsHTML() {
  const p = _panel;
  return `
    <div class="pl-drafts">
      <div class="pl-drafts-top">
        <span class="pl-hint">One player per row. Rows without a name are ignored. Tab moves across, Enter adds a row.</span>
        <button class="pl-btn-sm" id="plPasteToggle">Paste from spreadsheet</button>
      </div>
      <div class="pl-pastebox" id="plPasteBox" ${p.pasteOpen ? '' : 'hidden'}>
        <span class="pl-hint">Columns in order: name, email, phone, member #, rating. Tab or comma separated.</span>
        <textarea id="plPasteText" rows="4" placeholder="One player per line: name, email, phone, member number, rating"></textarea>
        <div class="pl-pastebox-foot"><button class="btn btn-primary btn-sm" id="plPasteApply">Add to rows</button></div>
      </div>
      <div class="pl-dgrid-card">
        <div class="pl-dgrid pl-dgrid--head">
          <span></span><span>Name *</span><span>Email</span><span>Phone</span><span>Member #</span><span>Rating</span><span class="pl-dgrid-c">Member</span><span class="pl-dgrid-c">Excl.</span><span></span>
        </div>
        <div id="plDraftRows">${p.drafts.map((d, i) => _draftRowHTML(d, i)).join('')}</div>
      </div>
      <div class="pl-drafts-foot">
        <button class="pl-btn-sm" id="plAddRow">+ Add row</button>
        <span class="pl-hint" id="plDraftSummary">Nothing to add yet</span>
      </div>
    </div>`;
}

function _draftRowHTML(d, i) {
  return `
    <div class="pl-dgrid pl-dgrid--row" data-row="${i}">
      <span class="pl-dgrid-n">${i + 1}</span>
      <input data-d="name" data-i="${i}" value="${esc(d.name)}" placeholder="Name">
      <input data-d="email" data-i="${i}" value="${esc(d.email)}" placeholder="Email">
      <input data-d="phone" data-i="${i}" value="${esc(d.phone)}" placeholder="Phone">
      <input data-d="member_number" data-i="${i}" value="${esc(d.member_number)}" placeholder="#">
      <input data-d="club_locker_rating" data-i="${i}" type="number" step="0.01" value="${esc(String(d.club_locker_rating))}" placeholder="0.00">
      <span class="pl-dgrid-c"><input type="checkbox" data-d="is_member" data-i="${i}" ${d.is_member ? 'checked' : ''}></span>
      <span class="pl-dgrid-c"><input type="checkbox" data-d="exclude_from_ladder" data-i="${i}" ${d.exclude_from_ladder ? 'checked' : ''}></span>
      <button class="pl-dgrid-x" data-remove="${i}" title="Remove row">&#10005;</button>
    </div>`;
}

function _wireDrafts() {
  const p = _panel;
  const holder = document.getElementById('plDraftRows');

  const rerenderRows = () => {
    holder.innerHTML = p.drafts.map((d, i) => _draftRowHTML(d, i)).join('');
    wireRows();
    _updatePanelFooter();
  };
  const wireRows = () => {
    holder.querySelectorAll('input[data-d]').forEach((input) => {
      const i = Number(input.dataset.i);
      const key = input.dataset.d;
      const isCheck = input.type === 'checkbox';
      input.addEventListener(isCheck ? 'change' : 'input', () => {
        p.drafts[i][key] = isCheck ? input.checked : input.value;
        _setDirty();
      });
      if (!isCheck) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (i === p.drafts.length - 1) { p.drafts.push(_blankDraft()); rerenderRows(); }
          }
        });
      }
    });
    holder.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.remove);
      if (p.drafts.length > 1) p.drafts.splice(i, 1);
      else p.drafts[0] = _blankDraft();
      rerenderRows();
    }));
  };
  wireRows();

  document.getElementById('plAddRow').addEventListener('click', () => { p.drafts.push(_blankDraft()); rerenderRows(); });
  document.getElementById('plPasteToggle').addEventListener('click', () => {
    p.pasteOpen = !p.pasteOpen;
    document.getElementById('plPasteBox').hidden = !p.pasteOpen;
  });
  document.getElementById('plPasteApply').addEventListener('click', () => {
    const text = document.getElementById('plPasteText').value;
    const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const c = l.includes('\t') ? l.split('\t') : l.split(',');
      return { ..._blankDraft(), name: (c[0] || '').trim(), email: (c[1] || '').trim(), phone: (c[2] || '').trim(), member_number: (c[3] || '').trim(), club_locker_rating: (c[4] || '').trim() };
    });
    if (!rows.length) return;
    p.drafts = [...p.drafts.filter((d) => d.name.trim()), ...rows];
    p.pasteOpen = false;
    _setDirty();
    _renderPanel();
  });
}

async function _saveDrafts() {
  const p = _panel;
  const rows = p.drafts.filter((d) => d.name.trim());
  if (!rows.length) return _plToast('Enter at least one name', 'warn');
  const seen = new Set(state.players.map((x) => String(x.email || '').toLowerCase()).filter(Boolean));
  const bad = rows.find((d) => d.email.trim() && seen.has(d.email.trim().toLowerCase()));
  if (bad) return _plToast(`Email ${bad.email} is already in use`, 'err');
  let added = 0, failed = 0;
  for (const d of rows) {
    try { await window.api.addPlayer(_payload(d)); added++; } catch (_) { failed++; }
  }
  _closePanel();
  await _refreshPlayers();
  _plToast(failed ? `Added ${added}, ${failed} failed` : `${added} player${added === 1 ? '' : 's'} added`, failed ? 'err' : 'ok');
}

// --- import CSV ---

function _importHTML() {
  const p = _panel;
  if (!p.imp) {
    return `
      <div class="pl-import">
        <label class="pl-dropzone">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15V3M8 7l4-4 4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>
          <span class="pl-dropzone-t">Choose a CSV file</span>
          <span class="pl-hint">Any column order. Recognised headers: name, email, phone, member number, rating, member, exclude from ladder, tester. Extra columns are ignored.</span>
          <input type="file" accept=".csv,text/csv" id="plCsvFile" hidden>
        </label>
        <div class="pl-import-links">
          <button class="pl-link" id="plCsvTemplate">Download template CSV</button>
        </div>
      </div>`;
  }
  const plan = _importPlan(p.imp);
  const skip = p.imp.dupes === 'skip';
  const n = plan.newCount + (skip ? 0 : plan.dupeCount);
  return `
    <div class="pl-import">
      <div class="pl-filechip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/></svg>
        <span class="pl-filechip-name">${esc(p.imp.fileName)}</span>
        <span class="pl-hint">${p.imp.data.length} rows</span>
        <button class="pl-link" id="plCsvChange">Change file</button>
      </div>
      <div class="pl-import-sec">
        <span class="pl-sec-label">Column mapping</span>
        <div class="pl-maplist">
          ${p.imp.headers.map((h, i) => {
            const sample = (p.imp.data.find((r) => String(r[i] || '').trim()) || [])[i] || '(empty)';
            return `
            <div class="pl-maprow">
              <span class="pl-maprow-l"><span class="pl-maprow-h">${esc(h)}</span><span class="pl-maprow-s">${esc(sample)}</span></span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              <select data-col="${i}">
                <option value="">Ignore this column</option>
                ${[['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['member_number', 'Member number'], ['club_locker_rating', 'Club Locker rating'], ['is_member', 'Club member (yes/no)'], ['exclude_from_ladder', 'Exclude from ladder (yes/no)'], ['is_tester', 'Tester (yes/no)']]
                  .map(([v, l]) => `<option value="${v}" ${p.imp.mapping[i] === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>`;
          }).join('')}
        </div>
        ${plan.noName ? '<span class="pl-field-err">Map one column to Name to continue.</span>' : ''}
      </div>
      <div class="pl-import-sec">
        <span class="pl-sec-label">Existing players</span>
        <div class="pl-dupes">
          <label class="pl-duperow"><input type="radio" name="plDupes" value="skip" ${skip ? 'checked' : ''}><span><span class="pl-duperow-t">Skip them</span><span class="pl-hint">Only new players are added. Matched by email, then by exact name.</span></span></label>
          <label class="pl-duperow"><input type="radio" name="plDupes" value="update" ${skip ? '' : 'checked'}><span><span class="pl-duperow-t">Update them</span><span class="pl-hint">Mapped columns overwrite existing values; blank cells leave fields alone.</span></span></label>
        </div>
      </div>
      <div class="pl-stats">
        <div class="pl-stat pl-stat--green"><span>${plan.newCount}</span>New players</div>
        <div class="pl-stat pl-stat--blue"><span>${plan.dupeCount}</span>${skip ? 'Existing · skipped' : 'Existing · updated'}</div>
        <div class="pl-stat pl-stat--red"><span>${plan.badCount}</span>Skipped (no name)</div>
      </div>
      <div class="pl-import-sec">
        <span class="pl-sec-label">Preview</span>
        <div class="pl-preview">
          ${plan.items.slice(0, 40).map((it) => {
            const tag = it.kind === 'new' ? 'NEW' : it.kind === 'dupe' ? (skip ? 'SKIP' : 'UPDATE') : 'SKIP';
            const cls = it.kind === 'new' ? 'pl-ptag--green' : it.kind === 'dupe' ? 'pl-ptag--blue' : 'pl-ptag--red';
            return `<div class="pl-prow-i"><span class="pl-ptag ${cls}">${tag}</span><span class="pl-prow-name">${esc(it.name)}</span><span class="pl-prow-detail">${esc(it.detail)}</span></div>`;
          }).join('')}
        </div>
      </div>
      <span hidden id="plImportN">${plan.noName || n === 0 ? '' : n}</span>
    </div>`;
}

function _wireImport() {
  const p = _panel;
  const loadCsv = (fileName, text) => {
    const rows = _parseCsv(text);
    if (rows.length < 2) return _plToast('That file has no data rows', 'err');
    const headers = rows[0].map((h) => h.trim());
    const mapping = headers.map((h) => {
      const l = h.toLowerCase();
      return Object.keys(FIELD_ALIASES).find((f) => FIELD_ALIASES[f].includes(l)) || '';
    });
    p.imp = { fileName, headers, data: rows.slice(1), mapping, dupes: 'skip' };
    p.dirty = true;
    _renderPanel();
  };

  document.getElementById('plCsvFile')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => loadCsv(f.name, String(r.result));
    r.readAsText(f);
  });
  document.getElementById('plCsvTemplate')?.addEventListener('click', () => {
    _download('wsrc-players-template.csv', 'name,email,phone,member_number,club_locker_rating,is_member,exclude_from_ladder,is_tester\n');
  });
  document.getElementById('plCsvChange')?.addEventListener('click', () => { p.imp = null; _renderPanel(); });
  document.querySelectorAll('#plPanel [data-col]').forEach((sel) => sel.addEventListener('change', () => {
    const i = Number(sel.dataset.col);
    const v = sel.value;
    // a field can be mapped from one column only
    p.imp.mapping = p.imp.mapping.map((m, j) => (j === i ? v : m === v ? '' : m));
    _renderPanel();
  }));
  document.querySelectorAll('#plPanel [name="plDupes"]').forEach((r) => r.addEventListener('change', () => {
    p.imp.dupes = r.value;
    _renderPanel();
  }));
  const primary = document.getElementById('plPanelPrimary');
  if (p.imp) {
    const plan = _importPlan(p.imp);
    const n = plan.newCount + (p.imp.dupes === 'update' ? plan.dupeCount : 0);
    primary.textContent = `Import ${n} player${n === 1 ? '' : 's'}`;
    primary.disabled = plan.noName || n === 0;
  } else {
    primary.textContent = 'Import';
    primary.disabled = true;
  }
}

async function _runImport() {
  const p = _panel;
  const plan = _importPlan(p.imp);
  if (!plan || plan.noName) return;
  let added = 0, updated = 0, failed = 0;
  for (const it of plan.items) {
    try {
      if (it.kind === 'new') {
        await window.api.addPlayer(_payload({ ..._blankDraft(), is_member: false, ...it.fields, club_locker_rating: it.fields.club_locker_rating ?? '' }));
        added++;
      } else if (it.kind === 'dupe' && p.imp.dupes === 'update') {
        // Partial update: only the mapped, non-blank fields travel.
        await window.api.updatePlayer({ id: it.existing.id, ...it.fields });
        updated++;
      }
    } catch (_) { failed++; }
  }
  _closePanel();
  await _refreshPlayers();
  let msg = `Imported ${added} new`;
  if (updated) msg += `, updated ${updated}`;
  if (plan.dupeCount && !updated) msg += `, skipped ${plan.dupeCount} existing`;
  if (failed) msg += `, ${failed} failed`;
  _plToast(msg, failed ? 'err' : 'ok');
}

// --- bulk edit ---

const BULK_DEFS = [
  ['is_member', 'Club membership', 'Controls court booking and member-only events.', 'Member', 'Non-member'],
  ['exclude_from_ladder', 'Ladder', 'Whether they appear in ladder rankings.', 'Excluded from ladder', 'On the ladder'],
  ['is_tester', 'Tester account', 'Gets new features early.', 'Tester', 'Not a tester'],
  ['club_locker_rating', 'Club Locker rating', 'Set the same rating on everyone selected.', '', ''],
];

function _bulkHTML() {
  const b = _panel.bulk;
  if (b.mode === 'all') {
    return `
      <div class="pl-bulk">
        <div class="pl-seg">
          <button class="pl-seg-btn pl-seg-btn--on" data-bulkmode="all">Set for all</button>
          <button class="pl-seg-btn" data-bulkmode="each">Edit individually</button>
        </div>
        <span class="pl-hint">Tick a field to change it on every selected player. Unticked fields are left exactly as they are.</span>
        <div class="pl-bulkfields">
          ${BULK_DEFS.map(([k, label, hint, yes, no]) => {
            const f = b.fields[k];
            return `
            <div class="pl-bulkfield${f.on ? ' pl-bulkfield--on' : ''}" data-bf="${k}">
              <input type="checkbox" data-bulktick="${k}" ${f.on ? 'checked' : ''}>
              <span><span class="pl-toggle-t">${label}</span><span class="pl-toggle-h">${hint}</span></span>
              ${k === 'club_locker_rating'
                ? `<input type="number" step="0.01" data-bulkval="${k}" value="${esc(f.value)}" placeholder="Leave blank to clear" ${f.on ? '' : 'disabled'}>`
                : `<select data-bulkval="${k}" ${f.on ? '' : 'disabled'}>
                    <option value="1" ${f.value === '1' ? 'selected' : ''}>${yes}</option>
                    <option value="0" ${f.value === '0' ? 'selected' : ''}>${no}</option>
                  </select>`}
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }
  return `
    <div class="pl-bulk">
      <div class="pl-seg">
        <button class="pl-seg-btn" data-bulkmode="all">Set for all</button>
        <button class="pl-seg-btn pl-seg-btn--on" data-bulkmode="each">Edit individually</button>
      </div>
      <span class="pl-hint">Edit any cell. Only rows you change are saved.</span>
      <div class="pl-dgrid-card">
        <div class="pl-dgrid pl-dgrid--head pl-dgrid--bulk">
          <span>Name *</span><span>Email</span><span>Phone</span><span>Member #</span><span>Rating</span><span class="pl-dgrid-c">Member</span><span class="pl-dgrid-c">Excl.</span>
        </div>
        ${b.rows.map((r, i) => `
          <div class="pl-dgrid pl-dgrid--row pl-dgrid--bulk${r.changed ? ' pl-dgrid--changed' : ''}" data-bulkrow="${i}">
            <input data-b="name" data-i="${i}" value="${esc(r.name)}" class="${r.name.trim() ? '' : 'pl-input--err'}">
            <input data-b="email" data-i="${i}" value="${esc(r.email)}">
            <input data-b="phone" data-i="${i}" value="${esc(r.phone)}">
            <input data-b="member_number" data-i="${i}" value="${esc(r.member_number)}">
            <input data-b="club_locker_rating" data-i="${i}" type="number" step="0.01" value="${esc(String(r.club_locker_rating))}">
            <span class="pl-dgrid-c"><input type="checkbox" data-b="is_member" data-i="${i}" ${r.is_member ? 'checked' : ''}></span>
            <span class="pl-dgrid-c"><input type="checkbox" data-b="exclude_from_ladder" data-i="${i}" ${r.exclude_from_ladder ? 'checked' : ''}></span>
          </div>`).join('')}
      </div>
    </div>`;
}

function _wireBulk() {
  const p = _panel;
  const b = p.bulk;
  document.querySelectorAll('#plPanel [data-bulkmode]').forEach((btn) => btn.addEventListener('click', () => {
    b.mode = btn.dataset.bulkmode;
    _renderPanel();
  }));
  document.querySelectorAll('#plPanel [data-bulktick]').forEach((cb) => cb.addEventListener('change', () => {
    const k = cb.dataset.bulktick;
    b.fields[k].on = cb.checked;
    const row = document.querySelector(`[data-bf="${k}"]`);
    row.classList.toggle('pl-bulkfield--on', cb.checked);
    row.querySelector('[data-bulkval]').disabled = !cb.checked;
    _setDirty();
  }));
  document.querySelectorAll('#plPanel [data-bulkval]').forEach((el) => el.addEventListener('change', () => {
    b.fields[el.dataset.bulkval].value = el.value;
    _setDirty();
  }));
  document.querySelectorAll('#plPanel [data-b]').forEach((input) => {
    const i = Number(input.dataset.i);
    const key = input.dataset.b;
    const isCheck = input.type === 'checkbox';
    input.addEventListener(isCheck ? 'change' : 'input', () => {
      b.rows[i][key] = isCheck ? input.checked : input.value;
      b.rows[i].changed = true;
      input.closest('.pl-dgrid--row').classList.add('pl-dgrid--changed');
      _setDirty();
    });
  });
}

async function _saveBulk() {
  const p = _panel;
  const b = p.bulk;
  const ids = [...pl.selected];
  if (b.mode === 'all') {
    const patch = {};
    Object.entries(b.fields).forEach(([k, f]) => {
      if (!f.on) return;
      patch[k] = k === 'club_locker_rating' ? (f.value === '' ? null : parseFloat(f.value)) : f.value === '1';
    });
    if (!Object.keys(patch).length) return _plToast('Tick at least one field to change', 'warn');
    // Snapshot what the patch will overwrite, so Undo can put it back.
    const before = state.players
      .filter((x) => pl.selected.has(x.id))
      .map((x) => {
        const prev = { id: x.id };
        Object.keys(patch).forEach((k) => { prev[k] = x[k]; });
        return prev;
      });
    try {
      await window.api.bulkPatchPlayers({ ids, patch });
      _closePanel();
      await _refreshPlayers();
      const nf = Object.keys(patch).length;
      _plToast(`${nf} field${nf === 1 ? '' : 's'} updated on ${ids.length} players`, 'ok', async () => {
        for (const prev of before) await window.api.updatePlayer(prev);
        await _refreshPlayers();
        _plToast('Reverted');
      });
    } catch (e) {
      _plToast(e.message || 'Could not update.', 'err');
    }
  } else {
    const changed = b.rows.filter((r) => r.changed);
    if (changed.some((r) => !String(r.name).trim())) return _plToast('Every player needs a name', 'err');
    let ok = 0, failed = 0;
    for (const r of changed) {
      try { await window.api.updatePlayer({ id: r.id, ..._payload(r) }); ok++; } catch (_) { failed++; }
    }
    _closePanel();
    await _refreshPlayers();
    _plToast(failed ? `Updated ${ok}, ${failed} failed` : `${ok} player${ok === 1 ? '' : 's'} updated`, failed ? 'err' : 'ok');
  }
}

function _panelPrimary(another) {
  const p = _panel;
  if (!p) return;
  if (p.mode === 'edit' || (p.mode === 'add' && p.tab === 'one')) return _saveForm(another);
  if (p.mode === 'add' && p.tab === 'several') return _saveDrafts();
  if (p.mode === 'add' && p.tab === 'import') return _runImport();
  if (p.mode === 'bulk') return _saveBulk();
}

// ---- entry points the profile page (playerProfile.js) uses ----

export function openEditPlayerModal(player) {
  _openPanel('edit', { player });
}

export function confirmDeletePlayer(id, name) {
  _plConfirm({
    title: `Delete ${name}?`,
    body: DELETE_BODY,
    okLabel: 'Delete',
    danger: true,
    onOk: async () => {
      await window.api.deletePlayer(id);
      _plToast(`${name} deleted`);
      if (state.page === 'playerProfile') window.navigate('players');
      else await _refreshPlayers();
    },
  });
}


export function openMessagePlayerModal(playerId, playerName) {
  modal.open(`Message ${playerName}`, `
    <p class="text-muted" style="font-size:13px;margin-bottom:12px">
      Your message will be sent to ${esc(playerName)} by email. They can reply directly to your email address.
    </p>
    <div class="form-group">
      <textarea class="form-control" id="msgBody" rows="5" placeholder="Write your message…" style="resize:vertical"></textarea>
    </div>
    <div id="fError" class="form-error"></div>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSubmit">Send Message</button>
    </div>`);

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('msgBody').focus();
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const message = document.getElementById('msgBody').value.trim();
    if (!message) { document.getElementById('fError').textContent = 'Message is required.'; return; }
    const btn = document.getElementById('fSubmit');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await window.api.messagePlayer(playerId, { message });
      modal.close();
      toast('Message sent!', 'success');
    } catch (e) {
      document.getElementById('fError').textContent = e.message || 'Failed to send message.';
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }
  });
}

export function showAuthLinkModal(title, url) {
  modal.open(title, `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
      No email service is configured. Copy this link and send it directly to the player.
    </p>
    <div style="display:flex;gap:8px;align-items:center">
      <input class="form-control" id="authLinkInput" value="${esc(url)}" readonly
        style="font-size:12px;font-family:monospace;flex:1">
      <button class="btn btn-primary" id="authLinkCopyBtn" style="flex-shrink:0">Copy</button>
    </div>
    <div style="margin-top:14px;text-align:right">
      <button class="btn btn-outline" id="authLinkCloseBtn">Close</button>
    </div>
  `);
  document.getElementById('authLinkInput').select();
  document.getElementById('authLinkCopyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(url).catch(() => {
      document.getElementById('authLinkInput').select();
      document.execCommand('copy');
    });
    document.getElementById('authLinkCopyBtn').textContent = 'Copied!';
  });
  document.getElementById('authLinkCloseBtn').addEventListener('click', modal.close);
}
