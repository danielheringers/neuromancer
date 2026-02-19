use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use crate::app_server_runtime::write_json_line;
use crate::resolve_codex_launch;

use super::rate_limit_snapshot::{
    extract_rate_limits_from_app_server_message, StatusRateLimitSnapshot,
};

pub(crate) fn fetch_rate_limits_for_status(
    binary: &str,
    cwd: &Path,
) -> Option<StatusRateLimitSnapshot> {
    let app_server_args = vec!["app-server".to_string()];
    let (program, resolved_args) = resolve_codex_launch(binary, &app_server_args).ok()?;

    let mut command = Command::new(program);
    command.args(resolved_args);
    command.current_dir(cwd);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::null());

    let mut child = command.spawn().ok()?;
    let mut stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;

    let (tx, rx) = mpsc::channel::<Value>();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            let read = match reader.read_line(&mut line) {
                Ok(value) => value,
                Err(_) => break,
            };
            if read == 0 {
                break;
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
                let _ = tx.send(parsed);
            }
        }
    });

    let initialize_request = json!({
        "method": "initialize",
        "id": "alicia-init",
        "params": {
            "clientInfo": {
                "name": "alicia-status",
                "title": "Alicia Status",
                "version": "0.1.0",
            },
            "capabilities": {
                "experimentalApi": false,
            },
        },
    });
    let initialized_notification = json!({
        "method": "initialized",
        "params": {},
    });
    let read_limits_request = json!({
        "method": "account/rateLimits/read",
        "id": "alicia-rate-limits",
    });

    for payload in [initialize_request, initialized_notification, read_limits_request] {
        if write_json_line(&mut stdin, &payload).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut snapshot: Option<StatusRateLimitSnapshot> = None;
    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        let remaining = deadline.saturating_duration_since(now);
        let Ok(message) = rx.recv_timeout(remaining) else {
            break;
        };

        if let Some(parsed) = extract_rate_limits_from_app_server_message(&message) {
            snapshot = Some(parsed);
            if message
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| id == "alicia-rate-limits")
            {
                break;
            }
        }
    }

    let _ = child.kill();
    let _ = child.wait();
    snapshot
}
