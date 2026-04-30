const playerModel = require('../models/playerModel');

function getAllPlayers() {
  return playerModel.getAllPlayers();
}

function addPlayer(data) {
  if (!data.name || !data.name.trim()) throw new Error('Player name is required');
  return playerModel.addPlayer({ ...data, name: data.name.trim() });
}

function updatePlayer(data) {
  if (!data.name || !data.name.trim()) throw new Error('Player name is required');
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
