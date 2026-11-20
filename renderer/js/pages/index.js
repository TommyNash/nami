window.FoundersPages = {
  model(period, heatCompare, opts) {
    return loadGamesModel(period, heatCompare, opts);
  },
  peekModel(period, heatCompare) {
    const aid = activeAccountIdFrom(null);
    return gamesModelCache.get(`${period}|${heatCompare}|${aid || ''}`) || null;
  },
  invalidateModels() {
    invalidateGamesModels();
  },

  skeleton(pageKey) {
    try {
      return pageSkeletonHtml(pageKey);
    } catch (_) {
      return '';
    }
  },

  placePeriodPop,
  closePeriodPop,

  async periodControls(mount, period) {
    const existing = mount.querySelector('.seg[data-thumb-key="period"], .seg[data-thumb-key="period-compact"]');
    if (existing && typeof syncPeriodSeg === 'function' && syncPeriodSeg(existing, period)) {
      return;
    }
    const months = await earnMonthsCached(activeAccountIdFrom(null) || null);
    mount.innerHTML = periodSeg(period, months);
    bindPeriod(mount);
    if (window.FoundersMotion) window.FoundersMotion.scan(mount);
  },
  async games(root, data) {
    const period = data.period || 'month';
    const heatCompare = data.heatCompare || 'prev_month';
    const accounts = await loadAccounts();
    const activeAccount = resolveActiveAccount(accounts);
    const accountId = activeAccount ? String(activeAccount.id) : '';
    data.accounts = accounts;
    data.activeAccount = activeAccount;
    data.activeAccountId = accountId || null;
    if (window.FoundersApp && window.FoundersApp.state) {
      window.FoundersApp.state.activeAccountId = accountId || null;
      window.FoundersApp.state.accounts = accounts;
    }
    const model = await loadGamesModel(period, heatCompare, {
      force: !!data.forceReload,
      accountId: accountId || null
    });
    prefetchPeriodScreens(accountId || null, heatCompare);
    data.games = model.games;
    const heatMetric = data.heatMetric === 'earn' ? 'earn' : 'players';
    const games = model.games;
    const months = model.months;
    const overview = model.overview;
    const heatmap = model.heatmap;
    const q = (data.gamesQuery || '').trim().toLowerCase();
    const sortKey = data.gamesSortKey || 'players';
    const sortDir = data.gamesSortDir || 'desc';

    const publishedOnly = !!data.gamesPublishedOnly;
    const publishedTotal = games.filter((g) => g.status === 'published').length;
    const hiddenInactive = publishedOnly ? games.length - publishedTotal : 0;

    // (см. syncGamesTable) — поэтому иконки не перезагружаются при фильтрации.
    const isVisible = (g) => {
      if (publishedOnly && g.status !== 'published') return false;
      if (!q) return true;
      return (
        String(g.id).includes(q) ||
        String(g.title || '')
          .toLowerCase()
          .includes(q) ||
        String(statusLabel(g.status))
          .toLowerCase()
          .includes(q)
      );
    };

    const playersMode = data.gamesPlayersMode === 'sum' ? 'sum' : 'avg';
    const shareMetric = data.gamesShareMetric === 'earn' ? 'earn' : 'players';
    const dynamicsMetric = data.gamesDynamicsMetric === 'earn' ? 'earn' : 'players';
    const shareBase = publishedOnly ? games.filter((g) => g.status === 'published') : games;
    const totalPlayers = shareBase.reduce((s, g) => {
      const n = periodPlayersOf(g, playersMode);
      return s + (n == null ? 0 : n);
    }, 0);
    const totalEarn = shareBase.reduce((s, g) => s + (Number(g.period_earn) || 0), 0);
    const heatById = new Map();
    ((heatmap && heatmap.games) || []).forEach((h) => {
      if (h && h.id != null) heatById.set(String(h.id), h);
    });
    const dynamicsCompareLabel = (heatmap && heatmap.compareLabel) || T('pages.games.compareDefault');
    const shareView = {
      playersMode,
      shareMetric,
      totalPlayers,
      totalEarn,
      dynamicsMetric,
      dynamicsCompareLabel,
      heatById,
      heatmap
    };

    const sorter = {
      title: (g) => String(g.title || '').toLowerCase(),
      status: (g) => String(g.status || ''),
      players: (g) => {
        const n = periodPlayersOf(g, playersMode);
        return n == null ? -1 : n;
      },
      share: (g) => {
        const n = gameShareOf(g, shareView);
        return n == null ? -1 : n;
      },
      dynamics: (g) => {
        const d = gameDynamicsOf(g, shareView);
        return d.pct == null || !Number.isFinite(d.pct) ? -99999 : d.pct;
      },
      rating: (g) => Number(g.latest_rating_ru) || -1,
      earn: (g) => Number(g.period_earn != null ? g.period_earn : g.latest_earn) || -1
    };
    const get = sorter[sortKey] || sorter.players;
    const ordered = [...games].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    const filtered = ordered.filter(isVisible);

    const periodEarnSum = games.reduce((s, g) => s + (Number(g.period_earn) || 0), 0);
    const playersSum = games.reduce((s, g) => s + (Number(g.latest_players) || 0), 0);
    const gamesWithEarn = games.filter((g) => Number(g.period_earn) > 0).length;
    const daysInBounds = (() => {
      const b = overview && overview.bounds;
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
        today.getDate()
      ).padStart(2, '0')}`;
      if (!b || !b.fromDay) {
        // Fallback: с 1-го числа текущего месяца по сегодня
        return Math.max(1, today.getDate());
      }
      let toDay = b.toDay || todayKey;
      // Незаконченный месяц: не делить на «весь месяц», только на прошедшие дни
      if (String(b.fromDay).slice(0, 7) === todayKey.slice(0, 7) && toDay > todayKey) {
        toDay = todayKey;
      }
      const a = Date.parse(`${b.fromDay}T00:00:00`);
      const c = Date.parse(`${toDay}T00:00:00`);
      if (!Number.isFinite(a) || !Number.isFinite(c)) return Math.max(1, today.getDate());
      return Math.max(1, Math.round((c - a) / 86400000) + 1);
    })();
    const avgPerDay = daysInBounds > 0 ? periodEarnSum / daysInBounds : 0;
    // «Игроки в день» — среднее по свечам (полный срез ряда). Снимок панели
    // за октябрь пустой, поэтому без ряда карточка показывала 0.
    const playersAvg = overview && Number(overview.playersAvg) > 0 ? Number(overview.playersAvg) : 0;
    let playersValue = playersAvg > 0 ? playersAvg : playersSum;
    let arpu = playersValue > 0 ? periodEarnSum / playersValue : 0;
    const greet = window.FoundersApp.greeting();

    const earnByKey = new Map(
      (months || []).map((m) => [String(m.key || ''), Number(m.earn) || 0])
    );
    const monthKeys = (months || []).slice(0, 12).map((m) => String(m.key || ''));
    const axisPeerFirst = monthKeys[monthKeys.length - 1] || '';
    const axisPeerLast = monthKeys[0] || '';
    const monthBars = (months || [])
      .slice(0, 12)
      .reverse()
      .map((m, i, arr) => {
        const key = String(m.key || '');
        const [y, mo] = key.split('-');
        const prevKey =
          y && mo && Number.isFinite(Number(y)) ? `${Number(y) - 1}-${mo}` : '';
        const compare = prevKey ? earnByKey.get(prevKey) : null;
        const peerKey = i === 0 ? axisPeerLast : i === arr.length - 1 ? axisPeerFirst : key;
        return {
          label: formatMonthAxis(key, { peerKey }),
          title: formatMonthLabel(key),
          value: Number(m.earn) || 0,
          hint: key,
          monthKey: key,
          compare: compare != null && Number.isFinite(compare) ? compare : null,
          compareHint: prevKey ? formatMonthAxis(prevKey) : null
        };
      });
    const maxMonthMeta = (() => {
      if (!monthBars.length) return '';
      let best = monthBars[0];
      for (const b of monthBars) if (b.value > best.value) best = b;
      return best.value > 0
        ? T('pages.games.maxMonth', { value: moneyFmt(best.value), month: formatMonthAxis(best.monthKey) })
        : '';
    })();

    const heat = heatmapView(heatmap, heatMetric);

    // Цифры уже в KPI-карточках — в приветствии только мягкая подпись периода.
    const leadHtml = T('pages.games.lead', { period: F().esc(F().periodNoun(period)) });

    const earnEstimated = !!(overview && overview.earnings && overview.earnings.estimated);
    const earnSub = T(earnEstimated ? 'pages.games.earnSubEstimated' : 'pages.games.earnSub', {
      n: gamesWithEarn,
      count: gamesWithEarn,
      total: games.length
    });
    const avgSub = T('pages.games.avgSub', { n: daysInBounds, count: daysInBounds });
    const playersSub = T('pages.games.playersSub', {
      value: F().esc(
        (overview && overview.bounds && overview.bounds.toDay
          ? F().date(overview.bounds.toDay)
          : F().periodNoun(period)) || '—'
      )
    });

    // Таблица обновляется инкрементально (syncGamesTable): строки и иконки
    // создаются один раз, дальше только меняется порядок и видимость.
    const visibleIds = new Set(filtered.map((g) => String(g.id)));

    const playersNote =
      playersMode === 'sum'
        ? T('pages.games.playersNoteSum')
        : T('pages.games.playersNoteAvg');
    const shareNote =
      shareMetric === 'earn' ? T('pages.games.shareNoteEarn') : T('pages.games.shareNotePlayers');
    const dynNote = T(dynamicsMetric === 'earn' ? 'pages.games.dynNoteEarn' : 'pages.games.dynNotePlayers', {
      compare: dynamicsCompareLabel
    });
    const hiddenNoteParts = [
      playersNote,
      shareNote,
      dynNote,
      publishedOnly && hiddenInactive > 0
        ? T('pages.games.hiddenInactive', { n: hiddenInactive, count: hiddenInactive })
        : ''
    ].filter(Boolean);
    const hiddenNote = hiddenNoteParts.join(' · ');

    // Свечи по дням вместо текста под цифрами: видно, за какие дни данные есть.
    const strips = buildDayStrips({
      coverage: model.coverage,
      overview,
      period
    });
    if (strips.playersMean && strips.playersMean.value > 0) {
      playersValue = strips.playersMean.value;
      arpu = playersValue > 0 ? periodEarnSum / playersValue : 0;
    }

    const view = {
      period,
      heatCompare,
      heatMetric,
      publishedOnly,
      hiddenInactive,
      gamesQuery: data.gamesQuery || '',
      games,
      ordered,
      visibleIds,
      hiddenNote,
      sortKey,
      sortDir,
      playersMode,
      shareMetric,
      dynamicsMetric,
      dynamicsCompareLabel,
      heatById,
      heatCompare,
      totalPlayers,
      totalEarn,
      overview,
      coverage: model.coverage,
      earnStrip: strips.earnStrip,
      playersStrip: strips.playersStrip,
      heatmap,
      heat,
      leadHtml,
      earnLabel: T('pages.games.earnLabel', { period: F().periodNoun(period) }),
      earnSub,
      avgSub,
      playersSub: strips.playersSub || playersSub,
      periodEarnSum,
      avgPerDay,
      playersSum,
      playersValue,
      arpu,
      greet,
      accountChipHtml: accountChipHtml(activeAccount, accounts),
      accountSig: `${accountId || ''}|${(accounts || []).map((a) => a.id).join(',')}`,
      monthBars,
      maxMonthMeta,
      earnSig: monthBars.map((b) => `${b.label}:${b.value}`).join('|')
    };

    const existing = root.querySelector('.home[data-view="games"]');
    if (existing) {
      patchGamesView(existing, view);
    } else {
      root.innerHTML = gamesFullHtml(view);
      // Разметка пустая (таблица строится инкрементально) — наполняем строки.
      syncGamesTable(root.querySelector('.home[data-view="games"]') || root, view);
    }

    const home = root.querySelector('.home[data-view="games"]') || root;
    home.querySelectorAll('.export-host').forEach((node) => node.remove());

    const heatMount = home.querySelector('#heatmapMount');
    if (heatMount && !(data.freezeHeatmap && heatMount.querySelector('.heatmap'))) {
      mountHeatmap(heatMount, heatmap, heatMetric, heat, {
        animate: !!data.animateHeatmap
      });
      lastHeatmapPayload = heatmap;
    }

    paintEarnChart(home, view);
    bindGamesUi(root, data);
    animateCounters(root, { enabled: data.animateNumbers !== false });
  },

  async overview(root, data) {    const period = data.period || 'month';
    // Если модель для этого периода уже загружена — не дублируем запросы.
    const cached = this.peekModel(period, data.heatCompare || 'prev_month');
    const aid = activeAccountIdFrom(data) || null;
    let a;
    let months;
    if (cached) {
      a = cached.overview;
      months = cached.months;
    } else {
      [a, months] = await Promise.all([
      window.foundersApi.analyticsOverview(period, aid),
      earnMonthsCached(aid)
    ]);
    }
    prefetchPeriodScreens(aid, data.heatCompare || 'prev_month');
    root.innerHTML = `
      <div class="toolbar-row">
        <div>
          <div class="section-kicker">${T('pages.overview.kicker')}</div>
          <h2 class="inline-title">${T('pages.overview.title')}</h2>
        </div>
        ${periodSeg(period, months, { compact: true })}
      </div>
      ${scopeNote('live', a.bounds)}
      <div class="grid-cards">
        <div class="card"><div class="label">${T('pages.common.games')}</div><div class="metric" data-countup="${
          a.games || 0
        }" data-count-fmt="num" data-count-digits="0" data-count-key="ov.games" data-count-delay="0">${a.games || 0}</div></div>
        <div class="card"><div class="label">${T('pages.common.players')}</div><div class="metric" data-countup="${
          Number(a.players) || 0
        }" data-count-fmt="num" data-count-digits="0" data-count-key="ov.players" data-count-delay="70">${F().num(
          a.players,
          0
        )}</div>
          <div class="card-sub">${T('pages.overview.allGames')}</div></div>
        <div class="card"><div class="label">${T('pages.overview.playTimePerPlayer')}</div><div class="metric" data-countup="${
          Number(a.avgPlayTime) || 0
        }" data-count-fmt="num" data-count-digits="2" data-count-key="ov.avgPlay" data-count-delay="140">${F().num(
          a.avgPlayTime
        )}</div></div>
        <div class="card kpi-card-earn"><div class="label">${T('pages.games.earnLabel', { period: F().esc(F().periodNoun(period)) })}</div><div class="metric" data-countup="${
          Number(a.earnings && a.earnings.earn) || 0
        }" data-count-fmt="money" data-count-key="ov.earn" data-count-delay="210">${moneyFmt(
          a.earnings && a.earnings.earn
        )}</div>
          <div class="card-sub">${F().date(a.bounds.fromDay)} – ${F().date(a.bounds.toDay)}</div></div>
      </div>
      <div class="split">
        <div class="panel">
          <div class="panel-head"><h2>${T('pages.overview.topPlayers')}</h2></div>
          <div class="panel-body" style="padding:0">
            <table>
              <thead><tr><th>${T('pages.common.game')}</th><th>${T('pages.common.players')}</th><th>${T('pages.overview.ratingRuCis')}</th></tr></thead>
              <tbody>
                ${(a.topByPlayers || [])
                  .map(
                    (g) => `<tr class="click-row" data-game="${F().esc(g.id)}">
                      <td>${F().esc(g.title || g.id)}</td>
                      <td>${F().num(g.players, 0)}</td>
                      <td>${F().num(g.rating_ru, 0)}</td>
                    </tr>`
                  )
                  .join('') || `<tr><td colspan="3" class="empty">${T('pages.common.noData')}</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>${T('pages.overview.gameReadySec')}</h2><span class="muted">${T('pages.overview.portfolioAverage')}</span></div>
          <div class="panel-body">
            <div class="metric big">${F().num(a.avgReady)}</div>
            <p class="muted">${T('pages.overview.consoleHint')}</p>
          </div>
        </div>
      </div>
    `;
    bindPeriod(root);
    root.querySelectorAll('[data-game]').forEach((row) => {
      row.onclick = () => window.FoundersApp.openGame(row.dataset.game);
    });
    animateCounters(root, { enabled: data.animateNumbers !== false });
  },

  async workspace(root, data) {
    const id = data.selectedGameId;
    const tab = data.workspaceTab || 'overview';
    const period = data.period || 'month';
    const [details, months] = await Promise.all([
      window.foundersApi.analyticsGame(id, period),
      earnMonthsCached()
    ]);
    for (const nextPeriod of ['day', 'week', 'month', 'year', 'all']) {
      if (nextPeriod !== period && typeof scheduleIdleTask === 'function') {
        const gameId = id;
        scheduleIdleTask(() => window.foundersApi.analyticsGame(gameId, nextPeriod));
      }
    }
    if (!details) {
      root.innerHTML = `
        <div class="empty">
          ${T('pages.workspace.noGameData')}
          <div style="margin-top:12px"><button class="btn" id="backGames">${T('pages.workspace.backToGames')}</button></div>
        </div>`;
      document.getElementById('backGames').onclick = () => {
        window.FoundersApp.state.page = 'games';
        localStorage.setItem('fa.page', 'games');
        window.FoundersApp.refresh();
      };
      return;
    }

    void tab;
    void months;
    const nav = [
      ['summary', T('pages.workspace.nav.summary'), 'squares-four'],
      ['players', T('pages.common.players'), 'users'],
      ['playtime', T('pages.workspace.nav.playtime'), 'clock'],
      ['ready', T('pages.workspace.nav.ready'), 'timer'],
      ['rating', T('pages.workspace.nav.rating'), 'star'],
      ['revenue', T('pages.workspace.nav.revenue'), 'currency-rub'],
      ['audience', T('pages.workspace.nav.audience'), 'globe-hemisphere-west'],
      ['conversion', T('pages.workspace.nav.conversion'), 'percent'],
      ['purchases', T('pages.workspace.nav.purchases'), 'shopping-bag']
    ];
    const icon = (name) =>
      window.FoundersIcons ? window.FoundersIcons.svg(name, 16) : '';
    const layerBtn = (k, label, ic, active) =>
      `<button type="button" class="layer-btn ${active ? 'active' : ''}" data-section="${k}">
        <span class="layer-ico">${icon(ic)}</span>
        <span class="layer-label">${F().esc(label)}</span>
      </button>`;
    let section = window.FoundersApp.state.workspaceLayer || 'summary';
    if (section === 'metrics') section = 'conversion';
    if (section === 'earnings') section = 'revenue';
    if (section === 'players' && !localStorage.getItem('fa.workspaceNavV2')) {
      section = 'summary';
      window.FoundersApp.setWorkspaceLayer('summary');
    }
    if (section !== window.FoundersApp.state.workspaceLayer) {
      window.FoundersApp.setWorkspaceLayer(section);
    }
    localStorage.setItem('fa.workspaceNavV2', '1');

    root.innerHTML = `
      <div class="game-report">
        <aside class="layers" aria-label="${T('pages.workspace.layersLabel')}">
          <div class="layers-title">${T('pages.workspace.layersTitle')}</div>
          ${nav
            .map(([k, label, ic]) => layerBtn(k, label, ic, section === k))
            .join('')}
        </aside>
        <div id="workspaceBody" class="ws-slot"></div>
      </div>
    `;

    const show = async (next) => {
      if (next === 'earnings') next = 'revenue';
      if (next === 'metrics') next = 'conversion';
      const report = root.querySelector('.game-report');
      const anchorTop = report ? report.getBoundingClientRect().top : null;
      window.FoundersApp.setWorkspaceLayer(next);
      root.querySelectorAll('[data-section]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.section === next);
      });
      const body = document.getElementById('workspaceBody');
      if (!body) return;
      const prevH = Math.max(body.getBoundingClientRect().height, 320);
      body.style.minHeight = `${Math.round(prevH)}px`;
      if (next === 'purchases') await renderWorkspacePurchases(body, id);
      else await renderWorkspaceOverview(body, details, period);
      animateCounters(root, { enabled: data.animateNumbers !== false });
      if (window.FoundersSquircle && typeof window.FoundersSquircle.refresh === 'function') {
        window.FoundersSquircle.refresh(body);
      }
      requestAnimationFrame(() => {
        if (report && anchorTop != null) {
          const dy = report.getBoundingClientRect().top - anchorTop;
          if (Math.abs(dy) > 0.5) window.scrollBy(0, dy);
        }
        body.style.minHeight = '';
      });
    };
    window.FoundersApp.showWorkspaceSection = (next) => {
      show(next);
    };
    root.querySelectorAll('[data-section]').forEach((btn) => {
      btn.onclick = () => show(btn.dataset.section);
    });
    await show(section);
  },

  async compare(root, data) {
    await renderComparePage(root, data);
  },

  tax: renderTaxPage,
  settings: renderSettingsPage,
  collector: renderCollectorPage
};
