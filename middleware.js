const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = 'wsrc_session';
const SECURE_FLAG = process.env.NODE_ENV === 'production' ? '; Secure' : '';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ===== ERROR WRAPPER =====

function wrap(fn) {
  return (req, res) =>
    fn(req, res).catch((err) => {
      console.error(err);
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'An internal error occurred' });
    });
}

// ===== SESSION TOKENS =====

function signSession(payload) {
  const withExp = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const data = Buffer.from(JSON.stringify(withExp)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  return `${data}.${sig}`;
}

function verifySession(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const data = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('='));
  });
  return out;
}

function getSession(req) {
  // Mobile clients send Authorization: Bearer <token> instead of a cookie
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return verifySession(auth.slice(7));
  return verifySession(parseCookies(req)[COOKIE_NAME]);
}

function setSessionCookie(res, payload) {
  const csrf = crypto.randomBytes(16).toString('hex');
  const token = signSession({ ...payload, csrf });
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${SECURE_FLAG}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${SECURE_FLAG}; Max-Age=0`);
}

// ===== AUTH MIDDLEWARE =====

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) {
    // API routes return JSON 401; page routes redirect to login
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/login');
  }
  req.session = session;
  next();
}

function requireAdmin(req, res, next) {
  if (req.session?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireAdminPage(req, res, next) {
  const session = getSession(req);
  if (!session) return res.redirect('/login');
  if (session.role !== 'admin') return res.redirect('/');
  req.session = session;
  next();
}

function requireCsrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  // Bearer token auth is not vulnerable to CSRF — skip the check
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return next();
  const token = req.headers['x-csrf-token'];
  if (!token || !req.session?.csrf || token !== req.session.csrf) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }
  next();
}

// ===== RATE LIMITERS =====

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

module.exports = {
  wrap,
  signSession,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  requireAdminPage,
  requireCsrf,
  loginLimiter,
  emailLimiter,
};
