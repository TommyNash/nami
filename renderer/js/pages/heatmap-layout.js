function squarifyHeatmap(items, width = 100, height = 100) {
  const total = items.reduce((s, d) => s + d.layoutValue, 0);
  if (!total || width <= 0 || height <= 0) return [];
  const nodes = items.map((d) => ({
    ...d,
    area: (d.layoutValue / total) * width * height
  }));
  const out = [];

  function worst(row, side) {
    const s = row.reduce((a, b) => a + b.area, 0);
    if (s <= 0) return Infinity;
    let rmax = 0;
    let rmin = Infinity;
    for (const d of row) {
      if (d.area > rmax) rmax = d.area;
      if (d.area < rmin) rmin = d.area;
    }
    return Math.max((side * side * rmax) / (s * s), (s * s) / (side * side * rmin));
  }

  function layoutRow(row, x, y, w, h, alongHeight) {
    const s = row.reduce((a, b) => a + b.area, 0) || 1;
    let offset = 0;
    for (const item of row) {
      const frac = item.area / s;
      if (alongHeight) {
        const rh = h * frac;
        out.push({ ...item, x, y: y + offset, w, h: rh });
        offset += rh;
      } else {
        const rw = w * frac;
        out.push({ ...item, x: x + offset, y, w: rw, h });
        offset += rw;
      }
    }
  }

  function step(list, x, y, w, h) {
    if (!list.length || w <= 0 || h <= 0) return;
    if (list.length === 1) {
      out.push({ ...list[0], x, y, w, h });
      return;
    }
    const side = Math.min(w, h);
    const row = [];
    let i = 0;
    while (i < list.length) {
      const trial = row.concat(list[i]);
      if (row.length && worst(trial, side) > worst(row, side)) break;
      row.push(list[i]);
      i += 1;
    }
    const rest = list.slice(i);
    const rowArea = row.reduce((a, b) => a + b.area, 0);
    if (w >= h) {
      const rw = Math.min(w, rowArea / h);
      layoutRow(row, x, y, rw, h, true);
      step(rest, x + rw, y, w - rw, h);
    } else {
      const rh = Math.min(h, rowArea / w);
      layoutRow(row, x, y, w, rh, false);
      step(rest, x, y + rh, w, h - rh);
    }
  }

  step(nodes, 0, 0, width, height);
  return out;
}

function heatGameItem(g, key, deltaKey) {
  const prevKey = key === 'earn' ? 'prev_earn' : 'prev_players';
  return {
    id: g.id,
    title: g.title || g.id,
    icon_url: g.icon_url,
    value: Number(g[key]) || 0,
    prevValue: g[prevKey] != null && Number.isFinite(Number(g[prevKey])) ? Number(g[prevKey]) : null,
    delta: g[deltaKey],
    isOther: false,
    children: null
  };
}

function withLayoutValue(d) {
  return {
    ...d,
    layoutValue: Math.pow(Math.max(d.value, 1e-6), 0.55)
  };
}

function makeOtherBucket(children, metric) {
  const list = [...children].sort((a, b) => b.value - a.value);
  const value = list.reduce((s, g) => s + g.value, 0);
  const n = list.length;
  return withLayoutValue({
    id: '__other__',
    title: T('heatmap.otherGames', { n, count: n }),
    icon_url: null,
    value,
    delta: null,
    isOther: true,
    children: list,
    metric
  });
}

function prepareHeatmapItems(games, key, deltaKey) {
  const sorted = [...games]
    .filter((g) => Number(g[key]) > 0)
    .sort((a, b) => Number(b[key]) - Number(a[key]));
  if (!sorted.length) return [];

  // Show up to top-10 separately when they fit; remainder → «Ещё».
  const TOP = 10;
  if (sorted.length <= TOP) {
    return sorted.map((g) => withLayoutValue(heatGameItem(g, key, deltaKey)));
  }

  const head = sorted.slice(0, TOP).map((g) => heatGameItem(g, key, deltaKey));
  const tail = sorted.slice(TOP).map((g) => heatGameItem(g, key, deltaKey));
  return [...head.map(withLayoutValue), makeOtherBucket(tail, key)];
}

function mergeIntoOther(items, victim) {
  const next = items.filter((d) => d.id !== victim.id);
  let other = next.find((d) => d.isOther);
  const child = {
    id: victim.id,
    title: victim.title,
    icon_url: victim.icon_url,
    value: victim.value,
    prevValue: victim.prevValue,
    delta: victim.delta
  };
  if (!other) {
    next.push(makeOtherBucket([child], null));
    return next;
  }
  const children = [...(other.children || []), child];
  const idx = next.findIndex((d) => d.isOther);
  next[idx] = makeOtherBucket(children, null);
  return next;
}

function heatmapSizeClass(area) {
  if (area >= 1800) return 'heat-lg';
  if (area >= 900) return 'heat-md';
  if (area >= 520) return 'heat-sm';
  return 'heat-xs';
}
