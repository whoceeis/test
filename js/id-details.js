(() => {
  const inputs = [...document.querySelectorAll('.field__value[name]')];
  const saved = new Map(); // что сейчас сохранено на сервере (или значение по умолчанию из разметки)
  const edited = new Set(); // поля, которые пользователь успел изменить до загрузки данных

  const login = () => window.location.replace('/pages/login.html');

  async function request(method, body) {
    const response = await fetch('/api/profile', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401) {
      login();
      return null;
    }
    if (!response.ok) throw new Error('request failed');
    return response.json();
  }

  async function save(input) {
    const value = input.value;
    if (value === saved.get(input.name)) return;

    try {
      const data = await request('PUT', { fields: { [input.name]: value } });
      if (!data) return;
      saved.set(input.name, data.fields[input.name]);
      if (document.activeElement !== input) input.value = data.fields[input.name];
    } catch {
      input.value = saved.get(input.name);
      window.alert('Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.');
    }
  }

  for (const input of inputs) {
    saved.set(input.name, input.value);

    input.addEventListener('input', () => edited.add(input.name));
    // Значение выделяется целиком: пользователь сразу печатает своё поверх примера
    input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
    input.addEventListener('change', () => save(input));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
    });
  }

  // Экран загрузки ждёт сохранённые значения, чтобы поля не менялись на открытой странице
  window.pageLoader?.hold((async () => {
    try {
      const data = await request('GET');
      if (!data) return;
      for (const input of inputs) {
        if (!(input.name in data.fields) || edited.has(input.name)) continue;
        input.value = data.fields[input.name];
        saved.set(input.name, input.value);
      }
    } catch {
      // без связи остаются значения по умолчанию
    }
  })());
})();
