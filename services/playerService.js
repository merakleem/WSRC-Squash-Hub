const playerModel = require('../models/playerModel');

async function getAllPlayers() {
  return playerModel.getAllPlayers();
}

async function addPlayer(data) {
  if (!data.name || !data.name.trim()) {
    throw new Error('Player name is required');
  }
  return playerModel.addPlayer({ ...data, name: data.name.trim() });
}

async function updatePlayer(data) {
  if (!data.name || !data.name.trim()) {
    throw new Error('Player name is required');
  }
  return playerModel.updatePlayer({ ...data, name: data.name.trim() });
}

async function deletePlayer(id) {
  return playerModel.deletePlayer(id);
}

async function getPlayerById(id) {
  return playerModel.getPlayerById(id);
}

async function getPlayerMatchHistory(id) {
  return playerModel.getPlayerMatchHistory(id);
}

async function getPlayerUpcomingMatches(id) {
  return playerModel.getPlayerUpcomingMatches(id);
}

async function getAllPlayerRecords() {
  return playerModel.getAllPlayerRecords();
}

module.exports = { getAllPlayers, addPlayer, updatePlayer, deletePlayer, getPlayerById, getPlayerMatchHistory, getPlayerUpcomingMatches, getAllPlayerRecords };
