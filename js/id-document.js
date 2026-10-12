(() => {
  const frame = document.getElementById('photo-frame');
  const input = document.getElementById('photo-input');
  const photo = document.getElementById('photo');
  const status = document.getElementById('photo-status');

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_SIDE = 2400; // длинная сторона, больше не нужно: рамка маленькая
  const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

  const CONFIRM_TEXT = 'Фото можно загрузить только один раз. Заменить его сможет только администратор, выдав новый код доступа.\n\nЗагрузить это фото?';

  let statusTimer = 0;
  let locked = false;

  function showStatus(message, { error = false, sticky = false } = {}) {
    clearTimeout(statusTimer);
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('document__status--error', error);
    if (message && !sticky) statusTimer = setTimeout(() => { status.hidden = true; }, 4000);
  }

  // После загрузки рамка закрывается: поле выбора файла отключено, нажатие ничего не делает
  function setLocked(value) {
    locked = value;
    input.disabled = value;
    frame.classList.toggle('is-locked', value);
  }

  function showPhoto(version) {
    photo.src = `/api/photo?v=${version}`;
  }

  photo.addEventListener('load', () => {
    photo.hidden = false;
    frame.classList.add('has-photo');
  });

  // Крупные фото с телефона уменьшаем в браузере: быстрее загрузка и меньше места на сервере.
  // Мелкие файлы уходят как есть.
  async function prepare(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= MAX_UPLOAD_BYTES) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', 0.9);
    });
  }

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      showStatus('Подходят только фото JPEG, PNG или WebP.', { error: true });
      return;
    }

    if (locked) return;
    if (!window.confirm(CONFIRM_TEXT)) return;

    showStatus('Загружаем…', { sticky: true });
    try {
      const body = await prepare(file);
      const response = await fetch('/api/photo', {
        method: 'POST',
        headers: { 'Content-Type': body.type },
        body,
      });

      if (response.status === 401) {
        window.location.replace('/pages/login.html');
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok && data.locked) {
        // Сервер уже закрыл загрузку (например, страница устарела): просто закрываем рамку
        setLocked(true);
        showStatus('');
        return;
      }
      if (!response.ok) {
        showStatus(data.error || 'Не удалось загрузить фото.', { error: true });
        return;
      }
      showPhoto(data.version);
      setLocked(true);
      showStatus('Фото сохранено. Заменить его сможет только администратор.');
    } catch {
      showStatus('Не удалось обработать это фото. Выберите другое.', { error: true });
    }
  });

  // Заставка отсчитывает свои 3 секунды заново: после экрана загрузки и при возврате кнопкой «назад»
  // (страница тогда берётся из кэша браузера без перезагрузки)
  const splash = document.getElementById('splash');
  function restartSplash() {
    if (!splash) return;
    splash.style.animation = 'none';
    void splash.offsetWidth;
    splash.style.animation = '';
  }
  document.addEventListener('pageloader:done', restartSplash);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) restartSplash();
  });

  // Экран загрузки ждёт данные и фото, чтобы они не появлялись на открытой странице
  const photoLoaded = () => new Promise((resolve) => {
    photo.addEventListener('load', resolve, { once: true });
    photo.addEventListener('error', resolve, { once: true });
  });

  window.pageLoader?.hold((async () => {
    try {
      const response = await fetch('/api/me');
      if (response.status === 401) {
        window.location.replace('/pages/login.html');
        return;
      }
      const me = await response.json();
      setLocked(Boolean(me.photoLocked));
      if (me.hasPhoto) {
        const loaded = photoLoaded();
        showPhoto(me.photoVersion);
        await loaded;
      }
    } catch {
      // без связи остаётся пустая рамка с подсказкой
    }
  })());
})();
