// Lua scripting runtime for "lua-live" code blocks in notes.
// Phase 1: sandboxed execution, returns a string for the preview.

use mlua::{Lua, LuaOptions, LuaSerdeExt, StdLib, Value};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

const SCRIPT_TIMEOUT: Duration = Duration::from_secs(3);
const MEMORY_LIMIT_BYTES: usize = 16 * 1024 * 1024; // 16 MB

pub fn run_script(code: &str) -> Result<String, String> {
    // Load only safe stdlib: string, table, math. No io/os/package/debug.
    let libs = StdLib::STRING | StdLib::TABLE | StdLib::MATH;
    let lua = Lua::new_with(libs, LuaOptions::default())
        .map_err(|e| format!("lua init: {e}"))?;

    lua.set_memory_limit(MEMORY_LIMIT_BYTES)
        .map_err(|e| format!("memory limit: {e}"))?;

    // Strip anything that may have leaked through, just to be safe.
    let globals = lua.globals();
    for name in [
        "dofile", "loadfile", "load", "loadstring", "require",
        "io", "os", "package", "debug", "collectgarbage",
    ] {
        let _ = globals.set(name, Value::Nil);
    }

    // http.get(url) -> { status, body, ok }
    let http_tbl = lua.create_table().map_err(|e| e.to_string())?;
    let get_fn = lua
        .create_function(|lua, url: String| {
            let client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(5))
                .user_agent("Martall-lua-live/0.1")
                .build()
                .map_err(mlua::Error::external)?;
            let resp = client.get(&url).send().map_err(mlua::Error::external)?;
            let status = resp.status().as_u16();
            let ok = resp.status().is_success();
            let body = resp.text().map_err(mlua::Error::external)?;
            let t = lua.create_table()?;
            t.set("status", status)?;
            t.set("ok", ok)?;
            t.set("body", body)?;
            Ok(t)
        })
        .map_err(|e| e.to_string())?;
    http_tbl.set("get", get_fn).map_err(|e| e.to_string())?;
    globals.set("http", http_tbl).map_err(|e| e.to_string())?;

    // json.decode(str) / json.encode(value)
    let json_tbl = lua.create_table().map_err(|e| e.to_string())?;
    let decode_fn = lua
        .create_function(|lua, s: String| {
            let v: serde_json::Value =
                serde_json::from_str(&s).map_err(mlua::Error::external)?;
            lua.to_value(&v)
        })
        .map_err(|e| e.to_string())?;
    let encode_fn = lua
        .create_function(|lua, v: Value| {
            let j: serde_json::Value = lua.from_value(v)?;
            serde_json::to_string(&j).map_err(mlua::Error::external)
        })
        .map_err(|e| e.to_string())?;
    json_tbl.set("decode", decode_fn).map_err(|e| e.to_string())?;
    json_tbl.set("encode", encode_fn).map_err(|e| e.to_string())?;
    globals.set("json", json_tbl).map_err(|e| e.to_string())?;

    // reachable(host, port) -> bool. TCP connect with 2s timeout. No ICMP.
    let reachable_fn = lua
        .create_function(|_, (host, port): (String, Option<u16>)| {
            let port = port.unwrap_or(443);
            let addr = format!("{host}:{port}");
            let mut iter = match addr.to_socket_addrs() {
                Ok(it) => it,
                Err(_) => return Ok(false),
            };
            if let Some(sock) = iter.next() {
                Ok(TcpStream::connect_timeout(&sock, Duration::from_secs(2)).is_ok())
            } else {
                Ok(false)
            }
        })
        .map_err(|e| e.to_string())?;
    globals
        .set("reachable", reachable_fn)
        .map_err(|e| e.to_string())?;

    // now() -> unix timestamp; date(fmt) -> formatted local time
    let now_fn = lua
        .create_function(|_, ()| Ok(chrono::Local::now().timestamp()))
        .map_err(|e| e.to_string())?;
    globals.set("now", now_fn).map_err(|e| e.to_string())?;
    let date_fn = lua
        .create_function(|_, fmt: Option<String>| {
            let fmt = fmt.unwrap_or_else(|| "%Y-%m-%d %H:%M".to_string());
            Ok(chrono::Local::now().format(&fmt).to_string())
        })
        .map_err(|e| e.to_string())?;
    globals.set("date", date_fn).map_err(|e| e.to_string())?;

    // calendar.upcoming(path, days) -> array of "YYYY-MM-DD HH:MM  Summary"
    let calendar_tbl = lua.create_table().map_err(|e| e.to_string())?;
    let upcoming_fn = lua
        .create_function(|lua, (path, days): (String, Option<i64>)| {
            let days = days.unwrap_or(7);
            let now = chrono::Local::now();
            let until = now + chrono::Duration::days(days);
            let file = std::fs::File::open(&path).map_err(mlua::Error::external)?;
            let reader = std::io::BufReader::new(file);
            let parser = ical::IcalParser::new(reader);
            let mut events: Vec<(chrono::DateTime<chrono::Local>, String)> = Vec::new();
            for cal in parser.flatten() {
                for ev in cal.events {
                    let mut summary = String::new();
                    let mut dtstart: Option<String> = None;
                    for prop in ev.properties {
                        match prop.name.as_str() {
                            "SUMMARY" => {
                                if let Some(v) = prop.value {
                                    summary = v;
                                }
                            }
                            "DTSTART" => {
                                dtstart = prop.value;
                            }
                            _ => {}
                        }
                    }
                    if let Some(dt) = dtstart {
                        if let Some(parsed) = parse_ical_dt(&dt) {
                            if parsed >= now && parsed <= until {
                                events.push((parsed, summary));
                            }
                        }
                    }
                }
            }
            events.sort_by_key(|(t, _)| *t);
            let t = lua.create_table()?;
            for (i, (when, summary)) in events.into_iter().enumerate() {
                let line = format!("{}  {}", when.format("%Y-%m-%d %H:%M"), summary);
                t.set(i + 1, line)?;
            }
            Ok(t)
        })
        .map_err(|e| e.to_string())?;
    calendar_tbl
        .set("upcoming", upcoming_fn)
        .map_err(|e| e.to_string())?;
    globals
        .set("calendar", calendar_tbl)
        .map_err(|e| e.to_string())?;

    // chart.line / chart.bar / chart.area — return a sentinel-prefixed
    // JSON string that the frontend recognizes and renders with Chart.js.
    let chart_tbl = lua.create_table().map_err(|e| e.to_string())?;
    for kind in ["line", "bar", "area"] {
        let kind_str = kind.to_string();
        let f = lua
            .create_function(move |lua, spec: Value| {
                let mut j: serde_json::Value = lua.from_value(spec)?;
                if let serde_json::Value::Object(ref mut map) = j {
                    map.insert(
                        "kind".to_string(),
                        serde_json::Value::String(kind_str.clone()),
                    );
                }
                let s = serde_json::to_string(&j).map_err(mlua::Error::external)?;
                Ok(format!("\u{001E}MARTALL_CHART\u{001E}{s}"))
            })
            .map_err(|e| e.to_string())?;
        chart_tbl.set(kind, f).map_err(|e| e.to_string())?;
    }
    globals.set("chart", chart_tbl).map_err(|e| e.to_string())?;

    // Instruction-count hook for timeout enforcement.
    let start = Instant::now();
    lua.set_hook(
        mlua::HookTriggers::new().every_nth_instruction(1000),
        move |_lua, _debug| {
            if start.elapsed() > SCRIPT_TIMEOUT {
                Err(mlua::Error::RuntimeError(
                    "script timeout (3s exceeded)".into(),
                ))
            } else {
                Ok(mlua::VmState::Continue)
            }
        },
    );

    let result: Value = lua
        .load(code)
        .set_name("lua-live")
        .eval()
        .map_err(|e| format!("{e}"))?;

    Ok(value_to_string(&result))
}

fn parse_ical_dt(s: &str) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::{NaiveDate, NaiveDateTime, TimeZone};
    // Strip optional trailing Z (UTC)
    let trimmed = s.trim_end_matches('Z');
    // YYYYMMDDTHHMMSS
    if let Ok(ndt) = NaiveDateTime::parse_from_str(trimmed, "%Y%m%dT%H%M%S") {
        return chrono::Local.from_local_datetime(&ndt).single();
    }
    // YYYYMMDD (all-day event)
    if let Ok(d) = NaiveDate::parse_from_str(trimmed, "%Y%m%d") {
        let ndt = d.and_hms_opt(0, 0, 0)?;
        return chrono::Local.from_local_datetime(&ndt).single();
    }
    None
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::Nil => String::new(),
        Value::Boolean(b) => b.to_string(),
        Value::Integer(i) => i.to_string(),
        Value::Number(n) => format!("{n}"),
        Value::String(s) => s.to_string_lossy().to_string(),
        Value::Table(t) => {
            // Render arrays as joined lines, otherwise key=value lines.
            let mut out = String::new();
            let len = t.raw_len();
            if len > 0 {
                for i in 1..=len {
                    if let Ok(item) = t.raw_get::<Value>(i) {
                        if !out.is_empty() { out.push('\n'); }
                        out.push_str(&value_to_string(&item));
                    }
                }
            } else {
                for pair in t.clone().pairs::<Value, Value>() {
                    if let Ok((k, val)) = pair {
                        if !out.is_empty() { out.push('\n'); }
                        out.push_str(&value_to_string(&k));
                        out.push_str(" = ");
                        out.push_str(&value_to_string(&val));
                    }
                }
            }
            out
        }
        other => format!("{other:?}"),
    }
}
