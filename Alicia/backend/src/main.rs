use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, State};

mod app_server_runtime;
mod account_runtime;
mod command_runtime;
mod bridge_runtime;
mod config_runtime;
mod events_runtime;
mod launch_runtime;
mod mcp_runtime;
mod models_runtime;
mod status_runtime;
mod session_lifecycle_runtime;
mod session_runtime;
mod session_turn_runtime;
mod terminal_runtime;
use crate::account_runtime::{
    AccountLoginStartRequest, AccountLoginStartResponse, AccountLogoutResponse,
    AccountRateLimitsReadResponse, AccountReadRequest, AccountReadResponse,
    AppListRequest, AppListResponse,
};
use crate::config_runtime::{load_runtime_config_from_codex, normalize_runtime_config};
use crate::bridge_runtime::BridgeProcess;
use crate::mcp_runtime::{
    McpLoginRequest, McpLoginResponse, McpReloadResponse, McpServerListResponse,
    McpStartupWarmupResponse,
};

pub(crate) use crate::launch_runtime::{default_codex_binary, resolve_binary_path, resolve_codex_launch};
pub(crate) use crate::events_runtime::{emit_codex_event, emit_lifecycle, emit_stderr, emit_stdout, emit_terminal_data, emit_terminal_exit};

// Comentario de teste
const CODEX_HELP_CLI_TREE: &str = r#"codex
  exec (alias: e)
    resume
    review
  review
  login
    status
  logout
  mcp
    list
    get
    add
    remove
    login
    logout
  mcp-server
  app-server
    generate-ts
    generate-json-schema
  completion
  sandbox
    macos
    linux
    windows
  debug
    app-server
      send-message-v2
  apply (alias: a)
  resume
  fork
  cloud
    exec
    status
    list
    apply
    diff
  features
    list
    enable
    disable"#;

const CODEX_HELP_SLASH_COMMANDS: &[&str] = &[
    "/model",
    "/approvals",
    "/permissions",
    "/setup-default-sandbox",
    "/sandbox-add-read-dir",
    "/experimental",
    "/skills",
    "/review",
    "/rename",
    "/new",
    "/resume",
    "/fork",
    "/init",
    "/compact",
    "/plan",
    "/collab",
    "/agent",
    "/diff",
    "/mention",
    "/status",
    // "/debug-config",
    "/statusline",
    "/mcp",
    "/apps",
    "/logout",
    "/quit",
    "/exit",
    "/feedback",
    "/ps",
    "/clean",
    "/personality",
    "/debug-m-drop",
    "/debug-m-update",
];

const CODEX_HELP_KEY_FLAGS: &[&str] = &[
    "--model",
    "--image",
    "--profile",
    "--sandbox",
    "--full-auto",
    "--dangerously-bypass-approvals-and-sandbox",
    "--search",
    "--add-dir",
    "--cd",
    "-c key=value",
    "--enable FEATURE",
    "--disable FEATURE",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCodexConfig {
    model: String,
    reasoning: String,
    approval_preset: String,
    approval_policy: String,
    sandbox: String,
    profile: String,
    web_search_mode: String,
}

impl Default for RuntimeCodexConfig {
    fn default() -> Self {
        Self {
            model: "default".to_string(),
            reasoning: "default".to_string(),
            approval_preset: "auto".to_string(),
            approval_policy: "on-request".to_string(),
            sandbox: "read-only".to_string(),
            profile: "read_write_with_approval".to_string(),
            web_search_mode: "cached".to_string(),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartCodexSessionConfig {
    binary: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartCodexSessionResponse {
    session_id: u64,
    pid: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatusResponse {
    session_id: Option<u64>,
    pid: Option<u32>,
    workspace: String,
    runtime_config: RuntimeCodexConfig,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCapabilitiesResponse {
    methods: HashMap<String, bool>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunCodexCommandResponse {
    stdout: String,
    stderr: String,
    status: i32,
    success: bool,
}


#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexInputItem {
    #[serde(rename = "type")]
    item_type: String,
    text: Option<String>,
    path: Option<String>,
    image_url: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexTurnRunRequest {
    thread_id: Option<String>,
    input_items: Vec<CodexInputItem>,
    output_schema: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexTurnRunResponse {
    accepted: bool,
    session_id: u64,
    thread_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadOpenResponse {
    thread_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadTurnHistoryMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadTurnSummary {
    id: String,
    status: String,
    item_count: usize,
    #[serde(default)]
    messages: Vec<CodexThreadTurnHistoryMessage>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadSummary {
    id: String,
    #[serde(default)]
    codex_thread_id: Option<String>,
    preview: String,
    model_provider: String,
    created_at: i64,
    updated_at: i64,
    cwd: String,
    path: Option<String>,
    source: String,
    turn_count: usize,
    #[serde(default)]
    turns: Vec<CodexThreadTurnSummary>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadListRequest {
    cursor: Option<String>,
    limit: Option<u32>,
    sort_key: Option<String>,
    model_providers: Option<Vec<String>>,
    source_kinds: Option<Vec<String>>,
    archived: Option<bool>,
    cwd: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadListResponse {
    data: Vec<CodexThreadSummary>,
    next_cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadReadRequest {
    thread_id: String,
    include_turns: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadReadResponse {
    thread: CodexThreadSummary,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadArchiveRequest {
    thread_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadArchiveResponse {
    id: String,
    codex_thread_id: String,
    archived: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadUnarchiveRequest {
    thread_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadUnarchiveResponse {
    thread: CodexThreadSummary,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadCompactStartRequest {
    thread_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadCompactStartResponse {
    ok: bool,
    thread_id: String,
    codex_thread_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadRollbackRequest {
    thread_id: String,
    num_turns: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadRollbackResponse {
    thread: CodexThreadSummary,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadForkRequest {
    thread_id: String,
    path: Option<String>,
    model: Option<String>,
    model_provider: Option<String>,
    cwd: Option<String>,
    approval_policy: Option<String>,
    sandbox: Option<String>,
    config: Option<Value>,
    base_instructions: Option<String>,
    developer_instructions: Option<String>,
    persist_extended_history: Option<bool>,
    new_thread_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadForkResponse {
    thread: CodexThreadSummary,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexTurnSteerRequest {
    thread_id: String,
    input_items: Vec<CodexInputItem>,
    expected_turn_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexTurnSteerResponse {
    thread_id: String,
    codex_thread_id: String,
    turn_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexTurnInterruptRequest {
    thread_id: String,
    turn_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexTurnInterruptResponse {
    ok: bool,
    thread_id: String,
    codex_thread_id: String,
    turn_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexReviewStartRequest {
    thread_id: Option<String>,
    target: Option<Value>,
    delivery: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexReviewStartResponse {
    accepted: bool,
    session_id: u64,
    thread_id: Option<String>,
    review_thread_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexApprovalRespondRequest {
    action_id: String,
    decision: String,
    remember: Option<bool>,
    execpolicy_amendment: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexUserInputRespondRequest {
    #[serde(alias = "action_id")]
    action_id: String,
    decision: String,
    #[serde(default)]
    answers: HashMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexUserInputRespondResponse {
    ok: bool,
    action_id: String,
    decision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCreateRequest {
    cwd: Option<String>,
    shell: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCreateResponse {
    terminal_id: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalWriteRequest {
    terminal_id: u64,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResizeRequest {
    terminal_id: u64,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalKillRequest {
    terminal_id: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexHelpSnapshot {
    cli_tree: &'static str,
    slash_commands: Vec<&'static str>,
    key_flags: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexReasoningEffortOption {
    reasoning_effort: String,
    description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexModel {
    id: String,
    model: String,
    display_name: String,
    description: String,
    supported_reasoning_efforts: Vec<CodexReasoningEffortOption>,
    default_reasoning_effort: String,
    supports_personality: bool,
    is_default: bool,
    upgrade: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexModelListResponse {
    data: Vec<CodexModel>,
}

struct TerminalSession {
    terminal_id: u64,
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

struct ActiveSession {
    session_id: u64,
    pid: Option<u32>,
    binary: String,
    cwd: PathBuf,
    thread_id: Option<String>,
    busy: bool,
    bridge: BridgeProcess,
}
struct AppState {
    active_session: Mutex<Option<ActiveSession>>,
    next_session_id: AtomicU64,
    runtime_config: Mutex<RuntimeCodexConfig>,
    next_event_seq: Arc<AtomicU64>,
    next_terminal_id: AtomicU64,
    terminals: Mutex<HashMap<u64, TerminalSession>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            active_session: Mutex::new(None),
            next_session_id: AtomicU64::new(1),
            runtime_config: Mutex::new(RuntimeCodexConfig::default()),
            next_event_seq: Arc::new(AtomicU64::new(1)),
            next_terminal_id: AtomicU64::new(1),
            terminals: Mutex::new(HashMap::new()),
        }
    }
}

fn lock_active_session(state: &AppState) -> Result<MutexGuard<'_, Option<ActiveSession>>, String> {
    state
        .active_session
        .lock()
        .map_err(|_| "active session lock poisoned".to_string())
}

fn lock_runtime_config(state: &AppState) -> Result<MutexGuard<'_, RuntimeCodexConfig>, String> {
    state
        .runtime_config
        .lock()
        .map_err(|_| "runtime config lock poisoned".to_string())
}

#[tauri::command]
fn codex_runtime_status(state: State<'_, AppState>) -> Result<RuntimeStatusResponse, String> {
    let (session_id, pid) = {
        let active = lock_active_session(state.inner())?;
        (
            active.as_ref().map(|session| session.session_id),
            active.as_ref().and_then(|session| session.pid),
        )
    };

    let runtime_config = lock_runtime_config(state.inner())?.clone();
    let workspace = env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .to_string_lossy()
        .to_string();

    Ok(RuntimeStatusResponse {
        session_id,
        pid,
        workspace,
        runtime_config,
    })
}

#[tauri::command]
async fn codex_runtime_capabilities(
    state: State<'_, AppState>,
) -> Result<RuntimeCapabilitiesResponse, String> {
    crate::command_runtime::codex_runtime_capabilities_impl(state).await
}
#[tauri::command]
async fn load_codex_default_config(state: State<'_, AppState>) -> Result<RuntimeCodexConfig, String> {
    let loaded = load_runtime_config_from_codex().await?;
    let mut runtime = lock_runtime_config(state.inner())?;
    *runtime = loaded.clone();
    Ok(loaded)
}

#[tauri::command]
fn update_codex_config(
    state: State<'_, AppState>,
    config: RuntimeCodexConfig,
) -> Result<RuntimeCodexConfig, String> {
    let mut runtime = lock_runtime_config(state.inner())?;
    *runtime = normalize_runtime_config(config);
    Ok(runtime.clone())
}

#[tauri::command]
fn codex_config_get(state: State<'_, AppState>) -> Result<RuntimeCodexConfig, String> {
    Ok(lock_runtime_config(state.inner())?.clone())
}

#[tauri::command]
fn codex_config_set(
    state: State<'_, AppState>,
    patch: RuntimeCodexConfig,
) -> Result<RuntimeCodexConfig, String> {
    let mut runtime = lock_runtime_config(state.inner())?;
    *runtime = normalize_runtime_config(patch);
    Ok(runtime.clone())
}

#[tauri::command]
async fn codex_turn_run(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CodexTurnRunRequest,
) -> Result<CodexTurnRunResponse, String> {
    crate::session_runtime::codex_turn_run_impl(app, state, request).await
}

#[tauri::command]
async fn codex_thread_open(
    state: State<'_, AppState>,
    thread_id: Option<String>,
) -> Result<CodexThreadOpenResponse, String> {
    crate::session_runtime::codex_thread_open_impl(state, thread_id).await
}

#[tauri::command]
async fn codex_thread_list(
    state: State<'_, AppState>,
    request: Option<CodexThreadListRequest>,
) -> Result<CodexThreadListResponse, String> {
    crate::session_runtime::codex_thread_list_impl(state, request.unwrap_or_default()).await
}

#[tauri::command]
async fn codex_thread_read(
    state: State<'_, AppState>,
    request: CodexThreadReadRequest,
) -> Result<CodexThreadReadResponse, String> {
    crate::session_runtime::codex_thread_read_impl(state, request).await
}

#[tauri::command]
async fn codex_thread_archive(
    state: State<'_, AppState>,
    request: CodexThreadArchiveRequest,
) -> Result<CodexThreadArchiveResponse, String> {
    crate::session_runtime::codex_thread_archive_impl(state, request).await
}

#[tauri::command]
async fn codex_thread_unarchive(
    state: State<'_, AppState>,
    request: CodexThreadUnarchiveRequest,
) -> Result<CodexThreadUnarchiveResponse, String> {
    crate::session_runtime::codex_thread_unarchive_impl(state, request).await
}

#[tauri::command]
async fn codex_thread_compact_start(
    state: State<'_, AppState>,
    request: CodexThreadCompactStartRequest,
) -> Result<CodexThreadCompactStartResponse, String> {
    crate::session_runtime::codex_thread_compact_start_impl(state, request).await
}

#[tauri::command]
async fn codex_thread_rollback(
    state: State<'_, AppState>,
    request: CodexThreadRollbackRequest,
) -> Result<CodexThreadRollbackResponse, String> {
    crate::session_runtime::codex_thread_rollback_impl(state, request).await
}

#[tauri::command]
async fn codex_thread_fork(
    state: State<'_, AppState>,
    request: CodexThreadForkRequest,
) -> Result<CodexThreadForkResponse, String> {
    crate::session_runtime::codex_thread_fork_impl(state, request).await
}

#[tauri::command]
async fn codex_turn_steer(
    state: State<'_, AppState>,
    request: CodexTurnSteerRequest,
) -> Result<CodexTurnSteerResponse, String> {
    crate::session_runtime::codex_turn_steer_impl(state, request).await
}

#[tauri::command]
async fn codex_turn_interrupt(
    state: State<'_, AppState>,
    request: CodexTurnInterruptRequest,
) -> Result<CodexTurnInterruptResponse, String> {
    crate::session_runtime::codex_turn_interrupt_impl(state, request).await
}

#[tauri::command]
async fn codex_review_start(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CodexReviewStartRequest,
) -> Result<CodexReviewStartResponse, String> {
    crate::session_runtime::codex_review_start_impl(app, state, request).await
}

#[tauri::command]
async fn codex_approval_respond(
    state: State<'_, AppState>,
    request: CodexApprovalRespondRequest,
) -> Result<(), String> {
    crate::session_runtime::codex_approval_respond_impl(state, request).await
}

#[tauri::command]
async fn codex_user_input_respond(
    state: State<'_, AppState>,
    request: CodexUserInputRespondRequest,
) -> Result<CodexUserInputRespondResponse, String> {
    crate::session_runtime::codex_user_input_respond_impl(state, request).await
}

#[tauri::command]
async fn send_codex_input(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
) -> Result<(), String> {
    crate::session_runtime::send_codex_input_impl(app, state, text).await
}

#[tauri::command]
async fn start_codex_session(
    app: AppHandle,
    state: State<'_, AppState>,
    config: Option<StartCodexSessionConfig>,
) -> Result<StartCodexSessionResponse, String> {
    crate::session_runtime::start_codex_session_impl(app, state, config).await
}

#[tauri::command]
fn resize_codex_pty(
    state: State<'_, AppState>,
    _rows: u16,
    _cols: u16,
) -> Result<(), String> {
    crate::session_runtime::resize_codex_pty_impl(state, _rows, _cols)
}

#[tauri::command]
async fn stop_codex_session(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    crate::session_runtime::stop_codex_session_impl(app, state).await
}

#[tauri::command]
async fn codex_bridge_start(
    app: AppHandle,
    state: State<'_, AppState>,
    config: Option<StartCodexSessionConfig>,
) -> Result<StartCodexSessionResponse, String> {
    crate::session_runtime::codex_bridge_start_impl(app, state, config).await
}

#[tauri::command]
async fn codex_bridge_stop(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    crate::session_runtime::codex_bridge_stop_impl(app, state).await
}

#[tauri::command]
fn terminal_create(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Option<TerminalCreateRequest>,
) -> Result<TerminalCreateResponse, String> {
    crate::terminal_runtime::terminal_create_impl(app, state, request)
}

#[tauri::command]
fn terminal_write(state: State<'_, AppState>, request: TerminalWriteRequest) -> Result<(), String> {
    crate::terminal_runtime::terminal_write_impl(state, request)
}

#[tauri::command]
fn terminal_resize(state: State<'_, AppState>, request: TerminalResizeRequest) -> Result<(), String> {
    crate::terminal_runtime::terminal_resize_impl(state, request)
}

#[tauri::command]
fn terminal_kill(
    app: AppHandle,
    state: State<'_, AppState>,
    request: TerminalKillRequest,
) -> Result<(), String> {
    crate::terminal_runtime::terminal_kill_impl(app, state, request)
}

#[tauri::command]
fn run_codex_command(args: Vec<String>, cwd: Option<String>) -> Result<RunCodexCommandResponse, String> {
    crate::command_runtime::run_codex_command_impl(args, cwd)
}
#[tauri::command]
fn codex_models_list(state: State<'_, AppState>) -> Result<CodexModelListResponse, String> {
    crate::command_runtime::codex_models_list_impl(state)
}
#[tauri::command]
async fn codex_wait_for_mcp_startup(
    state: State<'_, AppState>,
) -> Result<McpStartupWarmupResponse, String> {
    crate::command_runtime::codex_wait_for_mcp_startup_impl(state).await
}
#[tauri::command]
async fn codex_app_list(
    state: State<'_, AppState>,
    request: Option<AppListRequest>,
) -> Result<AppListResponse, String> {
    crate::command_runtime::codex_app_list_impl(state, request.unwrap_or(AppListRequest {
        cursor: None,
        limit: None,
        thread_id: None,
        force_refetch: false,
    }))
    .await
}

#[tauri::command]
async fn codex_account_read(
    state: State<'_, AppState>,
    request: Option<AccountReadRequest>,
) -> Result<AccountReadResponse, String> {
    crate::command_runtime::codex_account_read_impl(state, request.unwrap_or_default()).await
}

#[tauri::command]
async fn codex_account_login_start(
    state: State<'_, AppState>,
    request: AccountLoginStartRequest,
) -> Result<AccountLoginStartResponse, String> {
    crate::command_runtime::codex_account_login_start_impl(state, request).await
}

#[tauri::command]
async fn codex_account_logout(
    state: State<'_, AppState>,
) -> Result<AccountLogoutResponse, String> {
    crate::command_runtime::codex_account_logout_impl(state).await
}

#[tauri::command]
async fn codex_account_rate_limits_read(
    state: State<'_, AppState>,
) -> Result<AccountRateLimitsReadResponse, String> {
    crate::command_runtime::codex_account_rate_limits_read_impl(state).await
}
#[tauri::command]
async fn codex_mcp_list(state: State<'_, AppState>) -> Result<McpServerListResponse, String> {
    crate::command_runtime::codex_mcp_list_impl(state).await
}

#[tauri::command]
async fn codex_mcp_login(
    state: State<'_, AppState>,
    request: McpLoginRequest,
) -> Result<McpLoginResponse, String> {
    crate::command_runtime::codex_mcp_login_impl(state, request).await
}

#[tauri::command]
async fn codex_mcp_reload(state: State<'_, AppState>) -> Result<McpReloadResponse, String> {
    crate::command_runtime::codex_mcp_reload_impl(state).await
}

#[tauri::command]
fn pick_image_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter(
            "Image",
            &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
        )
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_mention_file() -> Option<String> {
    rfd::FileDialog::new()
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn codex_help_snapshot() -> CodexHelpSnapshot {
    CodexHelpSnapshot {
        cli_tree: CODEX_HELP_CLI_TREE,
        slash_commands: CODEX_HELP_SLASH_COMMANDS.to_vec(),
        key_flags: CODEX_HELP_KEY_FLAGS.to_vec(),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_codex_session,
            codex_bridge_start,
            codex_bridge_stop,
            codex_turn_run,
            codex_thread_open,
            codex_thread_list,
            codex_thread_read,
            codex_thread_archive,
            codex_thread_unarchive,
            codex_thread_compact_start,
            codex_thread_rollback,
            codex_thread_fork,
            codex_review_start,
            codex_turn_steer,
            codex_turn_interrupt,
            codex_approval_respond,
            codex_user_input_respond,
            update_codex_config,
            codex_config_get,
            codex_config_set,
            codex_runtime_status,
            codex_runtime_capabilities,
            load_codex_default_config,
            send_codex_input,
            stop_codex_session,
            resize_codex_pty,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_kill,
            run_codex_command,
            codex_models_list,
            codex_app_list,
            codex_account_read,
            codex_account_login_start,
            codex_account_logout,
            codex_account_rate_limits_read,
            codex_mcp_list,
            codex_mcp_login,
            codex_mcp_reload,
            codex_wait_for_mcp_startup,
            pick_image_file,
            pick_mention_file,
            codex_help_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

