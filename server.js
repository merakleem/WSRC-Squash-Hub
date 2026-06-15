require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDB, getDB } = require('./database/db');
const { getSession, requireCsrf } = require('./middleware');

const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'squash.db');

const missingVars = [
  !process.env.SITE_PASSWORD && 'SITE_PASSWORD',
  !process.env.SESSION_SECRET && 'SESSION_SECRET',
].filter(Boolean);

if (missingVars.length > 0) {
  console.error(`\n  ERROR: Missing required environment variable(s): ${missingVars.join(', ')}`);
  console.error('  Railway: set these in your project\'s Variables tab.');
  console.error('  Local: copy .env.example to .env and fill in the values.\n');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false }));

// Public assets (served before auth — login page needs the logo)
app.use(express.static(path.join(__dirname, 'public')));

// Auth pages + mobile token endpoint
app.use(require('./routes/auth'));

// Health check
app.get('/health', (req, res) => res.sendStatus(200));

// Public league page (unauthenticated)
app.use(require('./routes/public'));

// ===== GLOBAL AUTH GUARD =====
app.use((req, res, next) => {
  if (req.path === '/api/auth/token') return next();
  const session = getSession(req);
  if (!session) return res.redirect('/login');
  req.session = session;
  next();
});

// CSRF validation on all mutating API calls
app.use('/api', requireCsrf);

// Renderer SPA (no caching — auth check must run before this)
app.use(express.static(path.join(__dirname, 'renderer'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// ===== API: WHO AM I =====
app.get('/api/me', (req, res) => {
  let is_tester = 0;
  if (req.session.playerId) {
    const player = getDB().prepare('SELECT is_tester FROM players WHERE id = ?').get(req.session.playerId);
    is_tester = player?.is_tester || 0;
  }
  res.json({ role: req.session.role, playerId: req.session.playerId || null, csrf: req.session.csrf || null, is_tester });
});

// ===== API ROUTES =====
app.use('/api', require('./routes/players'));
app.use('/api', require('./routes/leagues'));
app.use('/api', require('./routes/matches'));
app.use('/api', require('./routes/ladder'));
app.use('/api', require('./routes/activity'));
app.use('/api', require('./routes/schedule'));
app.use('/api', require('./routes/bookings'));
app.use('/api', require('./routes/courts'));
app.use('/api', require('./routes/tournaments'));

// ===== 404 =====
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ===== START =====
async function start() {
  await initDB(DB_PATH);
  app.listen(PORT, () => {
    console.log('');
    console.log('  Play WSRC is running!');
    console.log(`  Open http://localhost:${PORT} in your browser`);
    console.log('');
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
