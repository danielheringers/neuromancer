use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Instant;
use tauri::State;

use crate::account_runtime::{
    parse_account_login_start_bridge_result, parse_account_logout_bridge_result,
    parse_account_rate_limits_bridge_result, parse_account_read_bridge_result,
    parse_app_list_bridge_result, AccountLoginStartRequest,
    AccountLoginStartResponse, AccountLogoutResponse,
    AccountRateLimitsReadResponse, AccountReadRequest, AccountReadResponse,
    AppListRequest, AppListResponse,
};
use crate::app_server_runtime::fetch_mcp_statuses_for_startup;
use crate::bridge_runtime::bridge_request;
use crate::mcp_runtime::{
    mcp_servers_from_names, parse_mcp_login_bridge_result,
    parse_mcp_reload_bridge_result, parse_mcp_server_list_bridge_result,
    parse_mcp_startup_warmup_bridge_result, McpLoginRequest, McpLoginResponse,
    McpReloadResponse, McpServerListResponse, McpStartupWarmupResponse,
};
use crate::models_runtime::fetch_models_for_picker;
use crate::{
    default_codex_binary, lock_active_session, resolve_codex_launch, AppState,
    CodexModelListResponse, RunCodexCommandResponse, RuntimeCapabilitiesResponse,
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

const RUNTIME_METHOD_KEYS: &[&str] = &[
    "thread.open",
    "thread.close",
    "thread.list",
    "thread.read",
    "thread.archive",
    "thread.unarchive",
    "thread.compact.start",
    "thread.rollback",
    "thread.fork",
    "turn.run",
    "review.start",
    "turn.steer",
    "turn.interrupt",
    "approval.respond",
    "user_input.respond",
    "tool.call.dynamic",
    "mcp.warmup",
    "mcp.list",
    "mcp.login",
    "mcp.reload",
    "app.list",
    "account.read",
    "account.login.start",
    "account.logout",
    "account.rate_limits.read",
    "account.rateLimits.read",
    "config.get",
    "config.set",
];

fn default_runtime_capabilities() -> HashMap<String, bool> {
    let mut methods: HashMap<String, bool> = RUNTIME_METHOD_KEYS
        .iter()
        .map(|method| ((*method).to_string(), true))
        .collect();
    methods.insert("tool.call.dynamic".to_string(), false);
    methods
}

fn normalize_account_rate_capabilities(capabilities: &mut HashMap<String, bool>) {
    let dotted = capabilities
        .get("account.rate_limits.read")
        .copied()
        .unwrap_or(true);
    let camel = capabilities
        .get("account.rateLimits.read")
        .copied()
        .unwrap_or(true);
    let supported = dotted && camel;
    capabilities.insert("account.rate_limits.read".to_string(), supported);
    capabilities.insert("account.rateLimits.read".to_string(), supported);
}

fn merge_runtime_capabilities(result: &serde_json::Value, capabilities: &mut HashMap<String, bool>) {
    if let Some(methods) = result.get("methods").and_then(|value| value.as_object()) {
        for (method, supported) in methods {
            if !capabilities.contains_key(method) {
                continue;
            }
            let fallback = capabilities.get(method).copied().unwrap_or(true);
            capabilities.insert(method.clone(), supported.as_bool().unwrap_or(fallback));
        }
    }

    normalize_account_rate_capabilities(capabilities);
}

fn is_unsupported_method_message(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("unsupported method") || normalized.contains("method not found")
}

fn is_unsupported_method_error_for(error: &str, methods: &[&str]) -> bool {
    if !is_unsupported_method_message(error) {
        return false;
    }

    let normalized = error.to_ascii_lowercase();
    methods.iter().any(|method| {
        let dotted = method.to_ascii_lowercase();
        let slashed = dotted.replace('.', "/");
        normalized.contains(&dotted) || normalized.contains(&slashed)
    })
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

pub(crate) async fn codex_runtime_capabilities_impl(
    state: State<'_, AppState>,
) -> Result<RuntimeCapabilitiesResponse, String> {
    let active_bridge = {
        let active = lock_active_session(state.inner())?;
        active.as_ref().map(|session| {
            (
                Arc::clone(&session.bridge.stdin),
                Arc::clone(&session.bridge.pending),
                Arc::clone(&session.bridge.next_request_id),
            )
        })
    };

    let mut methods = default_runtime_capabilities();

    if let Some((stdin, pending, next_request_id)) = active_bridge {
        match bridge_request(stdin, pending, next_request_id, "capabilities.get", json!({})).await {
            Ok(result) => {
                merge_runtime_capabilities(&result, &mut methods);
            }
            Err(error)
                if !is_unsupported_method_error_for(
                    &error,
                    &["capabilities.get", "capabilities/get"],
                ) =>
            {
                return Err(error);
            }
            Err(_unsupported_error) => {
                // Older bridge versions may not expose capabilities.get; keep defaults.
            }
        }
    }

    Ok(RuntimeCapabilitiesResponse { methods })
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

pub(crate) async fn codex_app_list_impl(
    state: State<'_, AppState>,
    request: AppListRequest,
) -> Result<AppListResponse, String> {
    let active_bridge = {
        let active = lock_active_session(state.inner())?;
        active.as_ref().map(|session| {
            (
                Arc::clone(&session.bridge.stdin),
                Arc::clone(&session.bridge.pending),
                Arc::clone(&session.bridge.next_request_id),
            )
        })
    };

    let Some((stdin, pending, next_request_id)) = active_bridge else {
        return Err("app list requires an active codex session".to_string());
    };

    let mut payload = serde_json::Map::new();
    if let Some(cursor) = request
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        payload.insert("cursor".to_string(), json!(cursor));
    }
    if let Some(limit) = request.limit {
        payload.insert("limit".to_string(), json!(limit));
    }
    if let Some(thread_id) = request
        .thread_id
        .as_deref()
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        payload.insert("threadId".to_string(), json!(thread_id));
    }
    if request.force_refetch {
        payload.insert("forceRefetch".to_string(), json!(true));
    }

    let started_at = Instant::now();
    let result = bridge_request(
        stdin,
        pending,
        next_request_id,
        "app.list",
        serde_json::Value::Object(payload),
    )
    .await;
    let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;

    match result {
        Ok(result) => Ok(parse_app_list_bridge_result(&result, elapsed_ms)),
        Err(error) => {
            if is_unsupported_method_error_for(&error, &["app.list", "app/list"]) {
                Ok(AppListResponse {
                    data: Vec::new(),
                    next_cursor: None,
                    total: 0,
                    elapsed_ms,
                })
            } else {
                Err(error)
            }
        }
    }
}

pub(crate) async fn codex_account_read_impl(
    state: State<'_, AppState>,
    request: AccountReadRequest,
) -> Result<AccountReadResponse, String> {
    let active_bridge = {
        let active = lock_active_session(state.inner())?;
        active.as_ref().map(|session| {
            (
                Arc::clone(&session.bridge.stdin),
                Arc::clone(&session.bridge.pending),
                Arc::clone(&session.bridge.next_request_id),
            )
        })
    };

    let Some((stdin, pending, next_request_id)) = active_bridge else {
        return Err("account read requires an active codex session".to_string());
    };

    let started_at = Instant::now();
    let result = bridge_request(
        stdin,
        pending,
        next_request_id,
        "account.read",
        json!({
            "refreshToken": request.refresh_token,
        }),
    )
    .await?;
    let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;

    Ok(parse_account_read_bridge_result(&result, elapsed_ms))
}

pub(crate) async fn codex_account_login_start_impl(
    state: State<'_, AppState>,
    request: AccountLoginStartRequest,
) -> Result<AccountLoginStartResponse, String> {
    let active_bridge = {
        let active = lock_active_session(state.inner())?;
        active.as_ref().map(|session| {
            (
                Arc::clone(&session.bridge.stdin),
                Arc::clone(&session.bridge.pending),
                Arc::clone(&session.bridge.next_request_id),
            )
        })
    };

    let Some((stdin, pending, next_request_id)) = active_bridge else {
        return Err("account login requires an active codex session".to_string());
    };

    let login_type = request.login_type.trim();
    if login_type.is_empty() {
        return Err("type is required".to_string());
    }

    let mut payload = serde_json::Map::new();
    if login_type.eq_ignore_ascii_case("chatgpt") {
        payload.insert("type".to_string(), json!("chatgpt"));
    } else if login_type.eq_ignore_ascii_case("apikey")
        || login_type.eq_ignore_ascii_case("api_key")
        || login_type.eq_ignore_ascii_case("apiKey")
    {
        let api_key = request
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .ok_or_else(|| "apiKey is required for type=apiKey".to_string())?;
        payload.insert("type".to_string(), json!("apiKey"));
        payload.insert("apiKey".to_string(), json!(api_key));
    } else {
        return Err("unsupported account login type".to_string());
    }

    let started_at = Instant::now();
    let result = bridge_request(
        stdin,
        pending,
        next_request_id,
        "account.login.start",
        serde_json::Value::Object(payload),
    )
    .await?;
    let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;

    Ok(parse_account_login_start_bridge_result(&result, elapsed_ms))
}

pub(crate) async fn codex_account_logout_impl(
    state: State<'_, AppState>,
) -> Result<AccountLogoutResponse, String> {
    let active_bridge = {
        let active = lock_active_session(state.inner())?;
        active.as_ref().map(|session| {
            (
                Arc::clone(&session.bridge.stdin),
                Arc::clone(&session.bridge.pending),
                Arc::clone(&session.bridge.next_request_id),
            )
        })
    };

    let Some((stdin, pending, next_request_id)) = active_bridge else {
        return Err("account logout requires an active codex session".to_string());
    };

    let started_at = Instant::now();
    let result = bridge_request(stdin, pending, next_request_id, "account.logout", json!({})).await?;
    let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;

    Ok(parse_account_logout_bridge_result(&result, elapsed_ms))
}

pub(crate) async fn codex_account_rate_limits_read_impl(
    state: State<'_, AppState>,
) -> Result<AccountRateLimitsReadResponse, String> {
    let active_bridge = {
        let active = lock_active_session(state.inner())?;
        active.as_ref().map(|session| {
            (
                Arc::clone(&session.bridge.stdin),
                Arc::clone(&session.bridge.pending),
                Arc::clone(&session.bridge.next_request_id),
            )
        })
    };

    let Some((stdin, pending, next_request_id)) = active_bridge else {
        return Err("account rate-limits requires an active codex session".to_string());
    };

    let started_at = Instant::now();
    let result = bridge_request(
        stdin,
        pending,
        next_request_id,
        "account.rate_limits.read",
        json!({}),
    )
    .await?;
    let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;

    Ok(parse_account_rate_limits_bridge_result(&result, elapsed_ms))
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

pub(crate) async fn codex_mcp_login_impl(
    state: State<'_, AppState>,
    request: McpLoginRequest,
) -> Result<McpLoginResponse, String> {
    let name = request.name.trim().to_string();
    if name.is_empty() {
        return Err("name is required".to_string());
    }

    let scopes: Vec<String> = request
        .scopes
        .into_iter()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect();

    let active_bridge = {
        let active = lock_active_session(state.inner())?;
        active.as_ref().map(|session| {
            (
                Arc::clone(&session.bridge.stdin),
                Arc::clone(&session.bridge.pending),
                Arc::clone(&session.bridge.next_request_id),
            )
        })
    };

    let Some((stdin, pending, next_request_id)) = active_bridge else {
        return Err("mcp login requires an active codex session".to_string());
    };

    let started_at = Instant::now();
    let mut payload = serde_json::Map::new();
    payload.insert("name".to_string(), json!(name.clone()));
    if !scopes.is_empty() {
        payload.insert("scopes".to_string(), json!(scopes.clone()));
    }
    if let Some(timeout_secs) = request.timeout_secs {
        payload.insert("timeoutSecs".to_string(), json!(timeout_secs));
    }

    let bridge_result = bridge_request(
        stdin,
        pending,
        next_request_id,
        "mcp.login",
        serde_json::Value::Object(payload),
    )
    .await;

    match bridge_result {
        Ok(result) => {
            let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
            return Ok(parse_mcp_login_bridge_result(&result, elapsed_ms));
        }
        Err(error)
            if is_unsupported_method_error_for(
                &error,
                &[
                    "mcp.login",
                    "mcp/login",
                    "mcpServer/oauth/login",
                    "mcpserver/oauth/login",
                ],
            ) =>
        {
            // mcp login is unsupported by current runtime/app-server; fall back to CLI.
        }
        Err(error) => {
            return Err(error);
        }
    }

    let mut args = vec!["mcp".to_string(), "login".to_string(), name.clone()];
    if !scopes.is_empty() {
        args.push("--scopes".to_string());
        args.push(scopes.join(","));
    }

    let result = run_codex_command_impl(args, None)?;
    if !result.success {
        let details = if result.stderr.trim().is_empty() {
            result.stdout.trim().to_string()
        } else {
            result.stderr.trim().to_string()
        };
        return Err(format!("codex mcp login failed: {details}"));
    }

    let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
    Ok(McpLoginResponse {
        name,
        authorization_url: None,
        started: true,
        elapsed_ms,
    })
}

pub(crate) async fn codex_mcp_reload_impl(
    state: State<'_, AppState>,
) -> Result<McpReloadResponse, String> {
    let active_bridge = {
        let active = lock_active_session(state.inner())?;
        active.as_ref().map(|session| {
            (
                Arc::clone(&session.bridge.stdin),
                Arc::clone(&session.bridge.pending),
                Arc::clone(&session.bridge.next_request_id),
            )
        })
    };

    let Some((stdin, pending, next_request_id)) = active_bridge else {
        return Err("mcp reload requires an active codex session".to_string());
    };

    let started_at = Instant::now();
    let result = bridge_request(stdin, pending, next_request_id, "mcp.reload", json!({})).await?;
    let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
    Ok(parse_mcp_reload_bridge_result(&result, elapsed_ms))
}

