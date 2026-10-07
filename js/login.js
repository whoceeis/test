(() => {
  const form = document.getElementById('login-form');
  const input = document.getElementById('code');
  const error = document.getElementById('error');
  const submit = document.getElementById('submit');

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  // Подставляем дефис после пятого символа: XXXXX-XXXXX
  input.addEventListener('input', () => {
    const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    input.value = raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
    showError('');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    if (code.replace('-', '').length !== 10) {
      showError('Введите код целиком: 10 символов.');
      return;
    }

    submit.disabled = true;
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError(data.error || 'Не удалось войти. Попробуйте ещё раз.');
        return;
      }
      window.location.replace(data.next || '/');
    } catch {
      showError('Нет связи с сервером. Проверьте интернет.');
    } finally {
      submit.disabled = false;
    }
  });
})();
