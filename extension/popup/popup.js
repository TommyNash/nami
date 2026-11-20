function send(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

function formatEta(ms) {
  if (!ms || ms < 0) return '';
  const sec = Number(ms) / 1000;
  if (sec < 10) return 'почти готово';
  if (sec < 60) return `около ${Math.ceil(sec / 5) * 5} сек`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `около ${min} мин`;
  const rest = min % 60;
  return `около ${Math.floor(min / 60)} ч${rest ? ` ${rest} мин` : ''}`;
}

function formatClock(ts) {
  const at = Number(ts || 0);
  if (!at) return '';
  try {
    return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatAgo(ts) {
  const at = Number(ts || 0);
  if (!at) return null;
  const diff = Date.now() - at;
  if (diff < 0) return 'только что';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 14) return `${days} дн. назад`;
  return new Date(at).toLocaleDateString('ru-RU');
}

const RING = 2 * Math.PI * 62;

const collectPrefs = {
  mode: 'refresh',
  refreshWindow: '7d',
  months: 12,
  delayMs: 700,
  lastFull: null,
  lastCollect: null
};

let staleBuild = false;
let lastPaintKey = '';
let lastEventsKey = '';
let refreshTimer = 0;
let refreshBusy = false;
let refreshQueued = false;

function $(id) {
  return document.getElementById(id);
}

async function detectStaleBuild() {
  try {
    const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    const onDisk = await res.json();
    staleBuild = onDisk.version !== chrome.runtime.getManifest().version;
  } catch {
    staleBuild = false;
  }
}

function openExtensionsPage() {
  return chrome.tabs.create({ url: 'chrome://extensions' });
}

function activeMode() {
  return collectPrefs.mode === 'full' ? 'full' : 'refresh';
}

function setText(el, value) {
  if (!el) return;
  const next = value == null ? '' : String(value);
  if (el.textContent !== next) el.textContent = next;
}

function setHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle('hidden', !!hidden);
}

const THUMB_OUTSET = 2;

function placeThumb(seg) {
  let thumb = seg.querySelector(':scope > .nav-thumb');
  if (!thumb) {
    thumb = document.createElement('i');
    thumb.className = 'nav-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    seg.prepend(thumb);
  }
  const active = seg.querySelector('.seg-btn.active');
  if (!active || !active.offsetWidth) {
    thumb.classList.remove('is-placed');
    return;
  }
  const first = !thumb.classList.contains('is-placed');
  if (first) thumb.style.transition = 'none';
  thumb.style.width = `${active.offsetWidth + THUMB_OUTSET * 2}px`;
  thumb.style.height = `${active.offsetHeight + THUMB_OUTSET * 2}px`;
  thumb.style.transform = `translate(${active.offsetLeft - THUMB_OUTSET}px, ${
    active.offsetTop - THUMB_OUTSET
  }px)`;
  if (first) {
    void thumb.offsetWidth;
    thumb.style.transition = '';
    thumb.classList.add('is-placed');
  }
}

function placeThumbs() {
  document.querySelectorAll('.seg').forEach(placeThumb);
}

function openSheet(id) {
  const el = $(id);
  if (el) el.hidden = false;
  placeThumbs();
}

function closeSheet(id) {
  const el = $(id);
  if (el) el.hidden = true;
}

function syncModeUi() {
  const mode = activeMode();
  document.querySelectorAll('.seg-btn[data-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  setHidden($('refreshOpts'), mode !== 'refresh');
  setHidden($('fullOpts'), mode !== 'full');

  document.querySelectorAll('#refreshOpts .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.window === collectPrefs.refreshWindow);
  });
  document.querySelectorAll('#fullOpts .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.months) === Number(collectPrefs.months));
  });

  setText($('delayValue'), String(collectPrefs.delayMs));
  $('delayMs').value = String(collectPrefs.delayMs);
  placeThumbs();

  if (!$('btnRun').classList.contains('is-running')) {
    paintIdleCopy();
  }
}

function paintIdleCopy() {
  const mode = activeMode();
  if (mode === 'refresh') {
    setText($('runCaption'), 'Обновить данные');
    setText(
      $('runHint'),
      collectPrefs.refreshWindow === 'month' ? 'Свежие данные за текущий месяц' : 'Свежие данные за 7 дней'
    );
  } else {
    setText($('runCaption'), 'Полный сбор');
    setText($('runHint'), `История за ${collectPrefs.months} мес.`);
  }
}

async function loadCollectPrefs() {
  const saved = await chrome.storage.local.get([
    'faCollectMode',
    'faRefreshWindow',
    'faEarnMonths',
    'faLastFullCollect',
    'faLastCollect',
    'faOnlyPublished',
    'faDelayMs'
  ]);
  collectPrefs.lastFull = saved.faLastFullCollect || null;
  collectPrefs.lastCollect = saved.faLastCollect || null;
  if (saved.faRefreshWindow === 'month' || saved.faRefreshWindow === '7d') {
    collectPrefs.refreshWindow = saved.faRefreshWindow;
  }
  const months = Number(saved.faEarnMonths);
  if (Number.isFinite(months) && months >= 1 && months <= 24) {
    collectPrefs.months = months;
  }
  const delay = Number(saved.faDelayMs);
  if (Number.isFinite(delay) && delay >= 600 && delay <= 5000) {
    collectPrefs.delayMs = delay;
  }
  if (saved.faCollectMode === 'full' || saved.faCollectMode === 'refresh') {
    collectPrefs.mode = saved.faCollectMode;
  } else if (collectPrefs.lastFull && collectPrefs.lastFull.at) {
    collectPrefs.mode = 'refresh';
  } else {
    collectPrefs.mode = 'full';
  }
  if (saved.faOnlyPublished !== undefined) {
    setOnlyPublished(Boolean(saved.faOnlyPublished));
  }
  syncModeUi();
}

function onlyPublishedOn() {
  const el = $('onlyPublished');
  return !!(el && el.classList.contains('is-on'));
}

function setOnlyPublished(on) {
  const el = $('onlyPublished');
  if (!el) return;
  el.classList.toggle('is-on', !!on);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

async function persistCollectPrefs() {
  await chrome.storage.local.set({
    faCollectMode: activeMode(),
    faRefreshWindow: collectPrefs.refreshWindow,
    faEarnMonths: Number(collectPrefs.months) || 12,
    faDelayMs: Number(collectPrefs.delayMs) || 700,
    faOnlyPublished: onlyPublishedOn()
  });
}

function collectPayloadExtras() {
  const mode = activeMode();
  if (mode === 'refresh') {
    return {
      collectMode: 'refresh',
      refreshWindow: collectPrefs.refreshWindow === 'month' ? 'month' : '7d',
      earnMonths: collectPrefs.refreshWindow === 'month' ? 1 : 0
    };
  }
  return {
    collectMode: 'full',
    earnMonths: Math.min(24, Math.max(1, Number(collectPrefs.months) || 12))
  };
}

function setRing(pct) {
  const ring = $('runRing');
  if (!ring) return;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  ring.style.strokeDasharray = String(RING);
  ring.style.strokeDashoffset = String(RING - (RING * p) / 100);
}

const STAGE_DEFS = [
  { id: 'games', name: 'Игры и метрики' },
  { id: 'earn', name: 'Доход' },
  { id: 'audience', name: 'Аудитория' },
  { id: 'purchases', name: 'Покупки' }
];

function stageItem(def, progress, reloading) {
  const stages = progress && progress.stages;
  const s = stages && stages[def.id];
  if (!stages) return { id: def.id, name: def.name, state: 'queued', meta: 'в очереди', fill: 0 };
  if (!s || !(s.total > 0)) return { id: def.id, name: def.name, state: 'skipped', meta: '', fill: 0 };

  const fill = Math.min(100, Math.round((s.done / s.total) * 100));
  const count = `${s.done} из ${s.total}`;
  if (s.done >= s.total) return { id: def.id, name: def.name, state: 'done', meta: 'готово', fill: 100 };
  if (reloading) {
    return { id: def.id, name: def.name, state: 'warn', meta: s.done ? `остановлено · ${count}` : 'остановлено', fill };
  }
  if (s.done > 0 || (progress.running && progress.stage === def.id)) {
    return { id: def.id, name: def.name, state: 'active', meta: count, fill };
  }
  return { id: def.id, name: def.name, state: 'queued', meta: 'в очереди', fill: 0 };
}

function taskStateFromProgress(progress) {
  const reloading = !!progress && progress.phase === 'reload';
  const items = STAGE_DEFS.map((def) => stageItem(def, progress, reloading)).filter(
    (item) => item.state !== 'skipped'
  );
  const stages = (progress && progress.stages) || null;
  let done = 0;
  let total = 0;
  if (stages) {
    for (const def of STAGE_DEFS) {
      const s = stages[def.id];
      if (s && s.total > 0) {
        done += Math.min(s.done, s.total);
        total += s.total;
      }
    }
  }
  const stepTotal = Number((progress && progress.total) || 0);
  const work = progress && progress.work;
  const pct =
    work && work.total > 0
      ? Math.min(100, Math.round((work.done / work.total) * 100))
      : total > 0
      ? Math.round((done / total) * 100)
      : stepTotal > 0
        ? Math.min(100, Math.round((Number(progress.step || 0) / stepTotal) * 100))
        : 0;
  return { pct, items };
}

function renderTasks(progress, forceAttention) {
  const host = $('tasks');
  if (!host) return;
  const show = !!(progress && (progress.running || progress.phase === 'reload' || forceAttention));
  setHidden(host, !show);
  if (!show) {
    host.innerHTML = '';
    return;
  }
  const model = taskStateFromProgress(progress);
  const html = model.items
    .map((t) => {
      const cls = [
        'task',
        t.state === 'done' ? 'is-done' : '',
        t.state === 'queued' ? 'is-queued' : '',
        t.state === 'warn' ? 'is-warn' : ''
      ]
        .filter(Boolean)
        .join(' ');
      const meta =
        t.state === 'done' ? `готово <i class="ph ph-check" aria-hidden="true"></i>` : t.meta;
      return `<div class="${cls}" data-task="${t.id}">
        <div class="task-row">
          <span class="task-name">${t.name}</span>
          <span class="task-meta">${meta}</span>
        </div>
        <div class="task-bar"><div class="task-fill" style="width:${Math.max(0, Math.min(100, t.fill))}%"></div></div>
      </div>`;
    })
    .join('');
  if (host.dataset.key !== html) {
    host.dataset.key = html;
    host.innerHTML = html;
  }
  setRing(model.pct);
}

function paintStatus({ mode, text }) {
  const chip = $('statusChip');
  if (!chip) return;
  chip.dataset.mode = mode;
  setText($('statusText'), text);
}

async function refresh() {
  if (refreshBusy) {
    refreshQueued = true;
    return;
  }
  refreshBusy = true;
  try {
    const state = await send('get-state');
    if (!state || !state.ok) return;

    const { stats, settings, events, collecting, autoProgress } = state;
    const connected = Boolean(stats.appConnected);
    const consoleOk = Boolean(stats.consoleDetected);
    const busy = Boolean(autoProgress && autoProgress.running);
    const reloading = autoProgress && autoProgress.phase === 'reload';
    // Кабинет не открыт — главный блокер для старта.
    const consoleBlock = !consoleOk && !busy;
    const needsAttention = staleBuild || consoleBlock;

    const paintKey = [
      staleBuild ? 1 : 0,
      connected ? 1 : 0,
      consoleOk ? 1 : 0,
      busy ? 1 : 0,
      collecting ? 1 : 0,
      autoProgress && autoProgress.phase,
      autoProgress && autoProgress.step,
      autoProgress && autoProgress.total,
      autoProgress && autoProgress.label,
      autoProgress && autoProgress.etaMs,
      collectPrefs.mode,
      collectPrefs.refreshWindow,
      collectPrefs.months,
      collectPrefs.delayMs
    ].join('|');

    if (paintKey === lastPaintKey && !refreshQueued) {
      // Только журнал мог измениться — обновим ниже точечно.
    } else {
      lastPaintKey = paintKey;

      if (busy) {
        paintStatus({ mode: 'busy', text: 'Идёт сбор' });
      } else if (needsAttention) {
        paintStatus({ mode: 'attention', text: 'Нужно внимание' });
      } else if (connected) {
        paintStatus({ mode: 'ok', text: 'Готов' });
      } else {
        paintStatus({ mode: 'attention', text: 'Нужно внимание' });
      }

      const run = $('btnRun');
      const wrap = run && run.closest('.run-wrap');
      if (wrap) wrap.classList.toggle('is-busy', busy || reloading);
      if (run) {
        run.classList.toggle('is-running', busy);
        run.classList.toggle('is-disabled', needsAttention && !busy);
        run.setAttribute('aria-pressed', busy ? 'true' : 'false');
        run.setAttribute('aria-label', busy ? 'Остановить сбор' : 'Обновить данные');
      }

      if (busy) {
        setText($('runCaption'), 'Остановить');
        setText($('runHint'), autoProgress.label || 'Сбор данных');
        const eta = formatEta(autoProgress.etaMs);
        setText($('runEta'), eta.startsWith('около') ? `Осталось ${eta}` : eta);
        setHidden($('runEta'), !eta);
      } else if (needsAttention) {
        setText($('runCaption'), 'Обновить данные');
        setText($('runHint'), staleBuild ? 'Нужно перезагрузить расширение' : 'Нужен открытый кабинет');
        setHidden($('runEta'), true);
        setRing(0);
      } else {
        paintIdleCopy();
        setHidden($('runEta'), true);
        setRing(0);
      }

      setHidden($('attention'), !needsAttention);
      setHidden($('lastCard'), needsAttention || busy || reloading);
      if (staleBuild) {
        setText($('attentionTitle'), 'Расширение обновлено');
        setText(
          $('attentionText'),
          'Перезагрузите его на странице расширений и обновите вкладку кабинета — без этого этапы и экран сбора в приложении не работают'
        );
        setText($('btnAttention'), 'Открыть расширения');
      } else if (consoleBlock) {
        setText($('attentionTitle'), 'Кабинет не открыт');
        setText($('attentionText'), 'Откройте его в браузере, чтобы продолжить');
        setText($('btnAttention'), 'Открыть кабинет');
      }

      const last = collectPrefs.lastCollect || collectPrefs.lastFull;
      if (last && last.at) {
        const clock = formatClock(last.at);
        setText($('lastTitle'), clock ? `Последний сбор в ${clock}` : 'Последний сбор');
        const games =
          last.games != null
            ? `обновлено ${last.games} ${Number(last.games) === 1 ? 'игра' : Number(last.games) < 5 ? 'игры' : 'игр'}`
            : last.mode === 'full'
              ? 'полный сбор'
              : 'обновление';
        const quality =
          last.quality === 'ok'
            ? 'без ошибок'
            : last.quality === 'partial'
              ? 'частично'
              : last.quality === 'fail'
                ? 'с ошибками'
                : '';
        setText($('lastDetail'), [games, quality].filter(Boolean).join(' · '));
        $('lastMark').hidden = last.quality === 'fail';
      } else {
        setText($('lastTitle'), 'Последний сбор');
        setText($('lastDetail'), 'ещё не было');
        $('lastMark').hidden = true;
      }

      $('appDot').className = `dot ${connected ? 'ok' : 'bad'}`;
      $('consoleDot').className = `dot ${consoleOk ? 'ok' : 'bad'}`;
      $('portInput').value = settings.ingestPort || 17321;
      $('tokenInput').value = settings.ingestToken || '';
      setText($('btnPair'), connected ? 'Переподключить' : 'Подключить');
      setText($('btnToggle'), collecting ? 'Пассивный перехват: вкл' : 'Пассивный перехват: выкл');
    }

    const resumeData = await chrome.storage.local.get('faCollectResume');
    const resume = resumeData.faCollectResume;
    renderTasks(autoProgress, consoleBlock && !!(autoProgress && autoProgress.step));

    const hasFails =
      !busy &&
      autoProgress &&
      ((autoProgress.failures && autoProgress.failures.length) ||
        (autoProgress.quality && Number(autoProgress.quality.pendingFails) > 0));
    $('btnRetryFails').disabled = !hasFails;

    const resumeAge = resume ? Date.now() - Number(resume.at || 0) : Infinity;
    const canContinue =
      !busy &&
      resume &&
      resumeAge < 6 * 60 * 60 * 1000 &&
      Array.isArray(resume.doneIds) &&
      (resume.doneIds.length > 0 || resume.earnDaysDone);
    const btnContinue = $('btnContinue');
    btnContinue.disabled = !canContinue;
    btnContinue.textContent = canContinue
      ? `Продолжить · ${resume.doneIds.length} игр`
      : 'Продолжить';

    const eventsKey = (events || [])
      .slice(0, 8)
      .map((ev) => `${ev.at}|${ev.level}|${ev.message}`)
      .join(';');
    if (eventsKey !== lastEventsKey) {
      lastEventsKey = eventsKey;
      $('events').innerHTML = (events || [])
        .slice(0, 12)
        .map((ev) => {
          const time = new Date(ev.at).toLocaleTimeString('ru-RU');
          return `<li class="${ev.level}"><strong>${time}</strong> — ${ev.message}</li>`;
        })
        .join('');
    }
  } finally {
    refreshBusy = false;
    if (refreshQueued) {
      refreshQueued = false;
      queueRefresh(0);
    }
  }
}

function queueRefresh(delay = 120) {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = 0;
    refresh();
  }, delay);
}

function schedulePoll() {
  // Нативный popup Chrome не нужно «таскать» как окно: оставляем лёгкий опрос.
  // Во время сбора — чаще, в покое — редко. Без полного remount DOM.
  const busy = $('btnRun') && $('btnRun').classList.contains('is-running');
  setTimeout(async () => {
    await refresh();
    schedulePoll();
  }, busy ? 1500 : 5000);
}

document.querySelectorAll('.seg-btn[data-mode]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    collectPrefs.mode = btn.dataset.mode === 'full' ? 'full' : 'refresh';
    syncModeUi();
    await persistCollectPrefs();
    lastPaintKey = '';
    await refresh();
  });
});

document.querySelectorAll('#refreshOpts .seg-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    collectPrefs.refreshWindow = btn.dataset.window === 'month' ? 'month' : '7d';
    collectPrefs.mode = 'refresh';
    syncModeUi();
    await persistCollectPrefs();
    lastPaintKey = '';
    await refresh();
  });
});

document.querySelectorAll('#fullOpts .seg-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    collectPrefs.months = Number(btn.dataset.months) || 12;
    collectPrefs.mode = 'full';
    syncModeUi();
    await persistCollectPrefs();
    lastPaintKey = '';
    await refresh();
  });
});

function bumpDelay(delta) {
  const next = Math.min(5000, Math.max(600, Number(collectPrefs.delayMs || 700) + delta));
  collectPrefs.delayMs = next;
  syncModeUi();
  persistCollectPrefs();
}

$('delayMinus').addEventListener('click', () => bumpDelay(-100));
$('delayPlus').addEventListener('click', () => bumpDelay(100));

$('btnSettings').addEventListener('click', () => openSheet('settingsSheet'));
$('btnCloseSettings').addEventListener('click', () => closeSheet('settingsSheet'));
$('btnDoneSettings').addEventListener('click', async () => {
  await persistCollectPrefs();
  closeSheet('settingsSheet');
  lastPaintKey = '';
  await refresh();
});
$('btnLog').addEventListener('click', () => openSheet('logSheet'));
$('btnCloseLog').addEventListener('click', () => closeSheet('logSheet'));

async function pairApp() {
  const port = Number($('portInput').value || 17321);
  const result = await send('pair-app', { port });
  if (!result || !result.ok) {
    alert('Не удалось найти приложение Nami.\nЗапустите приложение и попробуйте снова.');
  }
  lastPaintKey = '';
  await refresh();
}

$('btnConnect').addEventListener('click', pairApp);
$('btnPair').addEventListener('click', pairApp);

async function openConsole() {
  await chrome.tabs.create({ url: 'https://games.yandex.ru/console/applications' });
}
$('btnOpenConsole').addEventListener('click', openConsole);
$('btnOpenConsole2').addEventListener('click', openConsole);
$('btnAttention').addEventListener('click', () => (staleBuild ? openExtensionsPage() : openConsole()));

$('btnSend').addEventListener('click', async () => {
  await send('flush-queue');
  lastPaintKey = '';
  await refresh();
});

$('btnToggle').addEventListener('click', async () => {
  const state = await send('get-state');
  const next = !(state && state.collecting !== false);
  await send('set-collecting', next);
  lastPaintKey = '';
  await refresh();
});

$('btnRun').addEventListener('click', async () => {
  const state = await send('get-state');
  const busy = Boolean(state && state.autoProgress && state.autoProgress.running);
  if (busy) {
    await send('stop-auto-collect');
    lastPaintKey = '';
    await refresh();
    return;
  }
  if (staleBuild) {
    openExtensionsPage();
    return;
  }
  if (!(state && state.stats && state.stats.consoleDetected)) {
    openConsole();
    return;
  }
  const mobileSlice = $('platformSelect').value || '__total__';
  const delayMs = Number(collectPrefs.delayMs || 700);
  const onlyPublished = onlyPublishedOn();
  await persistCollectPrefs();
  const result = await send('start-auto-collect', {
    delayMs,
    includeEarnings: true,
    mobileSlice,
    onlyPublished,
    ...collectPayloadExtras()
  });
  if (!result || !result.ok) {
    alert('Откройте вкладку кабинета Яндекс Игр (любая страница /console) и нажмите снова.');
  }
  lastPaintKey = '';
  await refresh();
});

$('btnContinue').addEventListener('click', async () => {
  const delayMs = Number(collectPrefs.delayMs || 700);
  const onlyPublished = onlyPublishedOn();
  const result = await send('start-auto-collect', {
    delayMs,
    includeEarnings: true,
    onlyPublished,
    continueFromResume: true,
    ...collectPayloadExtras()
  });
  if (!result || !result.ok) {
    alert('Откройте вкладку кабинета Яндекс Игр и нажмите снова.');
  }
  lastPaintKey = '';
  await refresh();
});

$('btnRetryFails').addEventListener('click', async () => {
  const state = await send('get-state');
  const failures = (state && state.autoProgress && state.autoProgress.failures) || [];
  if (!failures.length) {
    alert('Нет сохранённых ошибок для повтора.');
    return;
  }
  const delayMs = Math.max(Number(collectPrefs.delayMs || 700), 1600);
  const result = await send('start-auto-collect', {
    delayMs,
    replayOnly: true,
    failures
  });
  if (!result || !result.ok) {
    alert('Откройте вкладку кабинета и нажмите снова.');
  }
  lastPaintKey = '';
  await refresh();
});

$('onlyPublished').addEventListener('click', async () => {
  setOnlyPublished(!onlyPublishedOn());
  await persistCollectPrefs();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (
    changes.autoProgress ||
    changes.stats ||
    changes.events ||
    changes.faLastCollect ||
    changes.faLastFullCollect ||
    changes.faCollectResume
  ) {
    if (changes.faLastCollect) collectPrefs.lastCollect = changes.faLastCollect.newValue || null;
    if (changes.faLastFullCollect) collectPrefs.lastFull = changes.faLastFullCollect.newValue || null;
    queueRefresh(80);
  }
});

loadCollectPrefs().then(async () => {
  await detectStaleBuild();
  $('runRing').style.strokeDasharray = String(RING);
  $('runRing').style.strokeDashoffset = String(RING);
  await refresh();
  schedulePoll();
});
