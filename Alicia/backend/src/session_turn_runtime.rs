use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::bridge_runtime::bridge_request;
use crate::status_runtime::{fetch_rate_limits_for_status, format_non_tui_status};
use crate::{
    emit_lifecycle, emit_stderr, emit_stdout, lock_active_session, lock_runtime_config,
    AppState, CodexInputItem, CodexThreadOpenResponse, CodexTurnRunRequest,
    CodexTurnRunResponse, RuntimeCodexConfig,
};

fn runtime_config_to_json(config: &RuntimeCodexConfig, binary: &str) -> Value {
    json!({
        "model": config.model,
        "reasoning": config.reasoning,
        "approvalPolicy": config.approval_policy,
        "sandbox": config.sandbox,
        "profile": config.profile,
        "webSearchMode": config.web_search_mode,
        "binary": binary,
    })
}

fn finish_session_turn(app: &AppHandle, session_id: u64, discovered_thread_id: Option<String>) {
    let state = app.state::<AppState>();
    let mut guard = match lock_active_session(state.inner()) {
        Ok(guard) => guard,
        Err(_) => return,
    };

    let Some(active) = guard.as_mut() else {
        return;
    };

    if active.session_id != session_id {
        return;
    }

    active.busy = false;
    if let Some(thread_id) = discovered_thread_id {
        active.thread_id = Some(thread_id);
    }
}

fn parse_slash_command(prompt: &str) -> Option<(&str, &str)> {
    let trimmed = prompt.trim();
    if !trimmed.starts_with('/') {
        return None;
    }

    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let command = parts.next()?;
    let args = parts.next().unwrap_or("").trim();
    Some((command, args))
}

async fn schedule_turn_run(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CodexTurnRunRequest,
) -> Result<CodexTurnRunResponse, String> {
    let runtime_config = lock_runtime_config(state.inner())?.clone();
    let CodexTurnRunRequest {
        thread_id: requested_thread_id,
        input_items,
        output_schema,
    } = request;

    let (session_id, pid, binary, cwd, initial_thread_id, stdin, pending, next_request_id) = {
        let mut guard = lock_active_session(state.inner())?;
        let active = guard
            .as_mut()
            .ok_or_else(|| "no active codex session".to_string())?;

        if active.busy {
            return Err("codex session is still processing the previous turn".to_string());
        }

        active.busy = true;

        (
            active.session_id,
            active.pid,
            active.binary.clone(),
            active.cwd.clone(),
            active.thread_id.clone(),
            Arc::clone(&active.bridge.stdin),
            Arc::clone(&active.bridge.pending),
            Arc::clone(&active.bridge.next_request_id),
        )
    };

    let response = CodexTurnRunResponse {
        accepted: true,
        session_id,
        thread_id: initial_thread_id.clone(),
    };

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let result: Result<String, String> = async {
            let mut thread_id = requested_thread_id.or(initial_thread_id);
            if thread_id.as_ref().map(|value| value.trim().is_empty()).unwrap_or(true) {
                let open_result = bridge_request(
                    Arc::clone(&stdin),
                    Arc::clone(&pending),
                    Arc::clone(&next_request_id),
                    "thread.open",
                    json!({
                        "workspace": cwd.to_string_lossy().to_string(),
                        "runtimeConfig": runtime_config_to_json(&runtime_config, &binary),
                    }),
                )
                .await?;
                thread_id = open_result
                    .get("threadId")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string());
            }

            let thread_id = thread_id.ok_or_else(|| "failed to establish thread id".to_string())?;
            let mut run_params = serde_json::Map::new();
            run_params.insert("threadId".to_string(), Value::String(thread_id.clone()));
            run_params.insert(
                "workspace".to_string(),
                Value::String(cwd.to_string_lossy().to_string()),
            );
            run_params.insert(
                "runtimeConfig".to_string(),
                runtime_config_to_json(&runtime_config, &binary),
            );
            run_params.insert("inputItems".to_string(), json!(input_items));
            if let Some(schema) = output_schema {
                run_params.insert("outputSchema".to_string(), schema);
            }

            let run_result = bridge_request(
                Arc::clone(&stdin),
                Arc::clone(&pending),
                Arc::clone(&next_request_id),
                "turn.run",
                Value::Object(run_params),
            )
            .await?;

            let returned_thread_id = run_result
                .get("threadId")
                .and_then(|value| value.as_str())
                .unwrap_or(&thread_id)
                .to_string();
            Ok(returned_thread_id)
        }
        .await;

        match result {
            Ok(returned_thread_id) => {
                finish_session_turn(&app_for_task, session_id, Some(returned_thread_id));
            }
            Err(error) => {
                emit_lifecycle(
                    &app_for_task,
                    "error",
                    Some(session_id),
                    pid,
                    None,
                    Some(error),
                );
                finish_session_turn(&app_for_task, session_id, None);
            }
        }
    });

    Ok(response)
}

pub(crate) async fn codex_turn_run_impl(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CodexTurnRunRequest,
) -> Result<CodexTurnRunResponse, String> {
    if request.input_items.is_empty() {
        return Err("input_items cannot be empty".to_string());
    }
    if request
        .output_schema
        .as_ref()
        .is_some_and(|schema| !schema.is_object())
    {
        return Err("output_schema must be a plain JSON object".to_string());
    }
    schedule_turn_run(app, state, request).await
}

pub(crate) async fn codex_thread_open_impl(
    state: State<'_, AppState>,
    thread_id: Option<String>,
) -> Result<CodexThreadOpenResponse, String> {
    let runtime_config = lock_runtime_config(state.inner())?.clone();
    let (binary, cwd, stdin, pending, next_request_id) = {
        let guard = lock_active_session(state.inner())?;
        let active = guard
            .as_ref()
            .ok_or_else(|| "no active codex session".to_string())?;

        (
            active.binary.clone(),
            active.cwd.clone(),
            Arc::clone(&active.bridge.stdin),
            Arc::clone(&active.bridge.pending),
            Arc::clone(&active.bridge.next_request_id),
        )
    };

    let result = bridge_request(
        stdin,
        pending,
        next_request_id,
        "thread.open",
        json!({
            "threadId": thread_id,
            "workspace": cwd.to_string_lossy().to_string(),
            "runtimeConfig": runtime_config_to_json(&runtime_config, &binary),
        }),
    )
    .await?;

    let opened_thread_id = result
        .get("threadId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "bridge returned an invalid threadId".to_string())?
        .to_string();

    {
        let mut guard = lock_active_session(state.inner())?;
        let active = guard
            .as_mut()
            .ok_or_else(|| "no active codex session".to_string())?;
        active.thread_id = Some(opened_thread_id.clone());
    }

    Ok(CodexThreadOpenResponse {
        thread_id: opened_thread_id,
    })
}

pub(crate) async fn send_codex_input_impl(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
) -> Result<(), String> {
    let prompt = text.trim_end_matches(['\r', '\n']).to_string();
    if prompt.trim().is_empty() {
        return Err("cannot send empty input".to_string());
    }

    let runtime_config = lock_runtime_config(state.inner())?.clone();
    let slash_command = parse_slash_command(&prompt);

    let (session_id, pid, thread_id, cwd, binary, slash_status_requested) = {
        let mut guard = lock_active_session(state.inner())?;
        let active = guard
            .as_mut()
            .ok_or_else(|| "no active codex session".to_string())?;

        if active.busy {
            return Err("codex session is still processing the previous turn".to_string());
        }

        if let Some((command, _args)) = slash_command {
            if command.eq_ignore_ascii_case("/status") {
                (
                    active.session_id,
                    active.pid,
                    active.thread_id.clone(),
                    active.cwd.clone(),
                    active.binary.clone(),
                    true,
                )
            } else {
                emit_stderr(
                    &app,
                    active.session_id,
                    format!(
                        "slash command `{command}` is not available in SDK bridge mode. Supported compatibility command: /status"
                    ),
                );
                return Ok(());
            }
        } else {
            (
                active.session_id,
                active.pid,
                active.thread_id.clone(),
                active.cwd.clone(),
                active.binary.clone(),
                false,
            )
        }
    };

    if slash_status_requested {
        let rate_limits = fetch_rate_limits_for_status(&binary, &cwd);
        let chunk = format_non_tui_status(
            session_id,
            pid,
            thread_id.as_deref(),
            &cwd,
            &runtime_config,
            rate_limits.as_ref(),
        );
        emit_stdout(&app, session_id, chunk);
        return Ok(());
    }

    let request = CodexTurnRunRequest {
        thread_id,
        input_items: vec![CodexInputItem {
            item_type: "text".to_string(),
            text: Some(prompt),
            path: None,
            image_url: None,
            name: None,
        }],
        output_schema: None,
    };

    let _ = cwd;
    let _ = schedule_turn_run(app, state, request).await?;
    Ok(())
}
