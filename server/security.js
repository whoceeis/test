const crypto = require('node:crypto');
const config = require('./config');
const { db, sha256 } = require('./db');

const COOKIE_NAME = 'sid';

// ---------- Заголовки безопасности ----------
function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
}

// Запросы, меняющие данные, принимаем только с нашего же сайта
function originCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      // некорректный Origin
    }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Запрос отклонён.' });
  }
  return next();
}

// ---------- Сессии ----------
function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // битое значение cookie игнорируем
    }
  }
  return cookies;
}

function createSession(res, role, userId = null) {
  const ttlMs = role === 'admin'
    ? config.ADMIN_SESSION_HOURS * 60 * 60 * 1000
    : config.USER_SESSION_DAYS * 24 * 60 * 60 * 1000;
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();

  db.prepare('INSERT INTO sessions (token_hash, role, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), role, userId, now, now + ttlMs);

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    maxAge: ttlMs,
  });
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function attachSession(req, res, next) {
  req.session = null;
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) {
    const row = db.prepare(`
      SELECT s.role, s.user_id AS userId, u.label, u.disabled
      FROM sessions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(sha256(token), Date.now());

    if (row && (row.role === 'admin' || (row.userId && !row.disabled))) {
      req.session = { role: row.role, userId: row.userId, label: row.label };
    }
  }
  next();
}

const requireUser = (req, res, next) => (
  req.session?.role === 'user' ? next() : res.status(401).json({ error: 'Требуется вход.' })
);

const requireAdmin = (req, res, next) => (
  req.session?.role === 'admin' ? next() : res.status(401).json({ error: 'Требуется вход администратора.' })
);

// ---------- Пароль администратора ----------
function createAdminPasswordCheck(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Задайте ADMIN_PASSWORD (не короче 8 символов) в файле .env');
  }
  const salt = crypto.randomBytes(16);
  const expected = crypto.scryptSync(password, salt, 64);
  return (candidate) => {
    if (typeof candidate !== 'string' || candidate.length > 200) return false;
    return crypto.timingSafeEqual(crypto.scryptSync(candidate, salt, 64), expected);
  };
}

// ---------- Ограничение попыток входа (по IP) ----------
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
    }
    return next();
  };
}

module.exports = {
  securityHeaders,
  originCheck,
  attachSession,
  createSession,
  destroySession,
  requireUser,
  requireAdmin,
  createAdminPasswordCheck,
  rateLimit,
};
