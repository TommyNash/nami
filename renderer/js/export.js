/** Выгрузка отчётов для Excel / Numbers / AI / pandas.
 *  CSV и JSON — одна tidy-таблица:
 *  date, game_id, game_title, metric, value, unit [, dataset]
 *  Метаданные — в комментариях # key=value (CSV) или поле meta (JSON). */
(function () {
  const encoder = new TextEncoder();

  function xml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sheetName(name, used) {
    let base = String(name || 'data')
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31);
    if (!base) base = 'data';
    let next = base;
    let n = 2;
    while (used.has(next)) {
      const suffix = ` ${n}`;
      next = `${base.slice(0, 31 - suffix.length)}${suffix}`;
      n += 1;
    }
    used.add(next);
    return next;
  }

  function colName(index) {
    let n = index + 1;
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function cellXml(ref, value) {
    if (value == null || value === '') return `<c r="${ref}"/>`;
    if (isNumber(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }

  function sheetXml(sheet) {
    const columns = sheet.columns || [];
    const rows = sheet.rows || [];
    const lines = ['<row r="1">'];
    columns.forEach((col, i) => {
      lines.push(cellXml(`${colName(i)}1`, col.title || col.key));
    });
    lines.push('</row>');
    rows.forEach((row, ri) => {
      const r = ri + 2;
      lines.push(`<row r="${r}">`);
      columns.forEach((col, i) => {
        lines.push(cellXml(`${colName(i)}${r}`, row[col.key]));
      });
      lines.push('</row>');
    });
    const lastCol = colName(Math.max(0, columns.length - 1));
    const lastRow = Math.max(1, rows.length + 1);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCol}${lastRow}"/>
  <sheetData>${lines.join('')}</sheetData>
</worksheet>`;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(view, offset, value) {
    view.setUint16(offset, value, true);
  }
  function u32(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  function zipStore(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach((file) => {
      const name = encoder.encode(file.name);
      const data = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data));
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      u32(lv, 0, 0x04034b50);
      u16(lv, 4, 20);
      u32(lv, 14, crc);
      u32(lv, 18, data.length);
      u32(lv, 22, data.length);
      u16(lv, 26, name.length);
      local.set(name, 30);
      locals.push(local, data);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      u32(cv, 0, 0x02014b50);
      u16(cv, 4, 20);
      u16(cv, 6, 20);
      u32(cv, 16, crc);
      u32(cv, 20, data.length);
      u32(cv, 24, data.length);
      u16(cv, 28, name.length);
      u32(cv, 42, offset);
      central.set(name, 46);
      centrals.push(central);
      offset += local.length + data.length;
    });
    const centralSize = centrals.reduce((s, part) => s + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    u32(ev, 0, 0x06054b50);
    u16(ev, 8, files.length);
    u16(ev, 10, files.length);
    u32(ev, 12, centralSize);
    u32(ev, 16, offset);
    return new Blob([...locals, ...centrals, end], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function workbookBlob(sheets) {
    const used = new Set();
    const named = sheets.map((sheet, i) => ({
      ...sheet,
      name: sheetName(sheet.name || `data_${i + 1}`, used)
    }));
    const files = [
      {
        name: '[Content_Types].xml',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${named
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('')}
</Types>`
      },
      {
        name: '_rels/.rels',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
      },
      {
        name: 'xl/workbook.xml',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${named
      .map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}
  </sheets>
</workbook>`
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${named
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join('')}
</Relationships>`
      }
    ];
    named.forEach((sheet, i) => {
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheet) });
    });
    return zipStore(files);
  }

  const TRANSLIT = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', // i18n-ignore
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', // i18n-ignore
    х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' // i18n-ignore
  };

  function slug(value) {
    return String(value || '')
      .normalize('NFKD')
      .toLowerCase()
      .split('')
      .map((ch) => {
        if (TRANSLIT[ch] != null) return TRANSLIT[ch];
        if (/[a-z0-9]/.test(ch)) return ch;
        return '_';
      })
      .join('')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
  }

  function csvEscape(value) {
    const text = value == null ? '' : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  const HUMAN_HEADERS = {
    date: T('export.headers.date'),
    game_id: T('export.headers.gameId'),
    game_title: T('export.headers.gameTitle'),
    metric: T('export.headers.metric'),
    value: T('export.headers.value'),
    unit: T('export.headers.unit'),
    dataset: T('export.headers.dataset'),
    available_from: T('export.headers.availableFrom'),
    available_to: T('export.headers.availableTo')
  };

  const ANALYSIS_SCHEMA = {
    format: 'tidy_long',
    description:
      'One observation per row. Missing metrics are omitted (never coerced to 0). Pivot on metric for wide tables. Filter by dataset or game_id. Use available_from/available_to for each metric coverage.',
    columns: [
      { name: 'date', type: 'string', description: 'ISO date YYYY-MM-DD or period label' },
      { name: 'game_id', type: 'string', description: 'Yandex Games application id' },
      { name: 'game_title', type: 'string', description: 'Game display title' },
      { name: 'metric', type: 'string', description: 'Snake_case metric key' },
      {
        name: 'value',
        type: 'number|string',
        description: 'Metric value; null/missing rows are not exported. 0 means a real zero.'
      },
      {
        name: 'unit',
        type: 'string',
        description: 'RUB | YAN | count | pct | s | min | score | text | unknown'
      },
      { name: 'dataset', type: 'string', description: 'series | portfolio | platforms | purchases_catalog | …' },
      {
        name: 'available_from',
        type: 'string',
        description: 'First day this metric series exists for the game'
      },
      {
        name: 'available_to',
        type: 'string',
        description: 'Last day this metric series exists for the game'
      }
    ],
    units: {
      RUB: 'Russian ruble',
      YAN: 'Yandex in-game currency / price code',
      count: 'Absolute count',
      pct: 'Percent',
      s: 'Seconds (game_ready, TTI)',
      min: 'Minutes (play_time*)',
      score: 'Score 0-100',
      text: 'Categorical string',
      unknown: 'Unit could not be inferred'
    },
    notes: {
      missing_is_null: 'Absence of a metric must not be treated as zero',
      iap_sku_counts:
        'Per-SKU purchase counts are not available from Yandex console; export iap_price_* + inapp_purchases series totals',
      time_units: 'play_time* = minutes; game_ready* / time_to_interactive* = seconds'
    }
  };

  function plainCsv(report) {
    const columns = report.columns || [];
    const lines = [
      columns.map((col) => csvEscape(HUMAN_HEADERS[col.key] || col.title || col.key)).join(',')
    ];
    (report.rows || []).forEach((row) => {
      lines.push(columns.map((col) => csvEscape(row[col.key])).join(','));
    });
    return `\uFEFF${lines.join('\n')}`;
  }

  function analysisJson(report) {
    const coverage = {};
    (report.rows || []).forEach((row) => {
      if (!row || !row.metric) return;
      const key = `${row.game_id || ''}::${row.metric}`;
      const from = row.available_from || row.date || '';
      const to = row.available_to || row.date || '';
      if (!coverage[key]) {
        coverage[key] = {
          game_id: row.game_id || '',
          metric: row.metric,
          unit: row.unit || 'unknown',
          available_from: from,
          available_to: to
        };
        return;
      }
      if (from && (!coverage[key].available_from || from < coverage[key].available_from)) {
        coverage[key].available_from = from;
      }
      if (to && (!coverage[key].available_to || to > coverage[key].available_to)) {
        coverage[key].available_to = to;
      }
      if (row.unit && coverage[key].unit === 'unknown') coverage[key].unit = row.unit;
    });
    return {
      meta: {
        ...report.meta,
        format: 'tidy_long',
        audience: 'ai_pandas_bi',
        ...(report.notes || {})
      },
      schema: ANALYSIS_SCHEMA,
      metric_coverage: Object.values(coverage),
      columns: (report.columns || []).map((col) => col.key),
      rows: report.rows || []
    };
  }

  function buildMeta(spec) {
    return {
      report: spec.title || 'report',
      game_id: spec.gameId || '',
      game_title: spec.scope && spec.scope !== T('export.portfolio') ? spec.scope : '',
      period: spec.periodKey || spec.periodLabel || spec.period || '',
      metric: spec.metric || '',
      exported_at: new Date().toISOString()
    };
  }

  function normalize(spec) {
    const source = typeof spec === 'function' ? spec() : spec || {};
    const rows = Array.isArray(source.rows) ? source.rows : [];
    const columns =
      source.columns && source.columns.length
        ? source.columns
        : [
            { key: 'date' },
            { key: 'game_id' },
            { key: 'game_title' },
            { key: 'metric' },
            { key: 'value' },
            { key: 'unit' },
            { key: 'dataset' },
            { key: 'available_from' },
            { key: 'available_to' }
          ];
    return {
      title: source.title || 'report',
      gameId: source.gameId || '',
      scope: source.scope || '',
      periodKey: source.periodKey || source.period || '',
      periodLabel: source.periodLabel || '',
      metric: source.metric || source.title || '',
      columns,
      rows: (rows || []).filter(Boolean),
      notes: source.notes || null,
      meta: buildMeta(source),
      sheets: source.sheets || null
    };
  }

  function fileBase(spec) {
    const id = spec.gameId ? String(spec.gameId) : 'portfolio';
    const part = slug(spec.metric || spec.title || 'export') || 'export';
    const day = new Date().toISOString().slice(0, 10);
    return `fa_${id}_${part}_${day}`;
  }

  function blobToBase64(blob) {
    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const step = 0x8000;
      for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
      }
      return btoa(binary);
    });
  }

  async function saveBlob(blob, filename) {
    const tauri = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
    if (tauri && window.foundersApi && window.foundersApi.saveReport) {
      const data = await blobToBase64(blob);
      await window.foundersApi.saveReport(filename, data);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function download(spec, format) {
    const report = normalize(spec);
    const base = fileBase(report);
    if (format === 'analysis') {
      const payload = analysisJson(report);
      await saveBlob(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        `${base}_analysis.json`
      );
      return;
    }
    if (format === 'json') {
      const payload = {
        meta: report.meta,
        columns: (report.columns || []).map((col) => col.key),
        rows: report.rows || []
      };
      await saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${base}.json`);
      return;
    }
    if (format === 'xlsx') {
      const humanCols = (report.columns || []).map((col) => ({
        key: col.key,
        title: HUMAN_HEADERS[col.key] || col.title || col.key
      }));
      const sheets = report.sheets && report.sheets.length
        ? report.sheets
        : [
            {
              name: T('export.sheetData'),
              columns: humanCols,
              rows: report.rows
            },
            {
              name: 'meta',
              columns: [{ key: 'key' }, { key: 'value' }],
              rows: Object.entries(report.meta).map(([key, value]) => ({ key, value }))
            }
          ];
      await saveBlob(workbookBlob(sheets), `${base}.xlsx`);
      return;
    }
    // Обычный CSV — для Excel / Numbers, русские заголовки // i18n-ignore
    await saveBlob(new Blob([plainCsv(report)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
  }

  let pop = null;
  let popSpec = null;
  let popAnchor = null;

  function closePop() {
    if (!pop) return;
    pop.hidden = true;
    popSpec = null;
    popAnchor = null;
  }

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'export-pop';
    pop.hidden = true;
    pop.setAttribute('role', 'menu');
    pop.innerHTML = `
      <div class="export-pop-note">${T('export.menuNote')}</div>
      <button type="button" data-fmt="csv">${T('export.format.csv')}</button>
      <button type="button" data-fmt="xlsx">${T('export.format.xlsx')}</button>
      <button type="button" data-fmt="json">${T('export.format.json')}</button>
      <div class="export-pop-sep" role="separator"></div>
      <button type="button" data-fmt="analysis">${T('export.format.analysis')}</button>
    `;
    document.body.appendChild(pop);
    pop.addEventListener('click', (event) => {
      const fmt = event.target.closest('[data-fmt]');
      if (!fmt || !popSpec) return;
      event.preventDefault();
      event.stopPropagation();
      const spec = popSpec;
      closePop();
      download(spec, fmt.dataset.fmt).catch((err) => {
        console.warn('[export] не удалось сохранить отчёт', err); // i18n-ignore
      });
    });
    document.addEventListener('pointerdown', (event) => {
      if (!pop || pop.hidden) return;
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const inside = path.some(
        (node) =>
          node === pop ||
          node === popAnchor ||
          (node instanceof Element && node.classList && node.classList.contains('export-btn'))
      );
      if (!inside) closePop();
    });
    window.addEventListener('resize', closePop);
    return pop;
  }

  function openPop(anchor, spec) {
    if (pop && !pop.hidden && popAnchor === anchor) {
      closePop();
      return;
    }
    const menu = ensurePop();
    popSpec = spec;
    popAnchor = anchor;
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = 248;
    let left = rect.right - width;
    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    let top = rect.bottom + 6;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    const height = menu.offsetHeight || 140;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
      menu.style.top = `${Math.round(top)}px`;
    }
  }

  function place(host, spec) {
    if (!host) return null;
    const card =
      host.matches && host.matches('.panel, .compare-section-chart')
        ? host
        : host.closest
          ? host.closest('.panel, .compare-section-chart')
          : null;
    const chartHead =
      card && card.matches('.compare-section-chart')
        ? card.querySelector(':scope > .compare-section-chart-head')
        : null;
    const target = chartHead || card || host;
    if (card) {
      card
        .querySelectorAll(
          ':scope > .panel-head > .export-host, :scope > .compare-section-chart-head > .export-host'
        )
        .forEach((node) => node.remove());
    }
    let slot = target.querySelector(':scope > .export-host');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = card && !chartHead ? 'export-host is-corner' : 'export-host';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'export-btn';
      btn.setAttribute('aria-label', T('export.download'));
      btn.title = T('export.download');
      btn.innerHTML = '<i class="ph ph-download-simple" aria-hidden="true"></i>';
      slot.appendChild(btn);
      target.appendChild(slot);
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = slot._spec;
        if (!current) return;
        if (pop && !pop.hidden && popSpec === current) {
          closePop();
          return;
        }
        openPop(btn, current);
      });
    }
    slot._spec = spec;
    return slot;
  }

  window.FoundersExport = { download, place, open: openPop, close: closePop, slug };
})();
