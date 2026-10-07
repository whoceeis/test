const express = require('express');
const { db, normalizeCode, sha256, transaction } = require('../db');
const { createSession, destroySession, rateLimit } = require('../security');

module.exports = function authRoutes({ checkAdminPassword, loginLimit }) {
  const router = express.Router();
  const limiter = rateLimit(loginLimit);

  // Вход пользователя по одноразовому коду. После успешного входа код сгорает,
  // а устройство остаётся авторизованным (долгая сессия в cookie).
  router.post('/login', limiter, (req, res) => {
    const reject = () => res.status(401).json({ error: 'Неверный код или он уже использован.' });

    const code = normalizeCode(typeof req.body?.code === 'string' ? req.body.code : '');
    if (code.length !== 10) return reject();

    const row = db.prepare(`
      SELECT c.id, c.used_at AS usedAt, u.id AS userId, u.disabled
      FROM access_codes c
      JOIN users u ON u.id = c.user_id
      WHERE c.code_hash = ?
    `).get(sha256(code));

    if (!row || row.usedAt || row.disabled) return reject();

    // Условие used_at IS NULL делает «сгорание» атомарным: два одновременных запроса не пройдут оба.
    // Вход по новому коду заново открывает однократную загрузку фото.
    const accepted = transaction(() => {
      const claimed = db.prepare('UPDATE access_codes SET used_at = ? WHERE id = ? AND used_at IS NULL')
        .run(Date.now(), row.id);
      if (claimed.changes !== 1) return false;
      db.prepare('UPDATE users SET photo_locked = 0 WHERE id = ?').run(row.userId);
      return true;
    });
    if (!accepted) return reject();

    createSession(res, 'user', row.userId);
    return res.json({ ok: true, next: '/' });
  });

  router.post('/admin/login', limiter, (req, res) => {
    if (!checkAdminPassword(req.body?.password)) {
      return res.status(401).json({ error: 'Неверный пароль.' });
    }
    createSession(res, 'admin');
    return res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    destroySession(req, res);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    const session = req.session;
    if (!session) return res.status(401).json({ error: 'Требуется вход.' });
    if (session.role === 'admin') return res.json({ role: 'admin' });

    const user = db.prepare('SELECT photo_file AS photoFile, photo_version AS photoVersion, photo_locked AS photoLocked FROM users WHERE id = ?')
      .get(session.userId);
    return res.json({
      role: 'user',
      label: session.label,
      hasPhoto: Boolean(user?.photoFile),
      photoVersion: user?.photoVersion ?? 0,
      photoLocked: Boolean(user?.photoLocked),
    });
  });

  return router;
};
