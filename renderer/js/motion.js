/**
 * Скользящий pill (FkViewToggle-стиль).
 * Переезд капсулы — JS-анимация baseX/Y/w/h (не CSS), чтобы remount/RO
 * не «телепортировали» thumb на новый сегмент.
 * Parallax — отдельный rAF-lerp поверх базы.
 */
(() => {
  const MORPH_MS = 420;
  const PARALLAX_PX = 7;
  const SCALE_HOVER = 1.06;
  const LERP = 0.22;
  const TOGGLE_SEL = '.seg, .dock, [data-fk-vtoggle], .fk-vtoggle';
  const ACTIVE_SEL = [
    '.dock-btn.is-active',
    '.dock-btn.active',
    '.seg-btn.is-active',
    '.seg-btn.active',
    '.seg-month.is-active',
    '.seg-month.active',
    '.fk-vtoggle__btn.is-active',
    '.fk-vtoggle__btn.active',
    '[role="tab"][aria-selected="true"]'
  ].join(', ');

  /** @type {Map<Element, any>} */
  const states = new Map();
  const tracked = new Set();
  /** @type {Map<string, {x:number,y:number,w:number,h:number,activeKey:string}>} */
  const memory = new Map();

  function reducedMotion() {
    try {
      return !!(
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    } catch (_) {
      return false;
    }
  }

  function isStatic(container) {
    return (
      container.classList.contains('fk-vtoggle--static') ||
      container.classList.contains('is-thumb-static') ||
      container.hasAttribute('data-fk-vtoggle-static') ||
      container.hasAttribute('data-thumb-static') ||
      reducedMotion()
    );
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function itemKey(el) {
    if (!el) return null;
    const d = el.dataset || {};
    const explicit =
      d.period ||
      d.page ||
      d.heatMetric ||
      d.heatCompare ||
      d.msection ||
      d.wtab ||
      d.audienceTab ||
      d.metric ||
      d.tab;
    if (explicit) return explicit;
    const select = el.querySelector && el.querySelector('select');
    if (select && select.value) return `select:${select.value}`;
    const label = el.querySelector && el.querySelector('.seg-month-label');
    const text = label ? label.textContent : el.textContent;
    return `text:${String(text || '').trim()}`;
  }

  function containerKey(container) {
    return container.dataset.thumbKey || container.id || null;
  }

  function findActive(container) {
    return (
      container.querySelector(ACTIVE_SEL) ||
      container.querySelector('[aria-selected="true"]')
    );
  }

  function ensureThumb(container) {
    for (const child of container.children) {
      if (
        child.classList &&
        (child.classList.contains('nav-thumb') || child.classList.contains('fk-vtoggle__thumb'))
      ) {
        return child;
      }
    }
    const thumb = document.createElement('span');
    thumb.className = container.classList.contains('fk-vtoggle')
      ? 'fk-vtoggle__thumb'
      : 'nav-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    container.insertBefore(thumb, container.firstChild);
    return thumb;
  }

  function setInstant(container, on) {
    container.classList.toggle('is-instant-thumb', on);
    container.classList.toggle('fk-vtoggle--instant-thumb', on);
  }

  function setParallaxMode(container, on) {
    container.classList.toggle('is-thumb-parallax', on);
  }

  /** Насколько бегунок больше кнопки с каждой стороны. Остаётся внутри капсулы. */
  const THUMB_OUTSET = 2;

  function thumbBox(container, active) {
    const maxW = container.clientWidth;
    const maxH = container.clientHeight;
    let x = active.offsetLeft - THUMB_OUTSET;
    let y = active.offsetTop - THUMB_OUTSET;
    let w = active.offsetWidth + THUMB_OUTSET * 2;
    let h = active.offsetHeight + THUMB_OUTSET * 2;
    if (x < 0) {
      w += x;
      x = 0;
    }
    if (y < 0) {
      h += y;
      y = 0;
    }
    if (x + w > maxW) w = Math.max(0, maxW - x);
    if (y + h > maxH) h = Math.max(0, maxH - y);
    return { x, y, w, h };
  }

  function paint(state) {
    const { thumb, baseX, baseY, w, h, px, py, scale } = state;
    thumb.style.width = `${w}px`;
    thumb.style.height = `${h}px`;
    thumb.style.transform = `translate3d(${baseX + px}px, ${baseY + py}px, 0) scale(${scale})`;
  }

  function stopMorph(state) {
    if (state.morphRaf) {
      cancelAnimationFrame(state.morphRaf);
      state.morphRaf = 0;
    }
  }

  function stopParallax(state, container) {
    if (state.parallaxRaf) {
      cancelAnimationFrame(state.parallaxRaf);
      state.parallaxRaf = 0;
    }
    state.px = 0;
    state.py = 0;
    state.scale = 1;
    state.targetPx = 0;
    state.targetPy = 0;
    state.targetScale = 1;
    if (container) setParallaxMode(container, false);
  }

  function remember(state, x, y, w, h, key) {
    state.baseX = x;
    state.baseY = y;
    state.w = w;
    state.h = h;
    state.placed = true;
    state.activeKey = key;
    if (state.memKey) {
      memory.set(state.memKey, { x, y, w, h, activeKey: key });
    }
  }

  function morphTo(container, state, from, to, key) {
    stopMorph(state);
    stopParallax(state, container);
    setInstant(container, true);

    const start = performance.now();
    const fromX = from.x;
    const fromY = from.y;
    const fromW = from.w;
    const fromH = from.h;
    state.morphTo = to;
    state.activeKey = key;

    function frame(now) {
      if (!container.isConnected || !state.thumb.isConnected) {
        state.morphRaf = 0;
        return;
      }
      const dest = state.morphTo || to;
      const t = Math.min(1, (now - start) / MORPH_MS);
      const e = easeOutCubic(t);
      state.baseX = fromX + (dest.x - fromX) * e;
      state.baseY = fromY + (dest.y - fromY) * e;
      state.w = fromW + (dest.w - fromW) * e;
      state.h = fromH + (dest.h - fromH) * e;
      paint(state);
      if (t < 1) {
        state.morphRaf = requestAnimationFrame(frame);
      } else {
        state.morphRaf = 0;
        remember(state, dest.x, dest.y, dest.w, dest.h, key);
        paint(state);
        setInstant(container, false);
      }
    }

    state.baseX = fromX;
    state.baseY = fromY;
    state.w = fromW;
    state.h = fromH;
    paint(state);
    state.morphRaf = requestAnimationFrame(frame);
  }

  function settleParallax(state) {
    return (
      Math.abs(state.px - state.targetPx) < 0.05 &&
      Math.abs(state.py - state.targetPy) < 0.05 &&
      Math.abs(state.scale - state.targetScale) < 0.002
    );
  }

  function tickParallax(container) {
    const state = states.get(container);
    if (!state || state.morphRaf) {
      if (state) state.parallaxRaf = 0;
      return;
    }
    state.px += (state.targetPx - state.px) * LERP;
    state.py += (state.targetPy - state.py) * LERP;
    state.scale += (state.targetScale - state.scale) * LERP;
    paint(state);
    if (settleParallax(state)) {
      state.px = state.targetPx;
      state.py = state.targetPy;
      state.scale = state.targetScale;
      paint(state);
      state.parallaxRaf = 0;
      if (state.targetScale === 1 && state.targetPx === 0 && state.targetPy === 0) {
        setParallaxMode(container, false);
      }
      return;
    }
    state.parallaxRaf = requestAnimationFrame(() => tickParallax(container));
  }

  function requestParallaxTick(container) {
    const state = states.get(container);
    if (!state || state.parallaxRaf || state.morphRaf) return;
    setParallaxMode(container, true);
    state.parallaxRaf = requestAnimationFrame(() => tickParallax(container));
  }

  function getState(container, thumb) {
    let state = states.get(container);
    if (!state) {
      state = {
        thumb,
        baseX: 0,
        baseY: 0,
        w: 0,
        h: 0,
        px: 0,
        py: 0,
        scale: 1,
        targetPx: 0,
        targetPy: 0,
        targetScale: 1,
        parallaxRaf: 0,
        morphRaf: 0,
        placed: false,
        activeKey: null,
        memKey: containerKey(container),
        applying: false,
        syncRaf: 0,
        pendingOpts: null
      };
      states.set(container, state);
    }
    state.thumb = thumb;
    if (!state.memKey) state.memKey = containerKey(container);
    return state;
  }

  function fromGeometry(state) {
    if (state.placed && state.w > 0) {
      return { x: state.baseX, y: state.baseY, w: state.w, h: state.h };
    }
    const prev = state.memKey ? memory.get(state.memKey) : null;
    if (prev && prev.w > 0) return prev;
    return null;
  }

  function applyThumb(container, { instant = false } = {}) {
    if (!(container instanceof Element) || !container.isConnected) return;

    const thumb = ensureThumb(container);
    if (thumb.parentNode === container && container.firstChild !== thumb) {
      container.insertBefore(thumb, container.firstChild);
    }

    const state = getState(container, thumb);
    if (state.applying) return;
    state.applying = true;

    try {
      const active = findActive(container);
      if (!active) {
        thumb.style.opacity = '0';
        return;
      }
      thumb.style.opacity = '1';

      const box = thumbBox(container, active);
      const { x, y, w, h } = box;
      if (!w || !h) {
        thumb.style.opacity = '0';
        return;
      }

      const key = itemKey(active);
      const from = fromGeometry(state);
      const changed = state.activeKey !== key;
      const first = !from;
      const dest = { x, y, w, h };

      // Уже едем к этому пункту — не обрывать (ресайз/повторный sync только
      // поправляют цель). Иначе капсула в .seg «лагает» и телепортируется.
      if (state.morphRaf && state.activeKey === key) {
        state.morphTo = dest;
        return;
      }

      const dist = from
        ? Math.abs(from.x - x) + Math.abs(from.y - y) + Math.abs(from.w - w)
        : 0;

      const canMorph =
        !instant && !first && changed && !reducedMotion() && from && dist > 0.5;

      if (canMorph) {
        morphTo(container, state, from, dest, key);
        return;
      }

      // Без morph: сразу на место (первый кадр / forced instant / тот же ключ).
      stopMorph(state);
      if (changed) stopParallax(state, container);

      if (instant || first) {
        setInstant(container, true);
        remember(state, x, y, w, h, key);
        paint(state);
        void thumb.offsetWidth;
        requestAnimationFrame(() => {
          if (container.isConnected) setInstant(container, false);
        });
      } else {
        // Тот же сегмент, сдвиг геометрии (ресайз) — можно CSS.
        setInstant(container, false);
        remember(state, x, y, w, h, key);
        paint(state);
      }
    } finally {
      state.applying = false;
    }
  }

  function scheduleApply(container, opts) {
    const thumb = ensureThumb(container);
    const state = getState(container, thumb);
    // instant:true не должен затирать уже запланированный morph без instant
    if (state.pendingOpts && state.pendingOpts.instant === false && opts && opts.instant) {
      /* keep non-instant */
    } else {
      state.pendingOpts = opts || {};
    }
    if (state.syncRaf) return;
    state.syncRaf = requestAnimationFrame(() => {
      state.syncRaf = 0;
      const o = state.pendingOpts || {};
      state.pendingOpts = null;
      applyThumb(container, o);
    });
  }

  function onPointerMove(container, event) {
    if (isStatic(container)) return;
    const state = states.get(container);
    if (!state || !state.placed || state.morphRaf) return;
    const active = findActive(container);
    if (!active) return;

    const r = active.getBoundingClientRect();
    const inside =
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom;

    if (!inside) {
      state.targetPx = 0;
      state.targetPy = 0;
      state.targetScale = 1;
      requestParallaxTick(container);
      return;
    }

    const nx = ((event.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1;
    const ny = ((event.clientY - r.top) / Math.max(r.height, 1)) * 2 - 1;
    state.targetPx = Math.max(-1, Math.min(1, nx)) * PARALLAX_PX;
    state.targetPy = Math.max(-1, Math.min(1, ny)) * PARALLAX_PX * 0.65;
    state.targetScale = SCALE_HOVER;
    requestParallaxTick(container);
  }

  function onPointerLeave(container) {
    if (isStatic(container)) return;
    const state = states.get(container);
    if (!state || state.morphRaf) return;
    state.targetPx = 0;
    state.targetPy = 0;
    state.targetScale = 1;
    requestParallaxTick(container);
  }

  function bindPointer(container) {
    if (container.__faTogglePtr) return;
    container.__faTogglePtr = true;
    container.addEventListener('pointermove', (e) => onPointerMove(container, e), {
      passive: true
    });
    container.addEventListener('pointerleave', () => onPointerLeave(container));
  }

  function init(container) {
    if (!(container instanceof Element)) return;
    tracked.add(container);
    ensureThumb(container);
    bindPointer(container);

    // Новый DOM не доигрывает переезд после загрузки — капсула едет
    // в момент клика, пока элемент ещё на экране.
    applyThumb(container, { instant: true });

    if (!container.__faToggleMo) {
      const mo = new MutationObserver((records) => {
        for (const rec of records) {
          if (rec.type === 'childList') {
            scheduleApply(container);
            return;
          }
          if (rec.attributeName === 'aria-selected') {
            scheduleApply(container);
            return;
          }
          if (rec.attributeName === 'class' && rec.target instanceof Element) {
            if (rec.target === container) continue;
            const cur = String(rec.target.className || '');
            const old = String(rec.oldValue || '');
            if (/\b(active|is-active)\b/.test(cur) || /\b(active|is-active)\b/.test(old)) {
              scheduleApply(container);
              return;
            }
          }
        }
      });
      mo.observe(container, {
        attributes: true,
        attributeFilter: ['class', 'aria-selected'],
        attributeOldValue: true,
        childList: true,
        subtree: true
      });
      container.__faToggleMo = mo;
    }

    if (typeof ResizeObserver === 'function' && !container.__faToggleRo) {
      const ro = new ResizeObserver(() => {
        if (!container.isConnected) {
          ro.disconnect();
          return;
        }
        const state = states.get(container);
        // Во время morph не дёргаем; иначе телепорт.
        if (state && state.morphRaf) return;
        // Только подгон геометрии того же сегмента — без instant-телепорта.
        scheduleApply(container);
      });
      ro.observe(container);
      container.__faToggleRo = ro;
    }
  }

  function track(container) {
    if (tracked.has(container)) {
      scheduleApply(container);
      return;
    }
    init(container);
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(TOGGLE_SEL).forEach(track);
  }

  function sync(root) {
    if (!root) {
      scan(document);
      return;
    }
    if (root.matches && root.matches(TOGGLE_SEL)) {
      scheduleApply(root);
      return;
    }
    if (root.querySelectorAll) {
      root.querySelectorAll(TOGGLE_SEL).forEach((el) => scheduleApply(el));
    }
  }

  function initApi(root) {
    if (!root) {
      scan(document);
      return;
    }
    if (root.matches && root.matches(TOGGLE_SEL)) {
      init(root);
      return;
    }
    if (root.querySelectorAll) {
      root.querySelectorAll(TOGGLE_SEL).forEach((el) => init(el));
    }
  }

  const pending = new Set();
  let flushFrame = 0;

  function scheduleFlush() {
    if (flushFrame) return;
    flushFrame = requestAnimationFrame(() => {
      flushFrame = 0;
      for (const el of tracked) {
        if (!el.isConnected) {
          tracked.delete(el);
          const st = states.get(el);
          if (st) {
            stopMorph(st);
            if (st.parallaxRaf) cancelAnimationFrame(st.parallaxRaf);
          }
          states.delete(el);
        }
      }
      if (!pending.size) return;
      for (const el of pending) track(el);
      pending.clear();
    });
  }

  function collect(node) {
    if (!(node instanceof Element)) return;
    if (node.matches && node.matches(TOGGLE_SEL)) pending.add(node);
    if (node.querySelectorAll) {
      node.querySelectorAll(TOGGLE_SEL).forEach((el) => pending.add(el));
    }
  }

  function onMutations(records) {
    let found = false;
    for (const rec of records) {
      if (!rec.addedNodes || !rec.addedNodes.length) continue;
      for (const node of rec.addedNodes) {
        const before = pending.size;
        collect(node);
        if (pending.size !== before) found = true;
      }
    }
    if (found) scheduleFlush();
  }

  function start() {
    scan(document);
    new MutationObserver(onMutations).observe(document.body, {
      childList: true,
      subtree: true
    });

    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        for (const el of [...tracked]) {
          if (!el.isConnected) {
            tracked.delete(el);
            continue;
          }
          const st = states.get(el);
          if (st && st.morphRaf) continue;
          scheduleApply(el);
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  function flush(root) {
    const applyNow = (el) => applyThumb(el);
    if (!root) return;
    if (root.matches && root.matches(TOGGLE_SEL)) {
      applyNow(root);
      return;
    }
    if (root.querySelectorAll) {
      root.querySelectorAll(TOGGLE_SEL).forEach(applyNow);
    }
  }

  const api = {
    duration: MORPH_MS,
    scan,
    sync,
    flush,
    init: initApi
  };

  window.FoundersMotion = api;
  if (!window.FkViewToggle) window.FkViewToggle = api;
})();
