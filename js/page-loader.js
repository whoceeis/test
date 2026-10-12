// Экран загрузки (стили: css/loader.css). Подключается в <head> синхронно, до отрисовки страницы.
// Пока не загружены разметка, картинки, шрифты и запросы страницы, пользователь видит белый экран
// с красной линией сверху. Линия доходит до правого края, и только затем показывается страница.
//
// Страницы, которые после загрузки сами запрашивают данные, регистрируют запрос:
//   window.pageLoader?.hold(promise);
(() => {
  const root = document.documentElement;

  const MAX_WAIT_MS = 8000; // страховка: при сбое не держим белый экран дольше
  const FILL_MS = 300; // совпадает с transition в loader.css

  // Доли линии: до разметки она ползёт к PARSE_CAP, потом растёт по мере загрузки ресурсов
  const PARSE_CAP = 0.3;
  const DOM_READY = 0.4;
  const RESOURCES_SHARE = 0.5;

  root.classList.add('is-loading');

  let progress = 0;
  let finished = false;
  let domReady = false;
  let windowLoaded = false;
  let fontsReady = false;
  let total = 0; // картинки и запросы страницы
  let done = 0;

  function setProgress(value) {
    if (finished) return;
    progress = Math.max(progress, Math.min(value, 1));
    root.style.setProperty('--load-progress', String(progress));
  }

  function reveal() {
    root.classList.remove('is-loading');
    root.style.removeProperty('--load-progress');
    document.dispatchEvent(new Event('pageloader:done'));
  }

  function finish() {
    if (finished) return;
    setProgress(1);
    finished = true;
    clearInterval(creep);
    setTimeout(reveal, FILL_MS); // даём линии дойти до правого края
  }

  function update() {
    if (!domReady || finished) return;
    setProgress(DOM_READY + RESOURCES_SHARE * (total ? done / total : 1));
    if (windowLoaded && fontsReady && done >= total) finish();
  }

  function settle() {
    done += 1;
    update();
  }

  // Пока читается разметка, линия медленно ползёт, чтобы было видно, что идёт загрузка
  const creep = setInterval(() => setProgress(progress + (PARSE_CAP - progress) * 0.12), 100);
  setProgress(0.02);
  setTimeout(finish, MAX_WAIT_MS);

  function trackImages() {
    for (const image of document.images) {
      if (image.loading === 'lazy') continue; // такие грузятся только при прокрутке
      total += 1;
      if (image.complete) {
        done += 1;
      } else {
        image.addEventListener('load', settle, { once: true });
        image.addEventListener('error', settle, { once: true });
      }
    }
  }

  function onDomReady() {
    domReady = true;
    clearInterval(creep);
    trackImages();
    setProgress(DOM_READY);
    update();
  }

  function onWindowLoad() {
    windowLoaded = true;
    // Шрифты запрашиваются после вёрстки, поэтому ждём их уже после load
    const fonts = document.fonts?.ready ?? Promise.resolve();
    fonts.then(() => {
      fontsReady = true;
      update();
    }, () => {
      fontsReady = true;
      update();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onDomReady);
  else onDomReady();

  if (document.readyState === 'complete') onWindowLoad();
  else window.addEventListener('load', onWindowLoad);

  window.pageLoader = {
    hold(promise) {
      if (finished) return promise;
      total += 1;
      Promise.resolve(promise).then(settle, settle);
      return promise;
    },
  };
})();
