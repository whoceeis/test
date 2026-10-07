const express = require('express');
const { db } = require('../db');
const { requireUser } = require('../security');

// Поля страницы «Реквизиты». Пользователь вводит их сам, поэтому принимаем любой текст, но ограничиваем размер.
const FIELDS = ['fio', 'iin', 'birthDate', 'documentNumber', 'issueDate', 'expiryDate'];
const MAX_LENGTH = 120;

const clean = (value) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();

function readProfile(userId) {
  const row = db.prepare('SELECT profile FROM users WHERE id = ?').get(userId);
  try {
    return row?.profile ? JSON.parse(row.profile) : {};
  } catch {
    return {};
  }
}

module.exports = function profileRoutes() {
  const router = express.Router();

  // Возвращаются только поля, которые пользователь уже сохранял; остальное страница показывает по умолчанию
  router.get('/profile', requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ fields: readProfile(req.session.userId) });
  });

  // Тело: { fields: { fio: "...", iin: "..." } } — сохраняются только переданные поля
  router.put('/profile', requireUser, (req, res) => {
    const incoming = req.body?.fields;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Некорректный запрос.' });
    }

    const updates = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (!FIELDS.includes(key)) continue;
      if (typeof value !== 'string' || value.length > MAX_LENGTH) {
        return res.status(400).json({ error: `Значение слишком длинное (до ${MAX_LENGTH} символов).` });
      }
      updates[key] = clean(value);
    }

    const next = { ...readProfile(req.session.userId), ...updates };
    db.prepare('UPDATE users SET profile = ? WHERE id = ?').run(JSON.stringify(next), req.session.userId);
    return res.json({ fields: next });
  });

  return router;
};
