function ensureHeatPopover() {
  let el = document.getElementById('heatPopover');
  if (!el) {
    el = document.createElement('div');
    el.id = 'heatPopover';
    el.className = 'chart-tooltip heat-popover';
    el.setAttribute('hidden', '');
    document.body.appendChild(el);
  } else if (!el.classList.contains('chart-tooltip')) {
    el.classList.add('chart-tooltip');
  }
  return el;
}

function openHeatPopover(el) {
  el.removeAttribute('hidden');
  // force reflow for enter transition
  void el.offsetWidth;
  el.classList.add('is-open');
}

function closeHeatPopover(el) {
  el.classList.remove('is-open');
  const done = () => {
    if (!el.classList.contains('is-open')) el.setAttribute('hidden', '');
    el.removeEventListener('transitionend', done);
  };
  el.addEventListener('transitionend', done);
  setTimeout(done, 280);
}

function ensureHeatSheet() {
  let el = document.getElementById('heatSheet');
  if (!el) {
    el = document.createElement('div');
    el.id = 'heatSheet';
    el.className = 'heat-sheet';
    el.hidden = true;
    el.innerHTML = `
      <div class="heat-sheet-backdrop" data-heat-sheet-close="1"></div>
      <div class="heat-sheet-panel" role="dialog" aria-modal="true" aria-label="${F().esc(T('heatmap.sheet.aria'))}">
        <div class="heat-sheet-head">
          <h3 id="heatSheetTitle">${T('heatmap.sheet.title')}</h3>
          <button type="button" class="btn" data-heat-sheet-close="1">${T('heatmap.sheet.close')}</button>
        </div>
        <div class="heat-sheet-body" id="heatSheetBody"></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const close = e.target.closest('[data-heat-sheet-close]');
      if (close) {
        el.hidden = true;
        return;
      }
      const open = e.target.closest('[data-open]');
      if (open && open.dataset.open) {
        el.hidden = true;
        window.FoundersApp.openGame(open.dataset.open);
      }
    });
  }
  return el;
}

function openHeatOtherSheet(other, metric, payload) {
  const sheet = ensureHeatSheet();
  const kids = other.children || [];
  const title = document.getElementById('heatSheetTitle');
  const body = document.getElementById('heatSheetBody');
  if (title) title.textContent = other.title || T('heatmap.sheet.title');
  const curB = formatHeatBounds(payload && payload.currentBounds);
  const cmpB = formatHeatBounds(payload && payload.compareBounds);
  const compareLabel = (payload && payload.compareLabel) || '';
  body.innerHTML = `
    <div class="heat-sheet-meta muted">${T('heatmap.sheet.meta', {
      current: F().esc(curB),
      label: F().esc(compareLabel),
      compare: F().esc(cmpB)
    })}</div>
    <div class="heat-sheet-list">
      ${kids
        .map((c) => {
          const v = metric === 'earn' ? moneyFmt(c.value) : F().num(c.value, 0);
          const icon = c.icon_url
            ? `<img class="game-icon" src="${F().esc(c.icon_url)}" alt="" loading="lazy" />`
            : `<div class="game-icon placeholder">${F().esc(
                String(c.title || '?').slice(0, 1).toUpperCase()
              )}</div>`;
          return `<button type="button" class="heat-sheet-row" data-open="${F().esc(c.id)}">
            ${icon}
            <span class="heat-sheet-row-text">
              <strong>${F().esc(c.title || c.id)}</strong>
              <span class="muted mono">ID ${F().esc(c.id)}</span>
            </span>
            <b>${v}</b>
          </button>`;
        })
        .join('') || `<div class="empty">${T('heatmap.sheet.noGames')}</div>`}
    </div>`;
  sheet.hidden = false;
}

function bindHeatmapUi(root, payload, metric, itemsById) {
  const pop = ensureHeatPopover();
  let hideTimer = null;

  function hidePop() {
    closeHeatPopover(pop);
  }

  function showPop(cell, g) {
    clearTimeout(hideTimer);
    pop.innerHTML = heatmapPopoverHtml(g, metric, payload);
    const rect = cell.getBoundingClientRect();
    const pad = 12;
    pop.style.left = '-9999px';
    pop.style.top = '0px';
    openHeatPopover(pop);
    const pw = pop.offsetWidth || 280;
    const ph = pop.offsetHeight || 160;
    let left = rect.right + 10;
    let top = rect.top;
    if (left + pw > window.innerWidth - pad) left = rect.left - pw - 10;
    if (left < pad) left = Math.max(pad, Math.min(rect.left, window.innerWidth - pw - pad));
    if (top + ph > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - ph - pad);
    if (top < pad) top = pad;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;

    pop.querySelectorAll('[data-open]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        hidePop();
        if (btn.dataset.open) window.FoundersApp.openGame(btn.dataset.open);
      };
    });
  }

  root.querySelectorAll('.heatmap-cell[data-heat-id]').forEach((cell) => {
    const id = cell.dataset.heatId;
    const g = itemsById.get(id);
    if (!g) return;

    cell.onmouseenter = () => showPop(cell, g);
    cell.onmouseleave = () => {
      hideTimer = setTimeout(hidePop, 120);
    };
    cell.onfocus = () => showPop(cell, g);
    cell.onblur = () => {
      hideTimer = setTimeout(hidePop, 120);
    };

    if (g.isOther) {
      cell.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        hidePop();
        openHeatOtherSheet(g, metric, payload);
      };
    } else {
      // Клик по обычной плитке открывает игру. BindGamesUi плитки не трогает,
      // поэтому обработчик назначается только здесь.
      cell.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        hidePop();
        if (g.id) window.FoundersApp.openGame(g.id);
      };
    }
  });

  pop.onmouseenter = () => clearTimeout(hideTimer);
  pop.onmouseleave = () => {
    hideTimer = setTimeout(hidePop, 80);
  };
}

/** Уже посчитанная раскладка для тех же данных: поиск и сортировка её не трогают. */

/* Раскладка по реальному соотношению сторон контейнера:
   иначе квадратная сетка растягивается в прямоугольник и плитки «плывут». */
function applyHeatmapLayout(mapEl, itemsById) {
  if (!mapEl || !itemsById || !itemsById.size) return;
  const rect = mapEl.getBoundingClientRect();
  const W = Math.max(1, rect.width);
  const H = Math.max(1, rect.height);
  if (W < 24 || H < 24) return;

  const laid = squarifyHeatmap([...itemsById.values()], W, H);
  const cells = new Map();
  mapEl.querySelectorAll('.heatmap-cell').forEach((cell) => {
    if (cell.dataset.heatId != null) cells.set(cell.dataset.heatId, cell);
  });

  laid.forEach((g) => {
    const cell = cells.get(String(g.id));
    if (!cell) return;
    cell.style.left = `${((g.x / W) * 100).toFixed(4)}%`;
    cell.style.top = `${((g.y / H) * 100).toFixed(4)}%`;
    cell.style.width = `${((g.w / W) * 100).toFixed(4)}%`;
    cell.style.height = `${((g.h / H) * 100).toFixed(4)}%`;
    const normArea = ((g.w * g.h) / (W * H)) * 10000;
    const sizeClass = heatmapSizeClass(normArea);
    if (!cell.classList.contains(sizeClass)) {
      cell.classList.remove('heat-lg', 'heat-md', 'heat-sm', 'heat-xs');
      cell.classList.add(sizeClass);
    }
    fitHeatmapTile(cell, g.w, g.h, sizeClass);
  });
}

/**
 * Подгонка содержимого плитки под её реальную форму:
 * иконка масштабируется от меньшей стороны, название переносится в колонку
 * на вытянутых плитках и скрывается там, где места уже нет.
 */
function fitHeatmapTile(cell, w, h, sizeClass) {
  const pad = sizeClass === 'heat-lg' ? 10 : sizeClass === 'heat-xs' ? 6 : 8;
  // 4px — это --heat-gap у самой ячейки
  const contentW = Math.max(0, w - 4 - pad * 2);
  const contentH = Math.max(0, h - 4 - pad * 2);

  const fontSize = sizeClass === 'heat-lg' ? 13 : sizeClass === 'heat-xs' ? 10.5 : 11.5;
  const lineHeight = fontSize * 1.3;
  const metaHeight = 26;

  const minSide = Math.min(w, h);
  const icon = Math.round(Math.max(18, Math.min(56, minSide * 0.34)));
  cell.style.setProperty('--heat-icon', `${icon}px`);

  const canColumn = contentH >= icon + 8 + lineHeight * 2 + metaHeight;
  const rowRoom = contentW - icon - 8;
  const column = h >= w * 1.05 && canColumn;

  // Некуда ставить название — скрываем, иконка остаётся крупной
  const tooNarrow = contentW < 76;
  const tooShort = contentH < 44;
  const hideTitle = tooNarrow || tooShort || (!column && rowRoom < 72);

  cell.classList.toggle('heat-tall', column && !hideTitle);
  cell.classList.toggle('heat-narrow', hideTitle);

  const titleWidth = column ? contentW : Math.max(0, rowRoom);
  const headSpace = Math.max(0, contentH - (column ? icon + 8 : 0) - metaHeight);
  const byHeight = Math.floor(headSpace / lineHeight);
  const byWidth = Math.floor((titleWidth * 2.1) / fontSize);
  const lines = Math.max(1, Math.min(3, Math.min(byHeight || 1, byWidth || 1)));
  cell.style.setProperty('--heat-clamp', String(hideTitle ? 1 : lines));

  // Названия нет — отдаём освободившееся место иконке
  if (hideTitle) {
    const bigger = Math.round(Math.max(20, Math.min(64, minSide * 0.42)));
    if (bigger > icon) cell.style.setProperty('--heat-icon', `${bigger}px`);
  }
}

let heatResizeObserver = null;

function observeHeatmapResize(mapEl, itemsById) {
  if (heatResizeObserver) {
    heatResizeObserver.disconnect();
    heatResizeObserver = null;
  }
  if (typeof ResizeObserver !== 'function') return;
  let lastKey = '';
  heatResizeObserver = new ResizeObserver(() => {
    if (!mapEl.isConnected) {
      heatResizeObserver.disconnect();
      return;
    }
    const rect = mapEl.getBoundingClientRect();
    const key = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (key === lastKey) return;
    lastKey = key;
    applyHeatmapLayout(mapEl, itemsById);
  });
  heatResizeObserver.observe(mapEl);
}

/** Рендер карты в конкретный контейнер: раскладка, размеры текста. */
function mountHeatmap(heatMount, payload, metric, precomputed, { animate = false } = {}) {
  if (!heatMount) return null;

  // Данные и метрика не менялись (например, переключили тогл или сортировку) —
  if (
    heatMountCache.mount === heatMount &&
    heatMountCache.payload === payload &&
    heatMountCache.metric === metric &&
    heatMount.querySelector('.heatmap')
  ) {
    return heatMountCache.heat;
  }

  const heat = precomputed || heatmapHtml(payload, metric);
  heatMount.innerHTML = heat.html;
  const map = heatMount.querySelector('.heatmap');
  if (map) {
    applyHeatmapLayout(map, heat.itemsById);
    observeHeatmapResize(map, heat.itemsById);
    bindHeatmapUi(heatMount, payload, metric, heat.itemsById);
    if (animate) {
      // Анимация «прорисовки» только при входе в раздел.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => map.classList.add('is-drawn'));
      });
    } else {
      // При смене периода/фильтров плитки показываем сразу: кадр с opacity: 0
      // выглядел как моргание карты.
      map.classList.add('is-drawn');
    }
  }
  heatMountCache.mount = heatMount;
  heatMountCache.payload = payload;
  heatMountCache.metric = metric;
  heatMountCache.heat = heat;
  return heat;
}

let lastHeatmapPayload = null;

// Что сейчас смонтировано в контейнере карты: если payload/метрика те же,
const heatMountCache = {
  mount: null,
  payload: null,
  metric: null,
  heat: null
};

// Кэш DOM-узла панели «Доход по месяцам»: график не зависит от периода,
// поэтому при смене периода переиспользуем его без перерисовки.
const earnPanelCache = { sig: null, node: null };
window.NamiData = Object.assign(window.NamiData || {}, { earnPanelCache });

/* —— Единый слой данных страницы «Игры» ——
   Всё, что нужно экрану, грузится одним запросом на пару
   (период + база сравнения) и кэшируется. Повторные рендеры
   (фильтр, поиск, сортировка) берут данные из кэша: без IPC
   и без пересборки DOM. */
// Предупреждаем об отказе get_data_coverage только один раз за сессию.
let coverageWarned = false;
