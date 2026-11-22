async function renderWorkspacePurchases(body, gameId) {
  const page = await window.NamiServices.game.purchases(gameId);
  body.innerHTML = `
    ${scopeNote('snapshot')}
    <div class="panel">
      <div class="panel-head"><h2>${T('workspace.purchases.metricsTitle')}</h2></div>
      <div class="panel-body">
        ${(page.metrics || [])
          .map(
            (m) =>
              `<span class="tag">${F().esc(m.metric_title || m.metric_slug)}: ${F().num(m.value)} ${F().esc(
                m.unit || ''
              )}</span>`
          )
          .join('') || `<div class="empty">${T('workspace.purchases.noMetrics')}</div>`}
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>${T('workspace.purchases.catalogTitle')}</h2></div>
      <div class="panel-body" style="padding:0">
        <table>
          <thead><tr><th>${T('workspace.purchases.sku')}</th><th>${T('workspace.purchases.name')}</th><th>${T('workspace.purchases.price')}</th></tr></thead>
          <tbody>
            ${(page.products || [])
              .map(
                (p) => `<tr>
                  <td class="mono">${F().esc(p.product_id)}</td>
                  <td>${F().esc(p.title || '—')}</td>
                  <td>${F().num(p.price_value)} ${F().esc(p.price_code || '')}</td>
                </tr>`
              )
              .join('') || `<tr><td colspan="3" class="empty">${T('workspace.purchases.noProducts')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
