use serde_json::json;
use std::env;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Instant;
use tauri::State;

use crate::app_server_runtime::fetch_mcp_statuses_for_startup;
use crate::bridge_runtime::bridge_request;
use crate::mcp_runtime::{
    mcp_servers_from_names, parse_mcp_server_list_bridge_result,
    parse_mcp_startup_warmup_bridge_result, McpServerListResponse,
    McpStartupWarmupResponse,
};
use crate::models_runtime::fetch_models_for_picker;
use crate::{
    default_codex_binary, lock_active_session, resolve_codex_launch, AppState,
    CodexModelListResponse, RunCodexCommandResponse,
};

fn is_bridge_transport_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("stdout closed")
        || normalized.contains("stderr closed")
        || normalized.contains("channel closed")
        || normalized.contains("timed out")
        || normalized.contains("failed to write bridge request")
        || normalized.contains("failed to flush bridge request")
}

pub(crate) fn run_codex_command_impl(
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<RunCodexCommandResponse, String> {
    if args.is_empty() {
        return Err("run_codex_command requires at least one argument".to_string());
    }

    let binary = default_codex_binary();
    let (program, resolved_args) = resolve_codex_launch(&binary, &args)?;

    let mut command = Command::new(program);
    command.args(resolved_args);

    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }

    let output = command.output().map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            format!("failed to run codex command: executable not found ({error})")
        } else {
            format!("failed to run codex command: {error}")
        }
    })?;

    Ok(RunCodexCommandResponse {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        status: output.status.code().unwrap_or(-1),
        success: output.status.success(),
    })
}

pub(crate) fn codex_models_list_impl(
    state: State<'_, AppState>,
) -> Result<CodexModelListResponse, String> {
    let (binary, cwd) = {
        let active = lock_active_session(state.inner())?;
        if let Some(session) = active.as_ref() {
            (session.binary.clone(), session.cwd.clone())
        } else {
            (
                default_codex_binary(),
                env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            )
        }
    };

    let models = fetch_models_for_picker(&binary, &cwd)?;
    Ok(CodexModelListResponse { data: models })
}

pub(crate) async fn codex_wait_for_mcp_startup_impl(
    state: State<'_, AppState>,
) -> Result<McpStartupWarmupResponse, String> {
    let (active_bridge, binary, cwd) = {
        let active = lock_active_session(state.inner())?;
        if let Some(session) = active.as_ref() {
            (
                Some((
                    Arc::clone(&session.bridge.stdin),
                    Arc::clone(&session.bridge.pending),
                    Arc::clone(&session.bridge.next_request_id),
                )),
                session.binary.clone(),
                session.cwd.clone(),
            )
        } else {
            (
                None,
                default_codex_binary(),
                env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            )
        }
    };

    if let Some((stdin, pending, next_request_id)) = active_bridge {
        let started_at = Instant::now();
        match bridge_request(stdin, pending, next_request_id, "mcp.warmup", json!({})).await {
            Ok(result) => {
                let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
                return Ok(parse_mcp_startup_warmup_bridge_result(&result, elapsed_ms));
            }
            Err(error) if !is_bridge_transport_error(&error) => return Err(error),
            Err(_transport_error) => {
                // Bridge died or became unavailable; fall back to direct app-server probing.
            }
        }
    }

    let started_at = Instant::now();
    let ready_servers = fetch_mcp_statuses_for_startup(&binary, &cwd)?;
    let total_ready = ready_servers.len();
    let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;

    Ok(McpStartupWarmupResponse {
        ready_servers,
        total_ready,
        elapsed_ms,
    })
}

pub(crate) async fn codex_mcp_list_impl(
    state: State<'_, AppState>,
) -> Result<McpServerListResponse, String> {
    let (active_bridge, binary, cwd) = {
        let active = lock_active_session(state.inner())?;
        if let Some(session) = active.as_ref() {
            (
                Some((
                    Arc::clone(&session.bridge.stdin),
                    Arc::clone(&session.bridge.pending),
                    Arc::clone(&session.bridge.next_request_id),
                )),
                session.binary.clone(),
                session.cwd.clone(),
            )
        } else {
            (
                None,
                default_codex_binary(),
                env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            )
        }
    };

    if let Some((stdin, pending, next_request_id)) = active_bridge {
        let started_at = Instant::now();
        match bridge_request(stdin, pending, next_request_id, "mcp.list", json!({})).await {
            Ok(result) => {
                let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
                return Ok(parse_mcp_server_list_bridge_result(&result, elapsed_ms));
            }
            Err(error) if !is_bridge_transport_error(&error) => return Err(error),
            Err(_transport_error) => {
                // Bridge died or became unavailable; fall back to direct app-server probing.
            }
        }
    }

    let started_at = Instant::now();
    let ready_servers = fetch_mcp_statuses_for_startup(&binary, &cwd)?;
    let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
    Ok(mcp_servers_from_names(ready_servers, elapsed_ms))
}
