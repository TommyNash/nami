//! Вымышленный портфель для скринов и промо.
//! Только `nami-demo.sqlite` — рабочая база не меняется.

use crate::db;
use crate::error::AppResult;
use chrono::{Datelike, Duration, Months, NaiveDate, Utc};
use rusqlite::{params, Connection};
use std::time::{SystemTime, UNIX_EPOCH};

const DEMO_ACCOUNT: &str = "demo-studio";
/// Бамп при смене формы сида — старая демо-БД пересоберётся сама.
const DEMO_SEED_VERSION: &str = "3";

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn month_end(d: NaiveDate) -> NaiveDate {
    if d.month() == 12 {
        NaiveDate::from_ymd_opt(d.year() + 1, 1, 1)
            .and_then(|x| x.pred_opt())
            .unwrap_or(d)
    } else {
        NaiveDate::from_ymd_opt(d.year(), d.month() + 1, 1)
            .and_then(|x| x.pred_opt())
            .unwrap_or(d)
    }
}

fn prev_month_start(d: NaiveDate) -> NaiveDate {
    d.checked_sub_months(Months::new(1))
        .map(|x| NaiveDate::from_ymd_opt(x.year(), x.month(), 1).unwrap_or(x))
        .unwrap_or(d)
}

struct DemoGame {
    id: &'static str,
    title: &'static str,
    status: &'static str,
    /// Базовый DAU «сейчас».
    players: f64,
    play_min: f64,
    ready: f64,
    rating_ru: f64,
    rating_world: f64,
    /// Средний дневной доход «сейчас», ₽.
    earn_day: f64,
}

/// Масштаб под промо: портфель ~150–250k ₽/мес, DAU тысячи.
const GAMES: &[DemoGame] = &[
    DemoGame {
        id: "900001",
        title: "Небесный Парк",
        status: "published",
        players: 2_850.0,
        play_min: 14.2,
        ready: 3.8,
        rating_ru: 82.0,
        rating_world: 76.0,
        earn_day: 4_200.0,
    },
    DemoGame {
        id: "900002",
        title: "Космодром Ультра",
        status: "published",
        players: 1_980.0,
        play_min: 11.6,
        ready: 4.4,
        rating_ru: 78.0,
        rating_world: 71.0,
        earn_day: 2_850.0,
    },
    DemoGame {
        id: "900003",
        title: "Пекарня Хаоса",
        status: "published",
        players: 1_240.0,
        play_min: 16.8,
        ready: 3.2,
        rating_ru: 85.0,
        rating_world: 79.0,
        earn_day: 1_780.0,
    },
    DemoGame {
        id: "900004",
        title: "Тихий Океан",
        status: "published",
        players: 620.0,
        play_min: 8.4,
        ready: 5.6,
        rating_ru: 71.0,
        rating_world: 66.0,
        earn_day: 620.0,
    },
    DemoGame {
        id: "900005",
        title: "Пиксельный Сад",
        status: "published",
        players: 1_560.0,
        play_min: 12.1,
        ready: 4.1,
        rating_ru: 80.0,
        rating_world: 74.0,
        earn_day: 2_150.0,
    },
    DemoGame {
        id: "900006",
        title: "Лунный Базар",
        status: "published",
        players: 980.0,
        play_min: 9.5,
        ready: 4.9,
        rating_ru: 74.0,
        rating_world: 69.0,
        earn_day: 1_120.0,
    },
    DemoGame {
        id: "900007",
        title: "Форт Дракона",
        status: "moderation",
        players: 210.0,
        play_min: 6.2,
        ready: 7.1,
        rating_ru: 62.0,
        rating_world: 58.0,
        earn_day: 0.0,
    },
];

fn seed_version(conn: &Connection) -> AppResult<String> {
    Ok(db::meta_get(conn, "demo_seed_version")?.unwrap_or_default())
}

pub fn is_seeded(conn: &Connection) -> AppResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM games WHERE owner_id = ?1",
        [DEMO_ACCOUNT],
        |r| r.get(0),
    )?;
    Ok(n > 0 && seed_version(conn)? == DEMO_SEED_VERSION)
}

pub fn seed_demo(conn: &Connection, force: bool) -> AppResult<()> {
    if !force && is_seeded(conn)? {
        return Ok(());
    }
    wipe_demo(conn)?;

    let now = now_ms();
    let today = Utc::now().date_naive();

    conn.execute(
        "INSERT INTO accounts(id, title, login, avatar_url, last_seen_at, created_at)
         VALUES(?1, ?2, ?3, NULL, ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, login=excluded.login, last_seen_at=excluded.last_seen_at",
        params![DEMO_ACCOUNT, "Demo Studio", "demo@founders.local", now],
    )?;

    for g in GAMES {
        conn.execute(
            "INSERT INTO games(id, title, title_json, status, owner_id, icon_url, first_seen_at, last_seen_at)
             VALUES(?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status, owner_id=excluded.owner_id, last_seen_at=excluded.last_seen_at",
            params![g.id, g.title, g.title, g.status, DEMO_ACCOUNT, now],
        )?;
    }

    // Рост за год: 12 мес назад ~42% от текущего уровня, плавный ап с сезонностью.
    let month_scale = |months_ago: i32| -> f64 {
        let t = (11 - months_ago).max(0) as f64 / 11.0;
        let trend = 0.42 + 0.58 * t;
        let season = 1.0 + 0.12 * ((months_ago as f64) * 0.55).sin();
        trend * season
    };

    // 12 полных календарных месяцев (включая текущий — полный бакет для KPI/баров).
    let mut cursor = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today);
    for mi in 0..12 {
        let scale = month_scale(mi);
        let from = cursor;
        let to = month_end(cursor);
        let from_s = from.format("%Y-%m-%d").to_string();
        let to_s = to.format("%Y-%m-%d").to_string();
        let key = format!("{:04}-{:02}", cursor.year(), cursor.month());
        let days = (to - from).num_days().max(1) as f64 + 1.0;
        let mut month_total = 0.0;

        for (gi, g) in GAMES.iter().enumerate() {
            if g.earn_day <= 0.0 {
                continue;
            }
            let game_boost = 0.88 + (gi as f64) * 0.035;
            let month_earn =
                ((g.earn_day * days * scale * game_boost) * 100.0).round() / 100.0;
            month_total += month_earn;
            let adv = (month_earn * 0.68 * 100.0).round() / 100.0;
            let inapp = ((month_earn - adv) * 100.0).round() / 100.0;
            conn.execute(
                "INSERT INTO game_earnings(game_id, period_from, period_to, observation_day, captured_at, earn, adv, rsya, intad, inapp)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, ?8)
                 ON CONFLICT(game_id, period_from, period_to, observation_day) DO UPDATE SET
                   earn=excluded.earn, adv=excluded.adv, inapp=excluded.inapp, captured_at=excluded.captured_at",
                params![
                    g.id,
                    from_s,
                    to_s,
                    from_s,
                    now - (mi as i64) * 86_400_000,
                    month_earn,
                    adv,
                    inapp
                ],
            )?;
        }

        conn.execute(
            "INSERT INTO manual_earn_months(account_id, month_key, earn, note, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(account_id, month_key) DO UPDATE SET earn=excluded.earn, updated_at=excluded.updated_at",
            params![DEMO_ACCOUNT, key, month_total, "демо", now],
        )?;

        cursor = prev_month_start(cursor);
    }

    // Дневные срезы ~120 дней: KPI-свечи, heatmap, сравнение периодов.
    let day_count = 120i64;
    for day_ago in 0..day_count {
        let day = today - Duration::days(day_ago);
        let day_s = day.format("%Y-%m-%d").to_string();
        let months_ago = ((today.year() - day.year()) * 12 + today.month() as i32
            - day.month() as i32)
            .max(0);
        let scale = month_scale(months_ago);
        let weekday = day.weekday().num_days_from_monday() as f64;
        let weekend = if weekday >= 5.0 { 1.14 } else { 1.0 };
        let wave = 1.0 + 0.08 * ((day_ago as f64) * 0.41).sin();
        let captured = now - day_ago * 86_400_000;

        for (gi, g) in GAMES.iter().enumerate() {
            let jitter = 0.94 + ((gi as f64 * 1.7 + day_ago as f64) % 9.0) * 0.012;
            let players = (g.players * scale * wave * weekend * jitter).round();
            let play = g.play_min * (0.96 + (day_ago % 6) as f64 * 0.012);
            let ready = g.ready * (0.97 + (day_ago % 4) as f64 * 0.01);
            let earn = if g.earn_day > 0.0 {
                ((g.earn_day * scale * wave * weekend * jitter) * 100.0).round() / 100.0
            } else {
                0.0
            };
            let adv = (earn * 0.68 * 100.0).round() / 100.0;
            let inapp = ((earn - adv) * 100.0).round() / 100.0;

            conn.execute(
                "INSERT INTO game_metrics(game_id, observation_day, captured_at, players, play_time_per_player, game_ready, game_ready_delta, rating_ru, rating_world)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(game_id, observation_day) DO UPDATE SET
                   players=excluded.players,
                   play_time_per_player=excluded.play_time_per_player,
                   game_ready=excluded.game_ready,
                   rating_ru=excluded.rating_ru,
                   rating_world=excluded.rating_world,
                   captured_at=excluded.captured_at",
                params![
                    g.id,
                    day_s,
                    captured,
                    players,
                    play,
                    ready,
                    ready * 0.08,
                    g.rating_ru,
                    g.rating_world
                ],
            )?;

            if earn > 0.0 {
                conn.execute(
                    "INSERT INTO game_earnings(game_id, period_from, period_to, observation_day, captured_at, earn, adv, rsya, intad, inapp)
                     VALUES(?1, ?2, ?2, ?2, ?3, ?4, ?5, 0, 0, ?6)
                     ON CONFLICT(game_id, period_from, period_to, observation_day) DO UPDATE SET
                       earn=excluded.earn, adv=excluded.adv, inapp=excluded.inapp, captured_at=excluded.captured_at",
                    params![g.id, day_s, captured, earn, adv, inapp],
                )?;
            }

            let x = captured;
            for (name, y) in [
                ("players: Всего", players),
                ("play_time: Время игры", play),
                ("game_ready: Game Ready", ready),
            ] {
                conn.execute(
                    "INSERT INTO metric_series(game_id, observation_day, captured_at, series_name, point_x, point_y)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(game_id, observation_day, series_name, point_x) DO UPDATE SET point_y=excluded.point_y",
                    params![g.id, day_s, now, name, x, y],
                )?;
            }
            if earn > 0.0 {
                conn.execute(
                    "INSERT INTO metric_series(game_id, observation_day, captured_at, series_name, point_x, point_y)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(game_id, observation_day, series_name, point_x) DO UPDATE SET point_y=excluded.point_y",
                    params![
                        g.id,
                        day_s,
                        now,
                        "purchase_amount: Реклама",
                        x,
                        adv
                    ],
                )?;
                conn.execute(
                    "INSERT INTO metric_series(game_id, observation_day, captured_at, series_name, point_x, point_y)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(game_id, observation_day, series_name, point_x) DO UPDATE SET point_y=excluded.point_y",
                    params![
                        g.id,
                        day_s,
                        now,
                        "purchase_amount: Инап-покупки",
                        x,
                        inapp
                    ],
                )?;
            }
        }
    }

    let day0 = today.format("%Y-%m-%d").to_string();
    let geo = [
        ("Россия", 0.68),
        ("Казахстан", 0.10),
        ("Беларусь", 0.07),
        ("Узбекистан", 0.06),
        ("Другие", 0.09),
    ];
    let plats = [("desktop", 0.46), ("mobile", 0.47), ("tv", 0.07)];
    for g in GAMES {
        let base = g.players;
        for (country, share) in geo {
            conn.execute(
                "INSERT INTO game_geography(game_id, observation_day, captured_at, country, players)
                 VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(game_id, observation_day, country) DO UPDATE SET players=excluded.players",
                params![g.id, day0, now, country, (base * share).round()],
            )?;
        }
        for (platform, share) in plats {
            conn.execute(
                "INSERT INTO game_platforms(game_id, observation_day, captured_at, platform, players)
                 VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(game_id, observation_day, platform) DO UPDATE SET players=excluded.players",
                params![g.id, day0, now, platform, (base * share).round()],
            )?;
        }
    }

    db::meta_set(conn, "tax_rate", "6")?;
    db::meta_set(conn, "tax_shift", "1")?;
    db::meta_set(conn, "demo_seeded", "1")?;
    db::meta_set(conn, "demo_seed_version", DEMO_SEED_VERSION)?;
    Ok(())
}

fn wipe_demo(conn: &Connection) -> AppResult<()> {
    for t in [
        "metric_series",
        "game_earnings",
        "game_metrics",
        "game_geography",
        "game_platforms",
        "game_ratings",
        "game_reviews",
        "game_purchases",
        "purchase_metrics",
        "manual_earn_months",
        "raw_responses",
        "games",
        "accounts",
    ] {
        conn.execute(&format!("DELETE FROM {t}"), [])?;
    }
    Ok(())
}
