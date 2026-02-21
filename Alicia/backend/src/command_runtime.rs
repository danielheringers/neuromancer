use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
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
    CodexModelListResponse, GitCommitApprovedReviewRequest,
    GitCommitApprovedReviewResponse, GitCommandExecutionResult,
    GitWorkspaceChange, GitWorkspaceChangesRequest, GitWorkspaceChangesResponse,
    RunCodexCommandResponse, RuntimeCapabilitiesResponse,
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

fn run_git_command_impl(mut command: Command, operation: &str) -> Result<GitCommandExecutionResult, String> {
    let output = command.output().map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            format!(
                "failed to run git {operation}: git executable not found in PATH ({error})"
            )
        } else {
            format!("failed to run git {operation}: {error}")
        }
    })?;

    Ok(GitCommandExecutionResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        status: output.status.code().unwrap_or(-1),
        success: output.status.success(),
    })
}

fn is_safe_git_path(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }

    if path.contains('\0') {
        return false;
    }

    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return false;
    }

    candidate
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
}

fn to_literal_pathspec(path: &str) -> String {
    format!(":(literal){path}")
}

pub(crate) fn git_commit_approved_review_impl(
    request: GitCommitApprovedReviewRequest,
) -> Result<GitCommitApprovedReviewResponse, String> {
    let mut paths: Vec<String> = Vec::new();
    for entry in request.paths {
        let normalized = entry.trim().to_string();
        if normalized.is_empty() {
            continue;
        }
        if !is_safe_git_path(&normalized) {
            return Err(format!(
                "git_commit_approved_review rejected unsafe path: {normalized}"
            ));
        }
        paths.push(normalized);
    }

    if paths.is_empty() {
        return Err("git_commit_approved_review requires at least one non-empty path".to_string());
    }

    let literal_pathspecs: Vec<String> =
        paths.iter().map(|path| to_literal_pathspec(path)).collect();

    let message = request.message.trim().to_string();
    if message.is_empty() {
        return Err("git_commit_approved_review requires a non-empty message".to_string());
    }

    let cwd = request
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| {
            env::current_dir()
                .map_err(|error| format!("failed to resolve current directory for git commit: {error}"))
        })?;
    if !cwd.is_absolute() {
        return Err("git_commit_approved_review requires an absolute cwd".to_string());
    }

    let mut git_add = Command::new("git");
    git_add
        .current_dir(&cwd)
        .arg("add")
        .arg("-A")
        .arg("--")
        .args(literal_pathspecs.iter());
    let add = run_git_command_impl(git_add, "add")?;

    let commit = if add.success {
        let mut git_commit = Command::new("git");
        git_commit
            .current_dir(&cwd)
            .arg("commit")
            .arg("-m")
            .arg(&message)
            .arg("--")
            .args(literal_pathspecs.iter());
        run_git_command_impl(git_commit, "commit")?
    } else {
        GitCommandExecutionResult {
            stdout: String::new(),
            stderr: "git commit skipped because git add failed".to_string(),
            status: -1,
            success: false,
        }
    };

    Ok(GitCommitApprovedReviewResponse {
        success: add.success && commit.success,
        add,
        commit,
    })
}

fn resolve_git_workspace_cwd(
    state: State<'_, AppState>,
    request: GitWorkspaceChangesRequest,
) -> Result<PathBuf, String> {
    let active_cwd = {
        let active = lock_active_session(state.inner())?;
        active.as_ref().map(|session| session.cwd.clone())
    };

    if let Some(cwd) = active_cwd {
        return Ok(cwd);
    }

    if let Some(cwd) = request
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        return Ok(PathBuf::from(cwd));
    }

    env::current_dir().map_err(|error| {
        format!(
            "failed to resolve current directory for git workspace changes: {error}"
        )
    })
}

fn validate_workspace_cwd(cwd: &Path) -> Result<(), String> {
    if !cwd.exists() {
        return Err(format!(
            "git_workspace_changes invalid cwd '{}': path does not exist",
            cwd.display()
        ));
    }

    if !cwd.is_dir() {
        return Err(format!(
            "git_workspace_changes invalid cwd '{}': path is not a directory",
            cwd.display()
        ));
    }

    Ok(())
}

fn git_result_details(result: &GitCommandExecutionResult) -> String {
    let stderr = result.stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }

    let stdout = result.stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }

    format!("exit status {}", result.status)
}

fn ensure_git_repository(cwd: &Path) -> Result<(), String> {
    let mut git_rev_parse = Command::new("git");
    git_rev_parse
        .current_dir(cwd)
        .arg("rev-parse")
        .arg("--is-inside-work-tree");
    let rev_parse = run_git_command_impl(git_rev_parse, "rev-parse")?;

    if !rev_parse.success || rev_parse.stdout.trim() != "true" {
        return Err(format!(
            "git_workspace_changes requires a git repository at '{}': {}",
            cwd.display(),
            git_result_details(&rev_parse)
        ));
    }

    Ok(())
}

fn run_git_status_porcelain(cwd: &Path) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .current_dir(cwd)
        .arg("status")
        .arg("--porcelain=v1")
        .arg("-z")
        .output()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                format!(
                    "failed to run git status: git executable not found in PATH ({error})"
                )
            } else {
                format!("failed to run git status: {error}")
            }
        })?;

    if !output.status.success() {
        let result = GitCommandExecutionResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            status: output.status.code().unwrap_or(-1),
            success: false,
        };

        return Err(format!(
            "failed to collect git workspace changes at '{}': {}",
            cwd.display(),
            git_result_details(&result)
        ));
    }

    Ok(output.stdout)
}

fn classify_git_status(code: &str) -> &'static str {
    if code == "??" {
        return "untracked";
    }

    // Porcelain v1 conflict matrix.
    // Source: git-status short format (XY status for unmerged paths).
    if matches!(code, "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU") {
        return "unmerged";
    }

    let mut chars = code.chars();
    let index = chars.next().unwrap_or(' ');
    let worktree = chars.next().unwrap_or(' ');

    if index == 'U' || worktree == 'U' {
        return "unmerged";
    }
    if index == 'R' || worktree == 'R' {
        return "renamed";
    }
    if index == 'C' || worktree == 'C' {
        return "copied";
    }
    if index == 'D' || worktree == 'D' {
        return "deleted";
    }
    if index == 'A' || worktree == 'A' {
        return "added";
    }
    if index == 'M' || worktree == 'M' || index == 'T' || worktree == 'T' {
        return "modified";
    }

    "unknown"
}

fn parse_status_path(path: &[u8]) -> String {
    String::from_utf8_lossy(path).to_string()
}

fn parse_git_status_porcelain(output: &[u8]) -> Result<Vec<GitWorkspaceChange>, String> {
    let mut files = Vec::new();
    let mut cursor = 0usize;

    while cursor < output.len() {
        let Some(relative_end) = output[cursor..].iter().position(|byte| *byte == b'\0') else {
            return Err("malformed git status output: missing NUL terminator".to_string());
        };

        let entry_end = cursor + relative_end;
        let entry = &output[cursor..entry_end];
        cursor = entry_end + 1;

        if entry.is_empty() {
            continue;
        }

        if entry.len() < 3 {
            return Err(format!(
                "malformed git status entry: '{}'",
                String::from_utf8_lossy(entry)
            ));
        }

        let code = std::str::from_utf8(&entry[0..2]).map_err(|_| {
            format!(
                "malformed git status code in entry '{}'",
                String::from_utf8_lossy(entry)
            )
        })?;
        if code == "!!" {
            continue;
        }

        if entry[2] != b' ' {
            return Err(format!(
                "malformed git status entry: '{}'",
                String::from_utf8_lossy(entry)
            ));
        }

        let primary_path = &entry[3..];
        if primary_path.is_empty() {
            return Err(format!(
                "malformed git status entry (missing path): '{}'",
                String::from_utf8_lossy(entry)
            ));
        }

        let mut from_path = None;
        let path = parse_status_path(primary_path);

        if code.contains('R') || code.contains('C') {
            let Some(relative_source_end) = output[cursor..].iter().position(|byte| *byte == b'\0') else {
                return Err(
                    "malformed git status output: missing rename/copy source path".to_string(),
                );
            };
            let source_end = cursor + relative_source_end;
            let source_path = &output[cursor..source_end];
            cursor = source_end + 1;

            if source_path.is_empty() {
                return Err("malformed git status output: empty rename/copy source path".to_string());
            }

            from_path = Some(parse_status_path(source_path));
        }

        files.push(GitWorkspaceChange {
            path,
            status: classify_git_status(code).to_string(),
            code: code.to_string(),
            from_path,
        });
    }

    Ok(files)
}

pub(crate) fn git_workspace_changes_impl(
    state: State<'_, AppState>,
    request: GitWorkspaceChangesRequest,
) -> Result<GitWorkspaceChangesResponse, String> {
    let cwd = resolve_git_workspace_cwd(state, request)?;
    validate_workspace_cwd(&cwd)?;
    ensure_git_repository(&cwd)?;

    let status_output = run_git_status_porcelain(&cwd)?;
    let files = parse_git_status_porcelain(&status_output)?;

    Ok(GitWorkspaceChangesResponse {
        cwd: cwd.to_string_lossy().to_string(),
        total: files.len(),
        files,
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


#[cfg(test)]
mod tests {
    use super::{classify_git_status, parse_git_status_porcelain};

    #[test]
    fn parse_untracked_entry() {
        let parsed =
            parse_git_status_porcelain(b"?? src/new_file.rs\0").expect("entry should parse");
        let entry = &parsed[0];

        assert_eq!(entry.path, "src/new_file.rs");
        assert_eq!(entry.status, "untracked");
        assert_eq!(entry.code, "??");
        assert!(entry.from_path.is_none());
    }

    #[test]
    fn parse_renamed_entry_with_origin() {
        let parsed = parse_git_status_porcelain(b"R  src/new_name.rs\0src/old_name.rs\0")
            .expect("entry should parse");
        let entry = &parsed[0];

        assert_eq!(entry.path, "src/new_name.rs");
        assert_eq!(entry.status, "renamed");
        assert_eq!(entry.code, "R ");
        assert_eq!(entry.from_path.as_deref(), Some("src/old_name.rs"));
    }

    #[test]
    fn parse_unmerged_entry() {
        let parsed = parse_git_status_porcelain(b"UU src/conflict.rs\0")
            .expect("entry should parse");
        let entry = &parsed[0];

        assert_eq!(entry.path, "src/conflict.rs");
        assert_eq!(entry.status, "unmerged");
        assert_eq!(entry.code, "UU");
    }

    #[test]
    fn parse_status_output_with_multiple_entries() {
        let parsed =
            parse_git_status_porcelain(b"M  src/main.rs\0?? src/new.rs\0D  src/old.rs\0")
                .expect("output should parse");

        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].status, "modified");
        assert_eq!(parsed[1].status, "untracked");
        assert_eq!(parsed[2].status, "deleted");
    }

    #[test]
    fn parse_malformed_entry_errors() {
        let error = parse_git_status_porcelain(b"X\0")
            .expect_err("malformed output should return an error");
        assert!(error.contains("malformed git status entry"));
    }

    #[test]
    fn parse_paths_with_spaces() {
        let parsed = parse_git_status_porcelain(
            b"M  src/folder with spaces/file name.rs\0",
        )
        .expect("output should parse");

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].path, "src/folder with spaces/file name.rs");
    }

    #[test]
    fn classify_common_statuses() {
        assert_eq!(classify_git_status("M "), "modified");
        assert_eq!(classify_git_status("A "), "added");
        assert_eq!(classify_git_status("D "), "deleted");
        assert_eq!(classify_git_status("C "), "copied");
        assert_eq!(classify_git_status("DD"), "unmerged");
        assert_eq!(classify_git_status("AA"), "unmerged");
        assert_eq!(classify_git_status("UU"), "unmerged");
    }
}
