/**
 * Continuous (Figma/macOS-like) corners via SVG superellipse paths.
 * Path math vendored from figma-squircle (MIT) — works in Tauri WKWebView
 * without Electron's -electron-corner-smoothing.
 */
(() => {
  const DEFAULT_SMOOTHING = 0.6;

  const TOKENS = {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    '2xl': 32
  };

  const AUTO_SELECTOR = [
    '.card',
    '.kpi-card',
    '.sum-card',
    '.tax-kpi',
    '.panel',
    '.btn',
    '.tab',
    '.heatmap',
    '.heatmap-inner',
    '.heat-popover',
    '.heat-sheet-panel',
    '.heat-sheet-row',
    '.settings-card',
    '.settings-code',
    '.period-pop',
    '.nav-thumb',
    '.fk-vtoggle__thumb',
    '.onb-tile:not(.is-logo)',
    '.onb-row',
    '.onb-tip',
    '.onb-tip i',
    '[data-squircle]'
  ].join(',');

  const THUMB_SELECTOR = '.nav-thumb, .fk-vtoggle__thumb';

  const SKIP_SELECTOR = [
    '.dock',
    '.dock-btn',
    '.seg',
    '.seg-btn',
    '.seg-month',
    '.btn',
    '.capsule-btn',
    '.ws-export-btn',
    '.export-btn',
    '.tax-settings-btn',
    '.chrome-tax-save',
    '.pill',
    '.live-badge',
    '.layer-btn',
    '.settings-btn-danger',
    '.settings-toggle',
    '.chart-legend-item',
    '.data-status .status-pill',
    '.account-chip',
    '[data-squircle="off"]'
  ].join(',');

  /* —— figma-squircle path math (MIT, phamfoo/figma-squircle) —— */

  function distributeAndNormalize({
    topLeftCornerRadius,
    topRightCornerRadius,
    bottomRightCornerRadius,
    bottomLeftCornerRadius,
    width,
    height
  }) {
    const roundingAndSmoothingBudgetMap = {
      topLeft: -1,
      topRight: -1,
      bottomLeft: -1,
      bottomRight: -1
    };
    const cornerRadiusMap = {
      topLeft: topLeftCornerRadius,
      topRight: topRightCornerRadius,
      bottomLeft: bottomLeftCornerRadius,
      bottomRight: bottomRightCornerRadius
    };
    const adjacentsByCorner = {
      topLeft: [
        { corner: 'topRight', side: 'top' },
        { corner: 'bottomLeft', side: 'left' }
      ],
      topRight: [
        { corner: 'topLeft', side: 'top' },
        { corner: 'bottomRight', side: 'right' }
      ],
      bottomLeft: [
        { corner: 'bottomRight', side: 'bottom' },
        { corner: 'topLeft', side: 'left' }
      ],
      bottomRight: [
        { corner: 'bottomLeft', side: 'bottom' },
        { corner: 'topRight', side: 'right' }
      ]
    };
    Object.entries(cornerRadiusMap)
      .sort(([, a], [, b]) => b - a)
      .forEach(([cornerName, radius]) => {
        const adjacents = adjacentsByCorner[cornerName];
        const budget = Math.min(
          ...adjacents.map((adjacent) => {
            const adjacentCornerRadius = cornerRadiusMap[adjacent.corner];
            if (radius === 0 && adjacentCornerRadius === 0) return 0;
            const adjacentCornerBudget = roundingAndSmoothingBudgetMap[adjacent.corner];
            const sideLength =
              adjacent.side === 'top' || adjacent.side === 'bottom' ? width : height;
            if (adjacentCornerBudget >= 0) {
              return sideLength - roundingAndSmoothingBudgetMap[adjacent.corner];
            }
            return (radius / (radius + adjacentCornerRadius)) * sideLength;
          })
        );
        roundingAndSmoothingBudgetMap[cornerName] = budget;
        cornerRadiusMap[cornerName] = Math.min(radius, budget);
      });
    return {
      topLeft: {
        radius: cornerRadiusMap.topLeft,
        roundingAndSmoothingBudget: roundingAndSmoothingBudgetMap.topLeft
      },
      topRight: {
        radius: cornerRadiusMap.topRight,
        roundingAndSmoothingBudget: roundingAndSmoothingBudgetMap.topRight
      },
      bottomLeft: {
        radius: cornerRadiusMap.bottomLeft,
        roundingAndSmoothingBudget: roundingAndSmoothingBudgetMap.bottomLeft
      },
      bottomRight: {
        radius: cornerRadiusMap.bottomRight,
        roundingAndSmoothingBudget: roundingAndSmoothingBudgetMap.bottomRight
      }
    };
  }

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function rounded(strings, ...values) {
    return strings.reduce((acc, str, i) => {
      const value = values[i];
      if (typeof value === 'number') return acc + str + value.toFixed(4);
      return acc + str + (value ?? '');
    }, '');
  }

  function getPathParamsForCorner({
    cornerRadius,
    cornerSmoothing,
    preserveSmoothing,
    roundingAndSmoothingBudget
  }) {
    let p = (1 + cornerSmoothing) * cornerRadius;
    if (!preserveSmoothing) {
      const maxCornerSmoothing = roundingAndSmoothingBudget / cornerRadius - 1;
      cornerSmoothing = Math.min(cornerSmoothing, maxCornerSmoothing);
      p = Math.min(p, roundingAndSmoothingBudget);
    }
    const arcMeasure = 90 * (1 - cornerSmoothing);
    const arcSectionLength = Math.sin(toRadians(arcMeasure / 2)) * cornerRadius * Math.sqrt(2);
    const angleAlpha = (90 - arcMeasure) / 2;
    const p3ToP4Distance = cornerRadius * Math.tan(toRadians(angleAlpha / 2));
    const angleBeta = 45 * cornerSmoothing;
    const c = p3ToP4Distance * Math.cos(toRadians(angleBeta));
    const d = c * Math.tan(toRadians(angleBeta));
    let b = (p - arcSectionLength - c - d) / 3;
    let a = 2 * b;
    if (preserveSmoothing && p > roundingAndSmoothingBudget) {
      const p1ToP3MaxDistance = roundingAndSmoothingBudget - d - arcSectionLength - c;
      const minA = p1ToP3MaxDistance / 6;
      const maxB = p1ToP3MaxDistance - minA;
      b = Math.min(b, maxB);
      a = p1ToP3MaxDistance - b;
      p = Math.min(p, roundingAndSmoothingBudget);
    }
    return { a, b, c, d, p, arcSectionLength, cornerRadius };
  }

  function drawTopRightPath({ cornerRadius, a, b, c, d, p, arcSectionLength }) {
    if (cornerRadius) {
      return rounded`
    c ${a} 0 ${a + b} 0 ${a + b + c} ${d}
    a ${cornerRadius} ${cornerRadius} 0 0 1 ${arcSectionLength} ${arcSectionLength}
    c ${d} ${c}
        ${d} ${b + c}
        ${d} ${a + b + c}`;
    }
    return rounded`l ${p} 0`;
  }

  function drawBottomRightPath({ cornerRadius, a, b, c, d, p, arcSectionLength }) {
    if (cornerRadius) {
      return rounded`
    c 0 ${a}
      0 ${a + b}
      ${-d} ${a + b + c}
    a ${cornerRadius} ${cornerRadius} 0 0 1 -${arcSectionLength} ${arcSectionLength}
    c ${-c} ${d}
      ${-(b + c)} ${d}
      ${-(a + b + c)} ${d}`;
    }
    return rounded`l 0 ${p}`;
  }

  function drawBottomLeftPath({ cornerRadius, a, b, c, d, p, arcSectionLength }) {
    if (cornerRadius) {
      return rounded`
    c ${-a} 0
      ${-(a + b)} 0
      ${-(a + b + c)} ${-d}
    a ${cornerRadius} ${cornerRadius} 0 0 1 -${arcSectionLength} -${arcSectionLength}
    c ${-d} ${-c}
      ${-d} ${-(b + c)}
      ${-d} ${-(a + b + c)}`;
    }
    return rounded`l ${-p} 0`;
  }

  function drawTopLeftPath({ cornerRadius, a, b, c, d, p, arcSectionLength }) {
    if (cornerRadius) {
      return rounded`
    c 0 ${-a}
      0 ${-(a + b)}
      ${d} ${-(a + b + c)}
    a ${cornerRadius} ${cornerRadius} 0 0 1 ${arcSectionLength} -${arcSectionLength}
    c ${c} ${-d}
      ${b + c} ${-d}
      ${a + b + c} ${-d}`;
    }
    return rounded`l 0 ${-p}`;
  }

  function getSVGPathFromPathParams({
    width,
    height,
    topLeftPathParams,
    topRightPathParams,
    bottomLeftPathParams,
    bottomRightPathParams
  }) {
    return `
    M ${width - topRightPathParams.p} 0
    ${drawTopRightPath(topRightPathParams)}
    L ${width} ${height - bottomRightPathParams.p}
    ${drawBottomRightPath(bottomRightPathParams)}
    L ${bottomLeftPathParams.p} ${height}
    ${drawBottomLeftPath(bottomLeftPathParams)}
    L 0 ${topLeftPathParams.p}
    ${drawTopLeftPath(topLeftPathParams)}
    Z
  `
      .replace(/[\t\s\n]+/g, ' ')
      .trim();
  }

  function getSvgPath({
    cornerRadius = 0,
    topLeftCornerRadius,
    topRightCornerRadius,
    bottomRightCornerRadius,
    bottomLeftCornerRadius,
    cornerSmoothing,
    width,
    height,
    preserveSmoothing = false
  }) {
    topLeftCornerRadius = topLeftCornerRadius ?? cornerRadius;
    topRightCornerRadius = topRightCornerRadius ?? cornerRadius;
    bottomLeftCornerRadius = bottomLeftCornerRadius ?? cornerRadius;
    bottomRightCornerRadius = bottomRightCornerRadius ?? cornerRadius;

    if (
      topLeftCornerRadius === topRightCornerRadius &&
      topRightCornerRadius === bottomRightCornerRadius &&
      bottomRightCornerRadius === bottomLeftCornerRadius
    ) {
      const roundingAndSmoothingBudget = Math.min(width, height) / 2;
      const cornerRadius2 = Math.min(topLeftCornerRadius, roundingAndSmoothingBudget);
      const pathParams = getPathParamsForCorner({
        cornerRadius: cornerRadius2,
        cornerSmoothing,
        preserveSmoothing,
        roundingAndSmoothingBudget
      });
      return getSVGPathFromPathParams({
        width,
        height,
        topLeftPathParams: pathParams,
        topRightPathParams: pathParams,
        bottomLeftPathParams: pathParams,
        bottomRightPathParams: pathParams
      });
    }

    const corners = distributeAndNormalize({
      topLeftCornerRadius,
      topRightCornerRadius,
      bottomRightCornerRadius,
      bottomLeftCornerRadius,
      width,
      height
    });
    return getSVGPathFromPathParams({
      width,
      height,
      topLeftPathParams: getPathParamsForCorner({
        cornerSmoothing,
        preserveSmoothing,
        cornerRadius: corners.topLeft.radius,
        roundingAndSmoothingBudget: corners.topLeft.roundingAndSmoothingBudget
      }),
      topRightPathParams: getPathParamsForCorner({
        cornerSmoothing,
        preserveSmoothing,
        cornerRadius: corners.topRight.radius,
        roundingAndSmoothingBudget: corners.topRight.roundingAndSmoothingBudget
      }),
      bottomRightPathParams: getPathParamsForCorner({
        cornerSmoothing,
        preserveSmoothing,
        cornerRadius: corners.bottomRight.radius,
        roundingAndSmoothingBudget: corners.bottomRight.roundingAndSmoothingBudget
      }),
      bottomLeftPathParams: getPathParamsForCorner({
        cornerSmoothing,
        preserveSmoothing,
        cornerRadius: corners.bottomLeft.radius,
        roundingAndSmoothingBudget: corners.bottomLeft.roundingAndSmoothingBudget
      })
    });
  }

  /* —— runtime —— */

  const tracked = new WeakMap();
  let resizeObserver = null;
  let mutateTimer = 0;

  function parsePx(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const n = parseFloat(String(value).trim());
    return Number.isFinite(n) ? n : null;
  }

  function readTokenRadius(el) {
    const token = el.getAttribute('data-radius-token');
    if (token && TOKENS[token] != null) return TOKENS[token];
    const attr = parsePx(el.getAttribute('data-radius'));
    if (attr != null) return attr;
    const css = getComputedStyle(el);
    const br = parsePx(css.borderTopLeftRadius);
    if (br != null && br > 0 && br < 900) return br;
    return TOKENS.lg;
  }

  function readSmoothing(el) {
    const attr = el.getAttribute('data-smoothing');
    if (attr != null && attr !== '') {
      const n = Number(attr);
      if (Number.isFinite(n)) return Math.min(1, Math.max(0, n > 1 ? n / 100 : n));
    }
    return DEFAULT_SMOOTHING;
  }

  function paintSquircle(el, width, height, radius, smoothing, storeRadius, preserveSmoothing) {
    const key = `${width}x${height}:${radius}:${smoothing}:${preserveSmoothing ? 1 : 0}`;
    if (el.dataset.sq === key) return;
    if (storeRadius) {
      el.dataset.sqR = String(radius);
      el.dataset.sqS = String(smoothing);
    }
    el.dataset.sq = key;
    const path = getSvgPath({
      width,
      height,
      cornerRadius: radius,
      cornerSmoothing: smoothing,
      preserveSmoothing: !!preserveSmoothing
    });
    el.style.clipPath = `path('${path}')`;
    el.classList.add('is-squircle');
  }

  function measureElement(el) {
    if (!(el instanceof HTMLElement) || el.matches(SKIP_SELECTOR)) return null;
    const thumb = el.matches(THUMB_SELECTOR);
    // У бегунка scale в transform. getBoundingClientRect его учитывает и
    // кривит clip-path, поэтому берём layout-размер.
    const width = Math.round(thumb ? el.offsetWidth : el.getBoundingClientRect().width);
    const height = Math.round(thumb ? el.offsetHeight : el.getBoundingClientRect().height);
    if (width < 2 || height < 2) return null;
    // Радиус читаем один раз: getComputedStyle на каждом ресайзе
    // заставлял WebKit пересчитывать стиль всей карточки.
    let radius = Number(el.dataset.sqR);
    let smoothing = Number(el.dataset.sqS);
    let storeRadius = false;
    let preserveSmoothing = false;
    if (thumb) {
      radius = Math.min(width, height) / 2;
      smoothing = DEFAULT_SMOOTHING;
      preserveSmoothing = true;
    } else if (!Number.isFinite(radius) || !Number.isFinite(smoothing)) {
      radius = readTokenRadius(el);
      smoothing = readSmoothing(el);
      storeRadius = true;
    }
    return { el, width, height, radius, smoothing, storeRadius, preserveSmoothing };
  }

  function updateElement(el) {
    const job = measureElement(el);
    if (!job) return;
    paintSquircle(
      job.el,
      job.width,
      job.height,
      job.radius,
      job.smoothing,
      job.storeRadius,
      job.preserveSmoothing
    );
  }

  function track(el) {
    if (!(el instanceof HTMLElement) || tracked.has(el)) return;
    if (el.matches(SKIP_SELECTOR)) return;
    tracked.set(el, true);
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) updateElement(entry.target);
      });
    }
    resizeObserver.observe(el);
  }

  function observe(el) {
    track(el);
    updateElement(el);
  }

  function scan(root = document) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const els = [...scope.querySelectorAll(AUTO_SELECTOR)];
    // Сначала все чтения геометрии, потом запись clip-path — иначе каждый
    // path() сбрасывает layout и смена экрана заметно подвисает.
    const jobs = [];
    for (const el of els) {
      track(el);
      const job = measureElement(el);
      if (job) jobs.push(job);
    }
    for (const job of jobs) {
      paintSquircle(
      job.el,
      job.width,
      job.height,
      job.radius,
      job.smoothing,
      job.storeRadius,
      job.preserveSmoothing
    );
    }
  }

  function apply(element, radius = TOKENS.lg, smoothing = DEFAULT_SMOOTHING) {
    if (!(element instanceof HTMLElement)) return () => {};
    if (radius != null) element.setAttribute('data-radius', String(radius));
    if (smoothing != null) element.setAttribute('data-smoothing', String(smoothing));
    observe(element);
    return () => {
      if (resizeObserver) resizeObserver.unobserve(element);
      tracked.delete(element);
      element.style.clipPath = '';
      element.classList.remove('is-squircle');
    };
  }

  const pendingRoots = new Set();

  function collectAdded(node) {
    if (!(node instanceof Element)) return;
    if (node.matches && node.matches(AUTO_SELECTOR) && !node.matches(SKIP_SELECTOR)) {
      pendingRoots.add(node);
    }
    if (node.querySelectorAll) {
      node.querySelectorAll(AUTO_SELECTOR).forEach((el) => {
        if (!el.matches(SKIP_SELECTOR)) pendingRoots.add(el);
      });
    }
  }

  function scheduleScan() {
    // Один проход на кадр и только по новым узлам: полный scan(document)
    // на каждую мутацию пересчитывал clip-path всей страницы и давал лаг
    // при смене экрана.
    if (mutateTimer) return;
    mutateTimer = requestAnimationFrame(() => {
      mutateTimer = 0;
      const batch = [...pendingRoots].filter((el) => el.isConnected);
      pendingRoots.clear();
      const jobs = [];
      for (const el of batch) {
        track(el);
        const job = measureElement(el);
        if (job) jobs.push(job);
      }
      for (const job of jobs) {
        paintSquircle(
      job.el,
      job.width,
      job.height,
      job.radius,
      job.smoothing,
      job.storeRadius,
      job.preserveSmoothing
    );
      }
    });
  }

  function start() {
    scan(document);
    const mut = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach(collectAdded);
      }
      if (pendingRoots.size) scheduleScan();
    });
    mut.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.FoundersSquircle = {
    getSvgPath,
    apply,
    scan,
    tokens: TOKENS,
    smoothing: DEFAULT_SMOOTHING
  };
})();
