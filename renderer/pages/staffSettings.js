import { state, can, isAdminAccount, isStaff } from '../state.js';
import { esc, toast, modal, playerInitials } from '../utils.js';
import { confirmModal } from '../upcoming.js';

// Settings for the club side (design_handoff_staff_accounts): the tabs, the
// Staff accounts tab with its invite and edit pages (the admin account
// only), the Activity log, a staff member's My account, and the page shown
// when someone follows a link to something they may not use.

// ===== THE TABS =====

const TABS = [
  { key: 'club', label: 'Club', show: () => can('club') },
  { key: 'ladder', label: 'Ladder and seasons', show: () => can('ladder') },
  { key: 'courts', label: 'Courts and booking', show: () => can('courts') },
  { key: 'staff', label: 'Staff accounts', show: () => isAdminAccount() },
  { key: 'log', label: 'Activity log', show: () => can('log') },
  { key: 'account', label: 'My account', show: () => isStaff() },
];
const TAB_PERMISSION = { club: 'Club settings', ladder: 'Ladder and seasons', courts: 'Courts and booking types', log: 'Activity log' };

export const visibleSettingsTabs = () => TABS.filter((t) => t.show());

/**
 * The tab to show, or null when the one asked for is not this person's to
 * see (the caller then shows the Not allowed page).
 */
export function resolveSettingsTab() {
  const tabs = visibleSettingsTabs();
  const asked = state.settingsTab;
  if (asked && TABS.some((t) => t.key === asked)) return tabs.some((t) => t.key === asked) ? asked : null;
  return tabs[0]?.key || null;
}

export function settingsTabsHTML(active) {
  return `<div class="sa-tabs"><div class="tabbar" role="tablist" aria-label="Settings">
    ${visibleSettingsTabs().map((t) => `<button class="tab${t.key === active ? ' tab--on' : ''}" role="tab" aria-selected="${t.key === active}" data-sa-tab="${t.key}">${t.label}</button>`).join('')}
  </div></div>`;
}

export function wireSettingsTabs(root) {
  root.querySelectorAll('[data-sa-tab]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.saTab === state.settingsTab) return;
    window.navigate('clubSettings', { settingsTab: b.dataset.saTab }, { pushHistory: false });
  }));
}

/** Not allowed: rendered in place, under the title of the page they tried. */
export function renderDenied(sentence) {
  document.getElementById('topbarActions').innerHTML = '';
  document.getElementById('mainContent').innerHTML = `
    <div class="sa-denied">
      <span class="sa-denied-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg></span>
      <h2>You don't have access to this page</h2>
      <p>${esc(sentence)} Ask the club administrator if you need it.</p>
      <button class="btn btn-primary" id="saDeniedHome">Go to Dashboard</button>
    </div>`;
  document.getElementById('saDeniedHome').addEventListener('click', () => window.navigate('dashboard'));
}

export function deniedSentenceForTab(key) {
  if (key === 'staff') return 'Staff accounts are managed by the admin account.';
  if (key === 'account') return 'My account is for staff accounts.';
  return `This tab needs the ${TAB_PERMISSION[key] || 'right'} permission.`;
}

/** Render one of the new tabs (staff, log, account) under the tab bar. */
export async function renderNewSettingsTab(tab) {
  const content = document.getElementById('mainContent');
  content.innerHTML = `${settingsTabsHTML(tab)}<div id="saTabBody"><div style="padding:20px;color:var(--text-muted)">Loading…</div></div>`;
  wireSettingsTabs(content);
  const body = document.getElementById('saTabBody');
  if (tab === 'staff') await _renderStaffList(body);
  else if (tab === 'log') await _renderLog(body);
  else if (tab === 'account') await _renderAccount(body);
}

// ===== SHARED BITS =====

const _tz = () => state.currentUser?.club_timezone || undefined;
const _fmt = (iso, opts) => new Intl.DateTimeFormat('en-US', { timeZone: _tz(), ...opts }).format(new Date(iso));
const _dayKey = (iso) => _fmt(iso, { year: 'numeric', month: '2-digit', day: '2-digit' });
const _time = (iso) => _fmt(iso, { hour: 'numeric', minute: '2-digit' });
const _short = (iso) => _fmt(iso, { month: 'short', day: 'numeric' });
const _date = (iso) => _fmt(iso, { month: 'short', day: 'numeric', year: 'numeric' });

/** "Today, 7:12 PM", "Sep 28, 2026", or "Never". */
function _when(iso) {
  if (!iso) return 'Never';
  return _dayKey(iso) === _dayKey(new Date().toISOString()) ? `Today, ${_time(iso)}` : _date(iso);
}
const _first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const STATUS = { active: ['Active', 'pill--green'], invited: ['Invited', 'pill--amber'], disabled: ['Disabled', 'pill--grey'] };
const _pill = (status) => `<span class="pill ${STATUS[status][1]}">${STATUS[status][0]}</span>`;

const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';

/** A labelled switch row, using the app's one switch (.ps-switch). */
function _switchRow({ title, desc, checked, disabled = false, attrs = '' }) {
  return `<label class="sa-switch-row">
    <span class="sa-switch-text"><span class="sa-switch-title">${esc(title)}</span><span class="sa-switch-desc">${esc(desc)}</span></span>
    <span class="ps-switch"><input type="checkbox"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''} ${attrs}><span class="ps-switch-track"></span><span class="ps-switch-knob"></span></span>
  </label>`;
}

function _fieldError(input, message) {
  const group = input.closest('.form-group');
  group.querySelector('.form-error')?.remove();
  input.classList.add('ps-invalid');
  group.insertAdjacentHTML('beforeend', `<div class="form-error">${esc(message)}</div>`);
  input.focus();
  input.addEventListener('input', () => { input.classList.remove('ps-invalid'); group.querySelector('.form-error')?.remove(); }, { once: true });
}

// ===== STAFF ACCOUNTS: THE LIST =====

const GMAIL_HINT = (who) => `Gmail users can use an alias such as <code>${who}+staff@gmail.com</code>, which arrives in the same inbox.`;

async function _renderStaffList(body) {
  document.getElementById('topbarActions').innerHTML = `<button class="btn btn-primary btn-sm" id="saInviteBtn">${PLUS}<span>Invite staff member</span></button>`;
  document.getElementById('saInviteBtn').addEventListener('click', () => window.navigate('staffMember', { staffId: null }));
  const { staff } = await window.api.getStaff();
  if (!staff.length) {
    body.innerHTML = `<div style="max-width:860px"><div class="table-card"><div class="empty-state">
      <strong style="font-size:15px;color:var(--text)">No staff accounts yet</strong>
      <p style="max-width:420px;line-height:1.5">Invite each staff member and choose what they can do.</p>
      <p style="max-width:420px;line-height:1.5">Each person needs their own email, different from their player account's. Gmail users can use an alias such as <code style="font-family:ui-monospace,Menlo,monospace;font-size:12px">sam+staff@gmail.com</code>, which arrives in the same inbox.</p>
    </div></div></div>`;
    return;
  }
  body.innerHTML = `<div style="max-width:860px;display:flex;flex-direction:column;gap:16px">
    <div class="table-card">
      <div class="sa-staff-cols"><span>Staff member</span><span>Status</span><span>Two-step</span><span>Last signed in</span></div>
      <div class="sa-staff-list">
        ${staff.map((s) => {
          const last = s.last_signed_in_at ? _when(s.last_signed_in_at) : 'Never';
          const meta = [s.require_two_step ? 'Two-step' : null, last === 'Never' ? 'Never signed in' : `Signed in ${last}`].filter(Boolean).join(' · ');
          return `<a class="sa-staff-row${s.status === 'disabled' ? ' sa-staff-row--off' : ''}" href="#" data-staff="${s.id}">
            <div class="sa-staff-who"><span class="sa-av">${esc(playerInitials(s.name))}</span><div class="sa-staff-text"><span class="sa-staff-name">${esc(s.name)}</span><span class="sa-staff-email">${esc(s.email)}</span><span class="sa-staff-meta">${esc(meta)}</span></div></div>
            <div class="sa-staff-cell sa-staff-cell--status">${_pill(s.status)}</div>
            <div class="sa-staff-cell${s.require_two_step ? '' : ' sa-staff-cell--muted'}">${s.require_two_step ? 'Required' : 'Not required'}</div>
            <div class="sa-staff-cell${last === 'Never' ? ' sa-staff-cell--muted' : ''}">${esc(last)}</div>
          </a>`;
        }).join('')}
      </div>
    </div>
    <p class="sa-help" style="margin:0">Only the admin account manages staff accounts: it is not a permission, so no one can grant themselves access. Disabled accounts are kept so their names stay in the activity log.</p>
  </div>`;
  body.querySelectorAll('[data-staff]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    window.navigate('staffMember', { staffId: Number(a.dataset.staff) });
  }));
}

// ===== STAFF ACCOUNTS: INVITE AND EDIT =====

function _permsSection({ firstName, perms, permissions, disabled = false, desc }) {
  return `<div class="settings-section"${disabled ? ' style="opacity:.6"' : ''}>
    <div class="sa-perms-head"><h2 class="settings-section-title">Permissions</h2><div class="sa-perms-actions">
      <button type="button" class="btn btn-ghost btn-sm" id="saSelectAll"${disabled ? ' disabled' : ''}>Select all</button>
      <button type="button" class="btn btn-ghost btn-sm" id="saClearAll"${disabled ? ' disabled' : ''}>Clear all</button>
    </div></div>
    <p class="settings-section-desc">${esc(desc ?? `What ${firstName || 'they'} can do.`)}</p>
    <div class="sa-perms-list">
      ${permissions.map((p) => _switchRow({ title: p.name, desc: p.desc, checked: perms.includes(p.key), disabled, attrs: `data-perm="${p.key}"` })).join('')}
    </div>
  </div>`;
}

function _wirePerms(root) {
  const boxes = () => [...root.querySelectorAll('[data-perm]')];
  root.querySelector('#saSelectAll')?.addEventListener('click', () => boxes().forEach((b) => { b.checked = true; }));
  root.querySelector('#saClearAll')?.addEventListener('click', () => boxes().forEach((b) => { b.checked = false; }));
  return () => boxes().filter((b) => b.checked).map((b) => b.dataset.perm);
}

function _twoStepDesc(s) {
  if (!s) return 'After their password, a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Apple Passwords). They set it up when they accept the invite.';
  const first = _first(s.name);
  if (s.status === 'invited') return `${first} will set up an authenticator app when they accept the invite.`;
  if (s.two_step_on) return `${first} set this up on ${_date(s.totp_enabled_at)}. Turning it off lets them turn two-step sign-in off themselves in My account; their authenticator stays paired until they do.`;
  if (s.require_two_step) return `${first} will set up an authenticator app the next time they sign in.`;
  return `After their password, a 6-digit code from an authenticator app. If you turn this on, ${first} sets it up the next time they sign in.`;
}

/** The invite page (no id) or a staff member's page. */
export async function renderStaffMember() {
  const id = state.currentStaffId;
  const content = document.getElementById('mainContent');
  document.getElementById('topbarActions').innerHTML = '';
  if (!isAdminAccount()) {
    document.getElementById('pageTitle').textContent = 'Staff accounts';
    return renderDenied('Staff accounts are managed by the admin account.');
  }
  content.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading…</div>';
  const data = id == null ? await window.api.getStaff() : await window.api.getStaffMember(id);
  const s = id == null ? null : data.staff;
  document.getElementById('pageTitle').textContent = s ? s.name : 'Invite staff member';
  const permissions = data.permissions;
  const backToList = () => window.navigate('clubSettings', { settingsTab: 'staff' });

  if (!s) {
    content.innerHTML = `<form class="sa-page" id="saForm" novalidate>
      <div class="settings-section">
        <div class="settings-section-header"><h2 class="settings-section-title">Who</h2></div>
        <p class="settings-section-desc">They get an email with a link to set their name and password. The link works for 7 days.</p>
        <div class="season-settings" style="margin-bottom:0">
          <div class="form-group"><label class="form-label" for="fInvName">Name</label><input class="form-control" id="fInvName" type="text" placeholder="Their full name" autocomplete="off"></div>
          <div class="form-group" style="margin-bottom:0"><label class="form-label" for="fInvEmail">Email</label><input class="form-control" id="fInvEmail" type="email" placeholder="name@example.com" autocomplete="off">
            <p class="sa-help">This must be different from the email on their player account, if they have one. ${GMAIL_HINT('jordan')}</p>
          </div>
        </div>
      </div>
      ${_permsSection({ perms: [], permissions, desc: 'What they can do. Everything else is read-only for them, as it is for players. You can change these any time.' })}
      <div class="settings-section">
        <div class="settings-section-header"><h2 class="settings-section-title">Two-step sign-in</h2></div>
        ${_switchRow({ title: 'Require two-step sign-in', desc: _twoStepDesc(null), checked: false, attrs: 'id="saTwoStep"' }).replace('class="sa-switch-row"', 'class="sa-switch-row" style="border:0;padding-bottom:0"')}
      </div>
      <div class="form-actions" style="margin-top:0"><button type="button" class="btn btn-ghost" id="saCancel">Cancel</button><button type="submit" class="btn btn-primary" id="saSubmit">Send invite</button></div>
    </form>`;
    const form = document.getElementById('saForm');
    const permsOf = _wirePerms(form);
    document.getElementById('saCancel').addEventListener('click', backToList);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameEl = document.getElementById('fInvName');
      const emailEl = document.getElementById('fInvEmail');
      if (!nameEl.value.trim()) return _fieldError(nameEl, 'Enter their name.');
      if (!emailEl.value.trim()) return _fieldError(emailEl, 'Enter an email address.');
      const btn = document.getElementById('saSubmit');
      btn.disabled = true;
      try {
        await window.api.inviteStaff({ name: nameEl.value, email: emailEl.value, permissions: permsOf(), require_two_step: document.getElementById('saTwoStep').checked });
        toast(`Invite sent to ${emailEl.value.trim()}`, 'success');
        backToList();
      } catch (err) {
        btn.disabled = false;
        if (err.field === 'name') _fieldError(nameEl, err.message);
        else if (err.field === 'email') _fieldError(emailEl, err.message);
        else toast("Couldn't send the invite. Try again.", 'error');
      }
    });
    return;
  }

  const first = _first(s.name);
  const off = s.status === 'disabled';
  const sub = s.status === 'invited'
    ? `${s.email} · Invited ${_when(s.invited_at).replace(/^Today/, 'today')} · Link works until ${_short(s.invite_expires)}`
    : `${s.email} · Last signed in ${_when(s.last_signed_in_at).replace(/^Today/, 'today')} · Two-step ${s.two_step_on ? 'on' : 'off'}`;
  const actions = s.status === 'active'
    ? '<button type="button" class="btn btn-secondary btn-sm" id="saReset">Send password reset</button><button type="button" class="btn btn-danger-outline btn-sm" id="saDisable">Disable account</button>'
    : s.status === 'invited'
      ? '<button type="button" class="btn btn-secondary btn-sm" id="saResend">Resend invite</button><button type="button" class="btn btn-danger-outline btn-sm" id="saCancelInvite">Cancel invite</button>'
      : '<button type="button" class="btn btn-primary btn-sm" id="saEnable">Enable account</button>';
  content.innerHTML = `<form class="sa-page" id="saForm" novalidate>
    ${off ? `<div class="sa-notice">${INFO}<span><strong>This account is disabled.</strong> ${esc(first)} was signed out everywhere on ${esc(_short(s.disabled_at))} and can't sign in. Their name stays on everything they did in the activity log. Enabling the account restores the permissions below.</span></div>` : ''}
    <div class="settings-section">
      <div class="sa-who-card"><span class="sa-av sa-av--lg"${off ? ' style="background:var(--silver)"' : ''}>${esc(playerInitials(s.name))}</span><div class="sa-who-text"><span class="sa-who-name">${esc(s.name)} ${_pill(s.status)}</span><span class="sa-who-sub">${esc(sub)}</span></div></div>
      <div class="sa-who-actions">${actions}</div>
    </div>
    ${_permsSection({
      firstName: first, perms: s.permissions, permissions, disabled: off,
      desc: off ? 'Kept as they were. Enable the account to change them.'
        : s.status === 'invited' ? `What ${first} can do once they accept.` : `What ${first} can do. Changes apply the next time their app loads.`,
    })}
    ${off ? '' : `<div class="settings-section">
      <div class="settings-section-header"><h2 class="settings-section-title">Two-step sign-in</h2></div>
      ${_switchRow({ title: 'Require two-step sign-in', desc: _twoStepDesc(s), checked: s.require_two_step, attrs: 'id="saTwoStep"' }).replace('class="sa-switch-row"', 'class="sa-switch-row" style="border:0;padding-bottom:0"')}
    </div>
    <div class="form-actions" style="margin-top:0"><button type="button" class="btn btn-ghost" id="saCancel">Cancel</button><button type="submit" class="btn btn-primary" id="saSubmit">Save changes</button></div>`}
  </form>`;

  const form = document.getElementById('saForm');
  const permsOf = _wirePerms(form);
  const reload = () => renderStaffMember();
  document.getElementById('saCancel')?.addEventListener('click', backToList);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await window.api.updateStaff(s.id, { permissions: permsOf(), require_two_step: document.getElementById('saTwoStep').checked });
      toast('Changes saved', 'success');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('saReset')?.addEventListener('click', async () => {
    try { await window.api.sendStaffReset(s.id); toast(`Password reset sent to ${s.email}`, 'success'); } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('saResend')?.addEventListener('click', async () => {
    try { await window.api.resendStaffInvite(s.id); toast(`Invite resent to ${s.email}`, 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('saEnable')?.addEventListener('click', async () => {
    try { await window.api.enableStaff(s.id); toast(`${s.name}'s account is enabled.`, 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('saDisable')?.addEventListener('click', () => confirmModal({
    title: 'Disable account',
    body: `Disable <strong>${esc(s.name)}</strong>? They are signed out everywhere and can't sign in until you enable the account again. Their name stays in the activity log.`,
    confirm: 'Disable account', bodyClass: '',
    onConfirm: async () => {
      try { await window.api.disableStaff(s.id); toast(`${s.name}'s account is disabled.`, 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
    },
  }));
  document.getElementById('saCancelInvite')?.addEventListener('click', () => confirmModal({
    title: 'Cancel invite',
    body: `Cancel the invite to <strong>${esc(s.name)}</strong>? The link in their email stops working and they are removed from the list.`,
    cancel: 'Keep invite', confirm: 'Cancel invite', bodyClass: '',
    onConfirm: async () => {
      try { await window.api.cancelStaffInvite(s.id); toast(`The invite to ${s.name} is cancelled.`, 'success'); backToList(); } catch (err) { toast(err.message, 'error'); }
    },
  }));
}

// ===== THE ACTIVITY LOG =====

const log = { filters: { person: '', area: '', from: '', to: '' }, entries: [], total: 0, people: [], areas: [] };

async function _renderLog(body) {
  document.getElementById('topbarActions').innerHTML = '';
  const filters = await window.api.getActivityLogFilters();
  log.people = filters.people;
  log.areas = filters.areas;
  await _loadLog(false);
  _paintLog(body);
}

async function _loadLog(more) {
  const q = Object.fromEntries(Object.entries(log.filters).filter(([, v]) => v));
  if (more && log.entries.length) q.before = log.entries[log.entries.length - 1].id;
  const page = await window.api.getActivityLog(q);
  log.total = page.total;
  log.entries = more ? [...log.entries, ...page.entries] : page.entries;
}

function _dayHeading(iso) {
  const key = _dayKey(iso);
  const today = new Date();
  const ago = (n) => _dayKey(new Date(today.getTime() - n * 86400000).toISOString());
  if (key === ago(0)) return `Today · ${_short(iso)}`;
  if (key === ago(1)) return `Yesterday · ${_short(iso)}`;
  for (let n = 2; n < 7; n++) if (key === ago(n)) return `${_fmt(iso, { weekday: 'long' })} · ${_short(iso)}`;
  return _short(iso);
}

function _paintLog(body) {
  const f = log.filters;
  const filtered = Object.values(f).some(Boolean);
  const nobody = log.total === 0 && !filtered;
  const areaName = Object.fromEntries(log.areas.map((a) => [a.key, a.name]));
  const opt = (v, label, sel) => `<option value="${esc(v)}"${String(sel) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
  const n = log.total.toLocaleString('en-US');
  const summary = filtered
    ? [
      `${n} entr${log.total === 1 ? 'y' : 'ies'}`,
      f.person ? log.people.find((p) => String(p.id) === String(f.person))?.name : null,
      f.area ? areaName[f.area] : null,
      f.from || f.to ? `${f.from ? _short(`${f.from}T12:00:00Z`) : 'start'} to ${f.to ? _short(`${f.to}T12:00:00Z`) : 'now'}` : null,
    ].filter(Boolean).join(' · ')
    : `${n} entr${log.total === 1 ? 'y' : 'ies'}`;

  let rows = '';
  let lastDay = null;
  for (const e of log.entries) {
    const day = _dayHeading(e.at);
    if (day !== lastDay) { rows += `<div class="sa-log-day">${esc(day)}</div>`; lastDay = day; }
    rows += `<div class="sa-log-row"><div class="sa-log-text"><span class="sa-log-actor">${esc(e.actor)}</span> ${esc(e.text)}</div><div class="sa-log-right"><span class="chip chip--members">${esc(areaName[e.area] || e.area)}</span><span class="sa-log-time">${esc(_time(e.at))}</span></div></div>`;
  }

  body.innerHTML = `<div style="max-width:860px">
    <div class="sa-log-filters">
      <select class="form-control" aria-label="Person" id="saLogPerson"${nobody ? ' disabled' : ''}>${opt('', 'Everyone', f.person)}${log.people.map((p) => opt(p.id, p.name, f.person)).join('')}</select>
      <select class="form-control" aria-label="Area" id="saLogArea"${nobody ? ' disabled' : ''}>${opt('', 'All areas', f.area)}${log.areas.map((a) => opt(a.key, a.name, f.area)).join('')}</select>
      <input class="form-control" type="date" aria-label="From" id="saLogFrom" value="${esc(f.from)}"${nobody ? ' disabled' : ''}>
      <input class="form-control" type="date" aria-label="To" id="saLogTo" value="${esc(f.to)}"${nobody ? ' disabled' : ''}>
    </div>
    ${nobody ? '' : `<div class="sa-log-count"><span>${esc(summary)}</span>${filtered ? '<button class="btn btn-ghost btn-sm" id="saLogClear">Clear filters</button>' : ''}</div>`}
    <div class="table-card">
      ${nobody ? `<div class="empty-state"><strong style="font-size:15px;color:var(--text)">No activity yet</strong><p>Changes made by staff and the administrator will appear here, newest first.</p></div>`
        : !log.entries.length ? `<div class="empty-state"><strong style="font-size:15px;color:var(--text)">No activity matches these filters</strong><p>Try a wider date range or a different person.</p></div>`
          : `${rows}${log.entries.length < log.total ? `<div class="sa-log-more"><button class="btn btn-secondary btn-sm" id="saLogMore">Load more <span style="font-weight:400;color:var(--text-muted)">· showing ${log.entries.length.toLocaleString('en-US')} of ${n}</span></button></div>` : ''}`}
    </div>
  </div>`;

  const refilter = async () => {
    log.filters = {
      person: document.getElementById('saLogPerson').value, area: document.getElementById('saLogArea').value,
      from: document.getElementById('saLogFrom').value, to: document.getElementById('saLogTo').value,
    };
    await _loadLog(false);
    _paintLog(body);
  };
  ['saLogPerson', 'saLogArea', 'saLogFrom', 'saLogTo'].forEach((idx) => document.getElementById(idx).addEventListener('change', refilter));
  document.getElementById('saLogClear')?.addEventListener('click', async () => {
    log.filters = { person: '', area: '', from: '', to: '' };
    await _loadLog(false);
    _paintLog(body);
  });
  document.getElementById('saLogMore')?.addEventListener('click', async () => {
    await _loadLog(true);
    _paintLog(body);
  });
}

// ===== MY ACCOUNT (staff) =====

async function _renderAccount(body) {
  document.getElementById('topbarActions').innerHTML = '';
  const a = await window.api.getMyAccount();
  const twoStepValue = a.two_step_on
    ? `On ${a.require_two_step ? '<span class="pill pill--green">Required</span>' : '<span class="pill pill--grey">Not required</span>'}`
    : `Off ${a.require_two_step ? '<span class="pill pill--green">Required</span>' : ''}`;
  const twoStepSub = a.two_step_on ? `Set up ${_date(a.totp_enabled_at)} · ${a.backup_codes_left} of 10 backup codes left` : 'Not set up';
  const twoStepButtons = a.two_step_on
    ? `<button class="btn btn-secondary btn-sm" id="saNewCodes">New backup codes</button><button class="btn btn-secondary btn-sm" id="saNewApp">Set up a new app</button>${a.require_two_step ? '' : '<button class="btn btn-secondary btn-sm" id="saTwoStepOff">Turn off</button>'}`
    : '<button class="btn btn-secondary btn-sm" id="saNewApp">Turn on</button>';
  body.innerHTML = `<div class="settings-page">
    <div class="settings-section">
      <div class="settings-section-header"><h2 class="settings-section-title">Your details</h2></div>
      <p class="settings-section-desc">This is your staff account. It is separate from any player account you have, and it never appears in player lists.</p>
      <div class="season-settings">
        <div class="form-group"><label class="form-label" for="fAccName">Name</label><input class="form-control" id="fAccName" type="text" value="${esc(a.name)}"><p class="form-hint">Shown in the activity log.</p></div>
        <div class="form-group"><label class="form-label" for="fAccEmail">Email</label><input class="form-control" id="fAccEmail" type="email" value="${esc(a.email)}"><p class="form-hint">You sign in with this. A change is confirmed by a link sent to the new address.</p>
          ${a.pending_email ? `<div class="sa-notice sa-notice--info" style="margin-top:8px">${INFO}<span>Waiting for you to confirm <strong>${esc(a.pending_email)}</strong>. Until then you sign in with ${esc(a.email)}.</span></div>` : ''}
        </div>
        <div class="form-actions" style="justify-content:flex-start"><button class="btn btn-primary" id="saAccSave">Save</button></div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-header"><h2 class="settings-section-title">Password</h2></div>
      <div class="sa-account-row">
        <div class="sa-account-text"><span class="sa-account-value">${a.password_changed_at ? `Last changed ${esc(_date(a.password_changed_at))}` : 'Set'}</span><span class="sa-account-label">At least 8 characters.</span></div>
        <button class="btn btn-secondary btn-sm" id="saChangePw">Change password</button>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-header"><h2 class="settings-section-title">Two-step sign-in</h2></div>
      <p class="settings-section-desc">After your password, a 6-digit code from an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Apple Passwords.</p>
      <div class="sa-account-row">
        <div class="sa-account-text"><span class="sa-account-value">${twoStepValue}</span><span class="sa-account-label">${esc(twoStepSub)}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${twoStepButtons}</div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-header"><h2 class="settings-section-title">Sessions</h2></div>
      <div class="sa-account-row">
        <div class="sa-account-text"><span class="sa-account-value">Signed in on other devices?</span><span class="sa-account-label">Signs you out everywhere except here.</span></div>
        <button class="btn btn-secondary btn-sm" id="saSignOutAll">Sign out of all devices</button>
      </div>
    </div>
  </div>`;

  document.getElementById('saAccSave').addEventListener('click', async () => {
    const nameEl = document.getElementById('fAccName');
    const emailEl = document.getElementById('fAccEmail');
    try {
      const r = await window.api.saveMyAccount({ name: nameEl.value, email: emailEl.value });
      if (state.currentUser) state.currentUser.name = r.name;
      window.paintAccountCard?.();
      toast(r.emailSent ? `Check ${r.pending_email} to confirm the change.` : 'Saved', 'success');
      _renderAccount(body);
    } catch (err) {
      if (err.field === 'name') _fieldError(nameEl, err.message);
      else if (err.field === 'email') _fieldError(emailEl, err.message);
      else toast(err.message, 'error');
    }
  });
  document.getElementById('saChangePw').addEventListener('click', _openPasswordModal);
  document.getElementById('saNewApp').addEventListener('click', () => { location.href = '/staff/two-step/setup'; });
  document.getElementById('saNewCodes')?.addEventListener('click', () => confirmModal({
    title: 'New backup codes',
    body: 'Make a new set of 10 backup codes? The codes you have now stop working.',
    confirm: 'Make new codes', danger: false, bodyClass: '',
    onConfirm: async () => {
      try {
        const { codes } = await window.api.newBackupCodes();
        modal.open('Your new backup codes', `
          <p class="ps-modal-intro">If you lose your phone, one of these gets you in. Each works once. Keep them somewhere safe, not in the app.</p>
          <div class="sa-codes-grid">${codes.map((c) => `<span>${c}</span>`).join('')}</div>
          <div class="form-actions"><button class="btn btn-secondary" id="saCopyCodes">Copy codes</button><button class="btn btn-primary" id="saCodesDone">Done</button></div>`);
        document.getElementById('saCopyCodes').addEventListener('click', () => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Codes copied')));
        document.getElementById('saCodesDone').addEventListener('click', () => { modal.close(); _renderAccount(body); });
      } catch (err) { toast(err.message, 'error'); }
    },
  }));
  document.getElementById('saTwoStepOff')?.addEventListener('click', () => confirmModal({
    title: 'Turn off two-step sign-in',
    body: 'Turn off two-step sign-in? You will sign in with just your password, and your backup codes stop working.',
    confirm: 'Turn off',
    onConfirm: async () => {
      try { await window.api.turnOffTwoStep(); toast('Two-step sign-in is off.'); _renderAccount(body); } catch (err) { toast(err.message, 'error'); }
    },
  }));
  document.getElementById('saSignOutAll').addEventListener('click', async () => {
    try { await window.api.signOutEverywhere(); toast('Signed out of all other devices.', 'success'); } catch (err) { toast(err.message, 'error'); }
  });
}

function _openPasswordModal() {
  modal.open('Change password', `
    <form id="saPwForm" novalidate>
      <div class="form-group"><label for="saPwCurrent">Current password</label><input class="form-control" id="saPwCurrent" type="password" autocomplete="current-password"></div>
      <div class="form-group"><label for="saPwNew">New password</label><input class="form-control" id="saPwNew" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
      <div class="form-group"><label for="saPwConfirm">Confirm password</label><input class="form-control" id="saPwConfirm" type="password" autocomplete="new-password"></div>
      <div class="form-actions"><button type="button" class="btn btn-secondary" id="saPwCancel">Cancel</button><button type="submit" class="btn btn-primary" id="saPwSave">Change password</button></div>
    </form>`);
  document.getElementById('saPwCancel').addEventListener('click', () => modal.close());
  document.getElementById('saPwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = { current: 'saPwCurrent', password: 'saPwNew', confirm: 'saPwConfirm' };
    try {
      await window.api.changeMyPassword({
        current: document.getElementById('saPwCurrent').value,
        password: document.getElementById('saPwNew').value,
        confirm: document.getElementById('saPwConfirm').value,
      });
      modal.close();
      toast('Password changed. Your other devices were signed out.', 'success');
      if (state.settingsTab === 'account') renderNewSettingsTab('account');
    } catch (err) {
      const el = document.getElementById(fields[err.field]);
      if (el) _fieldError(el, err.message);
      else toast(err.message, 'error');
    }
  });
}
