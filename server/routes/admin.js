const express = require('express');
const { db, generateCode, hashCode, transaction, removeUpload } = require('../db');
const { requireAdmin } = require('../security');

function parseLabel(value) {
  const label = typeof value === 'string' ? value.trim() : '';
  return label.length >= 1 && label.length <= 60 ? label : null;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function insertCode(userId) {
  const code = generateCode();
  db.prepare('INSERT INTO access_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)')
    .run(userId, hashCode(code), Date.now());
  return code;
}

module.exports = function adminRoutes() {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/users', (req, res) => {
    const rows = db.prepare(`
      SELECT u.id,
             u.label,
             u.disabled,
             u.created_at AS createdAt,
             u.photo_file IS NOT NULL AS hasPhoto,
             u.photo_locked AS photoLocked,
             (SELECT MAX(used_at) FROM access_codes WHERE user_id = u.id) AS usedAt
      FROM users u
      ORDER BY u.id DESC
    `).all();

    res.json({
      users: rows.map((row) => ({
        id: row.id,
        label: row.label,
        status: row.disabled ? 'revoked' : (row.usedAt ? 'active' : 'pending'),
        createdAt: row.createdAt,
        usedAt: row.usedAt,
        hasPhoto: Boolean(row.hasPhoto),
        photoLocked: Boolean(row.photoLocked),
      })),
    });
  });

  // Новый пользователь и его одноразовый код. Код показывается только в ответе на этот запрос.
  router.post('/users', (req, res) => {
    const label = parseLabel(req.body?.label);
    if (!label) return res.status(400).json({ error: 'Укажите имя пользователя (до 60 символов).' });

    const result = transaction(() => {
      const user = db.prepare('INSERT INTO users (label, created_at) VALUES (?, ?)').run(label, Date.now());
      const id = Number(user.lastInsertRowid);
      return { id, code: insertCode(id) };
    });
    return res.status(201).json(result);
  });

  // Новый код для существующего пользователя: старый доступ закрывается (сессии и неиспользованные коды),
  // а после входа по новому коду пользователь один раз сможет заменить фото.
  router.post('/users/:id/codes', (req, res) => {
    const id = parseId(req.params.id);
    const user = id && db.prepare('SELECT id, disabled FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (user.disabled) return res.status(409).json({ error: 'Доступ пользователя отозван.' });

    const code = transaction(() => {
      db.prepare('DELETE FROM access_codes WHERE user_id = ? AND used_at IS NULL').run(id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      return insertCode(id);
    });
    return res.status(201).json({ id, code });
  });

  // Отозвать доступ: пользователь сразу выходит из приложения на всех устройствах
  router.post('/users/:id/revoke', (req, res) => {
    const id = parseId(req.params.id);
    const user = id && db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден.' });

    transaction(() => {
      db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM access_codes WHERE user_id = ? AND used_at IS NULL').run(id);
    });
    return res.json({ ok: true });
  });

  router.delete('/users/:id', (req, res) => {
    const id = parseId(req.params.id);
    const user = id && db.prepare('SELECT photo_file AS photoFile FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден.' });

    db.prepare('DELETE FROM users WHERE id = ?').run(id); // коды и сессии удаляются каскадом
    removeUpload(user.photoFile);
    return res.json({ ok: true });
  });

  return router;
};
