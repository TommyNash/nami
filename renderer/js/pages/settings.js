async function renderSettingsPage(root, data) {
    const info = data.info || (await window.foundersApi.getInfo());
    const c = data.collector || (await window.foundersApi.getCollector());
    const stats = await window.foundersApi.getDbStats();
    const app = window.FoundersApp;
    const online = !!(
      app &&
      app.state &&
      Number(c.lastExtensionConnection) > 0 &&
      Date.now() - Number(c.lastExtensionConnection) < 5 * 60 * 1000
    );
    const hasLink = Number(c.lastExtensionConnection) > 0;
    const gamesN = Number(stats.games) || 0;
    const metricsN = Number(stats.metrics) || 0;
    const earnN = Number(stats.earnings) || 0;
    const rawN = Number(stats.rawResponses) || 0;
    const rawPending = Number(stats.rawPending) || 0;
    const hasData = rawN > 0 || gamesN > 0;
    const publishedOnly = !!(app && app.state && app.state.gamesPublishedOnly);
    const period = (app && app.state && app.state.period) || 'month';
    const periodId = String(period).startsWith('m:') ? 'month' : period;
    const updatedLabel = formatSettingsWhen(
      c.lastExtensionConnection || (data.freshness && data.freshness.lastUpdatedAt)
    );
    const connTitle = online
      ? T('settings.conn.online')
      : hasData
        ? T('settings.conn.offline')
        : T('settings.conn.waiting');
    const connCls = online ? 'is-ok' : hasData ? 'is-off' : 'is-wait';
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

    root.innerHTML = `
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

    const packStatus = root.querySelector('#packStatus');
    root.querySelector('#packExt').onclick = async () => {
      if (packStatus) {
        packStatus.hidden = false;
        packStatus.textContent = T('settings.ext.packing');
      }
      const res = await window.foundersApi.packExtension();
      if (packStatus) {
        packStatus.textContent = res.ok
          ? T('settings.ext.packed', { path: res.path })
          : T('settings.ext.packFailed', { error: res.error || '—' });
      }
    };
    root.querySelector('#settingsOnboarding').onclick = () => window.NamiOnboarding.open();
    root.querySelector('#openInstall').onclick = () => window.foundersApi.openExtensionInstall();
    root.querySelector('#openExt').onclick = () => window.foundersApi.openExtensionFolder();

    const copyBtn = root.querySelector('#copyToken');
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(info.ingestToken || '');
        copyBtn.textContent = T('settings.dev.copied');
        setTimeout(() => {
          if (copyBtn.isConnected) copyBtn.textContent = T('settings.dev.copy');
        }, 1600);
      } catch (_) {
        copyBtn.textContent = T('settings.dev.copyFailed');
      }
    };

    root.querySelector('#reprocess').onclick = async () => {
      const btn = root.querySelector('#reprocess');
      btn.disabled = true;
      btn.textContent = T('settings.reprocess.busy');
      try {
        const res = await window.foundersApi.reprocess(true);
        const total = res && res.total != null ? res.total : '—';
        const ok = res && res.normalized != null ? res.normalized : '—';
        const failed = res && res.failed != null ? res.failed : '—';
        alert(T('settings.reprocess.result', { ok, total, failed }));
        window.FoundersPages.invalidateModels();
        window.FoundersApp.refresh({ force: true });
      } finally {
        if (btn.isConnected) {
          btn.disabled = false;
          btn.textContent = T('settings.reprocess.action');
        }
      }
    };

    const exportBtn = root.querySelector('#settingsExport');
    exportBtn.onclick = () => {
      if (window.FoundersExport) window.FoundersExport.open(exportBtn, () => portfolioExportSpec());
    };

    window.NamiBackup.bind(root);
    window.NamiLangPicker.mount(root.querySelector('#settingsLangSlot'));

    root.querySelector('#clearRaw').onclick = async () => {
      if (!confirm(T('settings.clearRaw.confirm'))) return;
      await window.foundersApi.clearRaw();
      window.FoundersApp.refresh({ force: true });
    };

    root.querySelectorAll('[data-settings-period]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.settingsPeriod;
        if (!id || !window.FoundersApp) return;
        window.FoundersApp.setPeriodQuiet(id);
        const seg = btn.closest('.seg');
        seg.querySelectorAll('[data-settings-period]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        window.FoundersMotion.flush(seg);
      };
    });

    const hideBtn = root.querySelector('#settingsHideInactive');
    if (hideBtn) {
      hideBtn.onclick = () => {
        const next = !window.FoundersApp.state.gamesPublishedOnly;
        window.FoundersApp.setPublishedOnly(next);
        hideBtn.classList.toggle('is-on', next);
        hideBtn.setAttribute('aria-checked', next ? 'true' : 'false');
      };
    }

    const demoBtn = root.querySelector('#settingsDemoMode');
    if (demoBtn) {
      demoBtn.onclick = async () => {
        const next = !demoBtn.classList.contains('is-on');
        demoBtn.disabled = true;
        try {
          await window.foundersApi.setDemoMode(next);
          if (window.FoundersPages && window.FoundersPages.invalidateModels) {
            window.FoundersPages.invalidateModels();
          }
          if (window.FoundersApp) {
            window.FoundersApp.state.demoMode = next;
            window.FoundersApp.state.info = {
              ...(window.FoundersApp.state.info || {}),
              demoMode: next,
              canUseDemo: true
            };
            await window.FoundersApp.refresh({ force: true, skeleton: true });
          }
        } catch (err) {
          console.warn('[demo] set_demo_mode:', err);
          alert(err && err.message ? err.message : T('settings.demo.switchFailed'));
        } finally {
          if (demoBtn.isConnected) demoBtn.disabled = false;
        }
      };
    }
    const demoReset = root.querySelector('#settingsDemoReset');
    if (demoReset) {
      demoReset.onclick = async () => {
        if (!confirm(T('settings.demo.reset.confirm'))) return;
        demoReset.disabled = true;
        try {
          await window.foundersApi.resetDemoData();
          if (window.FoundersPages && window.FoundersPages.invalidateModels) {
            window.FoundersPages.invalidateModels();
          }
          if (window.FoundersApp) await window.FoundersApp.refresh({ force: true });
        } catch (err) {
          console.warn('[demo] reset:', err);
          alert(err && err.message ? err.message : T('settings.demo.reset.failed'));
        } finally {
          if (demoReset.isConnected) demoReset.disabled = false;
        }
      };
    }

    const dev = root.querySelector('#settingsDev');
    const toggleDev = root.querySelector('#toggleDev');
    toggleDev.onclick = () => {
      const open = dev.hidden;
      dev.hidden = !open;
      toggleDev.classList.toggle('is-open', open);
      toggleDev.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    const journal = root.querySelector('#settingsJournal');
    const toggleJournal = root.querySelector('#toggleJournal');
    let journalLoaded = false;
    toggleJournal.onclick = async () => {
      const open = journal.hidden;
      journal.hidden = !open;
      toggleJournal.classList.toggle('is-open', open);
      toggleJournal.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && !journalLoaded) {
        journalLoaded = true;
        const el = root.querySelector('#diagBody');
        try {
          const rows = await window.foundersApi.listRaw({ limit: 50 });
          el.innerHTML = rows.length
            ? `<table class="settings-journal-table"><thead><tr><th>${T('settings.dev.journal.time')}</th><th>${T('settings.dev.journal.path')}</th><th>${T('settings.dev.journal.game')}</th></tr></thead>
                <tbody>${rows
                  .map(
                    (r) =>
                      `<tr><td>${F().time(r.captured_at)}</td><td class="mono">${F().esc(
                        r.pathname
                      )}</td><td class="mono">${F().esc(r.game_id || '—')}</td></tr>`
                  )
                  .join('')}</tbody></table>`
            : `<div class="muted" style="padding:12px">${T('settings.dev.journal.empty')}</div>`;
        } catch (_) {
          el.innerHTML = `<div class="muted" style="padding:12px">${T('settings.dev.journal.failed')}</div>`;
        }
      }
    };
}

async function renderCollectorPage(root, data) {
  return renderSettingsPage(root, data);
}

function formatSettingsWhen(ts) {
  if (!ts) return '—';
  try {
    return new Date(Number(ts) || ts).toLocaleString(window.NamiI18n.locale, {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_) {
    return '—';
  }
}

function maskIngestToken(token) {
  const s = String(token || '');
  if (!s) return '—';
  if (s.length <= 10) return '••••••••••••';
  return `${s.slice(0, 4)}${'•'.repeat(16)}${s.slice(-4)}`;
}
