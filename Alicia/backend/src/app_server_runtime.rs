use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::path::Path;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use crate::resolve_codex_launch;

pub(crate) fn write_json_line(stdin: &mut ChildStdin, payload: &Value) -> Result<(), String> {
    let serialized = serde_json::to_string(payload)
        .map_err(|error| format!("failed to encode json-rpc payload: {error}"))?;
    writeln!(stdin, "{serialized}")
        .map_err(|error| format!("failed to write json-rpc payload to app-server stdin: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("failed to flush app-server stdin: {error}"))
}

pub(crate) fn fetch_mcp_statuses_for_startup(binary: &str, cwd: &Path) -> Result<Vec<String>, String> {
    let app_server_args = vec!["app-server".to_string()];
    let (program, resolved_args) = resolve_codex_launch(binary, &app_server_args)?;

    let mut command = Command::new(program);
    command.args(resolved_args);
    command.current_dir(cwd);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::null());

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            format!("failed to spawn app-server for MCP warmup: executable not found ({error})")
        } else {
            format!("failed to spawn app-server for MCP warmup: {error}")
        }
    })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture app-server stdin for MCP warmup".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture app-server stdout for MCP warmup".to_string())?;

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

    let result: Result<Vec<String>, String> = (|| {
        write_json_line(
            &mut stdin,
            &json!({
                "method": "initialize",
                "id": "alicia-mcp-init",
                "params": {
                    "clientInfo": {
                        "name": "alicia-mcp-startup",
                        "title": "Alicia MCP Startup",
                        "version": "0.1.0",
                    },
                    "capabilities": {
                        "experimentalApi": false,
                    },
                },
            }),
        )?;
        write_json_line(
            &mut stdin,
            &json!({
                "method": "initialized",
                "params": {},
            }),
        )?;

        let mut ready_servers = HashSet::<String>::new();
        let mut cursor: Option<String> = None;
        let mut page: u32 = 0;

        loop {
            page += 1;
            let request_id = format!("alicia-mcp-status-{page}");
            write_json_line(
                &mut stdin,
                &json!({
                    "method": "mcpServerStatus/list",
                    "id": request_id.clone(),
                    "params": {
                        "limit": 100,
                        "cursor": cursor.clone(),
                    },
                }),
            )?;

            let deadline = Instant::now() + Duration::from_secs(90);
            let response_message = loop {
                let now = Instant::now();
                if now >= deadline {
                    return Err(
                        "timed out waiting for mcpServerStatus/list response from app-server"
                            .to_string(),
                    );
                }
                let remaining = deadline.saturating_duration_since(now);
                let message = rx.recv_timeout(remaining).map_err(|_| {
                    "timed out waiting for mcpServerStatus/list response from app-server"
                        .to_string()
                })?;

                if message
                    .get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value == request_id)
                {
                    break message;
                }
            };

            if let Some(error_value) = response_message.get("error") {
                let message = error_value
                    .get("message")
                    .and_then(Value::as_str)
                    .or_else(|| error_value.as_str())
                    .unwrap_or("unknown app-server mcpServerStatus/list error");
                return Err(format!("mcpServerStatus/list request failed: {message}"));
            }

            let result_value = response_message
                .get("result")
                .ok_or_else(|| "mcpServerStatus/list response missing `result`".to_string())?;

            if let Some(entries) = result_value.get("data").and_then(Value::as_array) {
                for entry in entries {
                    if let Some(name) = entry
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    {
                        ready_servers.insert(name.to_string());
                    }
                }
            }

            let next_cursor = result_value
                .get("nextCursor")
                .and_then(Value::as_str)
                .or_else(|| result_value.get("next_cursor").and_then(Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);

            if let Some(next_cursor) = next_cursor {
                cursor = Some(next_cursor);
            } else {
                break;
            }
        }

        let mut ready_servers = ready_servers.into_iter().collect::<Vec<_>>();
        ready_servers.sort();
        Ok(ready_servers)
    })();

    let _ = child.kill();
    let _ = child.wait();
    result
}
