const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { MAX_PHOTO_BYTES } = require('../config');
const { db, UPLOADS_DIR, removeUpload, transaction } = require('../db');
const { requireUser } = require('../security');

const LOCKED_MESSAGE = 'Фото уже загружено. Чтобы заменить его, попросите администратора выдать новый код доступа.';

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Тип определяем по содержимому файла, а не по заголовку, который присылает клиент
function sniffImageType(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

// Загрузить фото можно один раз; после этого загрузка закрыта, пока администратор не выдаст новый код
function rejectIfLocked(req, res, next) {
  const user = db.prepare('SELECT photo_locked AS locked FROM users WHERE id = ?').get(req.session.userId);
  if (user?.locked) return res.status(403).json({ error: LOCKED_MESSAGE, locked: true });
  return next();
}

module.exports = function photoRoutes() {
  const router = express.Router();

  // Фото документа текущего пользователя. Файлы лежат вне публичных папок и отдаются только владельцу.
  router.get('/photo', requireUser, (req, res) => {
    const user = db.prepare('SELECT photo_file AS file, photo_type AS type FROM users WHERE id = ?')
      .get(req.session.userId);
    if (!user?.file) return res.status(404).json({ error: 'Фото не загружено.' });

    res.set('Cache-Control', 'private, no-cache');
    res.type(user.type);
    return res.sendFile(path.join(UPLOADS_DIR, path.basename(user.file)));
  });

  // Тело запроса — сам файл (Content-Type: image/jpeg | image/png | image/webp)
  router.post(
    '/photo',
    requireUser,
    rejectIfLocked,
    express.raw({ type: Object.keys(EXTENSIONS), limit: MAX_PHOTO_BYTES }),
    (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(415).json({ error: 'Загрузите изображение JPEG, PNG или WebP.' });
      }
      const type = sniffImageType(req.body);
      if (!type) return res.status(415).json({ error: 'Файл не похож на изображение JPEG, PNG или WebP.' });

      const userId = req.session.userId;
      const file = `${userId}-${crypto.randomBytes(8).toString('hex')}.${EXTENSIONS[type]}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, file), req.body);

      // Условие photo_locked = 0 делает «один раз» атомарным: из двух одновременных загрузок пройдёт одна
      let previous;
      let claimed;
      try {
        ({ claimed, previous } = transaction(() => {
          const before = db.prepare('SELECT photo_file AS file FROM users WHERE id = ?').get(userId);
          const result = db.prepare(`
            UPDATE users
            SET photo_file = ?, photo_type = ?, photo_version = photo_version + 1, photo_locked = 1
            WHERE id = ? AND photo_locked = 0
          `).run(file, type, userId);
          return { claimed: result.changes === 1, previous: before?.file };
        }));
      } catch (error) {
        removeUpload(file);
        throw error;
      }

      if (!claimed) {
        removeUpload(file);
        return res.status(403).json({ error: LOCKED_MESSAGE, locked: true });
      }
      removeUpload(previous);

      const { photoVersion } = db.prepare('SELECT photo_version AS photoVersion FROM users WHERE id = ?').get(userId);
      return res.json({ ok: true, version: photoVersion, locked: true });
    },
  );

  return router;
};
