const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  ROOT,
  PORT: Number(process.env.PORT) || 3000,
  // По умолчанию слушаем только localhost; для проверки с телефона в одной сети: HOST=0.0.0.0
  HOST: process.env.HOST || '127.0.0.1',
  DATA_DIR: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  // Secure-cookie нужны за HTTPS; для локальной разработки по http выключены
  COOKIE_SECURE: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : isProd,
  // 1, если приложение стоит за nginx/прокси (нужно для лимита попыток по IP)
  TRUST_PROXY: process.env.TRUST_PROXY === '1',
  USER_SESSION_DAYS: 365,
  ADMIN_SESSION_HOURS: 12,
  MAX_PHOTO_BYTES: 12 * 1024 * 1024,
};
