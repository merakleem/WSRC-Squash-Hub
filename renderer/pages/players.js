import { state, isAdmin } from '../state.js';
import { esc, formatDate, formatShortDate, toast, modal, avatarHTML, playerInitials } from '../utils.js';

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
    }
    else if (key === 'member') { va = a.is_member ? 0 : 1; vb = b.is_member ? 0 : 1; }
    else if (key === 'account') { va = acctRank[a.account_status] ?? 2; vb = acctRank[b.account_status] ?? 2; }
    else {
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
    if (!pl.filterOpen) { fm.innerHTML = ''; }
    else {
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

const SORTABLE = { name: 'Player', email: 'Email', rating: 'Rating', member: 'Membership', account: 'Account' };

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
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
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
  let title = '', sub = '', primaryLabel = 'Save', wide = false;
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
    try { await window.api.addPlayer(_payload(d)); added++; }
    catch (_) { failed++; }
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
    _download('wsrc-players-template.csv', 'name,email,phone,member_number,club_locker_rating,is_member,exclude_from_ladder,is_tester\nSofia Duarte,sofia@example.com,(555) 0100,1042,3.5,yes,no,no');
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
      try { await window.api.updatePlayer({ id: r.id, ..._payload(r) }); ok++; }
      catch (_) { failed++; }
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

// ---- entry points the profile page keeps using ----

export function openEditPlayerModal(player) {
  _openPanel('edit', { player });
}

function confirmDeletePlayer(id, name) {
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


function openMessagePlayerModal(playerId, playerName) {
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

// ===== PLAYER PROFILE =====

// Selected season tab: null = All Time, 'none' = matches with no season, or a
// season id. Tracked alongside the player it was chosen for; back-navigation
// swaps state.currentPlayer without going through openPlayerProfile, so a
// selection must never be trusted for a different player.
let _profileSeason = null;
let _profileSeasonFor = null;
// The one player id the profile has already re-fetched for; see renderPlayerProfile.
let _profileRefetchedFor = null;
// Desktop panel and the Results source filter. Reset with the season selection
// so a stale tab never opens on a different player.
let _profileTab = 'results';
let _profileResultFilter = 'all';
// Mobile has no tab bar, so a quick link opens the panel as a sub-view over the
// column. null means the column itself is showing.
let _profileMobileView = null;

export async function openPlayerProfile(id, { pushHistory = true } = {}) {
  const player = await window.api.getPlayerHistory(id);
  window.navigate('playerProfile', { player }, { pushHistory });
}

export function renderPlayerProfile() {
  const p = state.currentPlayer;
  if (!p) { window.navigate('players'); return; }

  // A players-list row can reach here in place of the profile payload, and it
  // renders as a player with no matches, no rank and no seasons. The payload
  // always carries a history array, so its absence means the page was given
  // the wrong object: fetch the right one rather than draw a blank. Once only -
  // if what comes back has no history either, that is what the server has, and
  // asking again would spin: the first version of this looped a test page's
  // stubbed API forever and wedged the tab.
  if (!Array.isArray(p.history) && _profileRefetchedFor !== p.id) {
    _profileRefetchedFor = p.id;
    openPlayerProfile(p.id, { pushHistory: false });
    return;
  }
  if (Array.isArray(p.history)) _profileRefetchedFor = null;

  const adminMode = isAdmin();
  document.getElementById('pageTitle').textContent = p.name;
  const acctStatus = p.accountStatus || 'none'; // 'verified' | 'pending' | 'none'
  const hasEmail = !!p.email;

  const isOwnProfile = !adminMode && state.currentUser?.playerId === p.id;
  document.getElementById('topbarActions').innerHTML = adminMode ? `
    <div class="options-menu" id="optionsMenu">
      <button class="btn btn-outline" id="optionsBtn">Options <svg width="14" height="14" viewBox="0 0 4 14" fill="currentColor" style="vertical-align:middle;margin-left:2px"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/></svg></button>
      <div class="options-dropdown" id="optionsDropdown">
        <button class="options-item" data-action="edit-player" data-id="${p.id}">Edit Information</button>
        <button class="options-item" data-action="view-as" data-id="${p.id}">View as this player</button>
        ${hasEmail && acctStatus !== 'verified' ? `<button class="options-item" data-action="send-invite">Send Invite</button>` : ''}
        ${hasEmail && acctStatus === 'verified' ? `<button class="options-item" data-action="send-reset">Send Password Reset</button>` : ''}
        <button class="options-item options-item-danger" data-action="delete-player" data-id="${p.id}" data-name="${esc(p.name)}">Delete Player</button>
      </div>
    </div>`
  : !isOwnProfile ? `<button class="btn btn-outline" id="btnMessagePlayer">Message</button>` : '';

  if (adminMode) {
    document.getElementById('optionsBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('optionsDropdown').classList.toggle('open');
    });
    document.getElementById('optionsDropdown').addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      document.getElementById('optionsDropdown').classList.remove('open');
      if (action === 'view-as') {
        // Swaps the session for this player's. The server records that an admin
        // did it, which is what makes the way back possible.
        try {
          await window.api.viewAsPlayer(p.id);
          location.href = '/';
        } catch (err) {
          toast(err.message || 'Could not view as that player.', 'error');
        }
        return;
      }
      if (action === 'edit-player') {
        const player = state.players.find((pl) => pl.id === Number(e.target.dataset.id))
          || state.currentPlayer;
        openEditPlayerModal(player);
      } else if (action === 'delete-player') {
        confirmDeletePlayer(Number(e.target.dataset.id), e.target.dataset.name);
      } else if (action === 'send-invite') {
        try {
          const result = await window.api.sendInvite(p.id);
          if (result.emailSent) {
            toast('Invite email sent!', 'success');
          } else {
            showAuthLinkModal('Invite Link', result.inviteUrl);
          }
        } catch (err) {
          toast(err.message || 'Failed to send invite.', 'error');
        }
      } else if (action === 'send-reset') {
        try {
          const result = await window.api.sendReset(p.id);
          if (result.emailSent) {
            toast('Password reset email sent!', 'success');
          } else {
            showAuthLinkModal('Password Reset Link', result.resetUrl);
          }
        } catch (err) {
          toast(err.message || 'Failed to send reset email.', 'error');
        }
      }
    });
    document.addEventListener('click', function closeOptions() {
      document.getElementById('optionsDropdown')?.classList.remove('open');
      document.removeEventListener('click', closeOptions);
    }, { once: false });
  } else if (!isOwnProfile) {
    document.getElementById('btnMessagePlayer')?.addEventListener('click', () => {
      openMessagePlayerModal(p.id, p.name);
    });
  }

  // ===== DATA =====
  // Everything below derives from the single getPlayerHistory payload. Season
  // scoping is applied to history-derived blocks only; the ladder chart and
  // upcoming matches are deliberately all-time.
  const allHistory = p.history || [];
  const seasons = p.seasons || [];
  const seasonsById = Object.fromEntries(seasons.map((s) => [s.id, s]));

  // Every season the club has had is offered, not only the ones this player
  // appeared in. A season they sat out still shows the same page with an empty
  // record, which reads as "you played none" rather than the season vanishing.
  const seasonKeys = seasons.map((sn) => sn.key);
  const hasUnassigned = allHistory.some((m) => m.season_key == null);

  // The current season is the default while there is something of theirs in
  // it. Otherwise the page opens on the last season they played - history is
  // newest first, so that is the first key in it - because a new season begins
  // on a fixed day whether or not anyone has played yet, and on that day every
  // profile opening blank read as the history being gone.
  const currentKey = seasons.find((sn) => sn.is_current)?.key ?? null;
  const playedIn = (key) => key != null && allHistory.some((m) => m.season_key === key);
  const lastPlayedKey = allHistory.map((m) => m.season_key).find((k) => seasonKeys.includes(k)) ?? null;
  const defaultSeason = playedIn(currentKey) ? currentKey
    : lastPlayedKey
    ?? currentKey
    ?? seasonKeys[0]
    ?? (hasUnassigned ? 'none' : null);

  // A remembered selection is only trusted when it belongs to this player;
  // back navigation swaps the player without going through openPlayerProfile.
  const selectionValid = _profileSeasonFor === p.id && (
    _profileSeason === null
    || seasonKeys.includes(_profileSeason)
    || (_profileSeason === 'none' && hasUnassigned)
  );
  const activeSeason = selectionValid ? _profileSeason : defaultSeason;

  // Opening a different player resets the view; a Results filter that matched
  // nothing for them would otherwise render an empty panel with no explanation.
  if (_profileSeasonFor !== p.id) {
    // 'season' was a tab that no longer exists; it only ever fell through to
    // the Results default, so it now says so.
    _profileTab = 'results';
    _profileResultFilter = 'all';
    _profileMobileView = null;
    _profileSeasonFor = p.id;
    _profileSeason = defaultSeason;
  }

  const inSeason = (row) => activeSeason === null
    || (activeSeason === 'none' ? row.season_key == null : row.season_key === activeSeason);

  const history = allHistory.filter(inSeason);
  const tournamentResults = (p.tournamentResults || []).filter(inSeason);
  const upcoming = p.upcoming || [];

  const seasonLabel = activeSeason === null
    ? 'All time'
    : activeSeason === 'none' ? 'Unassigned' : (seasonsById[activeSeason]?.name || 'Season');

  // Empty-state copy naming the selected period, so a profile filtered to
  // "All time" doesn't report that nothing happened "this season".
  const periodPhrase = activeSeason === null
    ? 'recorded'
    : activeSeason === 'none' ? 'outside a season' : `in ${seasonLabel}`;

  const stats = _profileStats(history);

  const ladder = p.ladder || {};
  const isSelf = state.currentUser?.playerId === p.id;

  // ===== HEADER =====
  const canEditPhoto = adminMode || isSelf;
  const metaBits = [
    adminMode ? p.division_name : null,
    p.member_number ? `Member #${esc(p.member_number)}` : null,
    adminMode && p.email ? esc(p.email) : null,
  ].filter(Boolean);

  const acctBadge = adminMode && acctStatus === 'verified'
    ? `<span class="pp-badge">Verified</span>` : '';

  // The rank block names the system it came from. It reports the current season's
  // standing, the same number the Ladder page and the dashboard ring show, while
  // the career chart further down is a different scale entirely.
  // The rating is dropped on narrow screens, where it would wrap the label onto
  // a third line; the Ladder page carries it prominently either way.
  const rankLabelHTML = [ladder.frozen ? 'Final' : null, ladder.system === 'elo' ? 'Rating ladder' : 'Ladder']
    .filter(Boolean).join(' · ')
    + (ladder.rating == null ? '' : `<span class="pp-hstat-label-extra"> · ${Number(ladder.rating)}</span>`);

  const rankMoveHTML = !ladder.rank_change ? ''
    : `<span class="pp-hstat-move ${ladder.rank_change > 0 ? 'pp-pos' : 'pp-neg'}" title="Places moved in the last 7 days"><svg class="mv-tri" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 3 L10.2 8.6 L1.8 8.6 Z" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>${Math.abs(ladder.rank_change)}</span>`;

  // Nobody is on the ladder until they have played, so a member with no matches
  // gets told what to do about it rather than a gap where a rank would be.
  const rankBlockHTML = ladder.position != null ? `
      <div class="pp-hstat">
        <div class="pp-hstat-val">#${ladder.position}<span class="pp-hstat-sub">of ${ladder.ladder_size}</span>${rankMoveHTML}</div>
        <div class="pp-hstat-label">${rankLabelHTML}</div>
      </div>`
    : ladder.unranked ? `
      <div class="pp-hstat pp-hstat-unranked">
        <div class="pp-hstat-val">Unranked</div>
        <div class="pp-hstat-label">${isSelf ? 'Play a match to join the ladder' : 'No matches played yet'}</div>
      </div>`
    : '';

  const headerStatsHTML = `
    ${rankBlockHTML}
    <div class="pp-hstat pp-hstat-wide">
      <div class="pp-hstat-val">${stats.wins}–${stats.losses}<span class="pp-hstat-sub">${stats.winPct === null ? '' : `${stats.winPct}%`}</span></div>
      <div class="pp-hbar"><span style="width:${stats.winPct || 0}%"></span></div>
      <div class="pp-hstat-label">${esc(seasonLabel)} record</div>
    </div>
    ${stats.currentStreak === 0 ? '' : `
      <div class="pp-hstat">
        <div class="pp-hstat-val ${stats.streakType === 'W' ? 'pp-pos' : 'pp-neg'}">${stats.currentStreak}${stats.streakType}</div>
        <div class="pp-hstat-label">Current streak</div>
      </div>`}`;

  const seasonOptions = [
    ...seasonKeys.map((key) => ({ value: key, label: seasonsById[key]?.name || 'Season' })),
    ...(hasUnassigned ? [{ value: 'none', label: 'Unassigned' }] : []),
    { value: 'all', label: 'All time' },
  ];
  const seasonPillHTML = seasonOptions.length < 2 ? '' : `
    <div class="pp-season-pick">
      <select class="pp-season-select" aria-label="Season">
        ${seasonOptions.map((o) => `<option value="${o.value}" ${String(activeSeason ?? 'all') === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
    </div>`;

  const headerHTML = `
    <div class="pp-header">
      <div class="pp-identity">
        ${canEditPhoto ? `
          <button class="pp-avatar-btn" id="btnEditPhoto" title="Change photo">
            ${avatarHTML(p, 'pp-avatar')}
            <span class="pp-avatar-edit">Edit</span>
          </button>` : avatarHTML(p, 'pp-avatar')}
        <div class="pp-identity-text">
          <h2 class="pp-name">${esc(p.name)}</h2>
          ${metaBits.length ? `<div class="pp-meta">${metaBits.join(' · ')}</div>` : ''}
          ${acctBadge}
        </div>
      </div>
      <div class="pp-header-right">
        ${seasonPillHTML}
        <div class="pp-hstats">${headerStatsHTML}</div>
      </div>
    </div>`;

  // ===== PANELS =====
  // Season and Past seasons are gone: the season pill in the header already
  // controls the period, so both were a second way to do the same thing.
  const TABS = [
    { key: 'results', label: 'Results' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'tournaments', label: 'Tournaments' },
  ];
  // Normalised back onto the module state so the arrow-key handler and the
  // filter rebuild can't read a tab key the DOM never rendered.
  const activeTab = TABS.some((t) => t.key === _profileTab) ? _profileTab : 'results';
  _profileTab = activeTab;

  // A tablist needs aria-selected, a link to its panel, and one stop in the tab
  // order rather than four; arrow keys move between tabs from there.
  const tabBarHTML = `
    <div class="pp-tabs" role="tablist" aria-label="Profile sections">
      ${TABS.map((t) => `
        <button class="pp-tab${t.key === activeTab ? ' active' : ''}" data-pp-tab="${t.key}"
          role="tab" id="ppTab-${t.key}" aria-controls="ppPanel"
          aria-selected="${t.key === activeTab}" tabindex="${t.key === activeTab ? '0' : '-1'}">${t.label}</button>`).join('')}
    </div>`;

  const resultRow = (m, { compact = false } = {}) => {
    const won = m.result === 'W';
    const context = m.source === 'tournament'
      ? [esc(m.league_name), esc(m.round_label || '')].filter(Boolean).join(' · ')
      : m.source === 'pickup'
        ? 'Ladder match'
        : [esc(m.league_name), m.week_number ? `Wk ${m.week_number}` : null,
           m.division_name ? esc(m.division_name.replace(/^Division\s*/i, 'Div ')) : null].filter(Boolean).join(' · ');
    const opponent = m.opponent_id
      ? `<span class="nav-player-link" data-player-id="${m.opponent_id}">${esc(m.opponent_name)}</span>`
      : esc(m.opponent_name);
    // Only matches in a rated season carry a rating change.
    const delta = m.rating_change;
    const deltaHTML = delta === undefined || delta === null ? '' : `
      <span class="pp-row-delta ${delta >= 0 ? 'pp-delta-up' : 'pp-delta-down'}">${delta >= 0 ? '+' : ''}${delta}</span>`;
    return `
      <div class="pp-row" data-match="${m.id}">
        <span class="pp-chip ${won ? 'pp-chip-w' : 'pp-chip-l'}">${won ? 'W' : 'L'}</span>
        <div class="pp-row-main">
          <span class="pp-row-title">${opponent}</span>
          <span class="pp-row-sub">${context}</span>
        </div>
        ${deltaHTML}
        <span class="pp-row-score">${m.my_score}–${m.their_score}</span>
        ${compact ? '' : `<span class="pp-row-date">${formatShortDate(m.week_date)}</span>`}
      </div>`;
  };

  // `action` is optional: only the states where there is a genuinely available
  // next step get a button, rather than every empty panel growing one.
  const emptyBlock = (msg, action) => `
    <div class="empty-state">
      <strong>${esc(msg)}</strong>
      ${action ? `<button class="btn btn-outline btn-sm" data-pp-action="${action.id}">${esc(action.label)}</button>` : ''}
    </div>`;

  const reportMatchAction = isSelf ? { id: 'report-ladder', label: 'Report a ladder match' } : null;

  // -- Results panel --
  // Carries the season-detail figures that used to live on the Season tab, so
  // removing that tab doesn't lose them from the desktop view.
  const detailStripHTML = stats.played === 0 ? '' : `
    <div class="pp-detail-strip">
      <div><span class="pp-fig">${stats.gamesWon}–${stats.gamesLost}</span><span class="pp-fig-label">Games</span></div>
      <div><span class="pp-fig">${stats.gameWinPct === null ? '—' : `${stats.gameWinPct}%`}</span><span class="pp-fig-label">Game win rate</span></div>
    </div>`;

  const sourceFilters = [
    { key: 'all', label: 'All' },
    { key: 'league', label: 'League' },
    { key: 'pickup', label: 'Ladder' },
    { key: 'tournament', label: 'Tournament' },
  ];
  // Takes the filter as an argument so changing it can rebuild this panel alone
  // instead of re-rendering the whole profile.
  const buildResultsPanel = (filterKey) => {
    const filtered = filterKey === 'all'
      ? history
      : history.filter((m) => (m.source || 'league') === filterKey);
    return `
    <div class="pp-card">
      <div class="pp-card-head pp-card-head-wrap">
        <div class="pp-card-head-text">
          <span class="pp-card-label">Results · ${esc(seasonLabel)}</span>
          <span class="pp-card-sub">${stats.wins} win${stats.wins === 1 ? '' : 's'} · ${stats.losses} loss${stats.losses === 1 ? '' : 'es'}</span>
        </div>
        <div class="pp-filters" role="group" aria-label="Filter results by competition">
          ${sourceFilters.map((f) => `
            <button class="pp-filter${filterKey === f.key ? ' active' : ''}" data-pp-filter="${f.key}"
              aria-pressed="${filterKey === f.key}">${f.label}</button>`).join('')}
        </div>
      </div>
      ${detailStripHTML}
      ${filtered.length
        ? filtered.map((m) => resultRow(m)).join('')
        : filterKey === 'all'
          ? emptyBlock(`No matches ${periodPhrase} yet`, reportMatchAction)
          : emptyBlock(`No ${sourceFilters.find((f) => f.key === filterKey)?.label.toLowerCase()} matches ${periodPhrase}`)}
    </div>`;
  };

  // -- Upcoming panel --
  const upcomingPanelHTML = `
    <div class="pp-card">
      <div class="pp-card-head">
        <span class="pp-card-label">Upcoming matches</span>
        <span class="pp-card-sub">all seasons · ${upcoming.length} scheduled</span>
      </div>
      ${upcoming.length ? upcoming.map((m, i) => {
        const courtLabel = isAdmin() && (m.court_name || (m.schedule_courts && m.court_number ? `Court ${m.court_number}` : null));
        const timing = [m.match_time, courtLabel].filter(Boolean).join(' · ');
        const context = [esc(m.league_name), m.week_number ? `Wk ${m.week_number}` : null].filter(Boolean).join(' · ');
        const opponent = m.opponent_id
          ? `<span class="nav-player-link" data-player-id="${m.opponent_id}">${esc(m.opponent_name)}</span>`
          : esc(m.opponent_name || 'TBD');
        return `
          <div class="pp-row pp-row-lg${i === 0 ? ' pp-row-next' : ''}" data-match="${m.id}">
            <div class="pp-date-block">
              <span class="pp-date-main">${formatShortDate(m.week_date)}</span>
              ${timing ? `<span class="pp-date-sub">${esc(timing)}</span>` : ''}
            </div>
            <div class="pp-row-main">
              <span class="pp-row-title">${opponent}${i === 0 ? '<span class="pp-next-chip">Next up</span>' : ''}</span>
              <span class="pp-row-sub">${context}</span>
            </div>
          </div>`;
      }).join('') : emptyBlock('No upcoming matches')}
    </div>`;

  // -- Tournaments panel --
  const tournPanelHTML = `
    <div class="pp-card">
      <div class="pp-card-head"><span class="pp-card-label">Tournaments · ${esc(seasonLabel)}</span></div>
      ${tournamentResults.length ? tournamentResults.map((t) => `
        <div class="pp-row pp-row-lg${t.status !== 'completed' ? ' pp-row-next' : ''}">
          <div class="pp-row-main">
            <span class="pp-row-title">${esc(t.name)}</span>
            <span class="pp-row-sub">${formatShortDate(t.championship_date)}</span>
          </div>
          ${t.status === 'completed'
            ? `<span class="pp-finish${t.position === 2 ? ' pp-finish-runner' : ''}">${t.position ? `Finished #${t.position}` : '—'}</span>`
            : `<span class="pp-next-chip">In progress</span>`}
        </div>`).join('') : emptyBlock('No tournaments played yet')}
    </div>`;

  // The career ladder chart lived here. It plotted an all-time positional
  // replay while the header reported the season's own standing, so the two
  // numbers on one page disagreed by design. Pulled until ladder history is
  // stored rather than re-simulated; the header rank is the reliable one.
  const panelFor = (tabKey) => {
    switch (tabKey) {
      case 'upcoming':    return upcomingPanelHTML;
      case 'tournaments': return tournPanelHTML;
      default:            return buildResultsPanel(_profileResultFilter);
    }
  };

  // ===== MOBILE =====
  // A single scrolling column rather than tabs: record, then recent results.
  // Tapping a quick link opens that panel over the column, with a way back.
  // Without this the link set a desktop tab that mobile never renders, so
  // nothing happened.
  const MOBILE_TITLES = { results: 'Results', upcoming: 'Upcoming matches', tournaments: 'Tournaments' };
  const mobileHTML = _profileMobileView ? `
    <div class="pp-mobile">
      <button class="pp-back" id="ppMobileBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        Back
      </button>
      <h3 class="pp-subview-title">${esc(MOBILE_TITLES[_profileMobileView] || '')}</h3>
      ${panelFor(_profileMobileView)}
    </div>` : `
    <div class="pp-mobile">
      <div class="pp-season-row">
        ${seasonPillHTML}
        <span class="pp-season-count">${history.length} match${history.length === 1 ? '' : 'es'} played</span>
      </div>

      <div class="pp-card pp-card-pad">
        <div class="pp-card-head pp-card-head-bare">
          <span class="pp-card-label">${esc(seasonLabel)} record</span>
          ${stats.currentStreak > 1 && stats.streakType === 'W'
            ? `<span class="pp-streak">${stats.currentStreak}-match win streak</span>` : ''}
        </div>
        ${stats.played === 0 ? emptyBlock('No matches played this season') : `
          <div class="pp-big">
            <span class="pp-big-w">${stats.wins}</span>
            <span class="pp-big-sep">/</span>
            <span class="pp-big-l">${stats.losses}</span>
            <span class="pp-big-pct">${stats.winPct === null ? '—' : `${stats.winPct}%`}</span>
          </div>
          <div class="pp-bar pp-bar-lg"><span style="width:${stats.winPct || 0}%"></span></div>
          <div class="pp-figures">
            <div><span class="pp-fig">${stats.gamesWon}–${stats.gamesLost}</span><span class="pp-fig-label">Games</span></div>
            <div><span class="pp-fig">${stats.gameWinPct === null ? '—' : `${stats.gameWinPct}%`}</span><span class="pp-fig-label">Game win rate</span></div>
          </div>`}
      </div>

      ${history.length ? `
        <div class="pp-card">
          <div class="pp-card-head">
            <span class="pp-card-label">Last ${Math.min(3, history.length)} result${history.length === 1 ? '' : 's'}</span>
            ${history.length > 3 ? `<button class="pp-link" data-pp-tab="results">All ${history.length}</button>` : ''}
          </div>
          ${history.slice(0, 3).map((m) => resultRow(m)).join('')}
        </div>` : ''}

      ${_quickLinksHTML(upcoming.length, tournamentResults.length)}
    </div>`;

  document.getElementById('mainContent').innerHTML = `
    ${headerHTML}
    <div class="pp-desktop">
      ${tabBarHTML}
      <div class="pp-panel" id="ppPanel" role="tabpanel" aria-labelledby="ppTab-${activeTab}" tabindex="0">${panelFor(activeTab)}</div>
    </div>
    ${mobileHTML}`;

  // ===== EVENTS =====
  const content = document.getElementById('mainContent');

  const wireOpponentLinks = (root) => {
    root.querySelectorAll('.nav-player-link').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        window.openPlayerProfile(Number(el.dataset.playerId));
      });
    });
  };
  wireOpponentLinks(content);

  document.getElementById('btnEditPhoto')?.addEventListener('click', () => openPhotoModal(p));

  const panelEl = document.getElementById('ppPanel');
  const tabEls = [...content.querySelectorAll('.pp-tab[data-pp-tab]')];

  // Only the panel's contents depend on the tab and the filter, so only they are
  // rebuilt. A full renderPlayerProfile() re-fetched the profile, replayed the
  // ladder and replaced the header, which lost the scroll position.
  const wirePanel = () => {
    wireOpponentLinks(panelEl);
    panelEl.querySelectorAll('[data-pp-action="report-ladder"]').forEach((el) => {
      el.addEventListener('click', () => openPickupGameModal());
    });
    panelEl.querySelectorAll('[data-pp-filter]').forEach((el) => {
      el.addEventListener('click', () => {
        _profileResultFilter = el.dataset.ppFilter;
        panelEl.innerHTML = panelFor(_profileTab);
        wirePanel();
      });
    });
  };

  const showTab = (key) => {
    _profileTab = key;
    panelEl.innerHTML = panelFor(key);
    panelEl.setAttribute('aria-labelledby', `ppTab-${key}`);
    tabEls.forEach((t) => {
      const on = t.dataset.ppTab === key;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    wirePanel();
  };

  if (panelEl) {
    wirePanel();
    tabEls.forEach((el) => el.addEventListener('click', () => showTab(el.dataset.ppTab)));
    content.querySelector('.pp-tabs')?.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const i = tabEls.findIndex((t) => t.dataset.ppTab === _profileTab);
      const next = tabEls[(i + step + tabEls.length) % tabEls.length];
      showTab(next.dataset.ppTab);
      next.focus();
    });
  }

  // Quick links and the "show all results" link open the panel. On desktop that
  // is the tab; on mobile it opens as a sub-view, since there is no tab bar to
  // switch. Both go through a full re-render.
  content.querySelectorAll('.pp-quick-row[data-pp-tab], .pp-link[data-pp-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.ppTab;
      _profileTab = key;
      // Only the mobile column renders these controls, so opening the sub-view
      // here is safe; the desktop tab bar is unaffected by the flag.
      if (window.matchMedia('(max-width: 768px)').matches) _profileMobileView = key;
      renderPlayerProfile();
    });
  });

  document.getElementById('ppMobileBack')?.addEventListener('click', () => {
    _profileMobileView = null;
    renderPlayerProfile();
  });

  // The picker is in the page twice - the desktop header and the mobile block,
  // one of them hidden by CSS - so the handler goes on every copy. It used to
  // find one by id, which was always the desktop copy: on a phone the picker
  // you could see did nothing.
  document.querySelectorAll('.pp-season-select').forEach((sel) => sel.addEventListener('change', (e) => {
    const raw = e.target.value;
    _profileSeason = raw === 'all' ? null : raw === 'none' ? 'none' : raw;
    _profileSeasonFor = p.id;
    renderPlayerProfile();
  }));
}

// ===== PROFILE HELPERS =====

/** Match/game/streak totals for a set of history rows (newest first). */
function _profileStats(rows) {
  const wins = rows.filter((m) => m.result === 'W').length;
  const losses = rows.filter((m) => m.result === 'L').length;
  const played = wins + losses;
  const gamesWon = rows.reduce((s, m) => s + (Number(m.my_score) || 0), 0);
  const gamesLost = rows.reduce((s, m) => s + (Number(m.their_score) || 0), 0);
  const gamesTotal = gamesWon + gamesLost;

  let currentStreak = 0;
  let streakType = null;
  for (const m of rows) {
    if (streakType === null) streakType = m.result;
    if (m.result !== streakType) break;
    currentStreak++;
  }

  return {
    wins, losses, played,
    winPct: played > 0 ? Math.round((wins / played) * 100) : null,
    gamesWon, gamesLost, gamesTotal,
    gameWinPct: gamesTotal > 0 ? Math.round((gamesWon / gamesTotal) * 100) : null,
    currentStreak, streakType: currentStreak ? streakType : null,
  };
}

function _quickLinksHTML(upcomingCount, tournCount) {
  const chev = `<svg class="pp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>`;
  return `
    <div class="pp-card pp-quick">
      <button class="pp-quick-row" data-pp-tab="upcoming">
        <span class="pp-quick-label">Upcoming matches</span>
        <span class="pp-quick-meta">${upcomingCount}</span>${chev}
      </button>
      <button class="pp-quick-row" data-pp-tab="tournaments">
        <span class="pp-quick-label">Tournaments</span>
        <span class="pp-quick-meta">${tournCount}</span>${chev}
      </button>
    </div>`;
}

// ===== PROFILE PHOTO =====
// Avatars are only ever drawn as small circles, so the browser resizes and
// re-encodes before upload: a phone photo goes from several megabytes to tens
// of kilobytes, which keeps the volume small and every avatar quick to load.
const PHOTO_MAX_PX = 512;
const PHOTO_QUALITY = 0.82;

function _shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.onload = () => {
        // Centre square crop, since every surface draws the photo in a circle.
        const side = Math.min(img.width, img.height);
        const out = Math.min(side, PHOTO_MAX_PX);
        const canvas = document.createElement('canvas');
        canvas.width = out;
        canvas.height = out;
        const ctx = canvas.getContext('2d');
        // JPEG has no alpha; without this a transparent PNG turns black.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, out, out);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
        resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function openPhotoModal(player) {
  modal.open('Profile Photo', `
    <div class="photo-modal">
      <div class="photo-preview" id="photoPreview">
        ${player.photo_path
          ? `<img src="${esc(player.photo_path)}" alt="">`
          : `<span>${esc(playerInitials(player.name))}</span>`}
      </div>
      <p class="form-hint">JPEG, PNG, WebP or GIF, up to 5 MB. Photos are cropped square and shrunk before they are saved.</p>
      <input type="file" id="fPhotoFile" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
      <div class="form-actions">
        ${player.photo_path ? `<button class="btn btn-danger" id="fPhotoRemove">Remove</button>` : ''}
        <button class="btn btn-outline" id="fPhotoCancel">Cancel</button>
        <button class="btn btn-primary" id="fPhotoChoose">Choose Image</button>
      </div>
    </div>`);

  const fileInput = document.getElementById('fPhotoFile');

  document.getElementById('fPhotoCancel').addEventListener('click', modal.close);
  document.getElementById('fPhotoChoose').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Image is too large. Maximum size is 5 MB.', 'error');

    const dataUrl = await _shrinkPhoto(file)
      .catch((err) => { toast(err.message, 'error'); return null; });
    if (!dataUrl) return;

    try {
      await window.api.setPlayerPhoto(player.id, dataUrl);
      modal.close();
      toast('Photo updated');
      await window.openPlayerProfile(player.id);
    } catch (err) {
      toast(err.message || 'Could not save photo', 'error');
    }
  });

  document.getElementById('fPhotoRemove')?.addEventListener('click', async () => {
    try {
      await window.api.deletePlayerPhoto(player.id);
      modal.close();
      toast('Photo removed');
      await window.openPlayerProfile(player.id);
    } catch (err) {
      toast(err.message || 'Could not remove photo', 'error');
    }
  });
}

function showAuthLinkModal(title, url) {
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

// ===== LADDER MATCH MODAL =====
export async function openPickupGameModal() {
  const adminMode = isAdmin();
  const myId = state.currentUser?.playerId;

  modal.open('Enter a match', '<div class="modal-loading">Loading players…</div>', { medium: true });

  const allPlayers = state.players.length ? state.players : await window.api.getPlayers();
  // Your own row comes from the session when the list does not carry it, rather
  // than depending on finding yourself in a list someone may one day filter:
  // when that lookup failed, every name here fell back to a placeholder and the
  // hint below read it as a noun. /api/me always answers for its own player.
  const me = allPlayers.find((p) => p.id === myId)
    || (myId && state.currentUser?.name
      ? { id: myId, name: state.currentUser.name, photo_path: state.currentUser.photo_path }
      : null);
  // "You", like the report-score and court-booking sheets, so a name that never
  // arrives still reads as a person rather than as the word "Me".
  const myName = adminMode ? '' : (me?.name || 'You');

  // The scoreline is asked as two questions — who won, then how many games the
  // loser took — and folded back into the player1/player2 pair the API has
  // always taken. `games` is the LOSER's count, so 0 is a real answer: every
  // check on it must be `!== null`, never truthiness.
  let winner = null;   // 1 | 2 | null
  let games  = null;   // 0 | 1 | 2 | null

  const todayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  let playedOn = todayISO;
  // A date before the current season would file the match into a finished
  // ladder, so the picker stops there. The server enforces the same bound.
  let seasonStart = null;
  let seasonName = '';

  function searchSelectorHTML(id, placeholder) {
    return `<div class="pu-search-wrap">
      <div class="pu-search-input-row">
        <input type="text" class="form-control pu-search-input" id="${id}Search" placeholder="${placeholder}" autocomplete="off">
        <button type="button" class="pu-search-clear" id="${id}Clear">×</button>
      </div>
      <div class="pu-search-list" id="${id}List"></div>
      <input type="hidden" id="${id}">
    </div>`;
  }

  function wireSearch(id, getExcludeId, onChange) {
    const searchEl = document.getElementById(id + 'Search');
    const listEl   = document.getElementById(id + 'List');
    const hiddenEl = document.getElementById(id);
    const clearEl  = document.getElementById(id + 'Clear');

    function showList() {
      const q = searchEl.value.trim().toLowerCase();
      const excludeId = typeof getExcludeId === 'function' ? getExcludeId() : getExcludeId;
      const filtered = allPlayers
        .filter((p) => p.id !== excludeId && (!q || p.name.toLowerCase().includes(q)))
        .slice(0, 10);
      listEl.innerHTML = filtered.map((p) =>
        `<div class="pu-search-option" data-id="${p.id}" data-name="${esc(p.name)}">
          ${avatarHTML(p, 'em-opt-avatar')}
          <span class="em-opt-name">${esc(p.name)}</span>
        </div>`
      ).join('') || `<div class="pu-search-empty">No players found</div>`;
      listEl.style.display = 'block';
      listEl.querySelectorAll('.pu-search-option').forEach((opt) => {
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          hiddenEl.value = opt.dataset.id;
          // dataset.name, not textContent: the row now carries an avatar, whose
          // initials would otherwise be pasted into the field alongside the name.
          searchEl.value = opt.dataset.name;
          clearEl.style.display = '';
          listEl.style.display = 'none';
          onChange();
        });
      });
    }

    clearEl.style.display = 'none';
    searchEl.addEventListener('focus', showList);
    searchEl.addEventListener('input', showList);
    searchEl.addEventListener('blur', () => setTimeout(() => { listEl.style.display = 'none'; }, 150));
    clearEl.addEventListener('click', () => {
      hiddenEl.value = '';
      searchEl.value = '';
      clearEl.style.display = 'none';
      listEl.style.display = 'none';
      onChange();
    });
  }

  const p1Id = () => (adminMode ? Number(document.getElementById('puP1')?.value) || null : myId || null);
  const p2Id = () => Number(document.getElementById('puP2')?.value) || null;
  const bothChosen = () => !!(p1Id() && p2Id());
  // Slot 1 is the player themselves whenever an admin is not filling both
  // sides. Declared above its first use, not beside the other helpers: a const
  // arrow is not hoisted, so a later declaration only survives because these
  // run at render time.
  const isSelf = (slot) => !adminMode && slot === 1;

  function playerFor(slot) {
    const id = slot === 1 ? p1Id() : p2Id();
    if (!id) return null;
    // Same reason as `me` above: your own row may not be in the list, and
    // without this the winner card falls back to initials over your photo.
    return allPlayers.find((p) => p.id === id) || (isSelf(slot) ? me : null);
  }
  function nameFor(slot) {
    const p = playerFor(slot);
    if (p) return p.name;
    if (slot === 1) return adminMode ? 'Player 1' : myName;
    return adminMode ? 'Player 2' : 'Opponent';
  }
  const firstName = (n) => String(n || '').split(' ')[0];
  // You take "Your", never a possessive name: a pronoun bent into one reads as
  // broken English however the name was resolved.
  const possessive = (slot) => (isSelf(slot) ? 'Your' : `${firstName(nameFor(slot))}'s`);

  const CHECK_SVG = `<svg class="em-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`;

  const GAME_OPTIONS = [
    { games: 0, caption: 'in three' },
    { games: 1, caption: 'in four' },
    { games: 2, caption: 'in five' },
  ];

  function renderWinner() {
    const can = bothChosen();
    document.getElementById('emWinnerHint').textContent =
      can ? '' : (adminMode ? 'Choose both players' : 'Pick an opponent first');

    document.getElementById('emWinnerGrid').innerHTML = [1, 2].map((slot) => {
      const p = playerFor(slot);
      const sel = winner === slot;
      return `<button type="button" class="em-winner-card${sel ? ' em-winner-card--selected' : ''}"
        data-slot="${slot}"${can ? '' : ' disabled'}>
        ${avatarHTML(p || { name: nameFor(slot) }, 'em-winner-avatar')}
        <span class="em-winner-name">${esc(nameFor(slot))}</span>
        ${sel ? CHECK_SVG : ''}
      </button>`;
    }).join('');
  }

  function renderGames() {
    const section = document.getElementById('emGamesSection');
    // Hidden rather than disabled until a winner exists: the question has no
    // meaning yet, so it should not be on screen.
    section.hidden = winner === null;
    if (winner === null) return;

    document.getElementById('emGamesHint').textContent = `${possessive(winner)} games first`;
    document.getElementById('emGamesGrid').innerHTML = GAME_OPTIONS.map((o) => {
      const sel = games === o.games;
      return `<button type="button" class="em-games-card${sel ? ' em-games-card--selected' : ''}" data-games="${o.games}">
        <span class="em-games-score">3–${o.games}</span>
        <span class="em-games-caption">${o.caption}</span>
      </button>`;
    }).join('');
  }

  const isComplete = () => bothChosen() && winner !== null && games !== null;

  function renderConfirm() {
    const box = document.getElementById('emConfirm');
    box.hidden = !isComplete();
    if (box.hidden) return;
    const loser = winner === 1 ? 2 : 1;
    box.innerHTML = `${CHECK_SVG}<span class="em-confirm-text">${esc(nameFor(winner))} beat ${esc(nameFor(loser))} 3–${games}</span>`;
  }

  function renderFooter() {
    let note = '';
    if (!bothChosen()) note = adminMode ? 'Choose both players' : 'Choose your opponent';
    else if (winner === null || games === null) note = 'Pick a winner and a scoreline';
    document.getElementById('emMissing').textContent = note;
    document.getElementById('puSubmit').disabled = !isComplete();
  }

  function update() {
    renderWinner();
    renderGames();
    renderConfirm();
    renderFooter();
  }

  function onPlayerChange() {
    // A different pairing invalidates both halves of the scoreline.
    winner = null;
    games = null;
    update();
  }

  const playersSectionHTML = adminMode
    ? `<div class="em-section">
        <div class="em-label">Players</div>
        <div class="em-players-row">
          <div class="em-player-col">${searchSelectorHTML('puP1', 'Search players…')}</div>
          <div class="em-vs">vs</div>
          <div class="em-player-col">${searchSelectorHTML('puP2', 'Search players…')}</div>
        </div>
      </div>`
    : `<div class="em-section">
        <div class="em-self-card">
          ${avatarHTML(me || { name: myName }, 'em-self-avatar')}
          <span class="em-self-name">${esc(myName)}</span>
          <span class="em-you-chip">YOU</span>
        </div>
        <div class="em-vs em-vs-stacked">vs</div>
        ${searchSelectorHTML('puP2', 'Search opponent…')}
      </div>`;

  document.getElementById('modalBody').innerHTML = `
    <div class="em-modal">
      ${playersSectionHTML}

      <div class="em-section">
        <div class="em-label-row">
          <span class="em-label">Who won?</span>
          <span class="em-hint" id="emWinnerHint"></span>
        </div>
        <div class="em-winner-grid" id="emWinnerGrid"></div>
      </div>

      <div class="em-section" id="emGamesSection" hidden>
        <div class="em-label-row">
          <span class="em-label">Games</span>
          <span class="em-hint" id="emGamesHint"></span>
        </div>
        <div class="em-games-grid" id="emGamesGrid"></div>
      </div>

      <div class="em-section em-date-section">
        <span class="em-label">Date played</span>
        <div class="em-date-controls">
          <button type="button" class="em-today-chip em-today-chip--active" id="emToday">Today</button>
          <input type="date" class="em-date-input" id="emDate" value="${todayISO}" max="${todayISO}">
        </div>
      </div>

      <div class="em-confirm" id="emConfirm" hidden></div>

      <div class="em-footer">
        <span class="em-missing" id="emMissing"></span>
        <div class="em-footer-btns">
          <button type="button" class="btn btn-ghost" id="emCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="puSubmit" disabled>Log match</button>
        </div>
      </div>
    </div>`;

  update();

  if (adminMode) {
    wireSearch('puP1', () => p2Id(), onPlayerChange);
    wireSearch('puP2', () => p1Id(), onPlayerChange);
  } else {
    wireSearch('puP2', myId, onPlayerChange);
  }

  document.getElementById('emWinnerGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.em-winner-card');
    if (!btn || btn.disabled) return;
    const slot = Number(btn.dataset.slot);
    // Switching winner keeps the games count: 3–1 means the same shape of match
    // either way round, and re-asking for it would be busywork.
    winner = winner === slot ? null : slot;
    update();
  });

  document.getElementById('emGamesGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.em-games-card');
    if (!btn) return;
    const g = Number(btn.dataset.games);
    games = games === g ? null : g;
    update();
  });

  const dateEl = document.getElementById('emDate');
  const todayChip = document.getElementById('emToday');
  function setDate(value) {
    playedOn = value || todayISO;
    dateEl.value = playedOn;
    todayChip.classList.toggle('em-today-chip--active', playedOn === todayISO);
  }
  dateEl.addEventListener('change', () => {
    let v = dateEl.value;
    if (!v) { setDate(todayISO); return; }
    if (v > todayISO) { toast('A match cannot be played in the future.', 'warning'); v = todayISO; }
    else if (seasonStart && v < seasonStart) {
      toast(`That date is before the ${seasonName} season started.`, 'warning');
      v = seasonStart;
    }
    setDate(v);
  });
  todayChip.addEventListener('click', () => setDate(todayISO));

  document.getElementById('emCancel').addEventListener('click', () => modal.close());

  // Bounding the picker needs the season boundary, which nothing else on this
  // screen knows. Fetched after the modal is usable so a slow reply never
  // blocks entry, and the server rejects an out-of-range date regardless.
  window.api.getSeasons().then((seasons) => {
    const current = (seasons || []).find((s) => s.is_current);
    if (!current || !document.getElementById('emDate')) return;
    seasonStart = current.start_date;
    seasonName = current.name;
    document.getElementById('emDate').setAttribute('min', seasonStart);
  }).catch(() => {});

  document.getElementById('puSubmit').addEventListener('click', async () => {
    const p1 = p1Id();
    const p2 = p2Id();
    if (!p1 || !p2)   { toast('Please select both players.', 'warning'); return; }
    if (p1 === p2)    { toast('Players must be different.', 'warning'); return; }
    if (winner === null || games === null) { toast('Please select a score.', 'warning'); return; }
    const winnerIsP1 = winner === 1;
    const btn = document.getElementById('puSubmit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      await window.api.logPickupGame({
        player1Id: p1,
        player2Id: p2,
        player1Score: winnerIsP1 ? 3 : games,
        player2Score: winnerIsP1 ? games : 3,
        // Left off for a match played today so the row keeps a real timestamp
        // rather than a flattened midday one, which is what orders same-day
        // matches in the rating replay.
        ...(playedOn !== todayISO ? { playedOn } : {}),
      });
      toast('Ladder match recorded!', 'success');
      modal.close();
      if (state.page === 'ladder') window.renderLadder();
      else if (state.page === 'dashboard') window.renderDashboard();
    } catch (err) {
      toast(err.message || 'Failed to log game', 'error');
      btn.disabled = false;
      btn.textContent = 'Log match';
    }
  });
}

// ===== REPORT SCORE MODAL (player) =====
export async function openReportScoreModal() {
  const playerId = state.currentUser?.playerId;
  if (!playerId) return;

  modal.open('Report a Score', '<div class="modal-loading">Loading matches…</div>');

  const playerData = await fetch(`/api/players/${playerId}/history`).then((r) => r.json());
  const upcoming = playerData.upcoming || [];

  function fmtDate(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function showMatchList() {
    if (upcoming.length === 0) {
      document.getElementById('modalBody').innerHTML =
        '<div class="rsc-empty">You have no unscored matches to report.</div>';
      return;
    }
    document.getElementById('modalBody').innerHTML = `
      <p class="rsc-instructions">Select the match you want to report a score for.</p>
      <div class="rsc-match-list">
        ${upcoming.map((m) => {
          const isTbd = m.opponent_name === 'TBD';
          return `
          <button class="rsc-match-item${isTbd ? ' rsc-match-item--tbd' : ''}" data-match-id="${m.id}" data-source="${m.source || 'league'}" data-opponent="${esc(m.opponent_name)}" ${isTbd ? 'disabled' : ''}>
            <div class="rsc-match-opp">vs ${esc(m.opponent_name)}${isTbd ? ' <span class="rsc-tbd-note">(opponent not yet determined)</span>' : ''}</div>
            <div class="rsc-match-meta">${esc(m.league_name)}${m.division_name ? ' · ' + esc(m.division_name) : ''} &nbsp;·&nbsp; ${fmtDate(m.week_date)}</div>
          </button>`;
        }).join('')}
      </div>`;
    document.getElementById('modalBody').querySelectorAll('.rsc-match-item').forEach((btn) => {
      btn.addEventListener('click', () => showScoreForm(btn.dataset.matchId, btn.dataset.opponent, btn.dataset.source));
    });
  }

  function showScoreForm(matchId, opponentName, source) {
    document.getElementById('modalBody').innerHTML = `
      <button class="rsc-back-btn" id="rscBack">← Back</button>
      <div class="rsc-matchup-header">
        <span class="rsc-you">${esc(playerData.name)}</span>
        <span class="rsc-vs">vs</span>
        <span class="rsc-opp">${esc(opponentName)}</span>
      </div>
      <div class="rsc-score-form">
        <div class="rsc-score-side">
          <div class="rsc-score-label">Your Score</div>
          <input id="rscMyScore" class="rsc-score-input" type="number" min="0" max="3" placeholder="0">
        </div>
        <div class="rsc-score-sep">–</div>
        <div class="rsc-score-side">
          <div class="rsc-score-label">Their Score</div>
          <input id="rscTheirScore" class="rsc-score-input" type="number" min="0" max="3" placeholder="0">
        </div>
      </div>
      <button class="btn btn-primary rsc-submit-btn" id="rscSubmit">Submit Score</button>`;

    document.getElementById('rscBack').addEventListener('click', showMatchList);

    document.getElementById('rscSubmit').addEventListener('click', async () => {
      const myScore    = Number(document.getElementById('rscMyScore').value);
      const theirScore = Number(document.getElementById('rscTheirScore').value);

      const valid = Number.isInteger(myScore) && Number.isInteger(theirScore)
        && myScore >= 0 && myScore <= 3 && theirScore >= 0 && theirScore <= 3
        && (myScore === 3 || theirScore === 3) && myScore !== theirScore;

      if (!valid) {
        toast('Invalid score. One player must win 3 games (e.g. 3–1, 3–2)', 'warning');
        return;
      }

      const submitBtn = document.getElementById('rscSubmit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
      try {
        if (source === 'tournament') {
          const rawId = Number(String(matchId).replace('t_', ''));
          await window.api.reportTournamentPlayerScore(rawId, { myScore, theirScore });
        } else {
          await window.api.reportPlayerScore({ matchId: Number(matchId), myScore, theirScore });
        }
        toast('Score submitted successfully!', 'success');
        modal.close();
        if (state.page === 'dashboard') window.renderDashboard();
      } catch (err) {
        toast(err.message || 'Failed to submit score', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Score';
      }
    });
  }

  showMatchList();
}

// Set window exports so onclick HTML attributes work as soon as this module loads
window.openPlayerProfile = openPlayerProfile;
window.openPickupGameModal = openPickupGameModal;
window.openReportScoreModal = openReportScoreModal;
