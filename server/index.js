const config = require('./config');
const { createApp } = require('./app');

const app = createApp();

app.listen(config.PORT, config.HOST, () => {
  console.log(`Приложение: http://${config.HOST}:${config.PORT}`);
  console.log(`Админка:    http://${config.HOST}:${config.PORT}/pages/admin.html`);
});
