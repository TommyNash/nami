function gamesFullHtml(view) {
  const compares = [
    ['prev_period', T('games.heat.compare.prev_period')],
    ['prev_month', T('games.heat.compare.prev_month')],
    ['d7', T('games.heat.compare.d7')],
    ['d14', T('games.heat.compare.d14')],
    ['d30', T('games.heat.compare.d30')]
  ]
    .map(
      ([id, label]) =>
        `<button type="button" class="seg-btn ${
          view.heatCompare === id ? 'active' : ''
        }" data-heat-compare="${id}">${label}</button>`
    )
    .join('');

  return `
    <div class="home" data-view="games">
        <div class="home-hero">
        <h1 class="home-greet" data-account-sig="${F().esc(view.accountSig || '')}">${F().esc(
    view.greet
  )}.${view.accountChipHtml || ''}</h1>
        <p class="home-lead">${view.leadHtml}</p>
        </div>

        <div class="kpi-row">
        <div class="kpi-card kpi-card-earn" data-kpi="earn">
          <div class="kpi-label">${F().esc(view.earnLabel)}</div>
          <div class="kpi-value" data-countup="${view.periodEarnSum}" data-count-fmt="money" data-count-key="home.earnCard" data-count-delay="0">${moneyFmt(
    view.periodEarnSum
  )}</div>
          ${view.earnStrip || `<div class="kpi-sub">${view.earnSub}</div>`}
          </div>
        <div class="kpi-card" data-kpi="avg">
            <div class="kpi-label">${T('games.kpi.avgPerDay')}</div>
          <div class="kpi-value" data-countup="${view.avgPerDay}" data-count-fmt="money" data-count-key="home.avgDayCard" data-count-delay="70">${moneyFmt(
    view.avgPerDay
  )}</div>
          <div class="kpi-sub">${view.avgSub}</div>
          </div>
        <div class="kpi-card" data-kpi="players">
            <div class="kpi-label">${T('games.kpi.playersPerDay')}</div>
          <div class="kpi-value" data-countup="${view.playersValue}" data-count-fmt="num" data-count-digits="0" data-count-key="home.playersCard" data-count-delay="140">${F().num(
    view.playersValue,
    0
            )}</div>
          ${view.playersStrip || `<div class="kpi-sub">${view.playersSub}</div>`}
          </div>
        <div class="kpi-card" data-kpi="arpu">
            <div class="kpi-label">${T('games.kpi.earnPerPlayer')}</div>
          <div class="kpi-value" data-countup="${view.arpu}" data-count-fmt="money" data-count-key="home.arpuCard" data-count-delay="210">${moneyFmt(
    view.arpu
  )}</div>
            <div class="kpi-sub">${T('games.kpi.ownCalc')}</div>
          </div>
        </div>

        <div class="home-grid home-grid-2">
          <div class="panel stretch">
            <div class="panel-head table-head-row">
              <div class="panel-title-row">
                <h2 id="heatTitle">${
                  view.heatMetric === 'earn' ? T('games.heat.byEarn') : T('games.heat.byPlayers')
                }</h2>
              </div>
              <div class="heatmap-filters">
              <div class="seg seg--compact" role="group" aria-label="${T('games.heat.metricAria')}" data-thumb-key="heat-metric">
                <button type="button" class="seg-btn ${
                  view.heatMetric === 'players' ? 'active' : ''
                }" data-heat-metric="players">${T('games.common.players')}</button>
                <button type="button" class="seg-btn ${
                  view.heatMetric === 'earn' ? 'active' : ''
                }" data-heat-metric="earn">${T('games.common.earn')}</button>
                </div>
              <div class="seg seg--compact" role="group" aria-label="${T('games.heat.compareAria')}" data-thumb-key="heat-compare">${compares}</div>
              </div>
            </div>
            <div class="panel-body" id="heatmapMount"></div>
          </div>
          <div class="panel panel-chart panel-earn-days">
            <div class="panel-head earn-days-head">
              <div>
                <h2>${T('games.earn.byMonth')}</h2>
              <div class="earn-days-sub muted">${view.maxMonthMeta}</div>
              </div>
              <button type="button" class="earn-manual-btn" data-open-tax title="${T('games.earn.taxTitle')}" aria-label="${T('games.earn.taxTitle')}">${
                window.FoundersIcons && window.FoundersIcons.svg
                  ? window.FoundersIcons.svg('arrow-right', 18)
                  : '→'
              }</button>
            </div>
            <div class="panel-body earn-days-body"><div id="homeEarnBars"></div></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head table-head-row">
            <h2>${T('games.table.heading')}</h2>
            <div class="table-filters">
            <button
              type="button"
              class="toggle ${view.publishedOnly ? 'is-on' : ''}"
              id="hideInactive"
              role="switch"
              aria-checked="${view.publishedOnly ? 'true' : 'false'}"
              title="${T('games.table.publishedOnlyTitle')}"
            >
              <span class="toggle-track"><i class="toggle-knob"></i></span>
              <span class="toggle-text">${T('games.table.hideInactive')}</span>
            </button>
              <input id="gamesSearch" class="search compact" placeholder="${T('games.table.searchPlaceholder')}" value="${F().esc(
              view.gamesQuery || ''
              )}" />
            </div>
          </div>
        <div class="panel-body" style="padding:0" id="gamesTableWrap"></div>
      </div>
    </div>`;
}

/** Обновление карточки KPI без пересоздания DOM: элемент остаётся на месте,
 *  поэтому squircle не пересчитывает clip-path и значения не «моргают». */
/** Точечное обновление уже показанной страницы «Игры». */
function patchGamesView(home, view) {
  const greetEl = home.querySelector('.home-greet');
  if (greetEl) {
    const next = `${F().esc(view.greet)}.${view.accountChipHtml || ''}`;
    if (greetEl.dataset.accountSig !== view.accountSig) {
      greetEl.innerHTML = next;
      greetEl.dataset.accountSig = view.accountSig || '';
    }
  }

  const leadEl = home.querySelector('.home-lead');
  if (leadEl) leadEl.innerHTML = view.leadHtml;

  const card = (name) => home.querySelector(`.kpi-card[data-kpi="${name}"]`);
  patchKpiCard(card('earn'), {
    label: view.earnLabel,
    value: view.periodEarnSum,
    fmt: 'money',
    sub: view.earnSub
  });
  patchKpiCard(card('avg'), {
    label: T('games.kpi.avgPerDay'),
    value: view.avgPerDay,
    fmt: 'money',
    sub: view.avgSub
  });
  patchKpiCard(card('players'), {
    label: T('games.kpi.playersPerDay'),
    value: view.playersValue,
    fmt: 'num',
    digits: 0,
    sub: view.playersSub
  });
  patchKpiCard(card('arpu'), {
    label: T('games.kpi.earnPerPlayer'),
    value: view.arpu,
    fmt: 'money',
    sub: T('games.kpi.ownCalc')
  });

  const sub = home.querySelector('.earn-days-sub');
  if (sub) sub.textContent = view.maxMonthMeta;

  // Свечи по дням в карточках дохода и игроков: пересобираем только при смене
  const paintStrip = (cardName, html, subHtml) => {
    const card = home.querySelector(`.kpi-card[data-kpi="${cardName}"]`);
    if (!card) return;
    const current = card.querySelector('.kpi-days');
    if (!html) {
      if (!current) {
        const sub = card.querySelector('.kpi-sub');
        if (sub && subHtml != null) sub.innerHTML = subHtml;
        return;
      }
      const sub = document.createElement('div');
      sub.className = 'kpi-sub';
      sub.innerHTML = subHtml || '';
      current.replaceWith(sub);
      return;
    }
    // Подпись без замены DOM оставляла старое число свечей при смене периода:
    // цифры KPI обновлялись, а полоса — нет.
    if (current && current.dataset.sig === html) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    const node = tmp.firstElementChild;
    if (!node) return;
    node.dataset.sig = html;
    if (current) current.replaceWith(node);
    else {
      const prev = card.querySelector('.kpi-sub');
      if (prev) prev.replaceWith(node);
      else card.appendChild(node);
    }
  };
  paintStrip('earn', view.earnStrip, view.earnSub);
  paintStrip('players', view.playersStrip, view.playersSub);

  syncGamesTable(home, view);

  const toggle = home.querySelector('#hideInactive');
  if (toggle) {
    toggle.classList.toggle('is-on', view.publishedOnly);
    toggle.setAttribute('aria-checked', view.publishedOnly ? 'true' : 'false');
  }

  home.querySelectorAll('[data-heat-metric]').forEach((b) => {
    b.classList.toggle('active', b.dataset.heatMetric === view.heatMetric);
  });
  home.querySelectorAll('[data-heat-compare]').forEach((b) => {
    b.classList.toggle('active', b.dataset.heatCompare === view.heatCompare);
  });
  const heatTitle = home.querySelector('#heatTitle');
  if (heatTitle) {
    heatTitle.textContent =
      view.heatMetric === 'earn' ? T('games.heat.byEarn') : T('games.heat.byPlayers');
  }
}

/* —— Таблица игр без пересоздания строк ——
   Причина моргания иконок: раньше таблица перерисовывалась через innerHTML,
   и каждый <img> загружался заново. Теперь строки живут в DOM, меняются только
   порядок, видимость и числовые ячейки. */
