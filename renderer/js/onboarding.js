(() => {
  const SEEN_KEY = 'nami.onboarded';
  const RESUME_KEY = 'nami.onbResume';
  const POLL_MS = 2500;
  const ico = (name, size = 20) => window.FoundersIcons.svg(name, size);

  let root = null;
  let index = 0;
  let pollTimer = 0;
  let live = { linked: false, hasData: false };

  const node = (i, icon, label, brand) => `
    <div class="onb-node" style="--i:${i}">
      <div class="onb-tile ${brand ? 'is-logo' : ''}">${
        brand ? '<img src="assets/logo.png" alt="" draggable="false" />' : ico(icon, 32)
      }</div>
      <span class="onb-node-label">${label}</span>
    </div>`;

  const arrow = () => `<span class="onb-arrow">${ico('arrow-right', 18)}</span>`;

  const head = (title, sub) => `
    <div class="onb-head">
      <h1 class="onb-title">${title}</h1>
      <p class="onb-sub">${sub}</p>
    </div>`;

  const STEPS = [
    {
      render: () => `
        ${head(T('onboarding.welcome.title'), T('onboarding.welcome.sub'))}
        <div class="onb-flow">
          ${node(0, 'browser', T('onboarding.welcome.cabinet'))}
          ${arrow()}
          ${node(1, '', 'Nami', true)}
        </div>
        <div class="onb-feats">
          <div class="onb-feat">${ico('shield-check', 26)}<b>${T('onboarding.welcome.local.title')}</b><span>${T('onboarding.welcome.local.text')}</span></div>
          <div class="onb-feat">${ico('puzzle-piece', 26)}<b>${T('onboarding.welcome.auto.title')}</b><span>${T('onboarding.welcome.auto.text')}</span></div>
          <div class="onb-feat">${ico('chart-line-up', 26)}<b>${T('onboarding.welcome.portfolio.title')}</b><span>${T('onboarding.welcome.portfolio.text')}</span></div>
        </div>`
    },
    {
      lit: true,
      render: () => `
        ${head(T('onboarding.how.title'), T('onboarding.how.sub'))}
        <div class="onb-flow is-lit">
          ${node(0, 'browser', T('onboarding.how.cabinet'))}
          ${arrow()}
          ${node(1, 'puzzle-piece', T('onboarding.how.extension'))}
          ${arrow()}
          ${node(2, '', 'Nami', true)}
          ${arrow()}
          ${node(3, 'chart-line-up', T('onboarding.how.reports'))}
        </div>
        <p class="onb-note">
          <b>${T('onboarding.how.note.title')}</b>
          ${T('onboarding.how.note.text')}
        </p>`
    },
    {
      render: () => `
        ${head(T('onboarding.install.title'), T('onboarding.install.sub'))}
        <ol class="onb-list">
          <li class="onb-row">
            <span class="onb-num">1</span>
            <span class="onb-row-text">${T('onboarding.install.download.title')}<small id="onbPackStatus">${T('onboarding.install.download.hint')}</small></span>
            <button type="button" class="capsule-btn primary" id="onbPack">${T('onboarding.install.download.action')}</button>
          </li>
          <li class="onb-row">
            <span class="onb-num">2</span>
            <span class="onb-row-text">${T('onboarding.install.open.title')}<small>${T('onboarding.install.open.hint', { url: '<code>chrome://extensions</code>' })}</small></span>
            <button type="button" class="capsule-btn" id="onbCopyExt">${T('onboarding.install.open.action')}</button>
          </li>
          <li class="onb-row">
            <span class="onb-num">3</span>
            <span class="onb-row-text">${T('onboarding.install.load.title')}<small>${T('onboarding.install.load.hint', { folder: '<code>nami-collector</code>' })}</small></span>
            <span></span>
          </li>
        </ol>`
    },
    {
      live: true,
      render: () => `
        ${head(T('onboarding.connect.title'), T('onboarding.connect.sub'))}
        <ol class="onb-list">
          <li class="onb-row" id="onbLinkRow">
            <span class="onb-num">1</span>
            <span class="onb-row-text">${T('onboarding.connect.link.title')}<small id="onbLinkNote">${T('onboarding.connect.link.waiting')}</small></span>
            <i class="onb-tick">${ico('check-circle', 22)}</i>
          </li>
          <li class="onb-row">
            <span class="onb-num">2</span>
            <span class="onb-row-text">${T('onboarding.connect.cabinet.title')}<small>${T('onboarding.connect.cabinet.hint')}</small></span>
            <span></span>
          </li>
          <li class="onb-row" id="onbDataRow">
            <span class="onb-num">3</span>
            <span class="onb-row-text">${T('onboarding.connect.data.title')}<small id="onbDataNote">${T('onboarding.connect.data.waiting')}</small></span>
            <i class="onb-tick">${ico('check-circle', 22)}</i>
          </li>
        </ol>`
    },
    {
      render: () => `
        ${head(T('onboarding.done.title'), T('onboarding.done.sub'))}
        <ul class="onb-tips">
          <li class="onb-tip">${ico('game-controller', 22)}<div><b>${T('onboarding.done.games.title')}</b><span>${T('onboarding.done.games.text')}</span></div></li>
          <li class="onb-tip">${ico('arrows-left-right', 22)}<div><b>${T('onboarding.done.compare.title')}</b><span>${T('onboarding.done.compare.text')}</span></div></li>
          <li class="onb-tip">${ico('gear', 22)}<div><b>${T('onboarding.done.settings.title')}</b><span>${T('onboarding.done.settings.text')}</span></div></li>
        </ul>`
    }
  ];

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch (_) {
      /* ignore */
    }
  }

  function seen() {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch (_) {
      return true;
    }
  }

  function build() {
    const el = document.createElement('div');
    el.className = 'onb';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', T('onboarding.aria'));
    el.hidden = true;
    el.innerHTML = `
      <div class="onb-drag" data-tauri-drag-region></div>
      <div class="onb-top">
        <div class="onb-dots">${STEPS.map(() => '<i class="onb-dot"></i>').join('')}</div>
        <div class="onb-corner">
          <button type="button" class="onb-skip" id="onbSkip">${T('onboarding.skip')}</button>
          <div class="onb-lang" id="onbLang"></div>
        </div>
      </div>
      <div class="onb-stage" id="onbStage"></div>
      <div class="onb-foot">
        <button type="button" class="capsule-btn onb-back" id="onbBack">${T('onboarding.back')}</button>
        <span class="onb-count" id="onbCount"></span>
        <button type="button" class="capsule-btn primary onb-next" id="onbNext">${T('onboarding.next')}</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#onbSkip').onclick = close;
    window.NamiLangPicker.mount(el.querySelector('#onbLang'), {
      onChange: (code) => {
        sessionStorage.setItem(RESUME_KEY, String(index));
        window.NamiI18n.reloadWith(code);
      }
    });
    el.querySelector('#onbBack').onclick = () => go(index - 1);
    el.querySelector('#onbNext').onclick = () => (index === STEPS.length - 1 ? close() : go(index + 1));
    return el;
  }

  function paintLive() {
    const linkRow = root.querySelector('#onbLinkRow');
    const dataRow = root.querySelector('#onbDataRow');
    if (!linkRow || !dataRow) return;
    linkRow.classList.toggle('is-done', live.linked);
    dataRow.classList.toggle('is-done', live.hasData);
    root.querySelector('#onbLinkNote').textContent = live.linked
      ? T('onboarding.connect.link.done')
      : T('onboarding.connect.link.waiting');
    root.querySelector('#onbDataNote').textContent = live.hasData
      ? T('onboarding.connect.data.done')
      : T('onboarding.connect.data.waiting');
  }

  async function pollLive() {
    try {
      const [collector, stats] = await Promise.all([
        window.foundersApi.getCollector(),
        window.foundersApi.getDbStats()
      ]);
      live = {
        linked: Number(collector && collector.lastExtensionConnection) > 0,
        hasData: Number(stats && stats.games) > 0 || Number(stats && stats.rawResponses) > 0
      };
      if (STEPS[index].live && root && !root.hidden) paintLive();
    } catch (_) {
      /* нет IPC — остаются прежние отметки */
    }
  }

  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = 0;
  }

  function bindStep() {
    const stage = root.querySelector('#onbStage');
    const click = (id, fn) => {
      const el = stage.querySelector(id);
      if (el) el.onclick = fn;
    };
    click('#onbPack', async () => {
      const status = stage.querySelector('#onbPackStatus');
      status.textContent = T('onboarding.install.download.busy');
      try {
        const res = await window.foundersApi.packExtension();
        status.textContent =
          res && res.ok
            ? T('onboarding.install.download.done', { path: res.path })
            : T('onboarding.install.download.failed', { error: (res && res.error) || '—' });
      } catch (_) {
        status.textContent = T('onboarding.install.download.error');
      }
    });
    click('#onbCopyExt', async (event) => {
      const btn = event.currentTarget;
      try {
        await navigator.clipboard.writeText('chrome://extensions');
        btn.textContent = T('onboarding.install.open.copied');
      } catch (_) {
        btn.textContent = T('onboarding.install.open.copyFailed');
      }
      setTimeout(() => {
        if (btn.isConnected) btn.textContent = T('onboarding.install.open.action');
      }, 1600);
    });
  }

  function go(next) {
    index = Math.max(0, Math.min(STEPS.length - 1, next));
    const step = STEPS[index];
    const stage = root.querySelector('#onbStage');
    stage.innerHTML = `<div class="onb-step">${step.render()}</div>`;
    root.querySelectorAll('.onb-dot').forEach((dot, i) => {
      dot.classList.toggle('is-active', i === index);
      dot.classList.toggle('is-done', i < index);
    });
    root.querySelector('#onbCount').textContent = T('onboarding.count', { current: index + 1, total: STEPS.length });
    root.querySelector('#onbBack').hidden = index === 0;
    root.querySelector('#onbSkip').hidden = index === STEPS.length - 1;
    root.querySelector('#onbNext').textContent = index === STEPS.length - 1 ? T('onboarding.start') : T('onboarding.next');
    bindStep();
    stopPoll();
    if (step.live) {
      paintLive();
      pollLive();
      pollTimer = setInterval(pollLive, POLL_MS);
    }
  }

  function onKey(event) {
    if (!root || root.hidden) return;
    if (event.key === 'ArrowRight') root.querySelector('#onbNext').click();
    if (event.key === 'ArrowLeft' && index > 0) go(index - 1);
    if (event.key === 'Escape') close();
  }

  function open(startAt = 0) {
    if (!root) {
      root = build();
      document.addEventListener('keydown', onKey);
    }
    live = { linked: false, hasData: false };
    root.hidden = false;
    go(startAt);
    requestAnimationFrame(() => root.classList.add('is-open'));
  }

  function close() {
    markSeen();
    stopPoll();
    if (!root) return;
    root.classList.remove('is-open');
    setTimeout(() => {
      if (root && !root.classList.contains('is-open')) root.hidden = true;
    }, 260);
  }

  window.NamiOnboarding = {
    open,
    maybeOpen() {
      const resume = sessionStorage.getItem(RESUME_KEY);
      sessionStorage.removeItem(RESUME_KEY);
      if (resume !== null) open(Number(resume) || 0);
      else if (!seen()) open();
    }
  };
})();
