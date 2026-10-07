const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./config');

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    label         TEXT    NOT NULL,
    disabled      INTEGER NOT NULL DEFAULT 0,
    photo_file    TEXT,
    photo_type    TEXT,
    photo_version INTEGER NOT NULL DEFAULT 0,
    photo_locked  INTEGER NOT NULL DEFAULT 0,
    profile       TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS access_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT    NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    used_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    role       TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_codes_user ON access_codes(user_id);
`);

// Миграция для баз, созданных до появления блокировки: уже загруженные фото считаем «использованной» попыткой
const hasPhotoLocked = db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'photo_locked'").get();
if (!hasPhotoLocked) {
  db.exec('ALTER TABLE users ADD COLUMN photo_locked INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE users SET photo_locked = 1 WHERE photo_file IS NOT NULL');
}

// Данные полей «Реквизиты» (JSON) добавлены позже: дополняем старые базы
const hasProfile = db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'profile'").get();
if (!hasProfile) db.exec('ALTER TABLE users ADD COLUMN profile TEXT');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Код без похожих символов (нет 0/O, 1/I/L): 10 символов, ~50 бит
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  let raw = '';
  for (let i = 0; i < 10; i += 1) raw += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

const normalizeCode = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');

// В базе хранится только хэш кода: показать его повторно нельзя, только выпустить новый
const hashCode = (code) => sha256(normalizeCode(code));

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function removeUpload(file) {
  if (!file) return;
  try {
    fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(file)));
  } catch {
    // файла уже нет
  }
}

function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

module.exports = {
  db,
  UPLOADS_DIR,
  sha256,
  generateCode,
  normalizeCode,
  hashCode,
  transaction,
  removeUpload,
};
