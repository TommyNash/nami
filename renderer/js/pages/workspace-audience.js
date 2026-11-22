async function renderWorkspaceAudience(body, data, details, period) {
  const tab = data.audienceTab || 'reviews';
  const id = data.selectedGameId;
  const [reviewsPage, geo, plat] = await Promise.all([
    window.NamiServices.game.reviews(id),
    window.NamiServices.game.geography(id),
    window.NamiServices.game.platforms(id)
  ]);
  const ratings = Array.isArray(reviewsPage.ratings)
    ? reviewsPage.ratings
    : reviewsPage.ratings
      ? [reviewsPage.ratings]
      : [];

  body.innerHTML = `
    <div class="tabs">
      <button type="button" class="tab ${tab === 'reviews' ? 'active' : ''}" data-atab="reviews">${T('workspace.label.reviews')}</button>
      <button type="button" class="tab ${tab === 'geo' ? 'active' : ''}" data-atab="geo">${T('workspace.audience.geography')}</button>
      <button type="button" class="tab ${tab === 'platforms' ? 'active' : ''}" data-atab="platforms">${T('workspace.label.platforms')}</button>
    </div>
    <div id="audInner"></div>
  `;
  const inner = document.getElementById('audInner');

  function paint(active) {
    window.FoundersApp.setAudienceTab(active);
    body.querySelectorAll('[data-atab]').forEach((b) => b.classList.toggle('active', b.dataset.atab === active));
    if (active === 'reviews') {
      inner.innerHTML = `
        ${scopeNote('period', details.bounds)}
        <div class="panel">
          <div class="panel-head"><h2>${T('workspace.label.rating')}</h2></div>
          <div class="panel-body" style="padding:0">
            <table>
              <thead><tr><th>${T('workspace.audience.average')}</th><th>1★</th><th>2★</th><th>3★</th><th>4★</th><th>5★</th><th>${T('workspace.audience.total')}</th></tr></thead>
              <tbody>
                ${ratings
                  .map(
                    (r) => `<tr>
                      <td>${F().num(r.avg_rating)}</td>
                      <td>${F().num(r.stars_1, 0)}</td>
                      <td>${F().num(r.stars_2, 0)}</td>
                      <td>${F().num(r.stars_3, 0)}</td>
                      <td>${F().num(r.stars_4, 0)}</td>
                      <td>${F().num(r.stars_5, 0)}</td>
                      <td>${F().num(r.total, 0)}</td>
                    </tr>`
                  )
                  .join('') || `<tr><td colspan="7" class="empty">${T('workspace.audience.noRatings')}</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>${T('workspace.label.reviews')}</h2></div>
          <div class="panel-body" style="padding:0">
            <table>
              <thead><tr><th>${T('workspace.audience.author')}</th><th>★</th><th>${T('workspace.audience.text')}</th><th>${T('workspace.audience.time')}</th></tr></thead>
              <tbody>
                ${(reviewsPage.reviews || [])
                  .slice(0, 40)
                  .map(
                    (r) => `<tr>
                      <td>${F().esc(r.author_name || '—')}</td>
                      <td>${F().num(r.rating, 0)}</td>
                      <td>${F().esc((r.text || '').slice(0, 160))}</td>
                      <td>${F().time(r.review_time)}</td>
                    </tr>`
                  )
                  .join('') || `<tr><td colspan="4" class="empty">${T('workspace.audience.noReviews')}</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>`;
    } else if (active === 'geo') {
      inner.innerHTML = `
        ${scopeNote('snapshot')}
        <div class="panel"><div class="panel-body"><div id="aGeo"></div></div></div>
        <div class="panel"><div class="panel-body" style="padding:0">
          <table><thead><tr><th>${T('workspace.audience.country')}</th><th>${T('workspace.label.players')}</th></tr></thead>
          <tbody>${geo.map((r) => `<tr><td>${F().esc(r.country)}</td><td>${F().num(r.players, 0)}</td></tr>`).join('') ||
            `<tr><td colspan="2" class="empty">${T('workspace.audience.noData')}</td></tr>`}</tbody></table>
        </div></div>`;
      C().bars(
        document.getElementById('aGeo'),
        geo.slice(0, 15).map((r) => ({ label: r.country, value: r.players }))
      );
    } else {
      inner.innerHTML = `
        ${scopeNote('snapshot')}
        <div class="panel"><div class="panel-body"><div id="aPlat"></div></div></div>
        <div class="panel"><div class="panel-body" style="padding:0">
          <table><thead><tr><th>${T('workspace.audience.platform')}</th><th>${T('workspace.label.players')}</th></tr></thead>
          <tbody>${plat.map((r) => `<tr><td>${F().esc(r.platform)}</td><td>${F().num(r.players, 0)}</td></tr>`).join('') ||
            `<tr><td colspan="2" class="empty">${T('workspace.audience.noData')}</td></tr>`}</tbody></table>
        </div></div>`;
      C().bars(
        document.getElementById('aPlat'),
        plat.map((r) => ({ label: r.platform, value: r.players })),
        { color: '#1e7a50' }
      );
    }
  }

  body.querySelectorAll('[data-atab]').forEach((b) => {
    b.onclick = () => paint(b.dataset.atab);
  });
  paint(tab);
}
