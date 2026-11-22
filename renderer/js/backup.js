(function () {
  const PREF_PREFIX = 'fa.';

  function collectPrefs() {
    const prefs = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREF_PREFIX)) prefs[key] = localStorage.getItem(key);
    }
    return JSON.stringify(prefs);
  }

  function applyPrefs(json) {
    if (!json) return;
    let prefs;
    try {
      prefs = JSON.parse(json);
    } catch (_) {
      return;
    }
    Object.keys(prefs).forEach((key) => {
      if (key.startsWith(PREF_PREFIX) && typeof prefs[key] === 'string') {
        localStorage.setItem(key, prefs[key]);
      }
    });
  }

  function errorText(err) {
    return typeof err === 'string' ? err : (err && err.message) || T('backup.unknownError');
  }

  function sizeText(bytes) {
    const mb = Number(bytes) / (1024 * 1024);
    return mb >= 1
      ? T('backup.size.mb', { value: mb.toFixed(mb >= 100 ? 0 : 1) })
      : T('backup.size.kb', { value: Math.max(1, Math.round(mb * 1024)) });
  }

  function dateText(ts) {
    if (!ts) return T('backup.dateUnknown');
    return new Date(Number(ts)).toLocaleString(window.NamiI18n.locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function confirmText(info) {
    const num = (n) => window.FoundersFormat.num(Number(n) || 0, 0);
    const version = info.appVersion ? T('backup.confirm.version', { version: info.appVersion }) : '';
    return [
      T('backup.confirm.title', { date: dateText(info.createdAt), version }),
      T('backup.confirm.counts', {
        games: num(info.games),
        earnings: num(info.earnings),
        raw: num(info.rawResponses)
      }),
      '',
      T('backup.confirm.warning'),
      T('backup.confirm.question')
    ].join('\n');
  }

  function bind(root) {
    const exportBtn = root.querySelector('#backupExport');
    const importBtn = root.querySelector('#backupImport');
    const status = root.querySelector('#backupStatus');
    if (!exportBtn || !importBtn) return;
    const svc = window.NamiServices.settings;

    const say = (text) => {
      status.hidden = !text;
      status.textContent = text || '';
    };
    const lock = (busyBtn, label) => {
      exportBtn.disabled = true;
      importBtn.disabled = true;
      const prev = busyBtn.textContent;
      busyBtn.textContent = label;
      return () => {
        exportBtn.disabled = false;
        importBtn.disabled = false;
        busyBtn.textContent = prev;
      };
    };

    exportBtn.onclick = async () => {
      say('');
      const unlock = lock(exportBtn, T('backup.saving'));
      try {
        const res = await api.exportBackup(collectPrefs());
        if (res && res.ok) say(T('backup.saved', { path: res.path, size: sizeText(res.size) }));
      } catch (err) {
        console.warn('[backup] export:', err);
        say(T('backup.saveFailed', { error: errorText(err) }));
      } finally {
        if (exportBtn.isConnected) unlock();
      }
    };

    importBtn.onclick = async () => {
      say('');
      const unlock = lock(importBtn, T('backup.checking'));
      try {
        const picked = await svc.pickBackup();
        if (!picked || !picked.ok) return;
        if (!confirm(confirmText(picked.info))) {
          await svc.importBackup(false);
          return;
        }
        importBtn.textContent = T('backup.restoring');
        const res = await svc.importBackup(true);
        applyPrefs(res.uiPrefs);
        sessionStorage.setItem('nami.skipSplash', '1');
        window.location.reload();
      } catch (err) {
        console.warn('[backup] import:', err);
        say(T('backup.restoreFailed', { error: errorText(err) }));
      } finally {
        if (importBtn.isConnected) unlock();
      }
    };
  }

  window.NamiBackup = { bind };
})();
