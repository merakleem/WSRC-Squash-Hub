// ===== WRITING TO PLAYERS =====
// The two group emails an admin sends - a message, and account invites - for a
// league or a tournament alike. The caller says who and how to send.
import { esc, toast, modal } from './utils.js';

/**
 * Write to a group of players. `recipients` are `{ player_email }` (anyone
 * without one is skipped and said so); `send(payload)` posts it.
 */
export function openMessagePlayersModal({ recipients, send }) {
  const players = (recipients || []).filter((p) => p.player_email);
  const noEmailPlayers = (recipients || []).filter((p) => !p.player_email);
  const attachments = [];
  let quill = null;

  const fmtSize = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const hasDraft = () =>
    !!(document.getElementById('fMsgSubject')?.value.trim() || quill?.getText().trim() || attachments.length);

  // The confirmation is a layer inside the modal, not a second modal.open —
  // that would tear down the editor and lose the draft it is guarding.
  function showDiscardConfirm() {
    if (document.getElementById('mpDiscard')) return;
    const layer = document.createElement('div');
    layer.id = 'mpDiscard';
    layer.className = 'mp-discard';
    layer.innerHTML = `
      <div class="mp-discard-card">
        <div class="mp-discard-title">Discard this message?</div>
        <div class="mp-discard-body">Your subject, message and attachments will be lost.</div>
        <div class="mp-discard-btns">
          <button class="btn btn-outline" id="mpKeep">Keep editing</button>
          <button class="btn btn-danger" id="mpDiscardBtn">Discard</button>
        </div>
      </div>`;
    document.getElementById('modal').appendChild(layer);
    document.getElementById('mpKeep').addEventListener('click', () => layer.remove());
    document.getElementById('mpDiscardBtn').addEventListener('click', () => { layer.remove(); modal.close(); });
  }

  modal.open('Message players', `
    <p class="mp-recipients">
      Sending to <strong>${players.length} player${players.length !== 1 ? 's' : ''}</strong> with an email on file.
      ${noEmailPlayers.length ? `<span class="mp-skip">${noEmailPlayers.length} player${noEmailPlayers.length !== 1 ? 's have' : ' has'} no email and will be skipped.</span>` : ''}
    </p>
    <div class="form-group">
      <label class="mp-label">Subject</label>
      <input class="form-control mp-subject" id="fMsgSubject" type="text" placeholder="e.g. League night this week">
    </div>
    <div class="form-group">
      <label class="mp-label">Message</label>
      <div class="mp-editor">
        <div id="fMsgEditor"></div>
        <div class="mp-editor-foot">
          <span>Formatting is kept in the email.</span>
          <span id="mpWords" hidden></span>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="mp-label">Attachments <span class="mp-label-opt">(optional)</span></label>
      <div class="mp-attach" id="fAttachmentList"></div>
      <input id="fMsgFile" type="file" hidden>
    </div>
    <div class="mp-foot">
      <div class="mp-foot-left">
        <span id="fMsgError" class="form-error mp-err"></span>
        <span id="mpDraftNote" class="mp-draftnote" hidden>Draft in progress</span>
      </div>
      <div class="mp-foot-btns">
        <button class="btn btn-outline" id="fCancel">Cancel</button>
        <button class="btn btn-primary" id="fSend">Send email</button>
      </div>
    </div>`, {
    medium: true,
    sticky: true,
    onRequestClose: () => {
      if (!hasDraft()) return modal.close();
      showDiscardConfirm();
    },
  });

  quill = new Quill('#fMsgEditor', {
    theme: 'snow',
    placeholder: 'Write your message here…',
    modules: { toolbar: [
      [{ header: [false, 2, 3] }],
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link'],
      ['clean'],
    ] },
  });

  function updateDraftBits() {
    const words = quill.getText().trim().split(/\s+/).filter(Boolean).length;
    const wordsEl = document.getElementById('mpWords');
    if (wordsEl) {
      wordsEl.hidden = words === 0;
      wordsEl.textContent = `${words} word${words !== 1 ? 's' : ''}`;
    }
    const note = document.getElementById('mpDraftNote');
    if (note) note.hidden = !hasDraft() || !!document.getElementById('fMsgError')?.textContent;
  }
  quill.on('text-change', updateDraftBits);
  document.getElementById('fMsgSubject').addEventListener('input', updateDraftBits);

  function renderAttachmentList() {
    const list = document.getElementById('fAttachmentList');
    list.innerHTML = attachments.map((a, i) => `
      <span class="mp-chip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        <span class="mp-chip-name">${esc(a.filename)}</span>
        <span class="mp-chip-size">${fmtSize(a.size)}</span>
        <button class="mp-chip-x" data-remove="${i}" aria-label="Remove">&times;</button>
      </span>`).join('') + `
      <button class="mp-addfile" id="fAddFile" type="button">+ Add file</button>`;

    list.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        attachments.splice(Number(btn.dataset.remove), 1);
        renderAttachmentList();
        updateDraftBits();
      });
    });
    document.getElementById('fAddFile').addEventListener('click', () => {
      document.getElementById('fMsgFile').click();
    });
  }
  renderAttachmentList();

  document.getElementById('fMsgFile').addEventListener('change', async () => {
    const fileInput = document.getElementById('fMsgFile');
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    attachments.push({ filename: file.name, content: base64, size: file.size });
    fileInput.value = '';
    renderAttachmentList();
    updateDraftBits();
  });

  document.getElementById('fCancel').addEventListener('click', () => modal.requestClose());
  document.getElementById('fSend').addEventListener('click', async () => {
    const subject = document.getElementById('fMsgSubject').value.trim();
    const text = quill.getText().trim();
    const errEl = document.getElementById('fMsgError');
    if (!subject) { errEl.textContent = 'Subject is required.'; updateDraftBits(); return; }
    if (!text) { errEl.textContent = 'Message is required.'; updateDraftBits(); return; }
    errEl.textContent = '';
    document.getElementById('fSend').disabled = true;
    document.getElementById('fSend').textContent = 'Sending…';
    try {
      const data = await send({
        subject,
        body: text,
        bodyHtml: quill.getSemanticHTML(),
        attachments: attachments.map(({ filename, content }) => ({ filename, content })),
      });
      modal.close();
      toast(`Email sent to ${data.sent} player${data.sent !== 1 ? 's' : ''}`, 'success');
    } catch (e) {
      errEl.textContent = e.message;
      document.getElementById('fSend').disabled = false;
      document.getElementById('fSend').textContent = 'Send email';
    }
  });
}

// ===== BULK INVITE =====
/** Invite everyone in `what` ("this league") who has no account yet. */
export function openBulkInviteModal({ what, send }) {
  modal.open('Send Account Invites', `
    <p style="font-size:14px;color:var(--text-muted);margin-bottom:16px">
      This will send a personalized account activation email to every player in ${what}
      who has an email on file and has not yet activated their account.
    </p>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:20px">
      Players who already have an account will be skipped automatically.
    </p>
    <div id="fBulkError" style="color:var(--danger);font-size:13px;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-ghost" id="fBulkCancel">Cancel</button>
      <button class="btn btn-primary" id="fBulkSend">Send Invites</button>
    </div>
  `);
  document.getElementById('fBulkCancel').addEventListener('click', () => modal.close());
  document.getElementById('fBulkSend').addEventListener('click', async () => {
    const errEl = document.getElementById('fBulkError');
    const btn = document.getElementById('fBulkSend');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const data = await send();
      modal.close();
      if (data.sent === 0) {
        toast('All players already have accounts. No invites sent.', 'info');
      } else {
        toast(`Invites sent to ${data.sent} player${data.sent !== 1 ? 's' : ''}.`, 'success');
      }
    } catch (e) {
      errEl.textContent = e.message || 'Failed to send invites.';
      btn.disabled = false;
      btn.textContent = 'Send Invites';
    }
  });
}
