const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const { initDB } = require('../database/db');
const playerService = require('../services/playerService');
const leagueService = require('../services/leagueService');
const leagueModel = require('../models/leagueModel');
const ladderModel = require('../models/ladderModel');
const { getValidConfigurations } = require('../utils/helpers');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function registerIPC() {
  // Players
  ipcMain.handle('get-players', () => playerService.getAllPlayers());
  ipcMain.handle('add-player', (_, data) => playerService.addPlayer(data));
  ipcMain.handle('update-player', (_, data) => playerService.updatePlayer(data));
  ipcMain.handle('delete-player', (_, id) => playerService.deletePlayer(id));
  ipcMain.handle('get-player-history', async (_, id) => {
    const [player, history, records] = await Promise.all([
      playerService.getPlayerById(id),
      playerService.getPlayerMatchHistory(id),
      playerService.getAllPlayerRecords(),
    ]);
    const rec = (records || []).find((r) => r.id === id) || { wins: 0, losses: 0 };
    return { ...player, wins: rec.wins || 0, losses: rec.losses || 0, history };
  });
  ipcMain.handle('get-player-records', () => playerService.getAllPlayerRecords());

  // Leagues
  ipcMain.handle('get-leagues', () => leagueModel.getAllLeagues());
  ipcMain.handle('get-league', (_, id) => leagueService.getFullLeague(id));
  ipcMain.handle('create-league', (_, data) => leagueService.createLeague(data));
  ipcMain.handle('delete-league', (_, id) => leagueModel.deleteLeague(id));

  // Matches
  ipcMain.handle('update-match-score', (_, data) => leagueModel.updateMatchScore(data));

  // Ladder
  ipcMain.handle('get-ladder', () => ladderModel.getLadder());
  ipcMain.handle('update-ladder', (_, playerIds) => ladderModel.setLadder(playerIds));

  // Helpers
  ipcMain.handle('get-valid-configs', (_, numPlayers) => getValidConfigurations(numPlayers));
}

app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'squash.db');
  await initDB(dbPath);
  registerIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
