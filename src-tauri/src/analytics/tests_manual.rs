    use super::*;
    use super::coverage::{earn_series_days, players_series_days};
    use std::sync::Mutex;
    use super::portfolio::{period_player_stats, period_sparkline_series};
    use crate::db::SCHEMA_SQL;
    use rusqlite::Connection;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_SQL).unwrap();
        conn
    }

    #[test]
    fn earn_months_ignore_tax_entries() {
        let conn = mem();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO game_earnings(
               game_id, period_from, period_to, observation_day, captured_at, earn
             ) VALUES('1','2026-11-01','2026-11-30','2026-11-10',?1,100.0)",
            [now],
        )
        .unwrap();
        upsert_manual_earn_month(&conn, None, "2026-11", 999.0, None).unwrap();
        let months = list_earn_months(&conn, None).unwrap();
        let nov = months
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m.get("key").and_then(|v| v.as_str()) == Some("2026-11"))
            .unwrap();
        assert!((nov.get("earn").and_then(|v| v.as_f64()).unwrap() - 100.0).abs() < 0.01);
    }

    #[test]
    fn tax_sheet_shifts_console_month() {
        let conn = mem();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO game_earnings(
               game_id, period_from, period_to, observation_day, captured_at, earn
             ) VALUES('1','2026-10-01','2026-10-31','2026-10-31',?1,31000.0)",
            [now],
        )
        .unwrap();
        set_tax_settings(&conn, Some(6.0), Some(1)).unwrap();
        // Ключ = месяц заработка (октябрь), не месяц выплаты.
        upsert_manual_earn_month(&conn, None, "2026-10", 31055.71, Some("налог")).unwrap();

        let sheet = tax_sheet(&conn, None).unwrap();
        assert_eq!(sheet.get("shift").and_then(|v| v.as_i64()), Some(1));
        let oct = sheet
            .get("rows")
            .and_then(|v| v.as_array())
            .unwrap()
            .iter()
            .find(|r| r.get("earnMonth").and_then(|v| v.as_str()) == Some("2026-10"))
            .unwrap();
        assert_eq!(oct.get("payMonth").and_then(|v| v.as_str()), Some("2026-11"));
        assert!((oct.get("consoleEarn").and_then(|v| v.as_f64()).unwrap() - 31000.0).abs() < 0.01);
        assert!((oct.get("taxEarn").and_then(|v| v.as_f64()).unwrap() - 31055.71).abs() < 0.01);
        assert!((oct.get("net").and_then(|v| v.as_f64()).unwrap() - 31055.71 * 0.94).abs() < 0.05);
        // Соседний месяц не должен «украсть» сумму октября через сдвиг.
        let sep = sheet
            .get("rows")
            .and_then(|v| v.as_array())
            .unwrap()
            .iter()
            .find(|r| r.get("earnMonth").and_then(|v| v.as_str()) == Some("2026-09"));
        if let Some(sep) = sep {
            assert!(sep.get("taxEarn").and_then(|v| v.as_f64()).is_none());
        }
    }

    fn day_ms(day: u32, hour: u32) -> i64 {
        NaiveDate::from_ymd_opt(2026, 11, day)
            .unwrap()
            .and_hms_opt(hour, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis()
    }

    fn insert_game(conn: &Connection, id: &str, status: &str, owner: &str) {
        conn.execute(
            "INSERT INTO games(id, title, status, owner_id, first_seen_at, last_seen_at)
             VALUES(?1, ?1, ?2, ?3, 1, 1)",
            params![id, status, owner],
        )
        .unwrap();
    }

    fn insert_point(
        conn: &Connection,
        game: &str,
        series: &str,
        day: u32,
        hour: u32,
        y: Option<f64>,
        captured: i64,
    ) {
        conn.execute(
            "INSERT INTO metric_series(
               game_id, observation_day, captured_at, series_name, point_x, point_y
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                game,
                format!("2026-11-{day:02}"),
                captured,
                series,
                day_ms(day, hour),
                y
            ],
        )
        .unwrap();
    }

    #[test]
    fn series_memo_prefers_positive_then_latest_capture() {
        clear_earn_memo();
        let conn = mem();
        insert_game(&conn, "g1", "published", "acc");
        insert_game(&conn, "g2", "published", "other");
        insert_game(&conn, "draft", "draft", "acc");

        // Более свежий ноль не затирает предыдущее положительное значение дня.
        insert_point(&conn, "g1", "players: Всего", 1, 12, Some(10.0), 1);
        insert_point(&conn, "g1", "players: Всего", 1, 13, Some(0.0), 9);
        insert_point(&conn, "g1", "players: Всего", 2, 12, Some(4.0), 1);
        insert_point(&conn, "g1", "players: Всего", 3, 12, Some(0.0), 1);
        insert_point(&conn, "g1", "purchase_amount: Реклама", 2, 12, Some(3.0), 1);
        insert_point(&conn, "g1", "purchase_amount: Инап-покупки", 2, 12, Some(6.0), 1);
        insert_point(&conn, "g1", "purchase_amount: Инап-покупки", 2, 15, Some(0.0), 9);
        insert_point(&conn, "g2", "players: Всего", 1, 12, Some(100.0), 1);
        insert_point(&conn, "draft", "players: Всего", 1, 12, Some(50.0), 1);

        let stats = period_player_stats(&conn, "2026-11-01", "2026-11-02").unwrap();
        let (avg, sum) = stats["g1"];
        assert!((avg - 7.0).abs() < 1e-9, "avg {avg}");
        assert!((sum - 14.0).abs() < 1e-9, "sum {sum}");
        // Срез игроков портфеля не режет по аккаунту: чужая опубликованная игра остаётся,
        // черновик — нет. Аккаунт применяется в покрытии.
        assert!((stats["g2"].0 - 100.0).abs() < 1e-9);
        assert!(!stats.contains_key("draft"));

        let (sparks, earn) = period_sparkline_series(&conn, "2026-11-01", "2026-11-03").unwrap();
        assert_eq!(sparks["g1"], vec![10.0, 4.0, 0.0]);
        assert!((earn["g1"][0] - 9.0).abs() < 1e-9);

        let days = players_series_days(&conn, Some("acc")).unwrap();
        let nov1 = days
            .iter()
            .find(|d| d["day"] == "2026-11-01")
            .unwrap();
        assert!((nov1["players"].as_f64().unwrap() - 10.0).abs() < 1e-9);
        assert_eq!(nov1["games"].as_i64(), Some(1));
        let nov3 = days.iter().find(|d| d["day"] == "2026-11-03").unwrap();
        assert_eq!(nov3["players"].as_f64().unwrap(), 0.0);
        assert_eq!(nov3["gamesWithValue"].as_i64(), Some(0));
        assert_eq!(nov3["games"].as_i64(), Some(1));

        let earn_days = earn_series_days(&conn, Some("acc")).unwrap();
        let row = earn_days.iter().find(|d| d["day"] == "2026-11-02").unwrap();
        assert!((row["earn"].as_f64().unwrap() - 9.0).abs() < 1e-9);
        assert_eq!(row["gamesWithValue"].as_i64(), Some(1));

        let points = series_period_points(
            &conn,
            "g1",
            "players: Всего",
            day_ms(1, 0),
            day_ms(1, 23),
            0,
        )
        .unwrap();
        assert_eq!(points.len(), 1);
        assert_eq!(points[0]["x"].as_i64(), Some(day_ms(1, 12)));
        assert!((points[0]["y"].as_f64().unwrap() - 10.0).abs() < 1e-9);
    }

    fn live_db_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn series_memo_matches_sql_on_live_db() {
        let path = crate::db::default_db_path();
        if !path.exists() {
            return;
        }
        let _guard = live_db_lock();
        clear_earn_memo();
        let conn = Connection::open(&path).unwrap();
        let sql_players: Vec<(String, f64, i64, i64)> = conn
            .prepare(
                "WITH best AS (
                   SELECT s.game_id,
                          date(s.point_x / 1000, 'unixepoch') AS day,
                          s.point_y,
                          ROW_NUMBER() OVER (
                            PARTITION BY s.game_id, date(s.point_x / 1000, 'unixepoch')
                            ORDER BY CASE WHEN COALESCE(s.point_y, 0) > 0 THEN 1 ELSE 0 END DESC,
                                     s.captured_at DESC
                          ) AS rn
                   FROM metric_series s
                   INNER JOIN games g ON g.id = s.game_id AND g.status = 'published'
                   WHERE s.series_name = 'players: Всего'
                 )
                 SELECT day,
                        COALESCE(SUM(CASE WHEN point_y > 0 THEN point_y ELSE 0 END), 0),
                        SUM(CASE WHEN COALESCE(point_y, 0) > 0 THEN 1 ELSE 0 END),
                        COUNT(*)
                 FROM best WHERE rn = 1 GROUP BY day ORDER BY day",
            )
            .unwrap()
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, f64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        let memo_players = players_series_days(&conn, None).unwrap();
        assert_eq!(memo_players.len(), sql_players.len(), "day count");
        for (sql, memo) in sql_players.iter().zip(memo_players.iter()) {
            assert_eq!(memo["day"].as_str(), Some(sql.0.as_str()));
            let got = memo["players"].as_f64().unwrap();
            assert!((got - sql.1).abs() < 1e-6, "{} sql {} memo {}", sql.0, sql.1, got);
            assert_eq!(memo["gamesWithValue"].as_i64(), Some(sql.2), "{}", sql.0);
            assert_eq!(memo["games"].as_i64(), Some(sql.3), "{}", sql.0);
        }

        let sql_earn: Vec<(String, f64, i64, i64)> = conn
            .prepare(
                "WITH best AS (
                   SELECT s.game_id,
                          date(s.point_x / 1000, 'unixepoch') AS day,
                          s.point_y,
                          ROW_NUMBER() OVER (
                            PARTITION BY s.game_id, s.series_name, date(s.point_x / 1000, 'unixepoch')
                            ORDER BY CASE WHEN COALESCE(s.point_y, 0) > 0 THEN 1 ELSE 0 END DESC,
                                     s.captured_at DESC
                          ) AS rn
                   FROM metric_series s
                   INNER JOIN games g ON g.id = s.game_id AND g.status = 'published'
                   WHERE s.series_name IN ('purchase_amount: Реклама', 'purchase_amount: Инап-покупки')
                 )
                 SELECT day,
                        COALESCE(SUM(CASE WHEN point_y > 0 THEN point_y ELSE 0 END), 0),
                        COUNT(DISTINCT CASE WHEN COALESCE(point_y, 0) > 0 THEN game_id END),
                        COUNT(DISTINCT game_id)
                 FROM best WHERE rn = 1 GROUP BY day ORDER BY day",
            )
            .unwrap()
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, f64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        let memo_earn = earn_series_days(&conn, None).unwrap();
        assert_eq!(memo_earn.len(), sql_earn.len(), "earn day count");
        for (sql, memo) in sql_earn.iter().zip(memo_earn.iter()) {
            assert_eq!(memo["day"].as_str(), Some(sql.0.as_str()));
            let got = memo["earn"].as_f64().unwrap();
            assert!((got - sql.1).abs() < 1e-4, "{} sql {} memo {}", sql.0, sql.1, got);
            assert_eq!(memo["gamesWithValue"].as_i64(), Some(sql.2), "{}", sql.0);
            assert_eq!(memo["games"].as_i64(), Some(sql.3), "{}", sql.0);
        }
    }

    #[test]
    fn games_screen_periods_stay_fast_after_first_load() {
        let path = crate::db::default_db_path();
        if !path.exists() {
            return;
        }
        let _guard = live_db_lock();
        clear_earn_memo();
        let conn = Connection::open(&path).unwrap();
        let _ = players_series_days(&conn, None).unwrap();
        let stamp = |label: &str, f: &dyn Fn()| {
            let t = std::time::Instant::now();
            f();
            eprintln!("{label} {:?}", t.elapsed());
        };
        stamp("list_games year", &|| {
            list_games(&conn, "year", None).unwrap();
        });
        stamp("overview year", &|| {
            let games = list_games(&conn, "year", None).unwrap();
            analytics_overview_with(&conn, "year", None, &games).unwrap();
        });
        stamp("coverage year", &|| {
            data_coverage(&conn, "year", None).unwrap();
        });
        stamp("months", &|| {
            list_earn_months(&conn, None).unwrap();
        });
        stamp("heatmap year", &|| {
            games_heatmap_with(&conn, "year", "prev_month", None, None).unwrap();
        });
        stamp("portfolio year", &|| {
            games_portfolio(&conn, "year", None).unwrap();
        });
        let mut rest = std::time::Duration::ZERO;
        for period in ["day", "week", "month", "all"] {
            let t = std::time::Instant::now();
            let _ = games_screen(&conn, period, "prev_month", None).unwrap();
            let dt = t.elapsed();
            eprintln!("games_screen {period} {dt:?}");
            rest += dt;
            assert!(
                dt.as_millis() < 80,
                "период {period} после прогрева занял {dt:?}"
            );
        }
        assert!(rest.as_millis() < 250, "четыре периода заняли {rest:?}");
    }
