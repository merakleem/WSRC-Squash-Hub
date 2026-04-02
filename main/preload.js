const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Players
  getPlayers:       ()     => ipcRenderer.invoke('get-players'),
  addPlayer:        (data) => ipcRenderer.invoke('add-player', data),
  updatePlayer:     (data) => ipcRenderer.invoke('update-player', data),
  deletePlayer:     (id)   => ipcRenderer.invoke('delete-player', id),
  getPlayerHistory: (id)   => ipcRenderer.invoke('get-player-history', id),
  getPlayerRecords: ()     => ipcRenderer.invoke('get-player-records'),

  // Leagues
  getLeagues: () => ipcRenderer.invoke('get-leagues'),
  getLeague: (id) => ipcRenderer.invoke('get-league', id),
  createLeague: (data) => ipcRenderer.invoke('create-league', data),
  deleteLeague: (id) => ipcRenderer.invoke('delete-league', id),

  // Matches
  updateMatchScore: (data) => ipcRenderer.invoke('update-match-score', data),

  // Ladder
  getLadder:    ()          => ipcRenderer.invoke('get-ladder'),
  updateLadder: (playerIds) => ipcRenderer.invoke('update-ladder', playerIds),

  // Helpers
  getValidConfigs: (numPlayers) => ipcRenderer.invoke('get-valid-configs', numPlayers),
});
