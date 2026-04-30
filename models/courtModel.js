const { run, all, get } = require('../database/db');

function getAllCourts() {
  return all('SELECT * FROM courts ORDER BY sort_order ASC, id ASC');
}

function addCourt({ name }) {
  const result = run(
    'INSERT INTO courts (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM courts))',
    [name]
  );
  return get('SELECT * FROM courts WHERE id = ?', [result.lastID]);
}

function updateCourt({ id, name }) {
  run('UPDATE courts SET name = ? WHERE id = ?', [name, id]);
  return get('SELECT * FROM courts WHERE id = ?', [id]);
}

function deleteCourt(id) {
  return run('DELETE FROM courts WHERE id = ?', [id]);
}

module.exports = { getAllCourts, addCourt, updateCourt, deleteCourt };
