use serde_json::json;
use std::env;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::time::{timeout, Duration};

use crate::bridge_runtime::{bridge_request, spawn_bridge_process, stop_bridge_process};
use crate::{
    default_codex_binary, emit_lifecycle, lock_active_session, resolve_codex_launch, AppState,
    StartCodexSessionConfig, StartCodexSessionResponse,
};

fn binary_for_bridge(program: &str, args: &[String]) -> String {
    if program.eq_ignore_ascii_case("cmd")
        && args.len() >= 2
        && args[0].eq_ignore_ascii_case("/c")
    {
        return args[1].clone();
    }

    if let Some(first_arg) = args.first() {
        let lowered = first_arg.to_ascii_lowercase();
        if lowered.ends_with(".js") || lowered.ends_with(".mjs") || lowered.ends_with(".cjs") {
            return first_arg.clone();
        }
    }

    program.to_string()
}

pub(crate) async fn start_codex_session_impl(
    app: AppHandle,
    state: State<'_, AppState>,
    config: Option<StartCodexSessionConfig>,
) -> Result<StartCodexSessionResponse, String> {
    {
        let active_guard = lock_active_session(state.inner())?;
        if active_guard.is_some() {
            return Err("an active codex session is already running".to_string());
        }
    }

    let config = config.unwrap_or_default();
    if config.args.as_ref().is_some_and(|args| !args.is_empty()) {
        return Err("custom start args are not supported in bridge mode".to_string());
    }

    let configured_binary = config
        .binary
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_codex_binary);

    let (launch_program, launch_args) = resolve_codex_launch(&configured_binary, &[])?;
    let binary = binary_for_bridge(&launch_program, &launch_args);

    let cwd = config
        .cwd
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    if !cwd.exists() {
        return Err(format!("session cwd does not exist: {}", cwd.display()));
    }

    let env_overrides = config.env.unwrap_or_default();
    let session_id = state.next_session_id.fetch_add(1, Ordering::Relaxed);
    let bridge = spawn_bridge_process(
        &app,
        session_id,
        &cwd,
        &env_overrides,
        &binary,
        Arc::clone(&state.next_event_seq),
    )?;
    let pid = bridge.child.id();

    let stdin = Arc::clone(&bridge.stdin);
    let pending = Arc::clone(&bridge.pending);
    let next_request_id = Arc::clone(&bridge.next_request_id);
    let health_check = timeout(
        Duration::from_secs(90),
        bridge_request(stdin, pending, next_request_id, "health", json!({})),
    )
    .await;

    match health_check {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => {
            stop_bridge_process(bridge);
            return Err(format!("failed to initialize codex bridge: {error}"));
        }
        Err(_elapsed) => {
            stop_bridge_process(bridge);
            return Err("timed out waiting for codex bridge health check".to_string());
        }
    }

    {
        let mut guard = lock_active_session(state.inner())?;
        *guard = Some(crate::ActiveSession {
            session_id,
            pid: Some(pid),
            binary,
            cwd,
            thread_id: None,
            busy: false,
            bridge,
        });
    }

    emit_lifecycle(&app, "started", Some(session_id), Some(pid), None, None);
    Ok(StartCodexSessionResponse { session_id, pid })
}

pub(crate) fn resize_codex_pty_impl(
    state: State<'_, AppState>,
    _rows: u16,
    _cols: u16,
) -> Result<(), String> {
    let guard = lock_active_session(state.inner())?;
    if guard.is_none() {
        return Err("no active session".to_string());
    }

    Ok(())
}

pub(crate) async fn stop_codex_session_impl(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let active = {
        let mut guard = lock_active_session(state.inner())?;
        let active = guard
            .as_ref()
            .ok_or_else(|| "no active codex session".to_string())?;

        if active.busy {
            return Err("cannot stop session while a turn is still running".to_string());
        }

        guard.take().ok_or_else(|| "no active codex session".to_string())?
    };

    let session_id = active.session_id;
    let pid = active.pid;
    stop_bridge_process(active.bridge);
    emit_lifecycle(
        &app,
        "stopped",
        Some(session_id),
        pid,
        None,
        Some("stopped by request".to_string()),
    );

    Ok(())
}

pub(crate) async fn codex_bridge_start_impl(
    app: AppHandle,
    state: State<'_, AppState>,
    config: Option<StartCodexSessionConfig>,
) -> Result<StartCodexSessionResponse, String> {
    start_codex_session_impl(app, state, config).await
}

pub(crate) async fn codex_bridge_stop_impl(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    stop_codex_session_impl(app, state).await
}
