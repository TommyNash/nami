//! Доменные типы Nami без I/O.
use chrono::{Local, NaiveDate};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
pub struct PeriodBounds {
    #[serde(rename = "fromDay")]
    pub from_day: String,
    #[serde(rename = "toDay")]
    pub to_day: String,
    #[serde(rename = "monthKey", skip_serializing_if = "Option::is_none")]
    pub month_key: Option<String>,
    #[serde(rename = "monthComplete", skip_serializing_if = "Option::is_none")]
    pub month_complete: Option<bool>,
}

pub fn ymd(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

pub fn parse_ymd(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

pub fn days_between(from: NaiveDate, to: NaiveDate) -> i64 {
    (to - from).num_days() + 1
}

pub fn bounds_value(b: &PeriodBounds) -> Value {
    json!({
        "fromDay": b.from_day,
        "toDay": b.to_day,
    })
}
