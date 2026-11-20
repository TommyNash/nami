import { DEFAULT_INGEST, STORAGE_KEYS, MAX_QUEUE, MAX_EVENTS, MAX_BODY_CHARS } from '../shared/constants.js';
import { classifyPath, extractGameId, extractGameIdFromTabUrl, shouldIgnore } from '../shared/classify.js';
import { sanitizeJsonText } from '../shared/sanitize.js';

const defaultSettings = {
  ingestHost: DEFAULT_INGEST.host,
  ingestPort: DEFAULT_INGEST.port,
  ingestToken: '',
  autoSend: true
};

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...defaultSettings, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
}

async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

async function getStats() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  return (
    data[STORAGE_KEYS.STATS] || {
      detectedRequests: 0,
      processedResponses: 0,
      sentOk: 0,
      sendErrors: 0,
      categories: {},
      currentGameId: null,
      currentGameTitle: null,
      consoleDetected: false,
      lastCaptureAt: null,
      lastSendAt: null,
      appConnected: false,
      lastAppCheckAt: null
    }
  );
}

async function setStats(patch) {
  const current = await getStats();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: next });
  return next;
}

async function pushEvent(level, message, extra) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.EVENTS);
  const events = data[STORAGE_KEYS.EVENTS] || [];
  events.unshift({
    at: Date.now(),
    level,
    message,
    extra: extra || null
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.EVENTS]: events.slice(0, MAX_EVENTS) });
}

async function getQueue() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.QUEUE);
  return data[STORAGE_KEYS.QUEUE] || [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [STORAGE_KEYS.QUEUE]: queue.slice(0, MAX_QUEUE) });
}

function digest(parts) {
  const text = parts.join('|');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildEvent(payload, tabUrl) {
  if (!payload || shouldIgnore(payload.url || '')) return null;

  const pathname = payload.pathname || '';
  const category = classifyPath(pathname);
  if (!category) return null;

  if (!String(payload.contentType || '').includes('json') && !(payload.responseBody || '').trim().startsWith('{')) {
    return null;
  }

  let requestBodySanitized = null;
  if (payload.requestBody && typeof payload.requestBody === 'string') {
    const req = sanitizeJsonText(payload.requestBody, 100000);
    requestBodySanitized = req.ok ? req.body : { rawPreview: String(payload.requestBody).slice(0, 2000) };
  }

  // POST analytics/in-app кладут game_id в JSON body — без этого ряды остаются только у открытой игры.
  let gameIdFromBody = null;
  if (requestBodySanitized && typeof requestBodySanitized === 'object') {
    const rawId =
      requestBodySanitized.game_id ?? requestBodySanitized.gameId ?? requestBodySanitized.appId ?? null;
    if (rawId != null && String(rawId).trim()) gameIdFromBody = String(rawId);
  }

  const gameId =
    extractGameId(payload.url, pathname, payload.search) ||
    gameIdFromBody ||
    extractGameIdFromTabUrl(tabUrl || payload.pageUrl);

  const sanitized = sanitizeJsonText(payload.responseBody || '', MAX_BODY_CHARS);
  if (!sanitized.ok) {
    return null;
  }

  const bodyHash = digest([JSON.stringify(sanitized.body).slice(0, 50000)]);
  const dedupeKey = digest([
    payload.method || 'GET',
    pathname,
    (payload.search || '').replace(/game_id=\d+/g, 'game_id=ID').replace(/appId=\d+/g, 'appId=ID'),
    String(gameId || ''),
    bodyHash,
    new Date().toISOString().slice(0, 10)
  ]);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dedupeKey,
    capturedAt: payload.capturedAt || Date.now(),
    method: payload.method || 'GET',
    url: payload.url,
    pathname,
    search: payload.search || '',
    status: payload.status,
    contentType: payload.contentType || '',
    durationMs: payload.durationMs || null,
    category,
    gameId,
    pageUrl: payload.pageUrl || tabUrl || null,
    transport: payload.sourceTransport || 'unknown',
    requestBody: requestBodySanitized,
    body: sanitized.body,
    truncated: Boolean(sanitized.truncated),
    schemaVersion: 1
  };
}

async function ingestUrl(settings) {
  return `http://${settings.ingestHost}:${settings.ingestPort}${DEFAULT_INGEST.path}`;
}

async function pairWithApp(portOverride) {
  const settings = await getSettings();
  const port = Number(portOverride || settings.ingestPort || DEFAULT_INGEST.port);
  const host = settings.ingestHost || DEFAULT_INGEST.host;
  try {
    const res = await fetch(`http://${host}:${port}/pair`, { method: 'GET' });
    if (!res.ok) throw new Error(`pair ${res.status}`);
    const json = await res.json();
    const next = await setSettings({
      ingestHost: host,
      ingestPort: port,
      ingestToken: json.token || settings.ingestToken || '',
      autoSend: true
    });
    await setStats({ appConnected: true, lastAppCheckAt: Date.now() });
    await pushEvent('info', 'Приложение подключено автоматически');
    return { ok: true, settings: next };
  } catch (err) {
    await setStats({ appConnected: false, lastAppCheckAt: Date.now() });
    return { ok: false, error: String(err.message || err) };
  }
}

async function checkAppConnection() {
  const settings = await getSettings();
  try {
    const res = await fetch(`http://${settings.ingestHost}:${settings.ingestPort}/health`, {
      method: 'GET'
    });
    if (!res.ok) throw new Error(`health ${res.status}`);
    // If we don't have a token yet, pair immediately.
    if (!settings.ingestToken) {
      return (await pairWithApp()).ok;
    }
    await setStats({ appConnected: true, lastAppCheckAt: Date.now() });
    return true;
  } catch {
    await setStats({ appConnected: false, lastAppCheckAt: Date.now() });
    return false;
  }
}

async function sendBatch(events) {
  if (!events.length) return { ok: true, accepted: 0 };
  const settings = await getSettings();
  const url = await ingestUrl(settings);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(settings.ingestToken ? { 'x-founders-token': settings.ingestToken } : {})
    },
    body: JSON.stringify({
      source: 'nami-collector',
      schemaVersion: 1,
      events
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ingest ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json().catch(() => ({}));
  await setStats({ lastSendAt: Date.now(), appConnected: true, lastAppCheckAt: Date.now() });
  return { ok: true, accepted: json.accepted || events.length, duplicates: json.duplicates || 0 };
}

const PROGRESS_THROTTLE_MS = 700;
let progressSentAt = 0;
let progressTimer = null;
let progressLatest = null;

async function postProgress(progress) {
  const settings = await getSettings();
  if (!settings.ingestToken) return;
  const quality = progress.quality || {};
  await fetch(`http://${settings.ingestHost}:${settings.ingestPort}/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-founders-token': settings.ingestToken },
    body: JSON.stringify({
      source: 'nami-collector',
      progress: {
        running: Boolean(progress.running),
        phase: progress.phase || '',
        label: progress.label || '',
        detail: progress.detail || '',
        step: progress.step || 0,
        total: progress.total || 0,
        etaMs: progress.etaMs || 0,
        stage: progress.stage || null,
        stages: progress.stages || null,
        work: progress.work || null,
        grade: quality.grade || null,
        pendingFails: quality.pendingFails || 0,
        at: progress.at || Date.now()
      }
    })
  });
}

function flushProgress() {
  progressTimer = null;
  const progress = progressLatest;
  progressLatest = null;
  if (!progress) return;
  progressSentAt = Date.now();
  postProgress(progress).catch(() => {});
}

/** Прогресс сбора уходит в приложение не чаще раза в 700 мс; финал и остановка — сразу. */
function forwardProgress(progress) {
  progressLatest = progress;
  if (!progress.running && progress.phase !== 'reload') {
    clearTimeout(progressTimer);
    flushProgress();
    return;
  }
  if (progressTimer) return;
  const wait = Math.max(0, PROGRESS_THROTTLE_MS - (Date.now() - progressSentAt));
  progressTimer = setTimeout(flushProgress, wait);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEYS.AUTO_PROGRESS]) return;
  const next = changes[STORAGE_KEYS.AUTO_PROGRESS].newValue;
  if (next) forwardProgress(next);
});

async function flushQueue() {
  const queue = await getQueue();
  if (!queue.length) return { ok: true, sent: 0 };

  try {
    const result = await sendBatch(queue);
    await setQueue([]);
    const stats = await getStats();
    await setStats({ sentOk: (stats.sentOk || 0) + (result.accepted || 0) });
    await pushEvent('info', `Отправлено ${result.accepted} событий`, result);
    return { ok: true, sent: result.accepted || 0 };
  } catch (err) {
    const stats = await getStats();
    await setStats({ sendErrors: (stats.sendErrors || 0) + 1, appConnected: false });
    await pushEvent('error', `Ошибка отправки: ${err.message || err}`);
    return { ok: false, error: String(err.message || err) };
  }
}

async function enqueueOrSend(event) {
  const collecting = (await chrome.storage.local.get(STORAGE_KEYS.COLLECTING))[STORAGE_KEYS.COLLECTING];
  if (collecting === false) {
    await pushEvent('debug', 'Сбор выключен, событие пропущено', { pathname: event.pathname });
    return;
  }

  const stats = await getStats();
  const categories = { ...(stats.categories || {}) };
  categories[event.category] = (categories[event.category] || 0) + 1;

  await setStats({
    detectedRequests: (stats.detectedRequests || 0) + 1,
    processedResponses: (stats.processedResponses || 0) + 1,
    categories,
    currentGameId: event.gameId || stats.currentGameId,
    lastCaptureAt: Date.now(),
    consoleDetected: true
  });

  const settings = await getSettings();
  if (settings.autoSend) {
    try {
      await sendBatch([event]);
      await setStats({
        sentOk: ((await getStats()).sentOk || 0) + 1,
        lastSendAt: Date.now(),
        appConnected: true
      });
      await pushEvent('info', `Отправлен ${event.category}`, {
        pathname: event.pathname,
        gameId: event.gameId
      });
      return;
    } catch (err) {
      await pushEvent('warn', 'Приложение недоступно, в очередь', { error: String(err.message || err) });
    }
  }

  const queue = await getQueue();
  if (queue.some((item) => item.dedupeKey === event.dedupeKey)) {
    await pushEvent('debug', 'Дубликат в очереди пропущен', { dedupeKey: event.dedupeKey });
    return;
  }
  queue.push(event);
  await setQueue(queue);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) {
      sendResponse({ ok: false });
      return;
    }

    if (message.type === 'hook-ready' || message.type === 'console-ping') {
      await setStats({ consoleDetected: true });
      if (message.type === 'hook-ready') await pushEvent('info', 'Network hook активен');
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'network-response') {
      const tabUrl = sender.tab && sender.tab.url;
      const event = buildEvent(message.payload, tabUrl);
      if (event) await enqueueOrSend(event);
      sendResponse({ ok: Boolean(event) });
      return;
    }

    if (message.type === 'get-state') {
      const [settings, stats, queue, events, collecting, progress] = await Promise.all([
        getSettings(),
        getStats(),
        getQueue(),
        chrome.storage.local.get(STORAGE_KEYS.EVENTS),
        chrome.storage.local.get(STORAGE_KEYS.COLLECTING),
        chrome.storage.local.get(STORAGE_KEYS.AUTO_PROGRESS)
      ]);
      // Живая проверка: консоль уже открыта в любой вкладке
      let consoleOpen = Boolean(stats.consoleDetected);
      try {
        const consoleTabs = await chrome.tabs.query({ url: ['*://games.yandex.ru/*'] });
        consoleOpen = consoleTabs.some((t) => /games\.yandex\.ru\/console/i.test(String(t.url || '')));
        if (consoleOpen && !stats.consoleDetected) await setStats({ consoleDetected: true });
      } catch {
        /* ignore */
      }
      sendResponse({
        ok: true,
        settings,
        stats: { ...stats, consoleDetected: consoleOpen },
        queueLength: queue.length,
        events: events[STORAGE_KEYS.EVENTS] || [],
        collecting: collecting[STORAGE_KEYS.COLLECTING] !== false,
        autoProgress: progress[STORAGE_KEYS.AUTO_PROGRESS] || null
      });
      return;
    }

    if (message.type === 'save-settings') {
      const settings = await setSettings(message.payload || {});
      sendResponse({ ok: true, settings });
      return;
    }

    if (message.type === 'check-app') {
      const ok = await checkAppConnection();
      sendResponse({ ok });
      return;
    }

    if (message.type === 'pair-app') {
      const result = await pairWithApp(message.payload && message.payload.port);
      sendResponse(result);
      return;
    }

    if (message.type === 'flush-queue') {
      const result = await flushQueue();
      sendResponse(result);
      return;
    }

    if (message.type === 'set-collecting') {
      await chrome.storage.local.set({ [STORAGE_KEYS.COLLECTING]: Boolean(message.payload) });
      await pushEvent('info', message.payload ? 'Сбор включён' : 'Сбор остановлен');
      sendResponse({ ok: true, collecting: Boolean(message.payload) });
      return;
    }

    if (message.type === 'clear-queue') {
      await setQueue([]);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'auto-progress') {
      const prev = (await chrome.storage.local.get(STORAGE_KEYS.AUTO_PROGRESS))[
        STORAGE_KEYS.AUTO_PROGRESS
      ];
      const gameId =
        message.payload && message.payload.gameId ? String(message.payload.gameId) : null;
      const progress = {
        running: Boolean(message.payload && message.payload.running),
        step: Number((message.payload && message.payload.step) || 0),
        total: Number((message.payload && message.payload.total) || 0),
        label: (message.payload && message.payload.label) || '',
        detail: (message.payload && message.payload.detail) || '',
        hint: (message.payload && message.payload.hint) || '',
        etaMs: Number((message.payload && message.payload.etaMs) || 0),
        phase: (message.payload && message.payload.phase) || '',
        stage: (message.payload && message.payload.stage) || null,
        stages: (message.payload && message.payload.stages) || null,
        work: (message.payload && message.payload.work) || null,
        startedAt: (message.payload && message.payload.startedAt) || null,
        finishedAt: (message.payload && message.payload.finishedAt) || null,
        quality: (message.payload && message.payload.quality) || null,
        paceMs: Number((message.payload && message.payload.paceMs) || 0) || null,
        failures: Array.isArray(message.payload && message.payload.failures)
          ? message.payload.failures.slice(0, 80)
          : null,
        gameId,
        at: Date.now()
      };
      await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_PROGRESS]: progress });
      // Журнал только на смене фазы/лейбла — иначе каждый шаг метрики
      // пишет storage и popup начинает лагать.
      const inGame = (phase) => /^game/.test(phase || '');
      const phaseChanged =
        !prev || (prev.phase !== progress.phase && !(inGame(prev.phase) && inGame(progress.phase)));
      const labelChanged = !prev || prev.label !== progress.label;
      const finished = prev && prev.running && !progress.running;
      if (progress.phase === 'retry' && (phaseChanged || labelChanged)) {
        await pushEvent('warn', `Автосбор: ${progress.label}`, {
          detail: progress.detail
        });
      } else if (
        progress.label &&
        (phaseChanged ||
          finished ||
          (labelChanged && !/метрика|analytics|inapp/i.test(progress.detail || '')))
      ) {
        await pushEvent('info', `Автосбор: ${progress.label}`, {
          step: progress.step,
          total: progress.total,
          phase: progress.phase
        });
      }
      if (gameId && (!prev || prev.gameId !== gameId)) {
        await setStats({ currentGameId: gameId });
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'get-auto-progress') {
      const data = await chrome.storage.local.get(STORAGE_KEYS.AUTO_PROGRESS);
      sendResponse({ ok: true, progress: data[STORAGE_KEYS.AUTO_PROGRESS] || null });
      return;
    }

    if (message.type === 'start-auto-collect') {
      await chrome.storage.local.set({ [STORAGE_KEYS.COLLECTING]: true });
      let tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
        url: ['https://games.yandex.ru/console/*', 'https://games.yandex.ru/console*']
      });
      if (!tabs[0]) {
        tabs = await chrome.tabs.query({
          url: ['https://games.yandex.ru/console/*', 'https://games.yandex.ru/console*']
        });
      }
      const tab = tabs[0];
      if (!tab) {
        await pushEvent('error', 'Откройте вкладку кабинета Яндекс Игр');
        sendResponse({ ok: false, error: 'no-console-tab' });
        return;
      }
      const delayMs = (message.payload && message.payload.delayMs) || 900;
      const includeEarnings =
        message.payload && message.payload.includeEarnings === false ? false : true;
      const mobileSlice = (message.payload && message.payload.mobileSlice) || '__total__';
      const earnMonths =
        message.payload && message.payload.earnMonths != null
          ? Number(message.payload.earnMonths)
          : 12;
      const collectMode =
        message.payload && message.payload.collectMode === 'refresh' ? 'refresh' : 'full';
      const refreshWindow =
        message.payload && message.payload.refreshWindow === 'month' ? 'month' : '7d';
      const replayOnly = Boolean(message.payload && message.payload.replayOnly);
      const continueFromResume = Boolean(message.payload && message.payload.continueFromResume);
      const failures = (message.payload && message.payload.failures) || null;
      // Тогл «только опубликованные» запоминаем между запусками.
      const onlyPublished =
        message.payload && message.payload.onlyPublished !== undefined
          ? Boolean(message.payload.onlyPublished)
          : true;
      if (!replayOnly) {
        await chrome.storage.local.set({
          faOnlyPublished: onlyPublished,
          faCollectMode: collectMode,
          faRefreshWindow: refreshWindow,
          faEarnMonths: Number.isFinite(earnMonths) ? earnMonths : 12
        });
      }
      const modeLabel = continueFromResume
        ? 'продолжение сохранённого сбора'
        : collectMode === 'refresh'
          ? refreshWindow === 'month'
            ? 'актуализация · текущий месяц'
            : 'актуализация · 7 дней'
          : `полный сбор · ${earnMonths || 12} мес.`;
      await chrome.storage.local.set({
        [STORAGE_KEYS.AUTO_PROGRESS]: {
          running: true,
          step: 0,
          total: 1,
          label: replayOnly ? 'Повтор ошибок…' : `Запуск: ${modeLabel}`,
          detail: replayOnly
            ? 'только failed-запросы'
            : onlyPublished
              ? `${modeLabel} · только опубликованные`
              : `${modeLabel} · все игры`,
          etaMs: 0,
          phase: 'init',
          startedAt: Date.now(),
          at: Date.now()
        }
      });
      let result;
      try {
        result = await chrome.tabs.sendMessage(tab.id, {
          type: 'auto-start',
          payload: {
            delayMs,
            includeEarnings,
            mode: 'portfolio',
            mobileSlice,
            earnMonths,
            collectMode,
            refreshWindow,
            replayOnly,
            failures,
            onlyPublished,
            continueFromResume
          }
        });
      } catch (err) {
        await pushEvent('error', 'Не удалось запустить сбор на вкладке — обновите страницу кабинета');
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
        return;
      }
      await pushEvent('info', replayOnly ? 'Повтор ошибок запущен' : 'Сбор портфеля запущен', result);
      sendResponse({ ok: true, result });
      return;
    }

    if (message.type === 'stop-auto-collect') {
      const tabs = await chrome.tabs.query({
        url: ['https://games.yandex.ru/console/*', 'https://games.yandex.ru/console*']
      });
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'auto-stop' });
        } catch {
          /* ignore */
        }
      }
      const data = await chrome.storage.local.get(STORAGE_KEYS.AUTO_PROGRESS);
      const prev = data[STORAGE_KEYS.AUTO_PROGRESS] || {};
      await chrome.storage.local.set({
        [STORAGE_KEYS.AUTO_PROGRESS]: {
          ...prev,
          running: false,
          label: 'Остановлено',
          etaMs: 0,
          finishedAt: Date.now(),
          at: Date.now()
        }
      });
      await pushEvent('info', 'Автосбор остановлен');
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: 'unknown-type' });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  });

  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url || !tab.url.includes('games.yandex.ru/console')) return;
  if (changeInfo.status === 'complete' || changeInfo.url) {
    const gameId = extractGameIdFromTabUrl(tab.url);
    await setStats({
      consoleDetected: true,
      currentGameId: gameId || (await getStats()).currentGameId
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ [STORAGE_KEYS.COLLECTING]: true });
  pairWithApp().catch(() => {});
});

async function findConsoleTabs() {
  let tabs = await chrome.tabs.query({
    url: ['https://games.yandex.ru/console/*', 'https://games.yandex.ru/console*']
  });
  if (!tabs.length) {
    tabs = await chrome.tabs.query({
      url: ['https://games.yandex.ru/*/console*', 'https://games.yandex.ru/*/console/*']
    });
  }
  return tabs;
}

/** После сна прогресс в storage остаётся running, а вкладка мертва или зависла. */
async function checkStaleCollect() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.AUTO_PROGRESS, 'faCollectResume']);
  const progress = data[STORAGE_KEYS.AUTO_PROGRESS];
  if (!progress || !progress.running) return;
  const age = Date.now() - Number(progress.at || 0);
  if (age < 120000) return;

  const tabs = await findConsoleTabs();
  if (!tabs.length) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTO_PROGRESS]: {
        ...progress,
        running: false,
        label: 'Сбор прерван · нет вкладки кабинета',
        detail: 'откройте кабинет и нажмите «Продолжить»',
        phase: 'done',
        finishedAt: Date.now(),
        at: Date.now(),
        canContinue: true
      }
    });
    await pushEvent('warn', 'Сбор завис без вкладки кабинета — прогресс сохранён');
    return;
  }

  for (const tab of tabs) {
    try {
      const status = await chrome.tabs.sendMessage(tab.id, {
        type: 'auto-watchdog',
        payload: { age }
      });
      if (status && status.recovering) {
        await pushEvent('info', 'Сбор продолжается после паузы экрана');
        return;
      }
      // Вкладка жива, но running=false при running в storage — синхронизируем.
      if (status && status.ok && !status.running) {
        const resume = data.faCollectResume;
        await chrome.storage.local.set({
          [STORAGE_KEYS.AUTO_PROGRESS]: {
            ...progress,
            running: false,
            label: 'Сбор прерван · можно продолжить',
            detail: resume
              ? `сохранено ${(resume.doneIds && resume.doneIds.length) || 0} игр`
              : 'нажмите «Продолжить» или запустите снова',
            phase: 'done',
            finishedAt: Date.now(),
            at: Date.now(),
            canContinue: Boolean(resume)
          }
        });
        await pushEvent('warn', 'Сбор завис после блокировки экрана — прогресс сохранён');
        return;
      }
    } catch (_) {
      // Content script выгружен: если есть resume — перезагрузим вкладку с autoResume.
      const resume = data.faCollectResume;
      if (resume && Array.isArray(resume.doneIds)) {
        await chrome.storage.local.set({
          faCollectResume: { ...resume, autoResume: true, at: Date.now() }
        });
        try {
          await chrome.tabs.reload(tab.id);
          await pushEvent('info', 'Вкладка кабинета перезагружена — продолжаю сбор');
          return;
        } catch (_) {
          /* ignore */
        }
      }
    }
  }
}

chrome.alarms.create('founders-heartbeat', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'founders-heartbeat') {
    checkAppConnection().catch(() => {});
    checkStaleCollect().catch(() => {});
  }
});

pairWithApp().catch(() => checkAppConnection().catch(() => {}));
