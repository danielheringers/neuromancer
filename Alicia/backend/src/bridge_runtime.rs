use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

use crate::{emit_codex_event, emit_stderr, resolve_binary_path};

pub(crate) type BridgePendingMap = HashMap<u64, oneshot::Sender<Result<Value, String>>>;

pub(crate) struct BridgeProcess {
    pub(crate) child: Child,
    pub(crate) stdin: Arc<Mutex<ChildStdin>>,
    pub(crate) pending: Arc<Mutex<BridgePendingMap>>,
    pub(crate) next_request_id: Arc<AtomicU64>,
}

fn fail_pending_requests(pending: &Arc<Mutex<BridgePendingMap>>, message: &str) {
    if let Ok(mut guard) = pending.lock() {
        let mut senders = Vec::with_capacity(guard.len());
        for (_, tx) in guard.drain() {
            senders.push(tx);
        }
        drop(guard);
        for tx in senders {
            let _ = tx.send(Err(message.to_string()));
        }
    }
}

fn resolve_bridge_entrypoint() -> Option<PathBuf> {
    if let Some(path) = env::var_os("ALICIA_CODEX_BRIDGE_ENTRY") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let mut candidates = Vec::<PathBuf>::new();

    if let Ok(cwd) = env::current_dir() {
        for ancestor in cwd.ancestors() {
            candidates.push(ancestor.join("alicia").join("codex-bridge").join("index.mjs"));
            candidates.push(ancestor.join("codex-bridge").join("index.mjs"));
        }
    }

    if let Ok(exe_path) = env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            for ancestor in parent.ancestors() {
                candidates.push(ancestor.join("alicia").join("codex-bridge").join("index.mjs"));
                candidates.push(ancestor.join("codex-bridge").join("index.mjs"));
            }
        }
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

pub(crate) fn spawn_bridge_process(
    app: &tauri::AppHandle,
    session_id: u64,
    cwd: &Path,
    env_overrides: &HashMap<String, String>,
    binary: &str,
    event_seq: Arc<AtomicU64>,
) -> Result<BridgeProcess, String> {
    let node_binary = resolve_binary_path("node")
        .ok_or_else(|| "node runtime not found. Install Node.js to run codex bridge.".to_string())?;
    let bridge_entry = resolve_bridge_entrypoint().ok_or_else(|| {
        "codex bridge entrypoint not found. Expected `alicia/codex-bridge/index.mjs`.".to_string()
    })?;

    let mut command = Command::new(node_binary);
    command.arg(bridge_entry);
    command.current_dir(cwd);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.env("ALICIA_CODEX_BIN", binary);
    for (key, value) in env_overrides {
        command.env(key, value);
    }

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            format!("failed to launch codex bridge: executable not found ({error})")
        } else {
            format!("failed to launch codex bridge: {error}")
        }
    })?;

    let child_stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture codex bridge stdin".to_string())?;
    let child_stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture codex bridge stdout".to_string())?;
    let child_stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture codex bridge stderr".to_string())?;

    let pending = Arc::new(Mutex::new(HashMap::<
        u64,
        oneshot::Sender<Result<Value, String>>,
    >::new()));

    let pending_stdout = Arc::clone(&pending);
    let app_stdout = app.clone();
    let event_seq_stdout = Arc::clone(&event_seq);
    thread::spawn(move || {
        let mut reader = BufReader::new(child_stdout);
        let mut line = String::new();

        loop {
            line.clear();
            let bytes_read = match reader.read_line(&mut line) {
                Ok(value) => value,
                Err(error) => {
                    emit_stderr(
                        &app_stdout,
                        session_id,
                        format!("[bridge] failed to read stdout: {error}"),
                    );
                    break;
                }
            };

            if bytes_read == 0 {
                break;
            }

            let raw = line.trim();
            if raw.is_empty() {
                continue;
            }

            let parsed = match serde_json::from_str::<Value>(raw) {
                Ok(value) => value,
                Err(error) => {
                    emit_stderr(
                        &app_stdout,
                        session_id,
                        format!("[bridge] invalid json message: {error}"),
                    );
                    continue;
                }
            };

            let message_type = parsed
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or_default();

            if message_type == "response" {
                let response_id = parsed.get("id").and_then(|value| value.as_u64()).unwrap_or(0);
                let ok = parsed.get("ok").and_then(|value| value.as_bool()).unwrap_or(false);
                let sender = if let Ok(mut guard) = pending_stdout.lock() {
                    guard.remove(&response_id)
                } else {
                    None
                };

                if let Some(tx) = sender {
                    if ok {
                        let result = parsed.get("result").cloned().unwrap_or(Value::Null);
                        let _ = tx.send(Ok(result));
                    } else {
                        let error = parsed
                            .get("error")
                            .and_then(|value| value.as_str())
                            .unwrap_or("codex bridge request failed")
                            .to_string();
                        let _ = tx.send(Err(error));
                    }
                }
                continue;
            }

            if message_type == "event" {
                if let Some(event) = parsed.get("event").cloned() {
                    emit_codex_event(&app_stdout, session_id, event, &event_seq_stdout);
                }
                continue;
            }

            emit_stderr(
                &app_stdout,
                session_id,
                format!("[bridge] unsupported message type: {message_type}"),
            );
        }

        fail_pending_requests(&pending_stdout, "codex bridge stdout closed");
    });

    let pending_stderr = Arc::clone(&pending);
    let app_stderr = app.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(child_stderr);
        let mut line = String::new();
        loop {
            line.clear();
            let bytes_read = match reader.read_line(&mut line) {
                Ok(value) => value,
                Err(_) => break,
            };
            if bytes_read == 0 {
                break;
            }
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                emit_stderr(&app_stderr, session_id, format!("[bridge] {trimmed}"));
            }
        }
        fail_pending_requests(&pending_stderr, "codex bridge stderr closed");
    });

    Ok(BridgeProcess {
        child,
        stdin: Arc::new(Mutex::new(child_stdin)),
        pending,
        next_request_id: Arc::new(AtomicU64::new(1)),
    })
}

pub(crate) async fn bridge_request(
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<BridgePendingMap>>,
    next_request_id: Arc<AtomicU64>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let request_id = next_request_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel::<Result<Value, String>>();
    {
        let mut guard = pending
            .lock()
            .map_err(|_| "bridge pending lock poisoned".to_string())?;
        guard.insert(request_id, tx);
    }

    let payload = json!({
        "type": "request",
        "id": request_id,
        "method": method,
        "params": params,
    });
    let serialized = serde_json::to_string(&payload)
        .map_err(|error| format!("failed to serialize bridge request: {error}"))?;

    {
        let mut writer = stdin
            .lock()
            .map_err(|_| "bridge stdin lock poisoned".to_string())?;
        writer
            .write_all(serialized.as_bytes())
            .map_err(|error| format!("failed to write bridge request: {error}"))?;
        writer
            .write_all(b"\n")
            .map_err(|error| format!("failed to finish bridge request: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("failed to flush bridge request: {error}"))?;
    }

    match timeout(Duration::from_secs(600), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_closed)) => Err("bridge response channel closed".to_string()),
        Err(_elapsed) => {
            if let Ok(mut guard) = pending.lock() {
                guard.remove(&request_id);
            }
            Err("bridge request timed out".to_string())
        }
    }
}

pub(crate) fn stop_bridge_process(mut bridge: BridgeProcess) {
    if let Ok(mut stdin) = bridge.stdin.lock() {
        let payload = json!({
            "type": "request",
            "id": 0,
            "method": "session.stop",
            "params": {},
        });
        if let Ok(serialized) = serde_json::to_string(&payload) {
            let _ = stdin.write_all(serialized.as_bytes());
            let _ = stdin.write_all(b"\n");
            let _ = stdin.flush();
        }
    }

    let _ = bridge.child.kill();
    let _ = bridge.child.wait();
    fail_pending_requests(&bridge.pending, "codex bridge stopped");
}
