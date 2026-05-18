const playerModel = require('../models/playerModel');
const { getDB } = require('../database/db');

function getAllPlayers() {
  return playerModel.getAllPlayers();
}

function _validationError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function _checkEmailUnique(email, excludeId = null) {
  if (!email || !email.trim()) return;
  const db = getDB();
  const existing = db.prepare(
    'SELECT id, name FROM players WHERE LOWER(email) = LOWER(?) AND id != COALESCE(?, -1)'
  ).get(email.trim(), excludeId);
  if (existing) throw _validationError(`Email is already used by ${existing.name}`);
}

function addPlayer(data) {
  if (!data.name || !data.name.trim()) throw _validationError('Player name is required');
  _checkEmailUnique(data.email);
  return playerModel.addPlayer({ ...data, name: data.name.trim() });
}

function updatePlayer(data) {
  if (!data.name || !data.name.trim()) throw _validationError('Player name is required');
  _checkEmailUnique(data.email, data.id);
  return playerModel.updatePlayer({ ...data, name: data.name.trim() });
}

function deletePlayer(id) {
  return playerModel.deletePlayer(id);
}

function getPlayerById(id) {
  return playerModel.getPlayerById(id);
}

function getPlayerMatchHistory(id) {
  return playerModel.getPlayerMatchHistory(id);
}

function getPickupMatchHistory(id) {
  return playerModel.getPickupMatchHistory(id);
}

function getPlayerUpcomingMatches(id) {
  return playerModel.getPlayerUpcomingMatches(id);
}

function getAllPlayerRecords() {
  return playerModel.getAllPlayerRecords();
}

module.exports = {
  getAllPlayers, addPlayer, updatePlayer, deletePlayer,
  getPlayerById, getPlayerMatchHistory, getPickupMatchHistory, getPlayerUpcomingMatches, getAllPlayerRecords,
};
