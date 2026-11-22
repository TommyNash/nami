function settingsPageHtml({ info, c, online, hasLink, gamesN, metricsN, earnN, rawN, rawPending, hasData, publishedOnly, periodId, updatedLabel, connTitle, connCls }) {
    const ico = (name, size = 16) =>
      window.FoundersIcons && window.FoundersIcons.svg
        ? window.FoundersIcons.svg(name, size)
        : '';
    const checkRow = (ok, label) =>
      `<div class="settings-check ${ok ? 'is-done' : ''}">
        <i class="ph ${ok ? 'ph-check-circle' : 'ph-circle'}" aria-hidden="true"></i>
        <span>${F().esc(label)}</span>
      </div>`;
    const periodSeg = ['day', 'week', 'month', 'year']
      .map((id) => {
        const label = T(`settings.period.${id}`);
        return `<button type="button" class="seg-btn ${
          periodId === id ? 'active' : ''
        }" data-settings-period="${id}">${label}</button>`;
      })
      .join('');
    const tokenMasked = maskIngestToken(info.ingestToken);
    const rawNote =
      rawN > 0 && rawPending === 0
        ? T('settings.data.rawDone')
        : rawPending > 0
          ? T('settings.data.rawPending', { count: F().num(rawPending, 0) })
          : '';

    const statChip = (label, value, note) => `
      <div class="settings-stat-chip">
        <b>${F().num(value, 0)}</b>
        <span>${F().esc(label)}</span>
        ${note ? `<em class="muted">${F().esc(note)}</em>` : ''}
      </div>`;
    const toggleBtn = (id, on) => `
      <button
        type="button"
        class="toggle settings-toggle ${on ? 'is-on' : ''}"
        id="${id}"
        role="switch"
        aria-checked="${on ? 'true' : 'false'}"
      >
        <span class="toggle-track"><i class="toggle-knob"></i></span>
      </button>`;
    const demoRows = info.canUseDemo
      ? `<div class="settings-row">
          <div class="settings-row-copy">
            <div class="settings-row-title">${T('settings.demo.show.title')}</div>
            <div class="settings-row-sub muted">${T('settings.demo.show.sub')}</div>
          </div>
          ${toggleBtn('settingsDemoMode', !!info.demoMode)}
        </div>
        <div class="settings-row">
          <div class="settings-row-copy">
            <div class="settings-row-title">${T('settings.demo.reset.title')}</div>
            <div class="settings-row-sub muted">${T('settings.demo.reset.sub')}</div>
          </div>
          <button type="button" class="btn" id="settingsDemoReset" ${
            info.demoMode ? '' : 'disabled'
          }>${T('settings.demo.reset.action')}</button>
        </div>`
      : '';

    return `
      <div class="settings-page">
        <div class="home-hero settings-hero">
          <h1 class="home-greet settings-title">${T('settings.title')}</h1>
        </div>

        <section class="settings-section">
          <header class="settings-section-head">
            <h2>${T('settings.app.title')}</h2>
            <p>${T('settings.app.sub')}</p>
          </header>
          <div class="settings-card settings-stack">
            <div class="settings-row settings-row-wrap">
              <div class="settings-row-copy">
                <div class="settings-row-title">${T('settings.app.period')}</div>
              </div>
              <div class="seg seg--compact" role="group" aria-label="${F().esc(T('settings.app.period'))}" data-thumb-key="settings-period">${periodSeg}</div>
            </div>
            <div class="settings-row">
              <div class="settings-row-copy">
                <div class="settings-row-title">${T('settings.app.hideInactive.title')}</div>
                <div class="settings-row-sub muted">${T('settings.app.hideInactive.sub')}</div>
              </div>
              ${toggleBtn('settingsHideInactive', publishedOnly)}
            </div>
            <div class="settings-row">
              <div class="settings-row-copy">
                <div class="settings-row-title">${T('settings.app.language.title')}</div>
                <div class="settings-row-sub muted">${T('settings.app.language.sub')}</div>
              </div>
              <div id="settingsLangSlot"></div>
            </div>
            <div class="settings-row">
              <div class="settings-row-copy">
                <div class="settings-row-title">${T('settings.app.tour.title')}</div>
                <div class="settings-row-sub muted">${T('settings.app.tour.sub')}</div>
              </div>
              <button type="button" class="btn" id="settingsOnboarding">${T('settings.app.tour.action')}</button>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <header class="settings-section-head">
            <h2>${T('settings.conn.title')}</h2>
            <p>${T('settings.conn.sub')}</p>
          </header>
          <div class="settings-card settings-conn ${connCls}">
            <div class="settings-conn-title">${F().esc(connTitle)}</div>
            <div class="settings-conn-sub muted">${F().esc(T('settings.conn.updated', { when: updatedLabel }))}</div>
          </div>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-copy">
                <div class="settings-row-title">${T('settings.ext.title')}</div>
                <div class="settings-row-sub muted">${T('settings.ext.sub')}</div>
              </div>
              <button type="button" class="btn primary" id="packExt">
                ${ico('download-simple', 15)}
                <span>${T('settings.ext.download')}</span>
              </button>
            </div>
            <div class="settings-checks">
              ${checkRow(hasLink || hasData, T('settings.ext.installed'))}
              ${checkRow(online || hasLink, T('settings.ext.connected'))}
              ${checkRow(hasData, T('settings.ext.collected'))}
            </div>
            <p id="packStatus" class="settings-pack-status muted" hidden></p>
            <div class="settings-card-foot">
              <button type="button" class="settings-link" id="openInstall">${T('settings.ext.guide')}</button>
              <button type="button" class="settings-link" id="openExt">${T('settings.ext.source')}</button>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <header class="settings-section-head">
            <h2>${T('settings.files.title')}</h2>
            <p>${T('settings.files.sub')}</p>
          </header>
          <div class="settings-stats-strip" role="group" aria-label="${F().esc(T('settings.data.title'))}">
            ${statChip(T('settings.data.games'), gamesN)}
            ${statChip(T('settings.data.metrics'), metricsN)}
            ${statChip(T('settings.data.earnings'), earnN)}
            ${statChip(T('settings.data.raw'), rawN, rawNote)}
          </div>
          <div class="settings-card settings-stack">
            <div class="settings-row">
              <div class="settings-row-copy">
                <div class="settings-row-title">${T('settings.export.title')}</div>
                <div class="settings-row-sub muted">${T('settings.export.sub')}</div>
              </div>
              <button type="button" class="btn" id="settingsExport">${T('settings.export.action')}</button>
            </div>
            <div class="settings-row">
              <div class="settings-row-copy">
                <div class="settings-row-title">${T('settings.backup.title')}</div>
                <div class="settings-row-sub muted">${T('settings.backup.sub')}</div>
              </div>
              <div class="settings-actions">
                <button type="button" class="btn" id="backupExport">${T('settings.backup.save')}</button>
                <button type="button" class="btn" id="backupImport">${T('settings.restore.pick')}</button>
              </div>
            </div>
            <p id="backupStatus" class="settings-pack-status muted" hidden></p>
          </div>
        </section>

        <section class="settings-section">
          <header class="settings-section-head">
            <h2>${T('settings.maintain.title')}</h2>
            <p>${T('settings.maintain.sub')}</p>
          </header>
          <div class="settings-card settings-stack">
            <div class="settings-row">
              <div class="settings-row-copy">
                <div class="settings-row-title">${T('settings.reprocess.title')}</div>
                <div class="settings-row-sub muted">${T('settings.reprocess.sub')}</div>
              </div>
              <button type="button" class="btn" id="reprocess">${T('settings.reprocess.action')}</button>
            </div>
            <div class="settings-row">
              <div class="settings-row-copy">
                <div class="settings-row-title">${T('settings.clearRaw.title')}</div>
                <div class="settings-row-sub muted">${T('settings.clearRaw.sub')}</div>
              </div>
              <button type="button" class="btn settings-btn-danger" id="clearRaw">${T('settings.clearRaw.action')}</button>
            </div>
            ${demoRows}
            <button type="button" class="settings-row settings-row-btn" id="toggleDev" aria-expanded="false">
              <div class="settings-row-copy">
                <div class="settings-row-title">${T('settings.dev.title')}</div>
                <div class="settings-row-sub muted">${T('settings.dev.sub')}</div>
              </div>
              <i class="ph ph-caret-right settings-chevron" aria-hidden="true"></i>
            </button>
            <div class="settings-dev" id="settingsDev" hidden>
              <div class="settings-field">
                <div class="settings-row-title">${T('settings.dev.address')}</div>
                <div class="settings-code mono">http://127.0.0.1:${F().esc(
                  String(info.ingestPort || c.ingestPort || 17321)
                )}</div>
              </div>
              <div class="settings-field">
                <div class="settings-row-title">${T('settings.dev.token')}</div>
                <div class="settings-token-row">
                  <div class="settings-code mono settings-token" id="tokenBox" title="${F().esc(T('settings.dev.tokenHidden'))}">${F().esc(
                    tokenMasked
                  )}</div>
                  <button type="button" class="btn" id="copyToken">${T('settings.dev.copy')}</button>
                </div>
              </div>
              <button type="button" class="settings-row settings-row-btn" id="toggleJournal" aria-expanded="false">
                <div class="settings-row-copy">
                  <div class="settings-row-title">${T('settings.dev.journal.title')}</div>
                  <div class="settings-row-sub muted">${T('settings.dev.journal.sub')}</div>
                </div>
                <i class="ph ph-caret-right settings-chevron" aria-hidden="true"></i>
              </button>
              <div class="settings-journal" id="settingsJournal" hidden>
                <div id="diagBody"><div class="muted" style="padding:12px">${T('settings.dev.journal.loading')}</div></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    `;
}
