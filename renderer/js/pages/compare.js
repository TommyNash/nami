async function renderComparePage(root, data) {
  const period = data.period || 'month';
  const aid = activeAccountIdFrom(data) || null;
  const model =
    window.FoundersPages && typeof window.FoundersPages.peekModel === 'function'
      ? window.FoundersPages.peekModel(period, data.heatCompare || 'prev_month')
      : null;
  const allGames =
    (model && model.games && model.games.length
      ? model.games
      : await window.foundersApi.listGames(period, aid)) || [];
  data.games = allGames;

  let selectedIds = (data.compareIds || []).map(String).filter(Boolean);
  // Если сохранённых id больше нет в каталоге — чистим.
  const known = new Set(allGames.map((g) => String(g.id)));
  selectedIds = selectedIds.filter((id) => known.has(id));
  selectedIds = setCompareIds(selectedIds);

  const selectedGames = selectedIds
    .map((id) => allGames.find((g) => String(g.id) === id))
    .filter(Boolean);
  const colors = selectedIds.map((_, i) => COMPARE_COLORS[i % COMPARE_COLORS.length]);

  root.innerHTML = `
    <div class="home compare-page" data-view="compare">
      <div class="home-hero">
        <h1 class="home-greet">${T('compare.title')}</h1>
        <p class="home-lead">${T('compare.lead')}</p>
      </div>

      <div class="compare-bar" id="compareBar">
        ${compareChipsHtml(selectedGames, colors)}
        <div class="compare-add-wrap">
          <button type="button" class="compare-add" id="compareAddBtn">${T('compare.addGame')}</button>
          ${comparePickerHtml(allGames, selectedIds)}
        </div>
      </div>

      <div class="panel compare-table-panel" id="compareTablePanel">
        <div class="panel-body" id="compareTableBody">
          <div class="compare-empty muted">${T('compare.loading')}</div>
        </div>
      </div>

      <div class="panel insight-card compare-insights-panel">
        <div class="panel-head"><h2>${T('compare.insights')}</h2></div>
        <div class="panel-body" id="compareInsightsMount">
          <div class="muted">${T('compare.pickGames')}</div>
        </div>
      </div>
    </div>`;

  const tableBody = root.querySelector('#compareTableBody');
  const insightsMount = root.querySelector('#compareInsightsMount');
  const picker = root.querySelector('#comparePicker');
  const addBtn = root.querySelector('#compareAddBtn');
  const search = root.querySelector('#comparePickSearch');
  let expandMap = loadCompareExpand();
  let chartMetricMap = loadCompareChartMetric();
  let lastOrdered = [];
  let lastColors = colors;

  const placePicker = () => {
    if (!picker || !addBtn || picker.hidden) return;
    const gap = 8;
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const btn = addBtn.getBoundingClientRect();
    const width = Math.min(440, vw - margin * 2);
    picker.style.width = `${width}px`;
    picker.style.maxHeight = `${Math.min(440, Math.floor(vh * 0.58))}px`;
    // Сначала показываем ниже кнопки, затем меряем и прижимаем к экрану.
    picker.style.left = `${Math.max(margin, Math.min(btn.left, vw - width - margin))}px`;
    picker.style.top = `${Math.max(margin, btn.bottom + gap)}px`;
    picker.style.right = 'auto';
    picker.style.bottom = 'auto';
    const rect = picker.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    if (btn.right - width >= margin && btn.left + width > vw - margin) {
      left = btn.right - width;
    }
    if (left + rect.width > vw - margin) left = vw - margin - rect.width;
    if (left < margin) left = margin;
    if (top + rect.height > vh - margin) {
      const above = btn.top - gap - rect.height;
      top = above >= margin ? above : Math.max(margin, vh - margin - rect.height);
    }
    if (top < margin) top = margin;
    picker.style.left = `${Math.round(left)}px`;
    picker.style.top = `${Math.round(top)}px`;
  };

  const closePicker = () => {
    if (!picker) return;
    picker.hidden = true;
  };
  const openPicker = () => {
    if (!picker) return;
    picker.hidden = false;
    placePicker();
    if (search) {
      search.value = '';
      filterPicker('');
      search.focus();
    }
    requestAnimationFrame(placePicker);
  };

  function filterPicker(q) {
    const query = String(q || '')
      .trim()
      .toLowerCase();
    root.querySelectorAll('.compare-pick-row').forEach((row) => {
      const title = (row.querySelector('.compare-pick-title')?.textContent || '').toLowerCase();
      const id = (row.querySelector('input')?.value || '').toLowerCase();
      row.hidden = !!(query && !title.includes(query) && !id.includes(query));
    });
  }

  function bindSectionCharts() {
    root.querySelectorAll('[data-compare-expand]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = String(btn.dataset.compareExpand || '');
        if (!id) return;
        expandMap = { ...expandMap, [id]: !expandMap[id] };
        saveCompareExpand(expandMap);
        const row = root.querySelector(`[data-compare-chart-row="${id}"]`);
        const open = !!expandMap[id];
        btn.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        const label = btn.querySelector('span');
        if (label) label.textContent = open ? T('compare.hideChart') : T('compare.showChart');
        if (row) {
          row.hidden = !open;
          row.classList.toggle('is-open', open);
        }
        if (open) {
          paintCompareOpenCharts(root, lastOrdered, lastColors, period, expandMap, chartMetricMap);
          requestAnimationFrame(() => {
            if (!window.FoundersMotion) return;
            const scope = row || root;
            window.FoundersMotion.scan(scope);
            scope.querySelectorAll('.seg').forEach((seg) => window.FoundersMotion.sync(seg));
          });
        }
      };
    });
    root.querySelectorAll('[data-compare-chart-metric]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const groupId = String(btn.dataset.compareChartMetric || '');
        const metric = String(btn.dataset.metric || '');
        if (!groupId || !metric) return;
        chartMetricMap = { ...chartMetricMap, [groupId]: metric };
        saveCompareChartMetric(chartMetricMap);
        const host = btn.closest('.compare-section-chart');
        const seg = btn.closest('.seg');
        if (host) {
          host.querySelectorAll('[data-compare-chart-metric]').forEach((b) => {
            b.classList.toggle('active', b === btn);
          });
        }
        if (seg && window.FoundersMotion && window.FoundersMotion.sync) {
          window.FoundersMotion.sync(seg);
        }
        const mount = root.querySelector(`[data-compare-chart-mount="${groupId}"]`);
        const toolsHost = root.querySelector(`[data-compare-chart-tools="${groupId}"]`);
        const group = compareMetricDefs(period).find((g) => g.id === groupId);
        const def = group && (group.charts || []).find((c) => c.id === metric);
        paintCompareSectionChart(mount, lastOrdered, lastColors, def, toolsHost);
      };
    });
  }

  async function refreshResult(ids) {
    const colorsNow = ids.map((_, i) => COMPARE_COLORS[i % COMPARE_COLORS.length]);
    if (ids.length < 2) {
      lastOrdered = [];
      lastColors = colorsNow;
      if (tableBody) {
        tableBody.innerHTML = `<div class="compare-empty muted">${T('compare.needTwo')}</div>`;
      }
      paintCompareInsights(insightsMount, [], colorsNow);
      return;
    }
    if (window.FoundersApp && window.FoundersApp.loading) {
      window.FoundersApp.loading(true);
    }
    try {
      const result = await window.foundersApi.analyticsCompare(ids, period);
      const games = result.games || [];
      // Сохраняем порядок выбора.
      const byId = new Map(games.map((g) => [String(g.id), g]));
      const ordered = ids.map((id) => byId.get(String(id))).filter(Boolean);
      const cols = ordered.map((_, i) => COMPARE_COLORS[i % COMPARE_COLORS.length]);
      lastOrdered = ordered;
      lastColors = cols;
      if (tableBody) {
        tableBody.innerHTML = compareTableHtml(ordered, period, cols, expandMap, chartMetricMap);
      }
      paintCompareOpenCharts(root, ordered, cols, period, expandMap, chartMetricMap);
      paintCompareInsights(insightsMount, ordered, cols);
      bindRemoveButtons();
      bindSectionCharts();
      if (window.FoundersMotion) window.FoundersMotion.scan(tableBody || root);
    } catch (err) {
      if (tableBody) {
        tableBody.innerHTML = `<div class="empty">${T('compare.failed', {
          error: F().esc(String(err && err.message ? err.message : err))
        })}</div>`;
      }
    } finally {
      if (window.FoundersApp && window.FoundersApp.loading) {
        window.FoundersApp.loading(false);
      }
    }
  }

  function syncBar(ids) {
    const games = ids
      .map((id) => allGames.find((g) => String(g.id) === String(id)))
      .filter(Boolean);
    const cols = ids.map((_, i) => COMPARE_COLORS[i % COMPARE_COLORS.length]);
    const bar = root.querySelector('#compareBar');
    if (!bar) return;
    const addWrap = bar.querySelector('.compare-add-wrap');
    bar.querySelectorAll('.compare-chip').forEach((el) => el.remove());
    if (addWrap) {
      addWrap.insertAdjacentHTML('beforebegin', compareChipsHtml(games, cols));
      const list = addWrap.querySelector('#comparePickList');
      if (list) {
        const tmp = document.createElement('div');
        tmp.innerHTML = comparePickerHtml(allGames, ids);
        const nextList = tmp.querySelector('#comparePickList');
        if (nextList) list.innerHTML = nextList.innerHTML;
      }
    }
    bindRemoveButtons();
    bindPickerChecks();
    if (picker && !picker.hidden) requestAnimationFrame(placePicker);
  }

  function bindRemoveButtons() {
    root.querySelectorAll('[data-compare-remove]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = String(btn.dataset.compareRemove || '');
        const next = setCompareIds(selectedIds.filter((x) => x !== id));
        selectedIds = next;
        closePicker();
        syncBar(selectedIds);
        refreshResult(selectedIds);
      };
    });
  }

  function bindPickerChecks() {
    root.querySelectorAll('.compare-pick-row input[type="checkbox"]').forEach((input) => {
      input.onchange = () => {
        const id = String(input.value);
        let next = selectedIds.slice();
        if (input.checked) {
          if (!next.includes(id)) next.push(id);
        } else {
          next = next.filter((x) => x !== id);
        }
        selectedIds = setCompareIds(next);
        syncBar(selectedIds);
        refreshResult(selectedIds);
      };
    });
  }

  if (addBtn) {
    addBtn.onclick = (e) => {
      e.stopPropagation();
      if (picker && !picker.hidden) closePicker();
      else openPicker();
    };
  }
  if (search) {
    search.oninput = () => filterPicker(search.value);
    search.onclick = (e) => e.stopPropagation();
  }
  if (picker) {
    picker.onclick = (e) => e.stopPropagation();
  }
  const onDoc = (e) => {
    if (!picker || picker.hidden) return;
    if (e.target.closest('#comparePicker') || e.target.closest('#compareAddBtn')) return;
    closePicker();
  };
  const onPlace = () => placePicker();
  document.addEventListener('click', onDoc, { once: false });
  window.addEventListener('resize', onPlace);
  document.addEventListener('scroll', onPlace, true);
  // Снимаем слушатель при уходе со страницы — следующий рендер перезапишет root.
  const obs = new MutationObserver(() => {
    if (!document.body.contains(root.querySelector('.compare-page'))) {
      document.removeEventListener('click', onDoc);
      window.removeEventListener('resize', onPlace);
      document.removeEventListener('scroll', onPlace, true);
      obs.disconnect();
    }
  });
  obs.observe(root, { childList: true, subtree: true });

  bindRemoveButtons();
  bindPickerChecks();
  await refreshResult(selectedIds);
}
