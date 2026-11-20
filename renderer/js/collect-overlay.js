(() => {
  const STAGES = ['earn', 'games', 'purchases', 'audience'];
  const RING_LENGTH = 2 * Math.PI * 50;
  const STALE_MS = 25000;
  const BLOCKED_PARTS = ['.topchrome', '.main', '.dock-wrap'];

  let els = null;
  let blocking = false;
  let lastAt = 0;
  let watchdog = 0;
  let hideTimer = 0;
  let handlers = { onStart: null, onEnd: null };

  function collectEls() {
    const root = document.getElementById('collectOverlay');
    if (!root) return null;
    const stageEls = {};
    root.querySelectorAll('[data-stage]').forEach((li) => {
      stageEls[li.dataset.stage] = li;
    });
    return {
      root,
      ring: root.querySelector('.collect-ring-fill'),
      value: root.querySelector('.collect-ring-value'),
      sub: root.querySelector('.collect-sub'),
      eta: root.querySelector('.collect-eta'),
      stages: stageEls
    };
  }

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function formatEta(ms) {
    const sec = Number(ms) / 1000;
    if (!Number.isFinite(sec) || sec <= 0) return '';
    if (sec < 10) return T('collect.eta.almost');
    if (sec < 60) return T('collect.eta.seconds', { n: Math.ceil(sec / 5) * 5 });
    const min = Math.ceil(sec / 60);
    if (min < 60) return T('collect.eta.minutes', { n: min });
    const hours = Math.floor(min / 60);
    const rest = min % 60;
    return rest
      ? T('collect.eta.hoursMinutes', { hours, minutes: rest })
      : T('collect.eta.hours', { hours });
  }

  function isActive(progress) {
    return !!progress && (progress.running === true || progress.phase === 'reload');
  }

  function percentOf(progress) {
    const work = progress.work;
    if (work && work.total > 0) return Math.min(99, Math.round((work.done / work.total) * 100));
    const stages = progress.stages;
    if (stages) {
      let done = 0;
      let total = 0;
      for (const id of STAGES) {
        const s = stages[id];
        if (s && s.total > 0) {
          done += Math.min(s.done, s.total);
          total += s.total;
        }
      }
      if (total > 0) return Math.min(99, Math.round((done / total) * 100));
    }
    const total = Number(progress.total) || 0;
    return total > 0 ? Math.min(99, Math.round((Number(progress.step) / total) * 100)) : 0;
  }

  function stageState(id, progress) {
    const s = progress.stages && progress.stages[id];
    if (!progress.stages) return 'queued';
    if (!s || !(s.total > 0)) return 'skipped';
    if (s.done >= s.total) return 'done';
    if (s.done > 0 || progress.stage === id) return 'active';
    return 'queued';
  }

  function subText(progress) {
    if (progress.phase === 'reload') return T('collect.sessionExpired');
    const id = progress.stage;
    const s = id && progress.stages && progress.stages[id];
    if (s && s.total > 0) return T('collect.stageProgress', { stage: T(`collect.stage.${id}`), current: Math.min(s.done + 1, s.total), total: s.total });
    return progress.label || T('collect.preparing');
  }

  function paint(progress) {
    const pct = percentOf(progress);
    els.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - pct / 100));
    setText(els.value, `${pct}%`);
    setText(els.sub, subText(progress));
    setText(els.eta, formatEta(progress.etaMs));
    for (const id of STAGES) {
      const li = els.stages[id];
      if (!li) continue;
      const state = stageState(id, progress);
      li.classList.toggle('is-done', state === 'done');
      li.classList.toggle('is-queued', state === 'queued');
      li.classList.toggle('is-skipped', state === 'skipped');
    }
  }

  function setInert(on) {
    for (const selector of BLOCKED_PARTS) {
      const node = document.querySelector(selector);
      if (node) node.toggleAttribute('inert', on);
    }
  }

  function show() {
    clearTimeout(hideTimer);
    els.root.hidden = false;
    requestAnimationFrame(() => els.root.classList.add('is-open'));
    setInert(true);
    watchdog = setInterval(() => {
      if (blocking && Date.now() - lastAt > STALE_MS) finish();
    }, 2000);
  }

  function hide() {
    clearInterval(watchdog);
    watchdog = 0;
    els.root.classList.remove('is-open');
    setInert(false);
    hideTimer = setTimeout(() => {
      if (!blocking) els.root.hidden = true;
    }, 220);
  }

  function finish() {
    if (!blocking) return;
    blocking = false;
    hide();
    if (handlers.onEnd) handlers.onEnd();
  }

  function update(progress) {
    if (!progress) return;
    if (!els) els = collectEls();
    if (!els) return;
    lastAt = Date.now();
    if (!isActive(progress)) {
      finish();
      return;
    }
    paint(progress);
    if (!blocking) {
      blocking = true;
      show();
      if (handlers.onStart) handlers.onStart();
    }
  }

  window.FoundersCollect = {
    update,
    isBlocking: () => blocking,
    configure(next) {
      handlers = { ...handlers, ...next };
    }
  };
})();
