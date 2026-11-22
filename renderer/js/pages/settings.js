async function renderSettingsPage(root, data) {
    const info = data.info || (await window.NamiServices.app.info());
    const c = data.collector || (await window.NamiServices.app.collector());
    const stats = await window.NamiServices.app.stats();
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
    root.innerHTML = settingsPageHtml({ info, c, online, hasLink, gamesN, metricsN, earnN, rawN, rawPending, hasData, publishedOnly, periodId, updatedLabel, connTitle, connCls });

    const packStatus = root.querySelector('#packStatus');
    root.querySelector('#packExt').onclick = async () => {
      if (packStatus) {
        packStatus.hidden = false;
        packStatus.textContent = T('settings.ext.packing');
      }
      const res = await window.NamiServices.settings.packExtension();
      if (packStatus) {
        packStatus.textContent = res.ok
          ? T('settings.ext.packed', { path: res.path })
          : T('settings.ext.packFailed', { error: res.error || '—' });
      }
    };
    root.querySelector('#settingsOnboarding').onclick = () => window.NamiOnboarding.open();
    root.querySelector('#openInstall').onclick = () => window.NamiServices.settings.openExtensionInstall();
    root.querySelector('#openExt').onclick = () => window.NamiServices.settings.openExtensionFolder();

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
        const res = await window.NamiServices.app.reprocess(true);
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
      await window.NamiServices.app.clearRaw();
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
          await window.NamiServices.settings.demoSet(next);
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
          await window.NamiServices.settings.demoReset();
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
          const rows = await window.NamiServices.app.listRaw({ limit: 50 });
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
