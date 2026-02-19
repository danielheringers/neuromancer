use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, ErrorKind};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use crate::app_server_runtime::write_json_line;
use crate::{resolve_codex_launch, CodexModel, CodexReasoningEffortOption};

fn parse_reasoning_effort_option(value: &Value) -> Option<CodexReasoningEffortOption> {
    let object = value.as_object()?;
    let reasoning_effort = object
        .get("reasoningEffort")
        .and_then(Value::as_str)
        .or_else(|| object.get("reasoning_effort").and_then(Value::as_str))?
        .trim()
        .to_string();

    if reasoning_effort.is_empty() {
        return None;
    }

    let description = object
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| reasoning_effort.clone());

    Some(CodexReasoningEffortOption {
        reasoning_effort,
        description,
    })
}

fn parse_codex_model(value: &Value) -> Option<CodexModel> {
    let object = value.as_object()?;
    let id = object.get("id").and_then(Value::as_str)?.trim().to_string();
    if id.is_empty() {
        return None;
    }

    let model = object
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| id.clone());

    let display_name = object
        .get("displayName")
        .and_then(Value::as_str)
        .or_else(|| object.get("display_name").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| model.clone());

    let description = object
        .get("description")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_default();

    let mut supported_reasoning_efforts = Vec::new();
    let mut seen_efforts = HashSet::new();
    if let Some(options) = object
        .get("supportedReasoningEfforts")
        .or_else(|| object.get("supported_reasoning_efforts"))
        .and_then(Value::as_array)
    {
        for option in options {
            if let Some(parsed) = parse_reasoning_effort_option(option) {
                if seen_efforts.insert(parsed.reasoning_effort.clone()) {
                    supported_reasoning_efforts.push(parsed);
                }
            }
        }
    }

    let default_reasoning_effort = object
        .get("defaultReasoningEffort")
        .and_then(Value::as_str)
        .or_else(|| object.get("default_reasoning_effort").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            supported_reasoning_efforts
                .first()
                .map(|entry| entry.reasoning_effort.clone())
        })
        .unwrap_or_else(|| "medium".to_string());

    let supports_personality = object
        .get("supportsPersonality")
        .and_then(Value::as_bool)
        .or_else(|| object.get("supports_personality").and_then(Value::as_bool))
        .unwrap_or(false);

    let is_default = object
        .get("isDefault")
        .and_then(Value::as_bool)
        .or_else(|| object.get("is_default").and_then(Value::as_bool))
        .unwrap_or(false);

    let upgrade = object
        .get("upgrade")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    Some(CodexModel {
        id,
        model,
        display_name,
        description,
        supported_reasoning_efforts,
        default_reasoning_effort,
        supports_personality,
        is_default,
        upgrade,
    })
}

fn parse_model_list_result(result: &Value) -> Result<(Vec<CodexModel>, Option<String>), String> {
    let object = result
        .as_object()
        .ok_or_else(|| "model/list result was not a JSON object".to_string())?;

    let data = object
        .get("data")
        .or_else(|| object.get("items"))
        .and_then(Value::as_array)
        .ok_or_else(|| "model/list result missing `data` array".to_string())?;

    let mut parsed = Vec::new();
    for entry in data {
        if let Some(model) = parse_codex_model(entry) {
            parsed.push(model);
        }
    }

    let next_cursor = object
        .get("nextCursor")
        .and_then(Value::as_str)
        .or_else(|| object.get("next_cursor").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    Ok((parsed, next_cursor))
}

pub fn fetch_models_for_picker(binary: &str, cwd: &Path) -> Result<Vec<CodexModel>, String> {
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
            format!(
                "failed to spawn app-server for model/list: executable not found ({error})"
            )
        } else {
            format!("failed to spawn app-server for model/list: {error}")
        }
    })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture app-server stdin for model/list".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture app-server stdout for model/list".to_string())?;

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

    let result: Result<Vec<CodexModel>, String> = (|| {
        write_json_line(
            &mut stdin,
            &json!({
                "method": "initialize",
                "id": "alicia-models-init",
                "params": {
                    "clientInfo": {
                        "name": "alicia-models",
                        "title": "Alicia Model Picker",
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

        let mut all_models = Vec::<CodexModel>::new();
        let mut seen_model_ids = HashSet::<String>::new();
        let mut cursor: Option<String> = None;
        let mut page: u32 = 0;

        loop {
            page += 1;
            let request_id = format!("alicia-model-list-{page}");
            write_json_line(
                &mut stdin,
                &json!({
                    "method": "model/list",
                    "id": request_id.clone(),
                    "params": {
                        "limit": 100,
                        "cursor": cursor.clone(),
                    },
                }),
            )?;

            let deadline = Instant::now() + Duration::from_secs(10);
            let response_message = loop {
                let now = Instant::now();
                if now >= deadline {
                    return Err(
                        "timed out waiting for model/list response from app-server".to_string(),
                    );
                }
                let remaining = deadline.saturating_duration_since(now);
                let message = rx.recv_timeout(remaining).map_err(|_| {
                    "timed out waiting for model/list response from app-server".to_string()
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
                    .unwrap_or("unknown app-server model/list error");
                return Err(format!("model/list request failed: {message}"));
            }

            let result_value = response_message
                .get("result")
                .ok_or_else(|| "model/list response missing `result`".to_string())?;

            let (page_models, next_cursor) = parse_model_list_result(result_value)?;
            for model in page_models {
                if seen_model_ids.insert(model.id.clone()) {
                    all_models.push(model);
                }
            }

            if let Some(next_cursor) = next_cursor {
                cursor = Some(next_cursor);
            } else {
                break;
            }
        }

        Ok(all_models)
    })();

    let _ = child.kill();
    let _ = child.wait();
    result
}


