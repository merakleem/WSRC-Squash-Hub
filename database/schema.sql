CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ladder (
    player_id INTEGER PRIMARY KEY,
    position INTEGER NOT NULL,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    num_teams INTEGER NOT NULL,
    num_divisions INTEGER NOT NULL,
    num_rounds INTEGER NOT NULL DEFAULT 1,
    blackout_dates TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    team_order INTEGER NOT NULL,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS divisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    level INTEGER NOT NULL,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS league_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    skill_rank INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    division_id INTEGER NOT NULL,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (division_id) REFERENCES divisions(id)
);

CREATE TABLE IF NOT EXISTS weeks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_matchups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id INTEGER NOT NULL,
    team1_id INTEGER,
    team2_id INTEGER,
    bye_team_id INTEGER,
    FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE,
    FOREIGN KEY (team1_id) REFERENCES teams(id),
    FOREIGN KEY (team2_id) REFERENCES teams(id),
    FOREIGN KEY (bye_team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    matchup_id INTEGER NOT NULL,
    division_id INTEGER NOT NULL,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER NOT NULL,
    player1_score INTEGER,
    player2_score INTEGER,
    winner_id INTEGER,
    FOREIGN KEY (matchup_id) REFERENCES team_matchups(id) ON DELETE CASCADE,
    FOREIGN KEY (division_id) REFERENCES divisions(id),
    FOREIGN KEY (player1_id) REFERENCES players(id),
    FOREIGN KEY (player2_id) REFERENCES players(id)
);
