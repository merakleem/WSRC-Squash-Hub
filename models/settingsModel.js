const { run, all, get } = require('../database/db');

// Key/value store for admin-editable configuration. Values are stored as TEXT;
// callers that need numbers or JSON parse them at the edge.

function getAllSettings() {
  const rows = all('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, value == null ? null : String(value)]
  );
  return { key, value };
}

function setSettings(map) {
  for (const [key, value] of Object.entries(map)) setSetting(key, value);
  return getAllSettings();
}

function deleteSetting(key) {
  return run('DELETE FROM settings WHERE key = ?', [key]);
}

module.exports = { getAllSettings, getSetting, setSetting, setSettings, deleteSetting };
