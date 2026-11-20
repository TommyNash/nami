//! Налог и ручные месяцы дохода.
use super::*;

fn month_bounds_from_key(key: &str) -> Option<(String, String)> {
    if key.len() != 7 || key.as_bytes().get(4) != Some(&b'-') {
        return None;
    }
    let y: i32 = key.get(0..4)?.parse().ok()?;
    let m: u32 = key.get(5..7)?.parse().ok()?;
    let from = NaiveDate::from_ymd_opt(y, m, 1)?;
    let to = if m == 12 {
        NaiveDate::from_ymd_opt(y + 1, 1, 1)?.pred_opt()?
    } else {
        NaiveDate::from_ymd_opt(y, m + 1, 1)?.pred_opt()?
    };
    Some((ymd(from), ymd(to)))
}

fn manual_account_key(account_id: Option<&str>) -> String {
    account_id_opt(account_id).unwrap_or("").to_string()
}

fn load_manual_earn_months(
    conn: &Connection,
    account_id: Option<&str>,
) -> AppResult<HashMap<String, (f64, Option<String>)>> {
    let aid = manual_account_key(account_id);
    let mut stmt = conn.prepare(
        "SELECT month_key, earn, note FROM manual_earn_months WHERE account_id = ?1",
    )?;
    let mut map = HashMap::new();
    let rows = stmt.query_map([&aid], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, f64>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    for row in rows {
        let (key, earn, note) = row?;
        if key.len() != 7 {
            continue;
        }
        if !earn.is_finite() || earn.abs() < 1e-9 {
            continue;
        }
        map.insert(key, (earn, note.filter(|s| !s.trim().is_empty())));
    }
    Ok(map)
}

pub fn list_earn_months(conn: &Connection, account_id: Option<&str>) -> AppResult<Value> {
    // Суммируем по месяцам, но данные берём уже дедуплицированные
    // (load_earnings оставляет один снимок на бакет). Иначе повторные
    // захваты одного диапазона складывались и месяц завышался.
    let rows = load_earnings_for(conn, account_id)?;
    let mut by_bucket: HashMap<(String, String), (f64, Option<String>)> = HashMap::new();
    for row in &rows {
        let Some(v) = row.3 else { continue };
        if v.abs() < 1e-9 {
            continue;
        }
        let key = (row.1.clone(), row.2.clone());
        let entry = by_bucket.entry(key).or_insert((0.0, None));
        entry.0 += v;
        let day = if row.5.is_empty() { None } else { Some(row.5.clone()) };
        if let Some(d) = day {
            if entry.1.as_deref().map(|prev| d > prev.to_string()).unwrap_or(true) {
                entry.1 = Some(d);
            }
        }
    }

    let mut months: HashMap<String, (String, String, f64, Option<String>)> = HashMap::new();
    for ((from, to), (earn, observed)) in by_bucket {
        if !is_monthly_bucket(&from, &to) {
            continue;
        }
        let key = from.get(0..7).unwrap_or("").to_string();
        if key.len() != 7 {
            continue;
        }
        // Приоритет: покрытие больше (полный месяц вместо MTD), затем свежесть.
        let prev = months.get(&key);
        let span = earn_span_days(&from, &to);
        let better = match prev {
            None => true,
            Some(p) => {
                let prev_span = earn_span_days(&p.0, &p.1);
                if span != prev_span {
                    span > prev_span
                } else {
                    earn >= p.2
                }
            }
        };
        if better {
            months.insert(key.clone(), (from, to, earn, observed));
        }
    }

    // График «Доход по месяцам» — только консоль. Налоговые суммы живут
    // на отдельном экране сверки (tax_sheet), без подмены баров.
    let mut list: Vec<_> = months
        .into_iter()
        .map(|(key, (from, to, earn, observed))| {
            json!({
                "key": key,
                "period": format!("m:{key}"),
                "from": from,
                "to": to,
                "earn": earn,
                "collectedDay": observed
            })
        })
        .collect();
    list.sort_by(|a, b| {
        b.get("key")
            .and_then(|v| v.as_str())
            .cmp(&a.get("key").and_then(|v| v.as_str()))
    });
    Ok(Value::Array(list))
}

fn shift_month_key(key: &str, delta_months: i32) -> Option<String> {
    let (from, _) = month_bounds_from_key(key)?;
    let d = parse_ymd(&from)?;
    let shifted = if delta_months >= 0 {
        d.checked_add_months(chrono::Months::new(delta_months as u32))?
    } else {
        d.checked_sub_months(chrono::Months::new((-delta_months) as u32))?
    };
    Some(format!("{:04}-{:02}", shifted.year(), shifted.month()))
}

fn tax_rate_of(conn: &Connection) -> f64 {
    crate::db::meta_get(conn, "tax_rate")
        .ok()
        .flatten()
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0 && *v <= 100.0)
        .unwrap_or(6.0)
}

fn tax_shift_of(conn: &Connection) -> i32 {
    crate::db::meta_get(conn, "tax_shift")
        .ok()
        .flatten()
        .and_then(|s| s.parse::<i32>().ok())
        .filter(|v| (-6..=6).contains(v))
        .unwrap_or(1)
}

/// Сводка «консоль ↔ налог» со сдвигом месяца.
/// shift=1: налог за ноябрь сверяется с консолью за октябрь
/// (в налог октябрьский доход приходит месяцем позже).
pub fn tax_sheet(conn: &Connection, account_id: Option<&str>) -> AppResult<Value> {
    let rate = tax_rate_of(conn);
    let shift = tax_shift_of(conn);
    let console_months = {
        // Переиспользуем list_earn_months → только консоль.
        let raw = list_earn_months(conn, account_id)?;
        let mut map = HashMap::new();
        if let Some(arr) = raw.as_array() {
            for m in arr {
                let key = m.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let earn = m.get("earn").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if key.len() == 7 && earn.is_finite() {
                    map.insert(key, earn);
                }
            }
        }
        map
    };
    let tax_map = load_manual_earn_months(conn, account_id)?;

    // Ряды — по месяцу заработка. Ключ в manual_earn_months = месяц заработка.
    // Сдвиг только подписывает выплату (окт → выпл. ноя), чужие месяцы не читаем.
    let mut earn_keys: HashSet<String> = HashSet::new();
    for ck in console_months.keys() {
        earn_keys.insert(ck.clone());
    }
    for stored in tax_map.keys() {
        earn_keys.insert(stored.clone());
    }
    if let Some(today) = Local::now().date_naive().with_day(1) {
        for i in 0..18 {
            if let Some(d) = today.checked_sub_months(chrono::Months::new(i)) {
                earn_keys.insert(format!("{:04}-{:02}", d.year(), d.month()));
            }
        }
    }

    let mut rows: Vec<Value> = earn_keys
        .into_iter()
        .filter_map(|earn_key| {
            let pay_key = shift_month_key(&earn_key, shift)?;
            let console_earn = console_months.get(&earn_key).copied().unwrap_or(0.0);
            let (tax_earn, note) = tax_map
                .get(&earn_key)
                .map(|(e, n)| (*e, n.clone()))
                .unwrap_or((0.0, None));
            let has_tax = tax_earn > 1e-9;
            let has_console = console_earn > 1e-9;
            if !has_tax && !has_console {
                let now_key = format!(
                    "{:04}-{:02}",
                    Local::now().year(),
                    Local::now().month()
                );
                if earn_key > now_key {
                    return None;
                }
            }
            let delta = if has_tax && has_console {
                Some(tax_earn - console_earn)
            } else {
                None
            };
            let tax_due = if has_tax { tax_earn * rate / 100.0 } else { 0.0 };
            let net = if has_tax { tax_earn - tax_due } else { 0.0 };
            Some(json!({
                "earnMonth": earn_key,
                "payMonth": pay_key,
                "taxMonth": pay_key,
                "consoleMonth": earn_key,
                "taxEarn": if has_tax { json!(tax_earn) } else { Value::Null },
                "consoleEarn": if has_console { json!(console_earn) } else { Value::Null },
                "delta": delta,
                "taxDue": if has_tax { json!(tax_due) } else { Value::Null },
                "net": if has_tax { json!(net) } else { Value::Null },
                "note": note,
                "hasTax": has_tax,
                "hasConsole": has_console
            }))
        })
        .collect();
    rows.sort_by(|a, b| {
        b.get("earnMonth")
            .and_then(|v| v.as_str())
            .cmp(&a.get("earnMonth").and_then(|v| v.as_str()))
    });

    let tax_vals: Vec<f64> = rows
        .iter()
        .filter_map(|r| r.get("taxEarn").and_then(|v| v.as_f64()))
        .filter(|v| *v > 0.0)
        .collect();
    let console_vals: Vec<f64> = rows
        .iter()
        .filter_map(|r| r.get("consoleEarn").and_then(|v| v.as_f64()))
        .filter(|v| *v > 0.0)
        .collect();
    let sum = |xs: &[f64]| xs.iter().sum::<f64>();
    let avg = |xs: &[f64]| {
        if xs.is_empty() {
            0.0
        } else {
            sum(xs) / xs.len() as f64
        }
    };
    let min = |xs: &[f64]| xs.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = |xs: &[f64]| xs.iter().cloned().fold(0.0_f64, f64::max);
    let tax_sum = sum(&tax_vals);
    let tax_due_sum = tax_sum * rate / 100.0;

    Ok(json!({
        "rate": rate,
        "shift": shift,
        "rows": rows,
        "stats": {
            "taxCount": tax_vals.len(),
            "taxSum": tax_sum,
            "taxAvg": avg(&tax_vals),
            "taxMin": if tax_vals.is_empty() { Value::Null } else { json!(min(&tax_vals)) },
            "taxMax": if tax_vals.is_empty() { Value::Null } else { json!(max(&tax_vals)) },
            "consoleSum": sum(&console_vals),
            "consoleAvg": avg(&console_vals),
            "taxDueSum": tax_due_sum,
            "netSum": tax_sum - tax_due_sum
        }
    }))
}

pub fn set_tax_settings(conn: &Connection, rate: Option<f64>, shift: Option<i32>) -> AppResult<Value> {
    if let Some(r) = rate {
        if !r.is_finite() || r < 0.0 || r > 100.0 {
            return Ok(json!({ "ok": false, "error": "bad_rate" }));
        }
        crate::db::meta_set(conn, "tax_rate", &format!("{r}"))?;
    }
    if let Some(s) = shift {
        if !(-6..=6).contains(&s) {
            return Ok(json!({ "ok": false, "error": "bad_shift" }));
        }
        crate::db::meta_set(conn, "tax_shift", &s.to_string())?;
    }
    Ok(json!({
        "ok": true,
        "rate": tax_rate_of(conn),
        "shift": tax_shift_of(conn)
    }))
}

pub fn upsert_manual_earn_month(
    conn: &Connection,
    account_id: Option<&str>,
    month_key: &str,
    earn: f64,
    note: Option<&str>,
) -> AppResult<Value> {
    let key = month_key.trim();
    if month_bounds_from_key(key).is_none() {
        return Ok(json!({ "ok": false, "error": "bad_month" }));
    }
    if !earn.is_finite() || earn < 0.0 {
        return Ok(json!({ "ok": false, "error": "bad_earn" }));
    }
    let aid = manual_account_key(account_id);
    let now = chrono::Utc::now().timestamp_millis();
    let note_clean = note.map(str::trim).filter(|s| !s.is_empty());
    if earn.abs() < 1e-9 {
        conn.execute(
            "DELETE FROM manual_earn_months WHERE account_id = ?1 AND month_key = ?2",
            params![aid, key],
        )?;
        return Ok(json!({ "ok": true, "deleted": true, "key": key }));
    }
    conn.execute(
        "INSERT INTO manual_earn_months(account_id, month_key, earn, note, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(account_id, month_key) DO UPDATE SET
           earn = excluded.earn,
           note = excluded.note,
           updated_at = excluded.updated_at",
        params![aid, key, earn, note_clean, now],
    )?;
    Ok(json!({ "ok": true, "key": key, "earn": earn, "note": note_clean }))
}

pub fn delete_manual_earn_month(
    conn: &Connection,
    account_id: Option<&str>,
    month_key: &str,
) -> AppResult<Value> {
    let key = month_key.trim();
    let aid = manual_account_key(account_id);
    let n = conn.execute(
        "DELETE FROM manual_earn_months WHERE account_id = ?1 AND month_key = ?2",
        params![aid, key],
    )?;
    Ok(json!({ "ok": true, "deleted": n > 0, "key": key }))
}

