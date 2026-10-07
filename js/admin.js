(() => {
  const $ = (id) => document.getElementById(id);

  const loginView = $('login-view');
  const panelView = $('panel-view');
  const loginForm = $('login-form');
  const loginError = $('login-error');
  const loginSubmit = $('login-submit');
  const createForm = $('create-form');
  const createSubmit = $('create-submit');
  const labelInput = $('label');
  const codeBox = $('code-box');
  const codeLabel = $('code-label');
  const codeValue = $('code-value');
  const copyButton = $('copy-code');
  const panelError = $('panel-error');
  const usersList = $('users');
  const usersEmpty = $('users-empty');
  const template = $('user-template');

  const STATUS_TEXT = { pending: 'Ждёт входа', active: 'В приложении', revoked: 'Доступ отозван' };
  const formatDate = (ms) => new Date(ms).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function api(path, { method, json } = {}) {
    const response = await fetch(path, {
      method: method || (json ? 'POST' : 'GET'),
      headers: json ? { 'Content-Type': 'application/json' } : undefined,
      body: json ? JSON.stringify(json) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.error || 'Ошибка запроса.', response.status);
    return data;
  }

  function setText(element, message) {
    element.textContent = message;
    element.hidden = !message;
  }

  function showLogin() {
    panelView.hidden = true;
    loginView.hidden = false;
    $('password').focus();
  }

  function showPanel() {
    loginView.hidden = true;
    panelView.hidden = false;
  }

  function renderUsers(users) {
    usersList.replaceChildren();
    usersEmpty.hidden = users.length > 0;

    for (const user of users) {
      const item = template.content.firstElementChild.cloneNode(true);
      item.dataset.id = String(user.id);
      item.dataset.label = user.label;
      item.querySelector('.user__name').textContent = user.label;

      const status = item.querySelector('.user__status');
      status.textContent = STATUS_TEXT[user.status];
      status.classList.add(`user__status--${user.status}`);

      const meta = [`создан ${formatDate(user.createdAt)}`];
      if (user.usedAt) meta.push(`вошёл ${formatDate(user.usedAt)}`);
      if (user.hasPhoto) meta.push(user.photoLocked ? 'фото загружено, замена закрыта' : 'фото загружено, можно заменить один раз');
      item.querySelector('.user__meta').textContent = meta.join(' · ');

      if (user.status === 'revoked') {
        item.querySelector('[data-action="code"]').hidden = true;
        item.querySelector('[data-action="revoke"]').hidden = true;
      }
      usersList.append(item);
    }
  }

  async function loadUsers() {
    try {
      const { users } = await api('/api/admin/users');
      showPanel();
      renderUsers(users);
    } catch (error) {
      if (error.status === 401) showLogin();
      else setText(panelError, error.message);
    }
  }

  function showCode(label, code) {
    codeLabel.textContent = label;
    codeValue.textContent = code;
    codeBox.hidden = false;
    copyButton.textContent = 'Скопировать код';
    codeBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginSubmit.disabled = true;
    try {
      await api('/api/admin/login', { json: { password: $('password').value } });
      $('password').value = '';
      setText(loginError, '');
      await loadUsers();
    } catch (error) {
      setText(loginError, error.message);
    } finally {
      loginSubmit.disabled = false;
    }
  });

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const label = labelInput.value.trim();
    if (!label) {
      setText(panelError, 'Введите имя пользователя.');
      return;
    }
    createSubmit.disabled = true;
    try {
      const { code } = await api('/api/admin/users', { json: { label } });
      labelInput.value = '';
      setText(panelError, '');
      showCode(label, code);
      await loadUsers();
    } catch (error) {
      if (error.status === 401) showLogin();
      else setText(panelError, error.message);
    } finally {
      createSubmit.disabled = false;
    }
  });

  usersList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const item = button.closest('.user');
    const { id, label } = item.dataset;

    try {
      if (button.dataset.action === 'code') {
        if (!window.confirm(`Выдать «${label}» новый код? Пользователь выйдет из приложения, а после входа по новому коду сможет один раз заменить фото.`)) return;
        const { code } = await api(`/api/admin/users/${id}/codes`, { method: 'POST' });
        showCode(label, code);
      } else if (button.dataset.action === 'revoke') {
        if (!window.confirm(`Отозвать доступ у «${label}»? Пользователь сразу выйдет из приложения.`)) return;
        await api(`/api/admin/users/${id}/revoke`, { method: 'POST' });
      } else if (button.dataset.action === 'delete') {
        if (!window.confirm(`Удалить «${label}» вместе с загруженным фото? Это нельзя отменить.`)) return;
        await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      }
      setText(panelError, '');
      await loadUsers();
    } catch (error) {
      if (error.status === 401) showLogin();
      else setText(panelError, error.message);
    }
  });

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeValue.textContent);
      copyButton.textContent = 'Скопировано';
    } catch {
      // Буфер обмена доступен только на HTTPS и localhost; код можно выделить одним касанием
      copyButton.textContent = 'Выделите код и скопируйте вручную';
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    codeBox.hidden = true;
    showLogin();
  });

  loadUsers();
})();
