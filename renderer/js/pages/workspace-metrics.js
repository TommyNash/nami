async function renderWorkspaceMetrics(body, details, period) {
  const sectionId = window.FoundersApp.state.metricsSection || 'product';
  const section = METRIC_SECTIONS.find((s) => s.id === sectionId) || METRIC_SECTIONS[0];
  const chartOpts = { analysis: true, trend: true, trendWindow: 7 };
  const extras = extraSeriesPrefixes(details.seriesGrouped);

  body.innerHTML = `
    ${scopeNote('earn', details.bounds)}
    ${
      period === 'day' || period === 'week'
        ? `<div class="scope-note">${T('workspace.metrics.yearNote', {
            period: F().esc(F().periodNoun(period))
          })}</div>`
        : `<div class="scope-note">${T('workspace.metrics.avgNote')}</div>`
    }
    <div class="seg metrics-seg" role="tablist" aria-label="${F().esc(T('workspace.metrics.sectionsAria'))}" data-thumb-key="metrics">
      ${METRIC_SECTIONS.map(
        (s) =>
          `<button type="button" class="seg-btn ${s.id === section.id ? 'active' : ''}" data-msection="${s.id}">${
            s.title
          }</button>`
      ).join('')}
    </div>
    <div class="scope-note">${T('workspace.metrics.cabinetNote', {
      title: section.title,
      count: KNOWN_METRIC_PREFIXES.length
    })}</div>
    ${section.charts
      .map(
        (c) => `
      <div class="panel">
        <div class="panel-head"><h2>${F().esc(c.title)}</h2>${
          c.hint ? `<span class="muted">${F().esc(c.hint)}</span>` : ''
        }</div>
        <div class="panel-body"><div id="mchart-${F().esc(c.id)}"></div></div>
      </div>`
      )
      .join('')}
    ${
      extras.length
        ? `<div class="panel"><div class="panel-head"><h2>${T('workspace.metrics.otherTitle')}</h2><span class="muted">${T('workspace.metrics.otherHint')}</span></div>
        <div class="panel-body">${extras.map((p) => `<span class="tag">${F().esc(p)}</span>`).join('')}</div></div>`
        : ''
    }
  `;

  body.querySelectorAll('[data-msection]').forEach((btn) => {
    btn.onclick = () => {
      window.NamiStore.setMetricsSection(btn.dataset.msection);
      renderWorkspaceMetrics(body, details, period);
    };
  });

  for (const chart of section.charts) {
    const raw = resolveChartSeries(details.seriesGrouped, chart);
    paintMetricChart(document.getElementById(`mchart-${chart.id}`), raw, chart, chartOpts);
  }
}
