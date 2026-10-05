import { state } from '../state.js';
import { esc, toast, modal, avatarHTML } from '../utils.js';
import { openPhotoModal } from './playerPhoto.js';

// A member's own Settings (design_handoff_player_settings): one page, three
// cards. Profile saves on an explicit Save, the email changes through a
// confirmation link sent to the new address, and each notification switch
// saves the moment it is flipped.

const NOTIFY_ROWS = [
  ['notify_booking_added', 'Someone adds me to a court booking'],
  ['notify_league_new', 'A new league is announced'],
  ['notify_tournament_new', 'A new tournament is announced'],
  ['notify_event_new', 'A new event is posted'],
  ['notify_score_reported', 'Someone reports a score for my match'],
];

const ICON = {
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
};

// The page's state between renders. `s` is the last copy the server sent.
const ps = { s: null, saving: false, errors: {}, resetSent: false };

export async function renderSettings() {
  document.getElementById('pageTitle').textContent = 'Settings';
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.getElementById('mainContent');
  content.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading…</div>';
  ps.saving = false;
  ps.errors = {};
  ps.resetSent = false;
  try {
    ps.s = await window.api.getMySettings();
  } catch (err) {
    content.innerHTML = `<div style="padding:20px;color:var(--text-muted)">${esc(err.message || 'Could not load your settings.')}</div>`;
    return;
  }
  _paint();
}

// Redraws the page. What the member has typed into Profile and not saved is
// kept, so resending a link or flipping a switch never loses an edit; pass
// `keep: false` to show the saved values again.
function _paint({ keep = true, focus = null } = {}) {
  const content = document.getElementById('mainContent');
  if (state.page !== 'settings' || !content) return;
  const typed = keep && document.getElementById('psName') ? _formValues() : null;
  content.innerHTML = `<div class="ps-page">${_profileCard()}${_signInCard()}${_notifyCard()}</div>`;
  if (typed) {
    document.getElementById('psName').value = typed.name;
    document.getElementById('psPhone').value = typed.phone;
  }
  // Drawn from the fields as they now stand, so Save knows if anything changed.
  document.getElementById('psProfileActions').innerHTML = _profileActions();
  _wire();
  if (focus) document.getElementById(focus)?.focus();
}

// ===== PROFILE =====

function _profileCard() {
  const s = ps.s;
  const err = ps.errors;
  const field = (id, label, value, hint, { optional = false, type = 'text', autocomplete = '' } = {}) => `
    <div class="form-group">
      <label for="${id}">${label}${optional ? ' <span class="form-hint">Optional</span>' : ''}</label>
      <input class="form-control${err[id] ? ' ps-invalid' : ''}" id="${id}" type="${type}" value="${esc(value)}"${autocomplete ? ` autocomplete="${autocomplete}"` : ''}${ps.saving ? ' disabled' : ''}>
      ${err[id] ? `<div class="form-error">${esc(err[id])}</div>` : `<span class="form-hint ps-field-hint">${hint}</span>`}
    </div>`;
  return `
    <section class="table-card ps-card" aria-labelledby="psProfileHead">
      <div class="ps-card-head">
        <span class="section-label" id="psProfileHead">Profile</span>
        <span class="ps-card-sub">How other members see you.</span>
      </div>
      <div class="ps-photo-row">
        ${avatarHTML(s, 'ps-avatar')}
        <div class="ps-photo-text">
          <button class="btn btn-secondary btn-sm" id="psChangePhoto"${ps.saving ? ' disabled' : ''}>Change photo</button>
          <span class="form-hint">Without a photo, your initials are shown.</span>
        </div>
      </div>
      <div class="ps-grid-2">
        ${field('psName', 'Name', s.name, 'Appears on the ladder, in brackets and on bookings.', { autocomplete: 'name' })}
        ${field('psPhone', 'Phone number', s.phone, 'Only the club can see it.', { optional: true, type: 'tel', autocomplete: 'tel' })}
      </div>
      <div class="ps-readonly">
        <div>
          <div class="ps-readonly-label">Member number</div>
          <div class="ps-readonly-val">${esc(s.member_number || '–')}</div>
        </div>
        <div>
          <div class="ps-readonly-label">Membership status</div>
          <div class="ps-readonly-pill">${s.is_member ? '<span class="pill pill--green">Active</span>' : '<span class="pill pill--grey">Inactive</span>'}</div>
        </div>
        <div class="ps-readonly-note">Set by the club. Ask an admin if either looks wrong.</div>
      </div>
      <div class="form-actions" id="psProfileActions"></div>
    </section>`;
}

function _profileActions() {
  const dirty = _dirty();
  return `
    ${dirty ? '<span class="ps-dirty">Unsaved changes</span>' : ''}
    ${dirty ? `<button class="btn btn-secondary" id="psProfileCancel"${ps.saving ? ' disabled' : ''}>Cancel</button>` : ''}
    <button class="btn btn-primary" id="psProfileSave"${!dirty || ps.saving ? ' disabled' : ''}>${ps.saving ? 'Saving…' : 'Save'}</button>`;
}

function _formValues() {
  return {
    name: document.getElementById('psName')?.value ?? ps.s.name,
    phone: document.getElementById('psPhone')?.value ?? ps.s.phone,
  };
}

function _dirty() {
  const v = _formValues();
  return v.name !== ps.s.name || v.phone !== (ps.s.phone || '');
}

async function _saveProfile() {
  const v = _formValues();
  ps.errors = {};
  if (!v.name.trim()) {
    ps.errors.psName = 'Name is required.';
    return _paint({ focus: 'psName' });
  }
  ps.saving = true;
  _paint();
  try {
    ps.s = await window.api.saveMyProfile({ name: v.name, phone: v.phone });
    ps.saving = false;
    _syncAccountCard();
    _paint({ keep: false });
    toast('Profile saved', 'success');
  } catch (err) {
    ps.saving = false;
    if (err.field === 'name') ps.errors.psName = err.message;
    else if (err.field === 'phone') ps.errors.psPhone = err.message;
    else toast('Could not save your profile. Try again.', 'error');
    _paint({ focus: err.field === 'phone' ? 'psPhone' : err.field === 'name' ? 'psName' : null });
  }
}

// The sidebar card and the player list show the name and photo too.
function _syncAccountCard() {
  if (state.currentUser) {
    state.currentUser.name = ps.s.name;
    state.currentUser.photo_path = ps.s.photo_path;
  }
  const row = state.players?.find((p) => p.id === ps.s.id);
  if (row) { row.name = ps.s.name; row.photo_path = ps.s.photo_path; }
  window.paintAccountCard?.();
}

// ===== SIGN-IN AND SECURITY =====

function _signInCard() {
  const s = ps.s;
  const pending = s.pending_email ? `
    <div class="ps-notice ps-notice--pending">
      <div class="ps-notice-row">
        ${ICON.clock}
        <span>Waiting for you to confirm <strong>${esc(s.pending_email)}</strong>. Check that inbox.</span>
      </div>
      <div class="ps-notice-actions">
        <button class="btn btn-ghost btn-sm" id="psResend">Resend link</button>
        <button class="btn btn-ghost btn-sm" id="psCancelChange">Cancel change</button>
      </div>
    </div>` : '';

  const emailRow = s.email ? `
    <div class="ps-row">
      <span class="ps-row-label">Email</span>
      <div class="ps-row-main">
        <span class="ps-row-val">${esc(s.email)}</span>
        <span class="ps-row-sub">${s.pending_email ? 'You still sign in with this address.' : 'Changing it sends a confirmation link to the new address first.'}</span>
        ${pending}
      </div>
      ${s.pending_email ? '' : '<button class="btn btn-secondary btn-sm" id="psChangeEmail">Change</button>'}
    </div>` : `
    <div class="ps-row ps-row--full">
      <div class="ps-notice ps-notice--warn">
        ${ICON.warn}
        <div class="ps-notice-text">
          <span class="ps-notice-title">No email on file</span>
          <span>Without one you cannot sign in by email, reset your password or receive club emails. Add an address and we will send it a confirmation link.</span>
        </div>
        <button class="btn btn-secondary btn-sm" id="psAddEmail">Add an email</button>
      </div>
      ${pending}
    </div>`;

  const pwMain = !s.email
    ? `<span class="ps-row-val">Reset by email</span>
       <span class="ps-row-sub">Add an email first, then we can send you a reset link.</span>`
    : ps.resetSent
      ? `<span class="ps-row-val ps-row-ok">${ICON.check}Reset link sent</span>
         <span class="ps-row-sub">Check ${esc(s.email)}. The link works once.</span>`
      : `<span class="ps-row-val">Reset by email</span>
         <span class="ps-row-sub">Send a link to ${esc(s.email)}.</span>`;

  return `
    <section class="table-card ps-card ps-card--rows" aria-labelledby="psSignInHead">
      <div class="ps-card-head">
        <span class="section-label" id="psSignInHead">Sign-in and security</span>
        <span class="ps-card-sub">Your email is also how you sign in.</span>
      </div>
      ${emailRow}
      <div class="ps-row">
        <span class="ps-row-label">Password</span>
        <div class="ps-row-main">${pwMain}</div>
        <button class="btn btn-secondary btn-sm" id="psSendReset"${!s.email || ps.resetSent ? ' disabled' : ''}>Email me a reset link</button>
      </div>
    </section>`;
}

function _openEmailModal() {
  const adding = !ps.s.email;
  modal.open(adding ? 'Add an email' : 'Change email', `
    <p class="ps-modal-intro">${adding
      ? 'We will send a confirmation link to this address. Your email is set as soon as you click it.'
      : `We will send a confirmation link to the new address. Nothing changes until you click it; you keep signing in with ${esc(ps.s.email)} in the meantime.`}</p>
    <div class="form-group">
      <label for="psNewEmail">${adding ? 'Email' : 'New email'}</label>
      <input class="form-control" id="psNewEmail" type="email" autocomplete="email">
      <div class="form-error" id="psEmailError" hidden></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="psEmailCancel">Cancel</button>
      <button class="btn btn-primary" id="psEmailSend">Send confirmation link</button>
    </div>`);

  const input = document.getElementById('psNewEmail');
  const errEl = document.getElementById('psEmailError');
  const send = document.getElementById('psEmailSend');
  input.focus();
  const showError = (msg) => {
    errEl.textContent = msg;
    errEl.hidden = false;
    input.classList.add('ps-invalid');
    input.focus();
  };
  const submit = async () => {
    const email = input.value.trim();
    // The same checks the server makes, so the common slips answer at once.
    if (!email) return showError('Enter an email address.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('That does not look like an email address.');
    if (ps.s.email && ps.s.email.toLowerCase() === email.toLowerCase()) return showError('That is already your email.');
    send.disabled = true;
    send.textContent = 'Sending…';
    try {
      ps.s = await window.api.changeMyEmail(email);
      modal.close();
      _paint();
      toast(`Confirmation link sent to ${email}`);
    } catch (err) {
      send.disabled = false;
      send.textContent = 'Send confirmation link';
      if (err.field === 'email') showError(err.message);
      else toast(err.message || 'Could not send the confirmation link. Try again.', 'error');
    }
  };
  document.getElementById('psEmailCancel').addEventListener('click', () => modal.close());
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => { errEl.hidden = true; input.classList.remove('ps-invalid'); });
}

// ===== NOTIFICATIONS =====

function _notifyCard() {
  const s = ps.s;
  const locked = !s.email;
  return `
    <section class="table-card ps-card" aria-labelledby="psNotifyHead">
      <div class="ps-card-head">
        <span class="section-label" id="psNotifyHead">Email notifications</span>
        <span class="ps-card-sub">${locked ? 'Add an email under Sign-in and security to turn these on.' : `Sent to ${esc(s.email)}.`}</span>
      </div>
      <div class="ps-switches">
        ${NOTIFY_ROWS.map(([key, label]) => `
          <div class="ps-switch-row${locked ? ' ps-switch-row--locked' : ''}" data-row="${key}">
            <span class="ps-switch-label" id="psLbl_${key}">${label}</span>
            <span class="ps-switch-status" aria-live="polite"></span>
            <label class="ps-switch">
              <input type="checkbox" data-pref="${key}" aria-labelledby="psLbl_${key}"${s.notifications[key] ? ' checked' : ''}${locked ? ' disabled' : ''}>
              <span class="ps-switch-track"></span>
              <span class="ps-switch-knob"></span>
            </label>
          </div>`).join('')}
        <p class="ps-club-note">Messages from the club always arrive and cannot be turned off.</p>
      </div>
    </section>`;
}

const _savedTimers = {};

async function _flip(input) {
  const key = input.dataset.pref;
  const value = input.checked;
  const row = input.closest('.ps-switch-row');
  const status = row.querySelector('.ps-switch-status');
  clearTimeout(_savedTimers[key]);
  row.classList.add('ps-switch-row--saving');
  status.classList.remove('ps-switch-status--ok');
  status.textContent = 'Saving…';
  try {
    await window.api.setMyNotification(key, value);
    ps.s.notifications[key] = value;
    status.textContent = 'Saved';
    status.classList.add('ps-switch-status--ok');
    _savedTimers[key] = setTimeout(() => {
      status.textContent = '';
      status.classList.remove('ps-switch-status--ok');
    }, 2000);
  } catch (_) {
    input.checked = !value;
    status.textContent = '';
    toast('Could not save that setting. Try again.', 'error');
  } finally {
    row.classList.remove('ps-switch-row--saving');
  }
}

// ===== WIRING =====

function _wireProfileActions() {
  document.getElementById('psProfileSave')?.addEventListener('click', _saveProfile);
  document.getElementById('psProfileCancel')?.addEventListener('click', () => {
    ps.errors = {};
    _paint({ keep: false });
  });
}

function _wire() {
  const onEdit = (e) => {
    // Typing in a field that was marked wrong clears the mark.
    if (ps.errors[e.target.id]) {
      delete ps.errors[e.target.id];
      e.target.classList.remove('ps-invalid');
      const errEl = e.target.parentElement.querySelector('.form-error');
      if (errEl) errEl.outerHTML = `<span class="form-hint ps-field-hint">${e.target.id === 'psName' ? 'Appears on the ladder, in brackets and on bookings.' : 'Only the club can see it.'}</span>`;
    }
    document.getElementById('psProfileActions').innerHTML = _profileActions();
    _wireProfileActions();
  };
  document.getElementById('psName').addEventListener('input', onEdit);
  document.getElementById('psPhone').addEventListener('input', onEdit);
  for (const id of ['psName', 'psPhone']) {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && _dirty() && !ps.saving) { e.preventDefault(); _saveProfile(); }
    });
  }
  _wireProfileActions();

  document.getElementById('psChangePhoto').addEventListener('click', () => {
    openPhotoModal(ps.s, {
      onDone: async () => {
        try { ps.s = await window.api.getMySettings(); } catch (_) { return; }
        _syncAccountCard();
        _paint();
      },
    });
  });

  document.getElementById('psChangeEmail')?.addEventListener('click', _openEmailModal);
  document.getElementById('psAddEmail')?.addEventListener('click', _openEmailModal);

  document.getElementById('psResend')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      ps.s = await window.api.resendMyEmailChange();
      toast('Confirmation link sent again');
    } catch (err) {
      toast(err.message || 'Could not send the confirmation link. Try again.', 'error');
    }
    _paint();
  });
  document.getElementById('psCancelChange')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      ps.s = await window.api.cancelMyEmailChange();
      toast('Email change cancelled');
    } catch (err) {
      toast(err.message || 'Could not cancel the change. Try again.', 'error');
    }
    _paint();
  });

  document.getElementById('psSendReset')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await window.api.sendMyPasswordReset();
      ps.resetSent = true;
      _paint();
    } catch (_) {
      btn.disabled = false;
      toast('Could not send the reset email. Try again.', 'error');
    }
  });

  document.querySelectorAll('.ps-switch input[data-pref]').forEach((input) => {
    input.addEventListener('change', () => _flip(input));
  });
}
