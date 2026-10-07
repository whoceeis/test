// Приложение не должно масштабироваться как веб-страница.
// Двойной тап и щипок блокирует CSS (touch-action в base.css) и meta viewport,
// но iOS Safari игнорирует meta, поэтому щипок дополнительно гасим вручную.
(() => {
  const stop = (event) => event.preventDefault();

  ['gesturestart', 'gesturechange', 'gestureend'].forEach((name) => {
    document.addEventListener(name, stop, { passive: false });
  });

  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
})();
