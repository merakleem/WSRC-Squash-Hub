// ===== PROFILE PHOTO =====
// The upload modal shared by the profile page and the players list's panel.
import { esc, toast, modal, playerInitials } from '../utils.js';

// Avatars are only ever drawn as small circles, so the browser resizes and
// re-encodes before upload: a phone photo goes from several megabytes to tens
// of kilobytes, which keeps the volume small and every avatar quick to load.
const PHOTO_MAX_PX = 512;
const PHOTO_QUALITY = 0.82;

// One plain message for anything the browser cannot decode - an iPhone HEIC
// is the usual case - rather than an explanation.
const PHOTO_FORMAT_ERROR = 'That file format is not accepted.';

function _shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(PHOTO_FORMAT_ERROR));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(PHOTO_FORMAT_ERROR));
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

export function openPhotoModal(player) {
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
