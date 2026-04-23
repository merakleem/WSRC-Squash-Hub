const { run, all, get } = require('../database/db');

async function getAllCourts() {
  return all('SELECT * FROM courts ORDER BY sort_order ASC, id ASC');
}

async function addCourt({ name }) {
  const result = await run(
    'INSERT INTO courts (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM courts))',
    [name]
  );
  return get('SELECT * FROM courts WHERE id = ?', [result.lastID]);
}

async function updateCourt({ id, name }) {
  await run('UPDATE courts SET name = ? WHERE id = ?', [name, id]);
  return get('SELECT * FROM courts WHERE id = ?', [id]);
}

async function deleteCourt(id) {
  return run('DELETE FROM courts WHERE id = ?', [id]);
}

module.exports = { getAllCourts, addCourt, updateCourt, deleteCourt };
