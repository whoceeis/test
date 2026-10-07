const path = require('node:path');
const express = require('express');
const config = require('./config');
const {
  securityHeaders,
  originCheck,
  attachSession,
  createAdminPasswordCheck,
} = require('./security');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const photoRoutes = require('./routes/photo');
const profileRoutes = require('./routes/profile');

const PUBLIC_PAGES = new Set(['/login.html', '/admin.html']);

function createApp({ loginLimit = { windowMs: 15 * 60 * 1000, max: 10 } } = {}) {
  const checkAdminPassword = createAdminPasswordCheck(config.ADMIN_PASSWORD);
  const app = express();

  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(attachSession);
  app.use(originCheck);

  // Публичная статика: стили, скрипты, иконки
  for (const dir of ['css', 'js', 'assets']) {
    app.use(`/${dir}`, express.static(path.join(config.ROOT, dir)));
  }

  // Главная открывается прямо по адресу сайта; без входа — экран входа
  app.get('/', (req, res) => {
    if (req.session?.role !== 'user') return res.redirect('/pages/login.html');
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(path.join(config.ROOT, 'pages', 'home.html'));
  });
  app.get('/pages/home.html', (req, res) => res.redirect('/'));
  // «Реквизиты» теперь вкладка страницы «Удостоверение личности»; старые адреса остаются рабочими
  app.get('/pages/id-details.html', (req, res) => res.redirect('/pages/id-document.html#requisites'));
  app.get('/pages/id-test.html', (req, res) => res.redirect('/pages/id-document.html'));
  // Иконки и манифест открыты без входа: их запрашивает браузер/система до авторизации
  const sendPublic = (file, type) => (req, res) => {
    if (type) res.type(type);
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(config.ROOT, file));
  };
  app.get('/manifest.webmanifest', sendPublic('manifest.webmanifest', 'application/manifest+json'));
  app.get('/favicon.ico', sendPublic('assets/icons/favicon-32.png', 'image/png'));
  app.get('/apple-touch-icon.png', sendPublic('assets/icons/apple-touch-icon.png', 'image/png'));

  // Страницы приложения доступны только после входа по коду; вход и админка — открыты
  app.use('/pages', (req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    if (PUBLIC_PAGES.has(req.path)) {
      if (req.path === '/login.html' && req.session?.role === 'user') return res.redirect('/');
      return next();
    }
    if (req.session?.role === 'user') return next();
    return res.redirect('/pages/login.html');
  }, express.static(path.join(config.ROOT, 'pages'), { index: false }));

  app.use('/api', express.json({ limit: '10kb' }));
  app.use('/api', authRoutes({ checkAdminPassword, loginLimit }));
  app.use('/api/admin', adminRoutes());
  app.use('/api', photoRoutes());
  app.use('/api', profileRoutes());
  app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Файл слишком большой.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный запрос.' });
    console.error(error);
    return res.status(500).json({ error: 'Ошибка сервера.' });
  });

  return app;
}

module.exports = { createApp };
