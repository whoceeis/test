const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');

// База, созданная до появления однократной загрузки фото (без колонки photo_locked)
test('миграция: у пользователей с фото загрузка закрыта, у остальных открыта', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-migration-'));
  process.env.DATA_DIR = dir;
  process.env.ADMIN_PASSWORD = 'test-admin-password';

  const old = new DatabaseSync(path.join(dir, 'app.db'));
  old.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
      photo_file TEXT, photo_type TEXT, photo_version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    INSERT INTO users (label, photo_file, photo_type, photo_version, created_at) VALUES ('С фото', '1-a.png', 'image/png', 1, 1);
    INSERT INTO users (label, created_at) VALUES ('Без фото', 2);
  `);
  old.close();

  const { db } = require('../server/db');
  const rows = db.prepare('SELECT label, photo_locked AS locked FROM users ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [r.label, r.locked]), [['С фото', 1], ['Без фото', 0]]);
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'profile'").get(), 'колонка profile добавлена');
});
