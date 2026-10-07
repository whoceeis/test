const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'app-test-'));
process.env.ADMIN_PASSWORD = 'test-admin-password';

const { createApp } = require('../server/app');

// Минимальный валидный PNG 1x1
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let server;
let base;

before(async () => {
  server = createApp({ loginLimit: { windowMs: 60_000, max: 1000 } }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// Клиент с «браузерным» cookie-хранилищем
function client() {
  let cookie = '';
  return async (url, { json, body, headers = {}, method } = {}) => {
    const init = { method: method || (json || body ? 'POST' : 'GET'), redirect: 'manual', headers: { ...headers } };
    if (cookie) init.headers.cookie = cookie;
    if (json) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(json);
    }
    if (body) init.body = body;
    const res = await fetch(base + url, init);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0].endsWith('=') ? '' : setCookie.split(';')[0];
    return res;
  };
}

async function adminClient() {
  const admin = client();
  const res = await admin('/api/admin/login', { json: { password: 'test-admin-password' } });
  assert.equal(res.status, 200);
  return admin;
}

async function newUser(admin, label = 'Тест') {
  const res = await admin('/api/admin/users', { json: { label } });
  assert.equal(res.status, 201);
  return res.json();
}

test('страницы приложения без входа ведут на страницу входа', async () => {
  const anon = client();
  for (const page of ['/', '/pages/id-document.html', '/pages/services.html']) {
    const res = await anon(page);
    assert.equal(res.status, 302, page);
    assert.equal(res.headers.get('location'), '/pages/login.html');
  }
  assert.equal((await anon('/pages/login.html')).status, 200);
  // старый адрес главной не остаётся отдельной страницей
  const old = await anon('/pages/home.html');
  assert.equal(old.status, 302);
  assert.equal(old.headers.get('location'), '/');
  assert.equal((await anon('/pages/admin.html')).status, 200);
  assert.equal((await anon('/css/tokens.css')).status, 200);
});

test('серверные файлы и база недоступны по HTTP', async () => {
  const anon = client();
  for (const url of ['/server/app.js', '/data/app.db', '/package.json', '/.env', '/node_modules/express/package.json']) {
    const res = await anon(url);
    assert.notEqual(res.status, 200, url);
  }
});

test('админ: неверный пароль отклоняется, верный даёт доступ', async () => {
  const anon = client();
  assert.equal((await anon('/api/admin/users')).status, 401);
  assert.equal((await anon('/api/admin/login', { json: { password: 'wrong' } })).status, 401);
  assert.equal((await anon('/api/admin/login', { json: {} })).status, 401);

  const admin = await adminClient();
  assert.equal((await admin('/api/admin/users')).status, 200);
});

test('код одноразовый: после входа повторно не работает, а устройство остаётся в системе', async () => {
  const admin = await adminClient();
  const { code } = await newUser(admin);
  assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

  const phone = client();
  const login = await phone('/api/login', { json: { code } });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  assert.equal((await login.json()).next, '/');

  // тот же телефон открывает главную прямо по адресу сайта и страницы без кода
  const home = await phone('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>Главная<\/title>/);
  assert.equal((await phone('/pages/home.html')).headers.get('location'), '/');
  assert.equal((await phone('/pages/login.html')).headers.get('location'), '/');
  assert.equal((await phone('/pages/services.html')).status, 200);
  assert.equal((await phone('/api/me')).status, 200);

  // второй человек с тем же кодом не войдёт
  const stranger = client();
  assert.equal((await stranger('/api/login', { json: { code } })).status, 401);
  assert.equal((await stranger('/')).status, 302);
});

test('код принимается в любом регистре и без дефиса; неверные коды отклоняются', async () => {
  const admin = await adminClient();
  const { code } = await newUser(admin);
  const phone = client();
  assert.equal((await phone('/api/login', { json: { code: 'AAAAA-AAAAA' } })).status, 401);
  assert.equal((await phone('/api/login', { json: { code: 123 } })).status, 401);
  assert.equal((await phone('/api/login', { json: {} })).status, 401);
  assert.equal((await phone('/api/login', { json: { code: code.toLowerCase().replace('-', ' ') } })).status, 200);
});

test('обычный пользователь не может пользоваться админскими методами', async () => {
  const admin = await adminClient();
  const { code } = await newUser(admin);
  const phone = client();
  await phone('/api/login', { json: { code } });

  assert.equal((await phone('/api/admin/users')).status, 401);
  assert.equal((await phone('/api/admin/users', { json: { label: 'x' } })).status, 401);
  assert.equal((await phone('/api/admin/users/1', { method: 'DELETE' })).status, 401);
});

test('фото: загрузка, получение, замена и проверка содержимого', async () => {
  const admin = await adminClient();
  const { id: userId, code } = await newUser(admin, 'С фото');
  const phone = client();
  await phone('/api/login', { json: { code } });

  assert.equal((await phone('/api/photo')).status, 404);
  const fresh = await (await phone('/api/me')).json();
  assert.equal(fresh.hasPhoto, false);
  assert.equal(fresh.photoLocked, false);

  // неудачные попытки не расходуют единственную загрузку
  const fake = await phone('/api/photo', { body: Buffer.from('<script>alert(1)</script>'), headers: { 'content-type': 'image/png' } });
  assert.equal(fake.status, 415);
  const svg = await phone('/api/photo', { body: Buffer.from('<svg/>'), headers: { 'content-type': 'image/svg+xml' } });
  assert.equal(svg.status, 415);
  assert.equal((await (await phone('/api/me')).json()).photoLocked, false);

  const up = await phone('/api/photo', { body: PNG, headers: { 'content-type': 'image/png' } });
  assert.equal(up.status, 200);
  const { version } = await up.json();

  const got = await phone('/api/photo');
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), PNG);
  assert.deepEqual(await (await phone('/api/me')).json(), { role: 'user', label: 'С фото', hasPhoto: true, photoVersion: version, photoLocked: true });

  // второй раз загрузить нельзя: фото и версия остаются прежними
  const second = await phone('/api/photo', { body: PNG, headers: { 'content-type': 'image/png' } });
  assert.equal(second.status, 403);
  assert.equal((await second.json()).locked, true);
  assert.equal((await (await phone('/api/me')).json()).photoVersion, version);
  assert.equal(fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads')).filter((f) => f.startsWith(`${userId}-`)).length, 1);

  // без входа
  assert.equal((await client()('/api/photo')).status, 401);
  assert.equal((await client()('/api/photo', { body: PNG, headers: { 'content-type': 'image/png' } })).status, 401);
});

test('фото разных пользователей не пересекаются', async () => {
  const admin = await adminClient();
  const a = client();
  const b = client();
  await a('/api/login', { json: { code: (await newUser(admin, 'A')).code } });
  await b('/api/login', { json: { code: (await newUser(admin, 'B')).code } });

  await a('/api/photo', { body: PNG, headers: { 'content-type': 'image/png' } });
  assert.equal((await a('/api/photo')).status, 200);
  assert.equal((await b('/api/photo')).status, 404);
});

test('слишком большой файл отклоняется', async () => {
  const admin = await adminClient();
  const phone = client();
  await phone('/api/login', { json: { code: (await newUser(admin)).code } });
  const huge = Buffer.concat([PNG, Buffer.alloc(13 * 1024 * 1024)]);
  const res = await phone('/api/photo', { body: huge, headers: { 'content-type': 'image/png' } });
  assert.equal(res.status, 413);
});

test('отзыв доступа сразу выкидывает пользователя; удаление чистит данные', async () => {
  const admin = await adminClient();
  const { id, code } = await newUser(admin, 'Отзыв');
  const phone = client();
  await phone('/api/login', { json: { code } });
  await phone('/api/photo', { body: PNG, headers: { 'content-type': 'image/png' } });
  assert.equal((await phone('/api/me')).status, 200);

  assert.equal((await admin(`/api/admin/users/${id}/revoke`, { method: 'POST' })).status, 200);
  assert.equal((await phone('/api/me')).status, 401);
  assert.equal((await phone('/')).status, 302);
  // новый код отозванному не выдаётся
  assert.equal((await admin(`/api/admin/users/${id}/codes`, { method: 'POST' })).status, 409);

  const before = fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads')).length;
  assert.equal((await admin(`/api/admin/users/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal(fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads')).length, before - 1);
  assert.equal((await admin(`/api/admin/users/${id}`, { method: 'DELETE' })).status, 404);
});

test('новый код для существующего пользователя: старый неиспользованный код отзывается', async () => {
  const admin = await adminClient();
  const { id, code: oldCode } = await newUser(admin, 'Новый телефон');
  const reissue = await admin(`/api/admin/users/${id}/codes`, { method: 'POST' });
  assert.equal(reissue.status, 201);
  const { code: newCode } = await reissue.json();
  assert.notEqual(newCode, oldCode);

  assert.equal((await client()('/api/login', { json: { code: oldCode } })).status, 401);
  assert.equal((await client()('/api/login', { json: { code: newCode } })).status, 200);
});

test('список пользователей показывает статусы и не содержит кодов', async () => {
  const admin = await adminClient();
  await newUser(admin, 'Ожидает вход');
  const res = await admin('/api/admin/users');
  const { users } = await res.json();
  const waiting = users.find((u) => u.label === 'Ожидает вход');
  assert.equal(waiting.status, 'pending');
  assert.ok(users.some((u) => u.status === 'active'));
  assert.ok(!JSON.stringify(users).match(/[A-Z2-9]{5}-[A-Z2-9]{5}/));
});

test('валидация имени при создании пользователя', async () => {
  const admin = await adminClient();
  for (const label of ['', '   ', 'x'.repeat(61), 5, null]) {
    const res = await admin('/api/admin/users', { json: { label } });
    assert.equal(res.status, 400, JSON.stringify(label));
  }
});

test('запросы с чужого сайта (Origin) отклоняются', async () => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ code: 'AAAAA-AAAAA' }),
  });
  assert.equal(res.status, 403);
});

test('выход завершает сессию', async () => {
  const admin = await adminClient();
  const phone = client();
  await phone('/api/login', { json: { code: (await newUser(admin)).code } });
  assert.equal((await phone('/api/logout', { method: 'POST' })).status, 200);
  assert.equal((await phone('/api/me')).status, 401);
});

test('ограничение числа попыток входа', async () => {
  const limited = createApp({ loginLimit: { windowMs: 60_000, max: 3 } }).listen(0, '127.0.0.1');
  await new Promise((resolve) => limited.once('listening', resolve));
  const url = `http://127.0.0.1:${limited.address().port}/api/login`;
  const statuses = [];
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'AAAAA-AAAAA' }) });
    statuses.push(res.status);
  }
  limited.close();
  assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
});

test('фото можно загрузить один раз; новый код от админа даёт ещё одну попытку', async () => {
  const admin = await adminClient();
  const { id, code } = await newUser(admin, 'Одна попытка');
  const phone = client();
  await phone('/api/login', { json: { code } });

  const upload = (who) => who('/api/photo', { body: PNG, headers: { 'content-type': 'image/png' } });
  const uploads = () => fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads')).filter((f) => f.startsWith(`${id}-`));

  const first = await upload(phone);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).locked, true);
  assert.equal((await upload(phone)).status, 403);
  assert.equal(uploads().length, 1);
  const [firstFile] = uploads();

  // админ видит, что замена закрыта
  let listed = (await (await admin('/api/admin/users')).json()).users.find((u) => u.id === id);
  assert.equal(listed.photoLocked, true);

  // новый код: старый доступ закрывается, пользователь входит заново
  const reissue = await admin(`/api/admin/users/${id}/codes`, { method: 'POST' });
  assert.equal(reissue.status, 201);
  assert.equal((await phone('/api/me')).status, 401, 'старая сессия должна быть закрыта');
  assert.equal((await upload(phone)).status, 401);

  // пока код не введён, загрузка всё ещё закрыта (даже для старого фото)
  listed = (await (await admin('/api/admin/users')).json()).users.find((u) => u.id === id);
  assert.equal(listed.photoLocked, true);

  const { code: newCode } = await reissue.json();
  assert.equal((await phone('/api/login', { json: { code: newCode } })).status, 200);
  const me = await (await phone('/api/me')).json();
  assert.equal(me.photoLocked, false);
  assert.equal(me.hasPhoto, true, 'прежнее фото остаётся, пока не загружено новое');

  // вторая (и последняя по этому коду) загрузка проходит, старый файл удаляется
  assert.equal((await upload(phone)).status, 200);
  assert.equal(uploads().length, 1);
  assert.notEqual(uploads()[0], firstFile);
  assert.equal((await phone('/api/me').then((r) => r.json())).photoLocked, true);
  assert.equal((await upload(phone)).status, 403);
});

test('две одновременные загрузки: проходит только одна, лишний файл не остаётся', async () => {
  const admin = await adminClient();
  const { id, code } = await newUser(admin, 'Гонка');
  const phone = client();
  await phone('/api/login', { json: { code } });

  const upload = () => phone('/api/photo', { body: PNG, headers: { 'content-type': 'image/png' } });
  const results = await Promise.all([upload(), upload(), upload()]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 403, 403]);
  const files = fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads')).filter((f) => f.startsWith(`${id}-`));
  assert.equal(files.length, 1);
});

test('фото нельзя заменить, пока новый код не введён, даже если админ только выдал код', async () => {
  const admin = await adminClient();
  const { id, code } = await newUser(admin, 'Код выдан, но не введён');
  const phone = client();
  await phone('/api/login', { json: { code } });
  await phone('/api/photo', { body: PNG, headers: { 'content-type': 'image/png' } });

  // второй браузер, который ещё не вводил новый код, тоже не загрузит
  await admin(`/api/admin/users/${id}/codes`, { method: 'POST' });
  const other = client();
  assert.equal((await other('/api/photo', { body: PNG, headers: { 'content-type': 'image/png' } })).status, 401);
});

test('манифест и иконки приложения открыты без входа, название «Kaspi.kz»', async () => {
  const anon = client();
  const res = await anon('/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /manifest\+json/);
  const manifest = await res.json();
  assert.equal(manifest.name, 'Kaspi.kz');
  assert.equal(manifest.short_name, 'Kaspi.kz');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));

  // каждая иконка из манифеста реально отдаётся и является PNG
  for (const icon of manifest.icons) {
    const r = await anon(icon.src);
    assert.equal(r.status, 200, icon.src);
    assert.equal(r.headers.get('content-type'), 'image/png', icon.src);
  }
  for (const url of ['/favicon.ico', '/apple-touch-icon.png', '/assets/icons/icon.svg']) {
    assert.equal((await anon(url)).status, 200, url);
  }

  // все страницы подключают манифест, иконки и название
  for (const page of ['login', 'admin']) {
    const html = await (await anon(`/pages/${page}.html`)).text();
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(html, /rel="apple-touch-icon"/);
    assert.match(html, /apple-mobile-web-app-title" content="Kaspi\.kz"/);
  }
});

test('реквизиты: пользователь сам вносит значения полей, они хранятся отдельно у каждого', async () => {
  const admin = await adminClient();
  const a = client();
  const b = client();
  await a('/api/login', { json: { code: (await newUser(admin, 'Реквизиты A')).code } });
  await b('/api/login', { json: { code: (await newUser(admin, 'Реквизиты B')).code } });

  const put = (who, fields) => who('/api/profile', { method: 'PUT', json: { fields } });

  // пока ничего не сохранено — пусто (страница покажет значения по умолчанию)
  assert.deepEqual(await (await a('/api/profile')).json(), { fields: {} });

  const saved = await put(a, { fio: '  Иванов Иван  ', iin: '123456789012', unknown: 'x' });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).fields, { fio: 'Иванов Иван', iin: '123456789012' });

  // дописывается по одному полю, остальные остаются; пустое значение — тоже значение
  await put(a, { birthDate: '01.02.2003' });
  await put(a, { fio: '' });
  assert.deepEqual((await (await a('/api/profile')).json()).fields, { fio: '', iin: '123456789012', birthDate: '01.02.2003' });

  // у другого пользователя ничего не изменилось
  assert.deepEqual(await (await b('/api/profile')).json(), { fields: {} });

  // проверки
  assert.equal((await put(a, { fio: 'x'.repeat(121) })).status, 400);
  assert.equal((await put(a, { fio: 123 })).status, 400);
  assert.equal((await a('/api/profile', { method: 'PUT', json: { fields: [] } })).status, 400);
  assert.equal((await a('/api/profile', { method: 'PUT', json: {} })).status, 400);
  assert.equal((await client()('/api/profile')).status, 401);
  assert.equal((await put(client(), { fio: 'x' })).status, 401);
});

test('«Документ» и «Реквизиты» — одна страница; старые адреса перенаправляются на неё', async () => {
  // старые адреса работают и без входа (дальше защита страницы отправит на вход)
  const anon = client();
  const details = await anon('/pages/id-details.html');
  assert.equal(details.status, 302);
  assert.equal(details.headers.get('location'), '/pages/id-document.html#requisites');
  const draft = await anon('/pages/id-test.html');
  assert.equal(draft.status, 302);
  assert.equal(draft.headers.get('location'), '/pages/id-document.html');
  assert.equal((await anon('/pages/id-document.html')).headers.get('location'), '/pages/login.html');

  // после входа страница содержит обе вкладки, обе панели и нужные скрипты
  const admin = await adminClient();
  const phone = client();
  await phone('/api/login', { json: { code: (await newUser(admin, 'Одна страница')).code } });
  const page = await phone('/pages/id-document.html');
  assert.equal(page.status, 200);
  const html = await page.text();
  for (const marker of ['id="tab-document"', 'id="tab-details"', 'id="panel-document"', 'id="panel-details"',
    'id="photo-frame"', 'name="fio"', '/js/id-pager.js', '/js/id-document.js', '/js/id-details.js', '/js/id-zoom.js']) {
    assert.ok(html.includes(marker), marker);
  }
  // вспомогательные файлы страницы отдаются, лишних больше нет
  for (const url of ['/css/pages/id-document.css', '/js/id-pager.js', '/js/id-document.js', '/js/id-details.js', '/js/id-zoom.js']) {
    assert.equal((await phone(url)).status, 200, url);
  }
  for (const url of ['/css/pages/id-details.css', '/css/pages/id-test.css', '/js/id-test.js']) {
    assert.equal((await phone(url)).status, 404, url);
  }
});
