//! Кэш доходов и рядов metric_series.
use super::*;
use std::sync::{Arc, Mutex};

/// Снимок доходов на соединение. Сбрасывается вместе с кэшем экрана,
/// иначе смена фильтра карты каждый раз заново читает всю таблицу.
static EARN_MEMO: Mutex<Option<(usize, Arc<Vec<EarnRow>>)>> = Mutex::new(None);

pub fn clear_earn_memo() {
    if let Ok(mut guard) = EARN_MEMO.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = SERIES_MEMO.lock() {
        *guard = None;
    }
}

/// Прогрев memo при старте: первый клик по периоду не читает metric_series с нуля.
pub fn warm_memos(conn: &Connection) -> AppResult<()> {
    let _span = tracing::info_span!("warm_memos").entered();
    let _ = load_earnings(conn)?;
    let _ = series_memo(conn)?;
    Ok(())
}

/// Сырые точки metric_series. Оконные запросы по дням раньше выполнялись
/// заново на каждый период, сравнение и график — в debug-сборке это и был
/// лаг фильтра. Здесь таблица читается один раз, дальше срезы идут по памяти.
#[derive(Clone, Copy)]
pub(crate) struct SeriesHit {
    pub(crate) x: i64,
    pub(crate) y: Option<f64>,
    pub(crate) captured: i64,
}

#[derive(Clone, Copy)]
pub(crate) struct DayPoint {
    pub(crate) ord: i32,
    pub(crate) y: Option<f64>,
}

pub(crate) struct SeriesMemo {
    pub(crate) by_game: HashMap<String, HashMap<String, Vec<SeriesHit>>>,
    /// Уже сведённый снимок «один день — одна точка», отсортирован по дню.
    /// Период и карта берут срез, а не пересчитывают победителя заново.
    pub(crate) daily: HashMap<String, HashMap<String, Vec<DayPoint>>>,
    pub(crate) published: HashSet<String>,
}

static SERIES_MEMO: Mutex<Option<(usize, Arc<SeriesMemo>)>> = Mutex::new(None);

pub(crate) fn series_memo(conn: &Connection) -> AppResult<Arc<SeriesMemo>> {
    let ptr = conn as *const Connection as usize;
    if let Ok(guard) = SERIES_MEMO.lock() {
        if let Some((memo_ptr, data)) = guard.as_ref() {
            if *memo_ptr == ptr {
                return Ok(Arc::clone(data));
            }
        }
    }
    let data = Arc::new(load_series_memo(conn)?);
    if let Ok(mut guard) = SERIES_MEMO.lock() {
        *guard = Some((ptr, Arc::clone(&data)));
    }
    Ok(data)
}

pub(crate) fn load_series_memo(conn: &Connection) -> AppResult<SeriesMemo> {
    let mut by_game: HashMap<String, HashMap<String, Vec<SeriesHit>>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT COALESCE(game_id, ''), series_name, point_x, point_y, COALESCE(captured_at, 0)
         FROM metric_series",
    )?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, Option<f64>>(3)?,
            r.get::<_, i64>(4)?,
        ))
    })? {
        let (game_id, series, x, y, captured) = row?;
        if game_id.is_empty() {
            continue;
        }
        by_game
            .entry(game_id)
            .or_default()
            .entry(series)
            .or_default()
            .push(SeriesHit { x, y, captured });
    }
    for series_map in by_game.values_mut() {
        for pts in series_map.values_mut() {
            pts.sort_by_key(|p| p.x);
        }
    }
    let mut daily: HashMap<String, HashMap<String, Vec<DayPoint>>> =
        HashMap::with_capacity(by_game.len());
    for (game, series_map) in &by_game {
        let mut reduced = HashMap::with_capacity(series_map.len());
        for (name, pts) in series_map {
            let days: Vec<DayPoint> = daily_winners(pts, 0, 0, true)
                .into_iter()
                .map(|p| DayPoint {
                    ord: utc_day_ord(p.x),
                    y: p.y,
                })
                .collect();
            reduced.insert(name.clone(), days);
        }
        daily.insert(game.clone(), reduced);
    }
    let mut published = HashSet::new();
    let mut games = conn.prepare("SELECT id FROM games WHERE status = 'published'")?;
    for id in games.query_map([], |r| r.get::<_, String>(0))? {
        if let Ok(id) = id {
            published.insert(id);
        }
    }
    Ok(SeriesMemo {
        by_game,
        daily,
        published,
    })
}

pub(crate) fn ymd_ord(day: &str) -> i32 {
    parse_ymd(day)
        .map(|d| d.num_days_from_ce())
        .unwrap_or(0)
}

pub(crate) fn ord_ymd(ord: i32) -> String {
    NaiveDate::from_num_days_from_ce_opt(ord)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

pub(crate) fn daily_slice<'a>(pts: &'a [DayPoint], from_day: &str, to_day: &str) -> &'a [DayPoint] {
    let from = ymd_ord(from_day);
    let to = ymd_ord(to_day);
    let start = pts.partition_point(|p| p.ord < from);
    let end = start + pts[start..].partition_point(|p| p.ord <= to);
    &pts[start..end]
}

pub(crate) fn sample_ys(ys: &[f64]) -> Vec<f64> {
    if ys.len() > 45 {
        let step = ((ys.len() as f64) / 45.0).ceil() as usize;
        ys.chunks(step.max(1))
            .map(|chunk| chunk.iter().sum::<f64>() / chunk.len() as f64)
            .collect()
    } else {
        ys.to_vec()
    }
}

pub(crate) fn utc_day_ord(x_ms: i64) -> i32 {
    chrono::DateTime::from_timestamp(x_ms / 1000, 0)
        .map(|dt| dt.date_naive().num_days_from_ce())
        .unwrap_or(0)
}

pub(crate) fn hit_better(new: &SeriesHit, old: &SeriesHit) -> bool {
    let new_pos = new.y.unwrap_or(0.0) > 0.0;
    let old_pos = old.y.unwrap_or(0.0) > 0.0;
    if new_pos != old_pos {
        return new_pos;
    }
    new.captured > old.captured
}

/// Один снимок на UTC-день: положительное значение важнее нуля, иначе более свежий сбор.
/// `all` берёт все точки; иначе только `from_ts..=to_ts`, как `point_x BETWEEN` в SQL.
pub(crate) fn daily_winners(pts: &[SeriesHit], from_ts: i64, to_ts: i64, all: bool) -> Vec<SeriesHit> {
    let slice = if all {
        pts
    } else {
        let start = pts.partition_point(|p| p.x < from_ts);
        let end = start + pts[start..].partition_point(|p| p.x <= to_ts);
        &pts[start..end]
    };
    let mut best: HashMap<i32, SeriesHit> = HashMap::with_capacity(slice.len());
    for point in slice {
        let day = utc_day_ord(point.x);
        match best.get(&day) {
            None => {
                best.insert(day, *point);
            }
            Some(prev) if hit_better(point, prev) => {
                best.insert(day, *point);
            }
            _ => {}
        }
    }
    let mut out: Vec<SeriesHit> = best.into_values().collect();
    out.sort_by_key(|p| p.x);
    out
}

pub(crate) fn series_hits<'a>(memo: &'a SeriesMemo, game_id: &str, series: &str) -> &'a [SeriesHit] {
    memo.by_game
        .get(game_id)
        .and_then(|map| map.get(series))
        .map(|pts| pts.as_slice())
        .unwrap_or(&[])
}

pub(crate) fn load_earnings(conn: &Connection) -> AppResult<Vec<EarnRow>> {
    let ptr = conn as *const Connection as usize;
    if let Ok(guard) = EARN_MEMO.lock() {
        if let Some((memo_ptr, rows)) = guard.as_ref() {
            if *memo_ptr == ptr {
                return Ok((**rows).clone());
            }
        }
    }
    let rows = Arc::new(load_earnings_query(conn)?);
    if let Ok(mut guard) = EARN_MEMO.lock() {
        *guard = Some((ptr, Arc::clone(&rows)));
    }
    Ok((*rows).clone())
}

/// Загружает доходы, оставляя по одному (самому свежему) снимку на бакет.
///
/// Один и тот же диапазон собирается многократно: например
/// `2026-11-01..2026-11-30` запрашивался и 7-го (вернул 3510.04), и 10-го
/// (вернул 4950.92). Без дедупликации суммы по бакету удваивались —
/// отсюда «неправильный доход по месяцам».
pub(crate) fn load_earnings_query(conn: &Connection) -> AppResult<Vec<EarnRow>> {
    let mut stmt = conn.prepare(
        "SELECT COALESCE(game_id,''), COALESCE(period_from,''), COALESCE(period_to, period_from, ''),
                earn, COALESCE(captured_at,0), COALESCE(observation_day,'')
         FROM game_earnings",
    )?;
    let rows: Vec<EarnRow> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<f64>>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Ключ — (игра, период). Берём снимок с максимальным captured_at,
    // а при равенстве — тот, где доход посчитан (не null).
    let mut best: HashMap<String, EarnRow> = HashMap::new();
    for row in rows {
        let key = format!("{}\u{1}{}\u{1}{}", row.0, row.1, row.2);
        match best.get(&key) {
            None => {
                best.insert(key, row);
            }
            Some(prev) => {
                let newer = row.4 > prev.4;
                let same_time_but_has_value = row.4 == prev.4
                    && row.3.map(|v| v.abs() > 1e-9).unwrap_or(false)
                    && !prev.3.map(|v| v.abs() > 1e-9).unwrap_or(false);
                if newer || same_time_but_has_value {
                    best.insert(key, row);
                }
            }
        }
    }
    Ok(best.into_values().collect())
}

/// Последний день, за который Яндекс уже отдал ненулевой доход.
/// Всё, что позже, — «ещё не посчитано» и должно оцениваться, а не нулём.
pub(crate) fn earn_stats_through(rows: &[EarnRow]) -> Option<String> {
    rows.iter()
        .filter(|r| r.3.map(|v| v.abs() > 1e-9).unwrap_or(false))
        .map(|r| r.5.clone())
        .filter(|d| d.len() == 10)
        .max()
}

pub(crate) fn select_earnings(rows: &[EarnRow], period: &str, bounds: &PeriodBounds) -> Vec<EarnRow> {
    let mut best: HashMap<String, EarnRow> = HashMap::new();

    let push = |map: &mut HashMap<String, EarnRow>, key: String, row: &EarnRow| {
        if let Some(prev) = map.get(&key) {
            if row.4 <= prev.4 {
                return;
            }
        }
        map.insert(key, row.clone());
    };

    if let Some(ym) = period.strip_prefix("m:") {
        for row in rows {
            if row.1.starts_with(ym) && is_monthly_bucket(&row.1, &row.2) {
                push(&mut best, row.0.clone(), row);
            }
        }
        return best.into_values().collect();
    }

    match period {
        "all" => {
            for row in rows {
                if is_monthly_bucket(&row.1, &row.2) {
                    let key = format!("{}|{}", row.0, &row.1.get(0..7).unwrap_or(""));
                    push(&mut best, key, row);
                }
            }
        }
        "day" => {
            for row in rows {
                if row.1 == bounds.from_day
                    && (row.2 == bounds.to_day || row.2 == row.1)
                    && earn_span_days(&row.1, &row.2) <= 1
                {
                    push(&mut best, row.0.clone(), row);
                }
            }
        }
        "week" => {
            for row in rows {
                let span = earn_span_days(&row.1, &row.2);
                if row.1 == bounds.from_day && row.2 == bounds.to_day && (2..=8).contains(&span) {
                    push(&mut best, row.0.clone(), row);
                }
            }
        }
        "month" => {
            let ym = &bounds.from_day[0..7];
            for row in rows {
                if row.1.starts_with(ym) && is_monthly_bucket(&row.1, &row.2) {
                    push(&mut best, row.0.clone(), row);
                }
            }
        }
        _ => {
            for row in rows {
                if !is_monthly_bucket(&row.1, &row.2) {
                    continue;
                }
                if row.2 >= bounds.from_day && row.1 <= bounds.to_day {
                    let key = format!("{}|{}", row.0, &row.1.get(0..7).unwrap_or(""));
                    push(&mut best, key, row);
                }
            }
        }
    }
    best.into_values().collect()
}

/// Средние игроки в день по игре внутри периода.
/// Снимок панели есть только за дни запуска сборщика, поэтому для августа
/// он пустой. Ряд «players: Всего» даёт сами дни.
/// Среднее и сумма дневных игроков за период (опубликованные игры).

/// Покрытие данными: какие дни есть в базе, каких нет и насколько отстаёт
/// статистика Яндекса. Нужно, чтобы UI честно показывал «нет данных за 09.11».
/// Дневные игроки из metric_series (ряд «players: Всего»).
/// Свежий снимок Яндекса иногда затирает день нулём, хотя прошлый сбор
/// того же дня был ненулевым. Берём последнюю положительную точку,
/// и только если её нет — последний ноль.
pub(crate) fn add_days(day: &str, delta: i64) -> Option<String> {
    parse_ymd(day).map(|d| ymd(d + Duration::days(delta)))
}

pub(crate) fn earn_in_range(
    rows: &[EarnRow],
    from_day: &str,
    to_day: &str,
    stats_through: Option<&str>,
) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    let Some(from) = parse_ymd(from_day) else { return out };
    let Some(to) = parse_ymd(to_day) else { return out };
    let need = days_between(from, to).max(1) as f64;

    let mut by_game: HashMap<String, Vec<&EarnRow>> = HashMap::new();
    for row in rows {
        by_game.entry(row.0.clone()).or_default().push(row);
    }

    for (id, list) in by_game {
        // Точный бакет — только если в нём есть посчитанный доход.
        // Яндекс отдаёт свежие дни с earn = null: это «ещё не посчитано»,
        // а не ноль, поэтому такие бакеты пропускаем.
        if let Some(exact) = list
            .iter()
            .filter(|r| r.1 == from_day && r.2 == to_day)
            .filter(|r| r.3.map(|v| v.abs() > 1e-9).unwrap_or(false))
            .max_by_key(|r| r.4)
        {
            out.insert(id, exact.3.unwrap_or(0.0));
            continue;
        }
        // Покрывающий бакет (месяц / MTD): режем пропорционально, но только
        // по тем дням, за которые статистика уже есть.
        let mut covering: Option<&&EarnRow> = None;
        for r in &list {
            if r.3.map(|v| v.abs() > 1e-9).unwrap_or(false) == false {
                continue;
            }
            if let (Some(a), Some(b)) = (parse_ymd(&r.1), parse_ymd(&r.2)) {
                if a <= from && b >= to {
                    covering = Some(covering.map_or(r, |c| {
                        let ca = days_between(parse_ymd(&c.1).unwrap(), parse_ymd(&c.2).unwrap());
                        let ra = days_between(a, b);
                        if ra < ca || (ra == ca && r.5 > c.5) {
                            r
                        } else {
                            c
                        }
                    }));
                }
            }
        }
        if let Some(c) = covering {
            let bucket_start = parse_ymd(&c.1).unwrap_or(from);
            let bucket_end = parse_ymd(&c.2).unwrap_or(to);
            // Если бакет уходит в будущее, реально заполнен он только до
            // последнего дня с данными.
            let mut filled_end = bucket_end;
            if let Some(through) = stats_through.and_then(parse_ymd) {
                if through < filled_end {
                    filled_end = through;
                }
            }
            let span = days_between(bucket_start, filled_end).max(1) as f64;
            out.insert(id, c.3.unwrap_or(0.0) / span * need);
            continue;
        }
        // Пересечение нескольких бакетов
        let mut sum = 0.0;
        let mut used = false;
        for r in list {
            let Some(v) = r.3.filter(|v| v.abs() > 1e-9) else {
                continue;
            };
            let Some(a) = parse_ymd(&r.1) else { continue };
            let Some(b) = parse_ymd(&r.2) else { continue };
            let of = from.max(a);
            let ot = to.min(b);
            if of > ot {
                continue;
            }
            let span = days_between(a, b).max(1) as f64;
            let overlap = days_between(of, ot) as f64;
            sum += v / span * overlap;
            used = true;
        }
        if used {
            out.insert(id, sum);
        }
    }
    out
}
