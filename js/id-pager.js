// «Документ» и «Реквизиты» на одной странице: переключение нажатием на вкладку или свайпом.
// Панели лежат в горизонтальной прокручиваемой ленте (scroll-snap), поэтому свайп нативный и плавный.
// Белая заливка на вкладках привязана к положению ленты: сколько прокрутили — столько она и проехала.
(() => {
  const pager = document.getElementById('pager');
  const tabs = document.getElementById('id-tabs');
  const items = [...tabs.querySelectorAll('.id-tabs__item')];
  const panels = [...pager.querySelectorAll('.panel')];

  const HASHES = ['#document', '#requisites'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let frame = 0;
  let settleTimer = 0;
  let settled = true;

  const maxScroll = () => Math.max(1, pager.scrollWidth - pager.clientWidth);
  const progress = () => Math.min(1, Math.max(0, pager.scrollLeft / maxScroll()));
  const currentIndex = () => (progress() >= 0.5 ? 1 : 0);

  // Заливка и подпись активной вкладки следуют за положением ленты
  function render() {
    frame = 0;
    tabs.style.setProperty('--progress', progress().toFixed(4));
    const current = currentIndex();
    items.forEach((item, index) => {
      item.setAttribute('aria-selected', String(index === current));
      item.tabIndex = index === current ? 0 : -1;
    });
  }

  // Лента остановилась: скрытую панель отключаем (в неё нельзя попасть табом) и запоминаем вкладку в адресе
  function settle() {
    settled = true;
    const current = currentIndex();
    panels.forEach((panel, index) => { panel.inert = index !== current; });
    history.replaceState(null, '', HASHES[current]);
  }

  function onScroll() {
    if (settled) {
      settled = false;
      panels.forEach((panel) => { panel.inert = false; });
    }
    if (!frame) frame = requestAnimationFrame(render);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 120);
  }

  function goTo(index) {
    pager.scrollTo({ left: index * pager.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  pager.addEventListener('scroll', onScroll, { passive: true });
  pager.addEventListener('scrollend', () => { clearTimeout(settleTimer); settle(); });

  items.forEach((item, index) => item.addEventListener('click', () => goTo(index)));

  tabs.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const next = event.key === 'ArrowRight' ? 1 : 0;
    goTo(next);
    items[next].focus();
  });

  // Если адрес поменяли вручную (#document / #requisites), переходим на нужную панель
  window.addEventListener('hashchange', () => {
    const index = HASHES.indexOf(location.hash);
    if (index >= 0 && index !== currentIndex()) goTo(index);
  });

  // При повороте экрана или смене размера остаёмся на той же панели
  window.addEventListener('resize', () => {
    pager.scrollLeft = currentIndex() * pager.clientWidth;
    render();
  });

  // Адрес со ссылкой #requisites сразу открывает «Реквизиты»
  pager.scrollLeft = location.hash === HASHES[1] ? pager.clientWidth : 0;
  render();
  settle();
})();
