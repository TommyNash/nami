function taxPageHtml({ rate, shift, stats, rows }) {
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

    return `
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
}
