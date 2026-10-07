// Увеличение фото документа щипком двумя пальцами.
// Территория зума — весь блок .document вместе с его полями (padding): фото может занять её целиком,
// но обрезается по её границам, поэтому не перекрывает вкладки сверху и кнопки снизу.
// Масштаб «фиксируется»: после отпускания пальцев остаётся как есть; свели пальцы до конца — фото встаёт на место.
(() => {
  const frame = document.getElementById('photo-frame');
  const photo = document.getElementById('photo');
  const area = frame?.closest('.document'); // территория зума
  if (!frame || !photo || !area) return;

  const MAX_SCALE = 4;
  const OVERSHOOT = 1.15; // во время щипка можно чуть выйти за максимум, после отпускания вернётся
  const SNAP_BACK = 1.1; // отпустили, не дойдя до 1,1×, — возвращаем в исходное положение

  let scale = 1;
  let x = 0;
  let y = 0;
  let gesture = null;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // Допустимый сдвиг по одной оси. Фото увеличивается от центра рамки (c, размер h) внутри территории [from, to]:
  // пока оно меньше территории — стоит по центру; когда стало больше — край фото не отходит от края территории
  function axis(s, value, c, h, from, to) {
    const half = (s * h) / 2;
    if (s * h < to - from) return (from - c + half + (to - c - half)) / 2;
    return clamp(value, to - c - half, from - c + half);
  }

  function bounded(s, ox, oy) {
    const f = frame.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    return [
      axis(s, ox, f.left + f.width / 2, f.width, a.left, a.right),
      axis(s, oy, f.top + f.height / 2, f.height, a.top, a.bottom),
    ];
  }

  function apply(animate = false) {
    photo.classList.toggle('is-animating', animate);
    photo.style.transform = scale === 1 && x === 0 && y === 0 ? '' : `translate(${x}px, ${y}px) scale(${scale})`;
    // В увеличенном состоянии фото двигается пальцем, поэтому рамка перестаёт отдавать жесты прокрутке
    area.classList.toggle('is-zoomed', scale > 1.001);
  }

  function reset(animate = false) {
    scale = 1;
    x = 0;
    y = 0;
    apply(animate);
  }

  const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  // Центр между пальцами относительно центра рамки
  function middle(a, b) {
    const rect = frame.getBoundingClientRect();
    return {
      x: (a.clientX + b.clientX) / 2 - (rect.left + rect.width / 2),
      y: (a.clientY + b.clientY) / 2 - (rect.top + rect.height / 2),
    };
  }

  function startPinch(touches) {
    const [a, b] = touches;
    const m = middle(a, b);
    // Точка фото под пальцами: её и держим под пальцами при изменении масштаба
    gesture = { type: 'pinch', d0: distance(a, b) || 1, s0: scale, px: (m.x - x) / scale, py: (m.y - y) / scale };
  }

  function startPan(touch) {
    gesture = { type: 'pan', sx: touch.clientX, sy: touch.clientY, x0: x, y0: y };
  }

  function onStart(event) {
    if (!photo.complete || photo.hidden) return;
    if (event.touches.length === 2) {
      startPinch(event.touches);
      event.preventDefault();
    } else if (event.touches.length === 1 && scale > 1.001) {
      startPan(event.touches[0]);
    }
  }

  function onMove(event) {
    if (!gesture) return;

    if (gesture.type === 'pinch' && event.touches.length >= 2) {
      const [a, b] = event.touches;
      const next = clamp((gesture.s0 * distance(a, b)) / gesture.d0, 1, MAX_SCALE * OVERSHOOT);
      const m = middle(a, b);
      scale = next;
      [x, y] = bounded(next, m.x - next * gesture.px, m.y - next * gesture.py);
      apply();
      event.preventDefault();
    } else if (gesture.type === 'pan' && event.touches.length === 1) {
      const t = event.touches[0];
      [x, y] = bounded(scale, gesture.x0 + t.clientX - gesture.sx, gesture.y0 + t.clientY - gesture.sy);
      apply();
      event.preventDefault();
    }
  }

  function onEnd(event) {
    if (!gesture) return;

    if (gesture.type === 'pinch') {
      if (event.touches.length >= 2) return;
      if (scale < SNAP_BACK) {
        reset(true);
      } else {
        scale = Math.min(scale, MAX_SCALE);
        [x, y] = bounded(scale, x, y);
        apply(true);
      }
      // Остался один палец — им можно сразу двигать увеличенное фото
      gesture = null;
      if (event.touches.length === 1 && scale > 1.001) startPan(event.touches[0]);
      return;
    }

    if (event.touches.length === 0) gesture = null;
  }

  // Жесты принимаются по всей территории блока, в том числе на его полях
  area.addEventListener('touchstart', onStart, { passive: false });
  area.addEventListener('touchmove', onMove, { passive: false });
  area.addEventListener('touchend', onEnd);
  area.addEventListener('touchcancel', onEnd);

  photo.addEventListener('transitionend', () => photo.classList.remove('is-animating'));
  // Новое фото всегда показывается без увеличения
  photo.addEventListener('load', () => reset());
  // При повороте экрана размеры меняются: удерживаем фото в границах территории
  window.addEventListener('resize', () => {
    [x, y] = bounded(scale, x, y);
    apply();
  });
})();
