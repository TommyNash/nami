const gamesTableState = { rows: new Map(), orderSig: '' };

/** Динамика: % к окну сравнения + sparkline текущего и прошлого окон. */

function ensureDynPopover() {
  let el = document.getElementById('dynPopover');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dynPopover';
    el.className = 'chart-tooltip heat-popover dyn-popover';
    el.setAttribute('hidden', '');
    document.body.appendChild(el);
  }
  return el;
}

function bindDynamicsTips() {
  const pop = ensureDynPopover();
  let hideTimer = null;
  let active = null;

  const hide = () => {
    closeHeatPopover(pop);
    active = null;
  };

  const show = (cell) => {
    let data = null;
    try {
      data = JSON.parse(cell.getAttribute('data-dyn') || 'null');
    } catch (_) {
      data = null;
    }
    if (!data) return hide();
    const row = cell.closest('tr');
    const titleEl = row && row.querySelector('.game-title');
    const title = (titleEl && titleEl.textContent) || T('games.common.dynamics');
    clearTimeout(hideTimer);
    active = cell;
    pop.innerHTML = dynamicsPopoverHtml(title, data);
    const rect = cell.getBoundingClientRect();
    const pad = 12;
    pop.style.left = '-9999px';
    pop.style.top = '0px';
    openHeatPopover(pop);
    const pw = pop.offsetWidth || 280;
    const ph = pop.offsetHeight || 120;
    let left = rect.right + 10;
    let top = rect.top + rect.height / 2 - ph / 2;
    if (left + pw > window.innerWidth - pad) left = rect.left - pw - 10;
    if (left < pad) left = Math.max(pad, window.innerWidth - pw - pad);
    if (top + ph > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - ph - pad);
    if (top < pad) top = pad;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  };

  document.addEventListener('mouseover', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if (target.closest('#dynPopover')) {
      clearTimeout(hideTimer);
      return;
    }
    const cell = target.closest('.dyn-cell');
    if (cell && cell.hasAttribute('data-dyn')) {
      if (cell !== active) show(cell);
      else clearTimeout(hideTimer);
      return;
    }
    if (active) hideTimer = setTimeout(hide, 120);
  });

  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pop.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(hide, 80);
  });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

function closeAllThMenus(root) {
  const scope = root || document;
  scope.querySelectorAll('.th-menu.is-open').forEach((menu) => {
    menu.classList.remove('is-open');
    menu.hidden = true;
  });
  scope.querySelectorAll('.th-menu-trigger[aria-expanded="true"]').forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
  });
}

function positionThMenu(trigger, menu) {
  const r = trigger.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  menu.style.left = '0px';
  menu.style.minWidth = `${Math.max(168, Math.round(r.width))}px`;
  menu.hidden = false;
  menu.classList.add('is-open');
  const mw = menu.offsetWidth || 200;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
  menu.style.left = `${Math.round(left)}px`;
  trigger.setAttribute('aria-expanded', 'true');
}

function syncGamesTable(home, view) {
  const wrap = home.querySelector('#gamesTableWrap');
  if (!wrap) return;

  let table = wrap.querySelector('table.games-table');
  // Старая шапка с native <select> — пересоздаём один раз.
  if (table && !table.querySelector('#dynamicsMenu')) {
    wrap.innerHTML = '';
    table = null;
    gamesTableState.rows.clear();
    gamesTableState.orderSig = '';
  }
  if (!table) {
    const cmp = view.heatCompare || 'prev_month';
    const check = thMenuCheck();
    const caret = thMenuCaret();
    wrap.innerHTML = `<div class="games-table-scroll">
      <table class="games-table dense">
      <thead><tr>
        <th class="cell-sticky" data-sort="title">${T('games.table.colGame')}</th>
        <th data-sort="status">${T('games.table.colStatus')}</th>
        <th class="th-metric" data-sort="players">
          <div class="th-metric-top">${T('games.common.players')}${view.sortKey === 'players' ? (view.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</div>
          <button type="button" class="th-menu-trigger" id="playersModeSelect" aria-haspopup="listbox" aria-expanded="false" title="${T('games.table.playersModeTitle')}">
            <span class="th-menu-label">${F().esc(playersModeLabel(view.playersMode))}</span>
            <span class="th-menu-caret" aria-hidden="true">${caret}</span>
          </button>
          <div class="th-menu" id="playersModeMenu" hidden role="listbox">
            ${thMenuItemHtml('avg', T('games.table.menuAvg'), view.playersMode === 'avg')}
            ${thMenuItemHtml('sum', T('games.table.menuSum'), view.playersMode === 'sum')}
          </div>
        </th>
        <th class="th-metric" data-sort="share">
          <div class="th-metric-top">${T('games.table.colShare')}${view.sortKey === 'share' ? (view.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</div>
          <button type="button" class="th-menu-trigger" id="shareMetricSelect" aria-haspopup="listbox" aria-expanded="false" title="${T('games.table.shareMetricTitle')}">
            <span class="th-menu-label">${F().esc(shareMetricLabel(view.shareMetric))}</span>
            <span class="th-menu-caret" aria-hidden="true">${caret}</span>
          </button>
          <div class="th-menu" id="shareMetricMenu" hidden role="listbox">
            ${thMenuItemHtml('players', T('games.table.menuFromPlayers'), view.shareMetric === 'players')}
            ${thMenuItemHtml('earn', T('games.table.menuFromEarn'), view.shareMetric === 'earn')}
          </div>
        </th>
        <th data-sort="earn" title="${T('games.table.colEarnTitle')}">${T('games.common.earn')}</th>
        <th class="th-metric th-dynamics" data-sort="dynamics">
          <div class="th-metric-top">${T('games.common.dynamics')}${view.sortKey === 'dynamics' ? (view.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</div>
          <button type="button" class="th-menu-trigger" id="dynamicsMenuTrigger" aria-haspopup="listbox" aria-expanded="false" title="${T('games.table.dynamicsTitle')}">
            <span class="th-menu-label">${F().esc(
              dynamicsTriggerLabel(view.dynamicsMetric, cmp)
            )}</span>
            <span class="th-menu-caret" aria-hidden="true">${caret}</span>
          </button>
          <div class="th-menu th-menu-wide" id="dynamicsMenu" hidden role="listbox">
            <div class="th-menu-cap">${T('games.table.capShow')}</div>
            <button type="button" class="th-menu-item ${
              view.dynamicsMetric === 'players' ? 'is-active' : ''
            }" data-field="metric" data-value="players" role="option" aria-selected="${
              view.dynamicsMetric === 'players' ? 'true' : 'false'
            }"><span>${T('games.common.players')}</span>${
              view.dynamicsMetric === 'players' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <button type="button" class="th-menu-item ${
              view.dynamicsMetric === 'earn' ? 'is-active' : ''
            }" data-field="metric" data-value="earn" role="option" aria-selected="${
              view.dynamicsMetric === 'earn' ? 'true' : 'false'
            }"><span>${T('games.common.earn')}</span>${
              view.dynamicsMetric === 'earn' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <div class="th-menu-cap">${T('games.table.capCompareWith')}</div>
            <button type="button" class="th-menu-item ${
              cmp === 'prev_month' ? 'is-active' : ''
            }" data-field="compare" data-value="prev_month" role="option" aria-selected="${
              cmp === 'prev_month' ? 'true' : 'false'
            }"><span>${T('games.table.vs.prev_month')}</span>${
              cmp === 'prev_month' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <button type="button" class="th-menu-item ${
              cmp === 'prev_period' ? 'is-active' : ''
            }" data-field="compare" data-value="prev_period" role="option" aria-selected="${
              cmp === 'prev_period' ? 'true' : 'false'
            }"><span>${T('games.table.vs.prev_period')}</span>${
              cmp === 'prev_period' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <button type="button" class="th-menu-item ${
              cmp === 'd7' ? 'is-active' : ''
            }" data-field="compare" data-value="d7" role="option" aria-selected="${
              cmp === 'd7' ? 'true' : 'false'
            }"><span>${T('games.table.vs.d7')}</span>${
              cmp === 'd7' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <button type="button" class="th-menu-item ${
              cmp === 'd14' ? 'is-active' : ''
            }" data-field="compare" data-value="d14" role="option" aria-selected="${
              cmp === 'd14' ? 'true' : 'false'
            }"><span>${T('games.table.vs.d14')}</span>${
              cmp === 'd14' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <button type="button" class="th-menu-item ${
              cmp === 'd30' ? 'is-active' : ''
            }" data-field="compare" data-value="d30" role="option" aria-selected="${
              cmp === 'd30' ? 'true' : 'false'
            }"><span>${T('games.table.vs.d30')}</span>${
              cmp === 'd30' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
          </div>
        </th>
        <th title="${T('games.table.colPerPlayerTitle')}">${T('games.table.colPerPlayer')}</th>
      </tr></thead>
      <tbody></tbody>
    </table>
        </div>
    <div class="empty" id="gamesEmpty" hidden></div>`;
    table = wrap.querySelector('table.games-table');
    gamesTableState.rows.clear();
  }

  const tbody = table.querySelector('tbody');
  const empty = wrap.querySelector('#gamesEmpty');

  // создавала новые <img> и иконки мигали.
  const template = document.createElement('tbody');
  const wanted = new Set();

  view.ordered.forEach((g) => {
    const id = String(g.id);
    wanted.add(id);
    const iconUrl = g.icon_url || '';
    let row = gamesTableState.rows.get(id);

    if (!row) {
      template.innerHTML = gameRowHtml(g, view);
      row = template.firstElementChild;
      row.querySelector('.game-icon-slot').replaceWith(gameIconNode(g));
      row.dataset.icon = iconUrl;
      gamesTableState.rows.set(id, row);
      tbody.appendChild(row);
    } else {
      // Числа
      const players = periodPlayersOf(g, view.playersMode);
      const earn = periodEarnOf(g);
      const share = gameShareOf(g, view);
      const avg = periodPlayersAvgOf(g);
      const per = avg > 0 ? earn / avg : null;
      const setText = (sel, text) => {
        const el = row.querySelector(sel);
        if (el && el.textContent !== text) el.textContent = text;
      };
      setText('.cell-players', players == null ? '—' : F().num(players, 0));
      setText('.cell-earn', moneyFmt(earn));
      setText('.cell-per', per == null ? '—' : moneyFmt(per));
      const bar = row.querySelector('.share-bar i');
      if (bar) bar.style.width = `${share == null ? 0 : Math.min(100, share)}%`;
      const shareText = row.querySelector('.share-bar span');
      if (shareText) shareText.textContent = share == null ? '—' : `${F().num(share, 1)}%`;
      const dynCell = row.querySelector('.cell-dynamics');
      if (dynCell) {
        const next = dynamicsCellHtml(gameDynamicsOf(g, view));
        if (dynCell.innerHTML !== next) dynCell.innerHTML = next;
      }

      // Название, статус и иконка — только при фактическом изменении
      const title = g.title || T('games.common.noTitle');
      const titleEl = row.querySelector('.game-title');
      if (titleEl && titleEl.textContent !== title) titleEl.textContent = title;

      const pill = row.querySelector('.status-pill');
      const pillClass = `status-pill ${statusClass(g.status)}`;
      const pillText = statusLabel(g.status);
      if (pill) {
        if (pill.className !== pillClass) pill.className = pillClass;
        if (pill.textContent !== pillText) pill.textContent = pillText;
      }
      if (row.dataset.icon !== iconUrl) {
        const cell = row.querySelector('.game-cell');
        const old = cell && cell.querySelector('.game-icon');
        const next = gameIconNode(g);
        if (old) old.replaceWith(next);
        else if (cell) cell.prepend(next);
        row.dataset.icon = iconUrl;
      }
    }

    const shouldHide = !view.visibleIds.has(id);
    if (row.hidden !== shouldHide) row.hidden = shouldHide;
  });

  // Удаляем строки игр, которых больше нет в данных
  for (const [id, row] of gamesTableState.rows) {
    if (!wanted.has(id)) {
      row.remove();
      gamesTableState.rows.delete(id);
    }
  }

  const orderSig = view.ordered
    .map((g) => String(g.id))
    .filter((id) => view.visibleIds.has(id))
    .join(',');
  if (gamesTableState.orderSig !== orderSig) {
    view.ordered.forEach((g) => {
      const row = gamesTableState.rows.get(String(g.id));
      if (row) tbody.appendChild(row);
    });
    gamesTableState.orderSig = orderSig;
  }

  const marks = { title: '', status: '', players: '', share: '', earn: '', dynamics: '' };
  if (view.sortKey in marks) marks[view.sortKey] = view.sortDir === 'asc' ? ' ↑' : ' ↓';
  table.querySelectorAll('th[data-sort="title"], th[data-sort="status"], th[data-sort="earn"]').forEach((th) => {
    const key = th.dataset.sort;
    const labels = {
      title: T('games.table.colGame'),
      status: T('games.table.colStatus'),
      earn: T('games.common.earn')
    };
    const next = `${labels[key]}${marks[key] || ''}`;
    if (th.textContent !== next) th.textContent = next;
  });
  const setMetricTop = (sel, label, mark) => {
    const el = table.querySelector(sel);
    if (!el) return;
    const next = `${label}${mark || ''}`;
    if (el.textContent !== next) el.textContent = next;
  };
  setMetricTop('th[data-sort="players"] .th-metric-top', T('games.common.players'), marks.players);
  setMetricTop('th[data-sort="share"] .th-metric-top', T('games.table.colShare'), marks.share);
  setMetricTop('th[data-sort="dynamics"] .th-metric-top', T('games.common.dynamics'), marks.dynamics);

  const syncTriggerLabel = (sel, text) => {
    const el = table.querySelector(`${sel} .th-menu-label`);
    if (el && el.textContent !== text) el.textContent = text;
  };
  const syncMenuItems = (menuSel, value, field) => {
    const menu = table.querySelector(menuSel);
    if (!menu) return;
    const check = thMenuCheck();
    menu.querySelectorAll('.th-menu-item').forEach((btn) => {
      if (field && btn.dataset.field !== field) return;
      const on = btn.dataset.value === value;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      const mark = btn.querySelector('.th-menu-check');
      if (on && !mark) {
        const i = document.createElement('i');
        i.className = 'th-menu-check';
        i.innerHTML = check;
        btn.appendChild(i);
      } else if (!on && mark) {
        mark.remove();
      }
    });
  };
  const cmp = view.heatCompare || 'prev_month';
  syncTriggerLabel('#playersModeSelect', playersModeLabel(view.playersMode));
  syncTriggerLabel('#shareMetricSelect', shareMetricLabel(view.shareMetric));
  syncTriggerLabel(
    '#dynamicsMenuTrigger',
    dynamicsTriggerLabel(view.dynamicsMetric, cmp)
  );
  syncMenuItems('#playersModeMenu', view.playersMode);
  syncMenuItems('#shareMetricMenu', view.shareMetric);
  syncMenuItems('#dynamicsMenu', view.dynamicsMetric, 'metric');
  syncMenuItems('#dynamicsMenu', cmp, 'compare');

  const visibleCount = view.visibleIds.size;
  table.hidden = visibleCount === 0;
  if (empty) {
    empty.hidden = visibleCount !== 0;
    empty.textContent = view.publishedOnly ? T('games.table.noPublished') : T('games.table.noSearch');
  }
}

function paintEarnChart(home, view) {
  const panel = home.querySelector('.panel-earn-days');
  if (!panel) return;

  const sub = panel.querySelector('.earn-days-sub');
  if (sub && view.maxMonthMeta != null) sub.textContent = view.maxMonthMeta;

  if (earnPanelCache.sig === view.earnSig && earnPanelCache.node === panel) return;

  const host = panel.querySelector('#homeEarnBars');
  if (!host) return;

  if (view.monthBars.some((d) => d.value > 0)) {
    const grid = home.querySelector('.home-grid-2');
    const raw = grid ? getComputedStyle(grid).getPropertyValue('--home-map-h') : '';
    const h = Math.max(200, Math.round(parseFloat(raw)) || 400);
    C().bars(host, view.monthBars, {
        dense: true,
        endLabelsOnly: true,
        hideValueLabels: true,
        height: h,
        color: '#1e7a50',
        highlightColor: '#3dd68c',
        showAvg: true,
        compareLine: true,
        compareColor: '#8a8a8a',
        formatY: (n) => (Number.isFinite(n) ? F().money(n, 0) : '')
      });
  } else {
    host.innerHTML =
      `<div class="empty">${T('games.earn.noMonths')}<br><button type="button" class="earn-empty-add" data-open-tax>${T('games.earn.openTax')}</button></div>`;
  }

  earnPanelCache.sig = view.earnSig;
  earnPanelCache.node = panel;
}

function closeAccountPop(root) {
  const scope = root || document;
  scope.querySelectorAll('.account-pop').forEach((pop) => {
    pop.hidden = true;
  });
  scope.querySelectorAll('[data-account-chip]').forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
  });
}

function bindAccountChip(root, data) {
  const wrap = root.querySelector('.account-chip-wrap');
  if (!wrap) return;
  const chip = wrap.querySelector('[data-account-chip]');
  const pop = wrap.querySelector('#accountPop');
  if (!chip || !pop) return;
  if (!chip.classList.contains('is-switchable')) return;

  chip.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = !pop.hidden;
    closeAccountPop(root);
    if (!open) {
      pop.hidden = false;
      chip.setAttribute('aria-expanded', 'true');
    }
  };

  pop.querySelectorAll('[data-account-id]').forEach((item) => {
    item.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nextId = String(item.dataset.accountId || '');
      const cur = String((data && data.activeAccountId) || '');
      closeAccountPop(root);
      if (!nextId || nextId === cur) return;
      writeStoredAccountId(nextId);
      invalidateGamesModels();
      if (window.FoundersApp && typeof window.FoundersApp.loading === 'function') {
        window.FoundersApp.loading(true);
      }
      try {
        await window.FoundersPages.games(root, {
          ...window.FoundersApp.state,
          forceReload: true,
          animateNumbers: false,
          animateHeatmap: false
        });
        if (window.FoundersPages.periodControls) {
          const mount = document.getElementById('periodMount');
          if (mount) {
            await window.FoundersPages.periodControls(
              mount,
              window.FoundersApp.state.period || 'month'
            );
          }
        }
      } finally {
        if (window.FoundersApp && typeof window.FoundersApp.loading === 'function') {
          window.FoundersApp.loading(false);
        }
      }
    };
  });

  if (!bindAccountChip._docBound) {
    document.addEventListener('click', () => closeAccountPop());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAccountPop();
    });
    bindAccountChip._docBound = true;
  }
}

/** Обработчики страницы «Игры»: переназначаются на каждом рендере (идемпотентно). */
function bindGamesUi(root, data) {
  const rerender = () => window.FoundersPages.games(root, window.FoundersApp.state);
  bindAccountChip(root, data);

    root.querySelectorAll('[data-heat-metric]').forEach((btn) => {
      btn.onclick = () => {
        window.FoundersApp.setHeatMetric(btn.dataset.heatMetric);
        root.querySelectorAll('[data-heat-metric]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        const seg = btn.closest('.seg');
        if (seg && window.FoundersMotion && window.FoundersMotion.flush) {
          window.FoundersMotion.flush(seg);
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => updateHeatmapOnly(root, window.FoundersApp.state));
        });
      };
    });

    const rememberSearch = () => {
      const search = root.querySelector('#gamesSearch');
      if (search) window.FoundersApp.state.gamesQuery = search.value;
    };

    const bindThMenu = (triggerSel, menuSel, onPick) => {
      const trigger = root.querySelector(triggerSel);
      const menu = root.querySelector(menuSel);
      if (!trigger || !menu) return;
      trigger.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const open = menu.classList.contains('is-open');
        closeAllThMenus(root);
        if (!open) positionThMenu(trigger, menu);
      };
      menu.onclick = (e) => e.stopPropagation();
      menu.querySelectorAll('.th-menu-item').forEach((item) => {
        item.onclick = (e) => {
          e.stopPropagation();
          onPick(item.dataset.value, item.dataset.field || null);
          closeAllThMenus(root);
          rememberSearch();
          rerender();
        };
      });
    };

    bindThMenu('#playersModeSelect', '#playersModeMenu', (v) =>
      window.FoundersApp.setGamesPlayersMode(v)
    );
    bindThMenu('#shareMetricSelect', '#shareMetricMenu', (v) =>
      window.FoundersApp.setGamesShareMetric(v)
    );
    bindThMenu('#dynamicsMenuTrigger', '#dynamicsMenu', (v, field) => {
      if (field === 'metric') {
        window.FoundersApp.setGamesDynamicsMetric(v);
        return;
      }
      window.FoundersApp.setHeatCompare(v);
      root.querySelectorAll('[data-heat-compare]').forEach((b) => {
        b.classList.toggle('active', b.dataset.heatCompare === v);
      });
    });

    if (!bindGamesUi._thMenuDocBound) {
      document.addEventListener('click', () => closeAllThMenus());
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllThMenus();
      });
      window.addEventListener(
        'scroll',
        () => closeAllThMenus(),
        true
      );
      bindGamesUi._thMenuDocBound = true;
    }

    root.querySelectorAll('[data-heat-compare]').forEach((btn) => {
      btn.onclick = () => {
        window.FoundersApp.setHeatCompare(btn.dataset.heatCompare);
        root.querySelectorAll('[data-heat-compare]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        rerender();
      };
    });

  const hideInactive = root.querySelector('#hideInactive');
  if (hideInactive) {
    hideInactive.onclick = () => {
      const app = window.FoundersApp;
      app.setPublishedOnly(!app.state.gamesPublishedOnly);
      const search = root.querySelector('#gamesSearch');
      if (search) app.state.gamesQuery = search.value;
      // Таблица обновляется на месте: строки не пересоздаются, иконки не мигают.
      rerender();
    };
  }

  const search = root.querySelector('#gamesSearch');
    if (search) {
      search.oninput = () => {
        window.FoundersApp.state.gamesQuery = search.value;
      rerender();
      const next = root.querySelector('#gamesSearch');
      // После перерисовки таблицы поле не пересоздаётся, но фокус сохраняем на всякий случай
      if (next && next !== search) {
        next.focus();
        next.setSelectionRange(next.value.length, next.value.length);
      }
    };
  }

    root.querySelectorAll('th[data-sort]').forEach((th) => {
      th.style.cursor = 'pointer';
      th.onclick = (e) => {
        if (e.target.closest('.th-menu-trigger, .th-menu')) return;
        const st = window.FoundersApp.state;
        const key = th.dataset.sort;
        if (st.gamesSortKey === key) st.gamesSortDir = st.gamesSortDir === 'asc' ? 'desc' : 'asc';
        else {
          st.gamesSortKey = key;
          st.gamesSortDir = key === 'title' || key === 'status' ? 'asc' : 'desc';
        }
        rerender();
      };
    });

  // Плитки тепловой карты обрабатывает bindHeatmapUi («Ещё» открывает список),
  root.querySelectorAll('[data-open]:not(.heatmap-cell)').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
      const host = el.closest('[data-open]') || el;
      const id = el.dataset.open || (host && host.dataset.open);
        if (id) window.FoundersApp.openGame(id);
      };
    });

  root.querySelectorAll('[data-open-tax]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTaxPage();
    };
  });
}

// Тултип для свечей вешаем один раз: обработчик делегирован на document.
bindDaysTips();
bindDynamicsTips();
