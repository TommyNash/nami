function summaryCardsHtml(details, period, periodEarn, snap) {
  const g = details.seriesGrouped || {};
  const b = details.bounds || {};
  const periodAcc = summaryPeriodAcc(period);
  const geo = details.geography || [];
  const geoTotal = geo.reduce((s, x) => s + (Number(x.players) || 0), 0);
  const topGeo = geo[0];
  const topShare =
    topGeo && geoTotal > 0 ? `${F().num((Number(topGeo.players) / geoTotal) * 100)}%` : '';
  const earnSparkAds = seriesSpark(g, WS_SERIES.ads, b);
  const earnSparkInapp = seriesSpark(g, WS_SERIES.inapp, b);
  const earnSpark = earnSparkAds.length
    ? earnSparkAds.map((v, i) => v + (earnSparkInapp[i] || 0))
    : earnSparkInapp;
  const earnDelta = fmtDelta(seriesDeltaPct(g, WS_SERIES.ads, b));
  const readyDeltaRaw = fmtDelta(seriesDeltaPct(g, 'game_ready_api: p50', b));
  const readyDelta = { ...readyDeltaRaw };
  // Ниже секунды — лучше: цвет инвертируем, подпись чипа оставляем честной.
  if (readyDelta.tone === 'up') readyDelta.tone = 'down';
  else if (readyDelta.tone === 'down') readyDelta.tone = 'up';
  const cards = [
    {
      id: 'players',
      label: T('workspace.label.players'),
      value: F().num(snap.playersAvg, 0),
      note: T('workspace.perDayAvg'),
      delta: fmtDelta(seriesDeltaPct(g, WS_SERIES.players, b)),
      spark: seriesSpark(g, WS_SERIES.players, b),
      valueTip: T('workspace.card.playersTip', { period: periodAcc }),
      accent: false
    },
    {
      id: 'playtime',
      label: T('workspace.label.playtime'),
      value: F().num(snap.play),
      note: T('workspace.perPlayerMinutes'),
      delta: fmtDelta(seriesDeltaPct(g, WS_SERIES.playTime, b)),
      spark: seriesSpark(g, WS_SERIES.playTime, b),
      valueTip: T('workspace.card.playtimeTip', { period: periodAcc }),
      accent: false
    },
    {
      id: 'ready',
      label: T('workspace.label.ready'),
      value: T('workspace.card.seconds', { value: F().num(snap.ready) }),
      note: T('workspace.card.untilReady'),
      delta: readyDelta,
      spark: seriesSpark(g, 'game_ready_api: p50', b),
      valueTip: T('workspace.card.readyTip'),
      deltaTip: deltaInsideTip(readyDelta, 'ready'),
      accent: false
    },
    {
      id: 'rating',
      label: T('workspace.label.rating'),
      value: F().num(snap.ratingRu, 0),
      note: T('workspace.card.worldRating', { value: F().num(snap.ratingWorld, 0) }),
      delta: fmtDelta(seriesDeltaAbs(g, WS_SERIES.ratingRu, b), { suffix: '' }),
      spark: seriesSpark(g, WS_SERIES.ratingRu, b),
      valueTip: T('workspace.card.ratingTip'),
      deltaTip: deltaInsideTip(
        fmtDelta(seriesDeltaAbs(g, WS_SERIES.ratingRu, b), { suffix: '' }),
        'rating'
      ),
      accent: false
    },
    {
      id: 'revenue',
      label: T('workspace.label.revenue'),
      value: moneyFmt(periodEarn),
      note: periodAcc,
      delta: earnDelta,
      spark: earnSpark,
      valueTip: T('workspace.card.revenueTip', { period: periodAcc }),
      deltaTip: deltaInsideTip(earnDelta, 'revenue'),
      accent: true
    },
    {
      id: 'audience',
      label: T('workspace.label.audience'),
      value: T('workspace.card.countries', { count: geo.length || 0 }),
      note: topGeo ? `${topGeo.country} ${topShare}` : T('workspace.card.noData'),
      delta: { text: '—', tone: 'flat', raw: null },
      spark: seriesSpark(g, WS_SERIES.players, b),
      valueTip: T('workspace.card.audienceTip'),
      deltaTip: topGeo
        ? T('workspace.card.geoTip', { country: topGeo.country, share: topShare })
        : T('workspace.card.noGeo'),
      accent: false
    }
  ];
  cards.forEach((c) => {
    if (c.deltaTip == null) c.deltaTip = deltaInsideTip(c.delta, c.id);
  });
  const arrow = window.FoundersIcons ? window.FoundersIcons.svg('arrow-up-right', 16) : '↗';
  const sparkSize = { w: 120, h: 40 };
  return `<div class="summary-grid">
    ${cards
      .map((c) => {
        const spark = sparklineSvg(c.spark, c.delta.tone, null, sparkSize);
        return `<button type="button" class="sum-card ${c.accent ? 'is-accent' : ''}" data-section="${c.id}">
          <div class="sum-card-top">
            <span>${F().esc(c.label)}</span>
            <i class="sum-card-go">${arrow}</i>
          </div>
          <div class="sum-card-mid">
            ${sumHint(c.valueTip, `<b>${c.value}</b>`)}
            <span class="sum-spark">${spark}</span>
          </div>
          <div class="sum-card-foot">
            ${sumHint(
              c.deltaTip,
              `<span class="sum-pill is-${c.delta.tone}">${F().esc(c.delta.text)}</span>`
            )}
            ${sumHint(c.valueTip, `<span class="sum-note">${F().esc(c.note)}</span>`)}
          </div>
        </button>`;
      })
      .join('')}
  </div>`;
}

function workspaceGameHeadHtml(details) {
  const game = details.game || {};
  const title = game.title || game.id || T('workspace.game.fallbackTitle');
  const initials = String(title)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  const icon = game.icon_url
    ? `<img class="ws-game-icon" src="${F().esc(game.icon_url)}" alt="" />`
    : `<div class="ws-game-icon is-ph">${F().esc(initials || '?')}</div>`;
  const updated =
    game.last_seen_at != null
      ? F().date(game.last_seen_at > 1e12 ? game.last_seen_at : game.last_seen_at * 1000)
      : '';
  return `<div class="ws-game-head">
    ${icon}
    <div class="ws-game-copy">
      <h1 class="ws-game-title">${F().esc(title)}</h1>
      <div class="ws-game-sub">
        <span class="status-pill ${statusClass(game.status)}">${F().esc(statusLabel(game.status))}</span>
        <span class="muted">ID ${F().esc(String(game.id || ''))}${updated ? T('workspace.head.updated', { date: updated }) : ''}</span>
      </div>
    </div>
    <button type="button" class="ws-export-btn" id="wsExportAll">
      <i class="ph ph-download-simple" aria-hidden="true"></i>
      <span>${T('workspace.head.download')}</span>
    </button>
  </div>`;
}

function sectionHeadStat(active, details, period, periodEarn, snap) {
  if (active.id === 'players') {
    return { value: F().num(snap.playersAvg, 0), sub: T('workspace.perDayAvg') };
  }
  if (active.id === 'playtime') return { value: F().num(snap.play), sub: T('workspace.perPlayerMinutes') };
  if (active.id === 'ready') {
    return { value: F().num(snap.ready), sub: T('workspace.headStat.secondsUntilReady') };
  }
  if (active.id === 'rating') {
    return {
      value: F().num(snap.ratingRu, 0),
      sub: T('workspace.card.worldRating', { value: F().num(snap.ratingWorld, 0) })
    };
  }
  if (active.id === 'revenue') {
    return { value: moneyFmt(periodEarn), sub: F().periodAcc(period) };
  }
  if (active.id === 'audience') {
    const geoN = (details.geography || []).length;
    const platN = (details.platforms || []).length;
    return {
      value: F().num(snap.playersAvg, 0),
      sub: T('workspace.headStat.audience', { platforms: platN || 0, countries: geoN || 0 })
    };
  }
  return null;
}
