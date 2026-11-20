async function renderTaxPage(root, data) {
    const aid = activeAccountIdFrom(data) || null;
    let sheet = { rate: 6, shift: 1, rows: [], stats: {} };
    try {
      sheet = (await window.foundersApi.taxSheet(aid)) || sheet;
    } catch (err) {
      console.warn('[tax] tax_sheet:', err);
    }
    const rate = Number(sheet.rate);
    const shift = Number(sheet.shift);
    const stats = sheet.stats || {};
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];

    const moneyOrDash = (v) =>
      v == null || !Number.isFinite(Number(v)) ? '—' : moneyFmt(Number(v));

    const tableRows = rows
      .map((r) => {
        const earnM = String(r.earnMonth || r.consoleMonth || '');
        const payM = String(r.payMonth || r.taxMonth || '');
        const taxVal = r.taxEarn != null ? Number(r.taxEarn) : null;
        const hasTax = !!r.hasTax;
        const consoleEarn = r.consoleEarn != null ? Number(r.consoleEarn) : null;
        const payNote =
          shift === 0
            ? ''
            : `<div class="muted tax-month-sub">${T('tax.payNote', { month: F().esc(formatMonthAxis(payM)) })}</div>`;
        return `<tr data-earn-month="${F().esc(earnM)}" data-console="${
          consoleEarn != null && Number.isFinite(consoleEarn) ? consoleEarn : ''
        }">
          <td>
            <div class="tax-month">${F().esc(formatMonthLabel(earnM))}</div>
            ${payNote}
          </td>
          <td class="num" data-col="console">${moneyOrDash(r.consoleEarn)}</td>
          <td>
            <input type="text" inputmode="decimal" class="tax-input" data-tax-earn
              data-saved="${hasTax ? F().esc(formatMoneyInputValue(taxVal)) : ''}"
              value="${hasTax ? F().esc(formatMoneyInputValue(taxVal)) : ''}"
              placeholder="${T('tax.amountPlaceholder')}">
          </td>
          <td class="num" data-col="due">${moneyOrDash(r.taxDue)}</td>
        </tr>`;
      })
      .join('');

    const sumCard = (id, label, value, note, accent) =>
      `<div class="tax-kpi ${accent ? 'is-accent' : ''}" data-tax-kpi="${F().esc(id)}">
        <div class="tax-kpi-label">${F().esc(label)}</div>
        <div class="tax-kpi-value" data-countup="${Number(value) || 0}" data-count-fmt="money">${moneyOrDash(
          value
        )}</div>
        <div class="tax-kpi-note" data-tax-note>${F().esc(note || '')}</div>
      </div>`;

    const avgRangeNote = T('tax.avgRange', { min: moneyOrDash(stats.taxMin), max: moneyOrDash(stats.taxMax) });
    const shiftLabel = (s) =>
      s === 0 ? T('tax.shiftNow') : s > 0 ? T('tax.shiftPlus', { value: s }) : T('tax.months', { value: s });
    const headMetaText = T('tax.headMeta', {
      rate,
      shift: shiftLabel(shift),
      count: F().num(stats.taxCount || 0, 0)
    });

    root.innerHTML = `
      <div class="tax-page">
        <div class="tax-head">
          <div class="tax-head-copy">
            <h1 class="tax-title">${T('tax.title')}</h1>
            <p class="tax-head-lead muted" data-tax-head-meta>${F().esc(headMetaText)}</p>
          </div>
          <div class="tax-head-actions">
            <button type="button" class="ws-export-btn" id="taxExportBtn">
              <i class="ph ph-download-simple" aria-hidden="true"></i>
              <span>${T('tax.exportData')}</span>
            </button>
            <div class="tax-settings">
              <button type="button" class="tax-settings-btn" id="taxSettingsBtn" aria-haspopup="dialog" aria-expanded="false" title="${T('tax.settings')}">
                <i class="ph ph-gear" aria-hidden="true"></i>
              </button>
              <div class="tax-settings-pop" id="taxSettingsPop" hidden>
                <div class="tax-control">
                  <label for="taxRate">${T('tax.rateLabel')}</label>
                  <input id="taxRate" type="text" inputmode="decimal" value="${F().esc(
                    String(rate)
                  )}" />
                </div>
                <div class="tax-control">
                  <label for="taxShift">${T('tax.shiftLabel')}</label>
                  <select id="taxShift">
                    ${[-2, -1, 0, 1, 2]
                      .map(
                        (s) =>
                          `<option value="${s}" ${s === shift ? 'selected' : ''}>${
                            s === 0
                              ? T('tax.shiftSame')
                              : s > 0
                                ? T('tax.shiftPlusHint', { value: s })
                                : T('tax.months', { value: s })
                          }</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <p class="tax-settings-hint muted">${T('tax.settingsHint')}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="tax-summary">
          ${sumCard('sum', T('tax.kpi.sum'), stats.taxSum, T('tax.months', { value: F().num(stats.taxCount || 0, 0) }), true)}
          ${sumCard('avg', T('tax.kpi.avg'), stats.taxAvg, avgRangeNote, false)}
          ${sumCard('due', T('tax.kpi.due'), stats.taxDueSum, T('tax.ofSum', { rate }), false)}
          ${sumCard('net', T('tax.net'), stats.netSum, T('tax.afterTax'), false)}
        </div>

        <div class="home-grid home-grid-2 tax-charts">
          <div class="panel panel-chart">
            <div class="panel-head">
              <h2>${T('tax.chart.factTitle')}</h2>
              <div id="taxFactChartTools" class="sum-chart-pills"></div>
            </div>
            <div id="taxFactChart" class="tax-chart-mount"></div>
          </div>
          <div class="panel panel-chart">
            <div class="panel-head">
              <h2>${T('tax.chart.splitTitle')}</h2>
            </div>
            <div id="taxSplitChart" class="tax-chart-mount"></div>
          </div>
        </div>

        <div class="panel tax-table-panel">
          <div class="panel-head">
            <h2>${T('tax.table.title')}</h2>
          </div>
          <div class="panel-body" style="padding:0">
            <div class="table-scroll">
              <table class="tax-table">
                <thead>
                  <tr>
                    <th>${T('tax.table.earn')}</th>
                    <th>${T('tax.table.console')}</th>
                    <th>${T('tax.table.fact')}</th>
                    <th>${T('tax.tax')}</th>
                  </tr>
                </thead>
                <tbody>${tableRows || `<tr><td colspan="4" class="empty">${T('tax.table.empty')}</td></tr>`}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>`;

    const rerender = () => window.FoundersPages.tax(root, window.FoundersApp.state);
    const savedRate = String(rate);
    const savedShift = String(shift);

    const currentRate = () => {
      const n = parseMoneyInput(root.querySelector('#taxRate') && root.querySelector('#taxRate').value);
      return n == null ? rate : n;
    };

    const normMoney = (raw) => {
      const n = parseMoneyInput(raw);
      if (n == null || n < 0) return '';
      if (n === 0) return '';
      return formatMoneyInputValue(n);
    };

    const draftChron = () => {
      const r = currentRate();
      return [...root.querySelectorAll('tr[data-earn-month]')]
        .map((tr) => {
          const inp = tr.querySelector('[data-tax-earn]');
          const taxEarn = parseMoneyInput(inp && inp.value);
          const hasTax = taxEarn != null && taxEarn > 0;
          const consoleRaw = tr.dataset.console;
          const consoleEarn =
            consoleRaw !== '' && consoleRaw != null && Number.isFinite(Number(consoleRaw))
              ? Number(consoleRaw)
              : null;
          const due = hasTax ? (taxEarn * r) / 100 : null;
          return {
            earnMonth: tr.dataset.earnMonth || '',
            taxEarn: hasTax ? taxEarn : null,
            consoleEarn,
            taxDue: due,
            net: hasTax ? taxEarn - due : null
          };
        })
        .sort((a, b) => String(a.earnMonth).localeCompare(String(b.earnMonth)));
    };

    const paintTaxCharts = () => {
      const chron = draftChron().filter((r) => r.taxEarn != null || r.consoleEarn != null);
      const factHost = root.querySelector('#taxFactChart');
      const splitHost = root.querySelector('#taxSplitChart');
      const factBars = chron
        .filter((r) => r.taxEarn != null)
        .map((r) => ({
          label: formatMonthShort(r.earnMonth),
          title: formatMonthLabel(r.earnMonth),
          value: Number(r.taxEarn) || 0
        }));
      if (factHost) {
        if (factBars.length) {
          C().bars(factHost, factBars, {
            color: '#1e7a50',
            highlightColor: '#3dd68c',
            showAvg: true,
            trend: true,
            yAxis: true,
            allXLabels: true,
            height: 320,
            gapRatio: 0.12,
            formatY: moneyFmt,
            hideValueLabels: true,
            toolsHost: root.querySelector('#taxFactChartTools')
          });
        } else {
          factHost.innerHTML = `<div class="empty">${T('tax.chart.empty')}</div>`;
        }
      }
      const stacks = chron
        .filter((r) => r.taxEarn != null)
        .map((r) => ({
          label: formatMonthShort(r.earnMonth),
          title: formatMonthLabel(r.earnMonth),
          segments: [
            { key: 'net', label: T('tax.net'), value: Number(r.net) || 0, color: '#3dd68c' },
            { key: 'tax', label: T('tax.tax'), value: Number(r.taxDue) || 0, color: '#e3a93a' }
          ]
        }));
      if (splitHost) {
        if (stacks.length) {
          C().stackedBars(splitHost, stacks, {
            height: 320,
            yAxis: true,
            gapRatio: 0.16,
            formatY: moneyFmt,
            legend: [
              { label: T('tax.net'), color: '#3dd68c' },
              { label: T('tax.tax'), color: '#e3a93a' }
            ]
          });
        } else {
          splitHost.innerHTML = `<div class="empty">${T('tax.chart.empty')}</div>`;
        }
      }
    };

    const patchKpisFromRows = () => {
      const chron = draftChron();
      const vals = chron.map((r) => r.taxEarn).filter((n) => n != null && n > 0);
      const sum = vals.reduce((a, b) => a + b, 0);
      const avg = vals.length ? sum / vals.length : 0;
      const min = vals.length ? Math.min(...vals) : null;
      const max = vals.length ? Math.max(...vals) : null;
      const r = currentRate();
      const due = (sum * r) / 100;
      const net = sum - due;
      const setCard = (id, value, note) => {
        const card = root.querySelector(`[data-tax-kpi="${id}"]`);
        if (!card) return;
        const valEl = card.querySelector('.tax-kpi-value');
        const noteEl = card.querySelector('[data-tax-note]');
        if (valEl) {
          valEl.dataset.countup = String(value || 0);
          valEl.textContent = moneyOrDash(value);
        }
        if (noteEl && note != null) noteEl.textContent = note;
      };
      setCard('sum', sum, T('tax.months', { value: vals.length }));
      setCard('avg', avg, T('tax.avgRange', { min: moneyOrDash(min), max: moneyOrDash(max) }));
      setCard('due', due, T('tax.ofSum', { rate: r }));
      setCard('net', net, T('tax.afterTax'));
      const headMeta = root.querySelector('[data-tax-head-meta]');
      if (headMeta) {
        const shiftSel = root.querySelector('#taxShift');
        const s = shiftSel ? Number(shiftSel.value) : shift;
        headMeta.textContent = T('tax.headMeta', { rate: r, shift: shiftLabel(s), count: vals.length });
      }
      scheduleTaxCharts();
    };

    let taxChartTimer = null;
    const scheduleTaxCharts = () => {
      if (taxChartTimer) clearTimeout(taxChartTimer);
      taxChartTimer = setTimeout(() => {
        taxChartTimer = null;
        paintTaxCharts();
      }, 280);
    };

    const patchRowComputed = (tr, taxEarn) => {
      const hasTax = taxEarn != null && taxEarn > 0;
      const r = currentRate();
      const due = hasTax ? (taxEarn * r) / 100 : null;
      const dueEl = tr.querySelector('[data-col="due"]');
      if (dueEl) dueEl.textContent = moneyOrDash(due);
    };

    const settingsDirty = () => {
      const rateInp = root.querySelector('#taxRate');
      const shiftSel = root.querySelector('#taxShift');
      const r = rateInp ? String(rateInp.value || '').trim() : savedRate;
      const s = shiftSel ? String(shiftSel.value) : savedShift;
      return r !== savedRate || s !== savedShift;
    };

    const rowsDirty = () =>
      [...root.querySelectorAll('[data-tax-earn]')].some((inp) => {
        const now = normMoney(inp.value);
        const was = normMoney(inp.dataset.saved || '');
        return now !== was;
      });

    const isDirty = () => settingsDirty() || rowsDirty();

    const syncSaveBar = () => {
      const mount = document.getElementById('chromeActions');
      if (!mount) return;
      const dirty = isDirty();
      if (!dirty) {
        mount.innerHTML = '';
        mount.setAttribute('aria-hidden', 'true');
        return;
      }
      mount.removeAttribute('aria-hidden');
      if (!mount.querySelector('#taxSaveBtn')) {
        mount.innerHTML = `<button type="button" class="chrome-tax-save" id="taxSaveBtn">${T('tax.save')}</button>`;
        const btn = mount.querySelector('#taxSaveBtn');
        if (btn) btn.onclick = () => saveAll();
      }
    };

    const markRowPreview = (tr, inp) => {
      const n = parseMoneyInput(inp.value);
      const empty = !String(inp.value || '').trim();
      patchRowComputed(tr, empty ? null : n);
      const now = normMoney(inp.value);
      const was = normMoney(inp.dataset.saved || '');
      inp.classList.toggle('is-dirty', now !== was);
    };

    const saveAll = async () => {
      const btn = document.getElementById('taxSaveBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = T('tax.saving');
      }
      const shiftSel = root.querySelector('#taxShift');
      const shiftChanged = !!(shiftSel && String(shiftSel.value) !== savedShift);
      try {
        if (settingsDirty()) {
          const rateInp = root.querySelector('#taxRate');
          const nextRate = parseMoneyInput(rateInp && rateInp.value);
          const nextShift = Number(shiftSel && shiftSel.value);
          await window.foundersApi.setTaxSettings(
            nextRate == null ? rate : nextRate,
            Number.isFinite(nextShift) ? nextShift : shift
          );
        }
        const jobs = [];
        root.querySelectorAll('tr[data-earn-month]').forEach((tr) => {
          const inp = tr.querySelector('[data-tax-earn]');
          if (!inp) return;
          const now = normMoney(inp.value);
          const was = normMoney(inp.dataset.saved || '');
          if (now === was) return;
          const earnKey = tr.dataset.earnMonth;
          if (!now) {
            jobs.push(
              window.foundersApi.deleteManualEarnMonth(aid, earnKey).then(() => {
                inp.dataset.saved = '';
                inp.value = '';
                inp.classList.remove('is-dirty');
                patchRowComputed(tr, null);
              })
            );
            return;
          }
          const n = parseMoneyInput(inp.value);
          if (n == null || n < 0) return;
          jobs.push(
            window.foundersApi.upsertManualEarnMonth(aid, earnKey, n, null).then(() => {
              inp.dataset.saved = formatMoneyInputValue(n);
              inp.value = formatMoneyInputValue(n);
              inp.classList.remove('is-dirty');
              patchRowComputed(tr, n);
            })
          );
        });
        await Promise.all(jobs);
        // Сдвиг меняет подписи «выплата» — пересоберём экран.
        if (shiftChanged) {
          await rerender();
          return;
        }
        patchKpisFromRows();
        syncSaveBar();
      } catch (err) {
        console.warn('[tax] save:', err);
        if (btn) {
          btn.disabled = false;
          btn.textContent = T('tax.save');
        }
      }
    };

    const onDraftChange = () => {
      root.querySelectorAll('tr[data-earn-month]').forEach((tr) => {
        const inp = tr.querySelector('[data-tax-earn]');
        if (inp) markRowPreview(tr, inp);
      });
      patchKpisFromRows();
      syncSaveBar();
    };

    const settingsBtn = root.querySelector('#taxSettingsBtn');
    const settingsPop = root.querySelector('#taxSettingsPop');
    const setSettingsOpen = (open) => {
      if (!settingsPop || !settingsBtn) return;
      settingsPop.hidden = !open;
      settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      settingsBtn.classList.toggle('is-open', open);
    };
    if (settingsBtn && settingsPop) {
      settingsBtn.onclick = (e) => {
        e.stopPropagation();
        setSettingsOpen(settingsPop.hidden);
      };
      settingsPop.onclick = (e) => e.stopPropagation();
      const onDocClose = (e) => {
        if (!root.contains(settingsBtn)) {
          document.removeEventListener('click', onDocClose);
          return;
        }
        if (
          !settingsPop.hidden &&
          !settingsPop.contains(e.target) &&
          !settingsBtn.contains(e.target)
        ) {
          setSettingsOpen(false);
        }
      };
      document.addEventListener('click', onDocClose);
    }

    const rateInp = root.querySelector('#taxRate');
    const shiftSel = root.querySelector('#taxShift');
    if (rateInp) {
      rateInp.oninput = onDraftChange;
      rateInp.onchange = onDraftChange;
    }
    if (shiftSel) shiftSel.onchange = onDraftChange;

    root.querySelectorAll('tr[data-earn-month]').forEach((tr) => {
      const inp = tr.querySelector('[data-tax-earn]');
      if (!inp) return;
      inp.oninput = () => {
        setMoneyInputFormatted(inp, formatMoneyInputLive(inp.value));
        markRowPreview(tr, inp);
        patchKpisFromRows();
        syncSaveBar();
      };
      inp.onblur = () => {
        const n = parseMoneyInput(inp.value);
        if (n != null && n > 0) {
          setMoneyInputFormatted(inp, formatMoneyInputValue(n));
        } else if (!String(inp.value || '').trim()) {
          inp.value = '';
        }
        markRowPreview(tr, inp);
        syncSaveBar();
      };
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const list = [...root.querySelectorAll('tr[data-earn-month]')];
          const i = list.indexOf(tr);
          const next = list[i + 1];
          const nextInp = next && next.querySelector('[data-tax-earn]');
          if (nextInp) nextInp.focus();
          else if (isDirty()) saveAll();
        }
      };
    });

    const exportBtn = root.querySelector('#taxExportBtn');
    if (exportBtn && window.FoundersExport) {
      exportBtn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const liveRows = draftChron().map((r) => ({
          earnMonth: r.earnMonth,
          payMonth: '',
          consoleEarn: r.consoleEarn,
          taxEarn: r.taxEarn,
          taxDue: r.taxDue
        }));
        const byEarn = new Map(rows.map((r) => [String(r.earnMonth || ''), r]));
        liveRows.forEach((r) => {
          const src = byEarn.get(String(r.earnMonth || ''));
          if (src) r.payMonth = src.payMonth || src.taxMonth || '';
        });
        window.FoundersExport.open(
          exportBtn,
          taxExportSpec({ rate: currentRate(), shift: Number(root.querySelector('#taxShift')?.value) || shift, rows: liveRows })
        );
      };
    }

    syncSaveBar();
    paintTaxCharts();
    animateCounters(root, { enabled: data.animateNumbers !== false });
    if (window.FoundersSquircle && typeof window.FoundersSquircle.refresh === 'function') {
      window.FoundersSquircle.refresh(root);
    }
}
