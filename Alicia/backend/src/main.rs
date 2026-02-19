use portable_pty::{native_pty_system, CommandBuilder as PtyCommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

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
    "/debug-config",
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
struct RunCodexCommandResponse {
    stdout: String,
    stderr: String,
    status: i32,
    success: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpStartupWarmupResponse {
    ready_servers: Vec<String>,
    total_ready: usize,
    elapsed_ms: u64,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEventPayload {
    session_id: u64,
    chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexStructuredEventPayload {
    session_id: u64,
    seq: u64,
    event: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LifecycleEventPayload {
    status: &'static str,
    session_id: Option<u64>,
    pid: Option<u32>,
    exit_code: Option<i32>,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalDataPayload {
    terminal_id: u64,
    seq: u64,
    chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    terminal_id: u64,
    seq: u64,
    exit_code: Option<i32>,
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

type BridgePendingMap = HashMap<u64, oneshot::Sender<Result<Value, String>>>;

struct BridgeProcess {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<BridgePendingMap>>,
    next_request_id: Arc<AtomicU64>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum WebSearchToml {
    Mode(String),
    Enabled(bool),
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct CodexProjectConfig {
    trust_level: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct CodexProfileConfig {
    model: Option<String>,
    approval_policy: Option<String>,
    sandbox_mode: Option<String>,
    model_reasoning_effort: Option<String>,
    web_search: Option<WebSearchToml>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct CodexConfigToml {
    model: Option<String>,
    approval_policy: Option<String>,
    sandbox_mode: Option<String>,
    model_reasoning_effort: Option<String>,
    web_search: Option<WebSearchToml>,
    profile: Option<String>,
    profiles: HashMap<String, CodexProfileConfig>,
    projects: HashMap<String, CodexProjectConfig>,
}

fn profile_from_preset(preset: &str) -> &'static str {
    match preset {
        "read-only" => "read_only",
        "full-access" => "full_access",
        _ => "read_write_with_approval",
    }
}

fn approval_preset_from_policy_and_sandbox(approval_policy: &str, sandbox: &str) -> &'static str {
    if sandbox == "read-only" {
        return "read-only";
    }
    if sandbox == "danger-full-access" && approval_policy == "never" {
        return "full-access";
    }
    "auto"
}

fn normalize_runtime_config(mut config: RuntimeCodexConfig) -> RuntimeCodexConfig {
    if config.model.trim().is_empty() {
        config.model = "default".to_string();
    }

    let reasoning = config.reasoning.to_ascii_lowercase();
    config.reasoning = match reasoning.as_str() {
        "default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" => reasoning,
        _ => "default".to_string(),
    };

    let approval_policy = config.approval_policy.to_ascii_lowercase();
    config.approval_policy = match approval_policy.as_str() {
        "untrusted" | "on-failure" | "on-request" | "never" => approval_policy,
        _ => "on-request".to_string(),
    };

    let sandbox = config.sandbox.to_ascii_lowercase();
    config.sandbox = match sandbox.as_str() {
        "read-only" | "workspace-write" | "danger-full-access" => sandbox,
        _ => "read-only".to_string(),
    };

    let web_search_mode = config.web_search_mode.to_ascii_lowercase();
    config.web_search_mode = match web_search_mode.as_str() {
        "disabled" | "cached" | "live" => web_search_mode,
        _ => "cached".to_string(),
    };

    let preset = config.approval_preset.to_ascii_lowercase();
    config.approval_preset = match preset.as_str() {
        "read-only" | "auto" | "full-access" => preset,
        _ => {
            if config.sandbox == "read-only" {
                "read-only".to_string()
            } else if config.sandbox == "danger-full-access" && config.approval_policy == "never" {
                "full-access".to_string()
            } else {
                "auto".to_string()
            }
        }
    };

    config.approval_preset =
        approval_preset_from_policy_and_sandbox(&config.approval_policy, &config.sandbox)
            .to_string();
    config.profile = profile_from_preset(&config.approval_preset).to_string();
    config
}

fn merge_option<T>(target: &mut Option<T>, value: Option<T>) {
    if let Some(value) = value {
        *target = Some(value);
    }
}

fn merge_codex_config(target: &mut CodexConfigToml, overlay: CodexConfigToml) {
    merge_option(&mut target.model, overlay.model);
    merge_option(&mut target.approval_policy, overlay.approval_policy);
    merge_option(&mut target.sandbox_mode, overlay.sandbox_mode);
    merge_option(
        &mut target.model_reasoning_effort,
        overlay.model_reasoning_effort,
    );
    merge_option(&mut target.web_search, overlay.web_search);
    merge_option(&mut target.profile, overlay.profile);

    for (key, profile) in overlay.profiles {
        target.profiles.insert(key, profile);
    }

    for (key, project) in overlay.projects {
        target.projects.insert(key, project);
    }
}

fn read_codex_config_file(path: &Path) -> Result<Option<CodexConfigToml>, String> {
    if !path.is_file() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read `{}`: {error}", path.display()))?;

    toml::from_str::<CodexConfigToml>(&raw)
        .map(Some)
        .map_err(|error| format!("failed to parse `{}`: {error}", path.display()))
}

fn resolve_codex_home() -> PathBuf {
    if let Some(path) = env::var_os("CODEX_HOME") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    if let Some(path) = env::var_os("HOME") {
        if !path.is_empty() {
            return PathBuf::from(path).join(".codex");
        }
    }

    if let Some(path) = env::var_os("USERPROFILE") {
        if !path.is_empty() {
            return PathBuf::from(path).join(".codex");
        }
    }

    PathBuf::from(".codex")
}

fn find_repo_root(cwd: &Path) -> Option<PathBuf> {
    for ancestor in cwd.ancestors() {
        if ancestor.join(".git").exists() {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

fn get_active_project_trust(config: &CodexConfigToml, cwd: &Path) -> Option<String> {
    let cwd_key = cwd.to_string_lossy().to_string();
    if let Some(level) = config
        .projects
        .get(&cwd_key)
        .and_then(|project| project.trust_level.as_ref())
    {
        return Some(level.to_ascii_lowercase());
    }

    if let Some(repo_root) = find_repo_root(cwd) {
        let root_key = repo_root.to_string_lossy().to_string();
        if let Some(level) = config
            .projects
            .get(&root_key)
            .and_then(|project| project.trust_level.as_ref())
        {
            return Some(level.to_ascii_lowercase());
        }
    }

    None
}

fn default_approval_policy_for_trust(trust_level: Option<&str>) -> &'static str {
    match trust_level {
        Some("untrusted") => "untrusted",
        _ => "on-request",
    }
}

fn default_sandbox_for_trust(trust_level: Option<&str>) -> &'static str {
    match trust_level {
        Some("trusted") | Some("untrusted") => {
            if cfg!(windows) {
                "read-only"
            } else {
                "workspace-write"
            }
        }
        _ => "read-only",
    }
}

fn web_search_mode_from_toml(value: Option<&WebSearchToml>) -> Option<String> {
    match value {
        Some(WebSearchToml::Mode(mode)) => Some(mode.to_ascii_lowercase()),
        Some(WebSearchToml::Enabled(true)) => Some("live".to_string()),
        Some(WebSearchToml::Enabled(false)) => Some("disabled".to_string()),
        None => None,
    }
}

async fn load_runtime_config_from_codex() -> Result<RuntimeCodexConfig, String> {
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let resolved_cwd = fs::canonicalize(&cwd).unwrap_or(cwd);
    let mut merged = CodexConfigToml::default();

    #[cfg(windows)]
    {
        let program_data = env::var_os("ProgramData")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
        let system_file = program_data.join("OpenAI").join("Codex").join("config.toml");
        if let Some(config) = read_codex_config_file(&system_file)? {
            merge_codex_config(&mut merged, config);
        }
    }

    #[cfg(not(windows))]
    {
        let system_file = PathBuf::from("/etc/codex/config.toml");
        if let Some(config) = read_codex_config_file(&system_file)? {
            merge_codex_config(&mut merged, config);
        }
    }

    let codex_home = resolve_codex_home();
    if let Some(config) = read_codex_config_file(&codex_home.join("config.toml"))? {
        merge_codex_config(&mut merged, config);
    }

    if let Some(repo_root) = find_repo_root(&resolved_cwd) {
        if let Some(config) = read_codex_config_file(&repo_root.join(".codex").join("config.toml"))?
        {
            merge_codex_config(&mut merged, config);
        }
    }

    if let Some(config) = read_codex_config_file(&resolved_cwd.join(".codex").join("config.toml"))?
    {
        merge_codex_config(&mut merged, config);
    }

    if let Some(config) = read_codex_config_file(&resolved_cwd.join("config.toml"))? {
        merge_codex_config(&mut merged, config);
    }

    let active_profile = merged
        .profile
        .clone()
        .and_then(|name| merged.profiles.get(&name).cloned());
    let trust_level = get_active_project_trust(&merged, &resolved_cwd);

    let model = active_profile
        .as_ref()
        .and_then(|profile| profile.model.clone())
        .or(merged.model)
        .unwrap_or_else(|| "default".to_string());

    let reasoning = active_profile
        .as_ref()
        .and_then(|profile| profile.model_reasoning_effort.clone())
        .or(merged.model_reasoning_effort)
        .unwrap_or_else(|| "default".to_string());

    let approval_policy = active_profile
        .as_ref()
        .and_then(|profile| profile.approval_policy.clone())
        .or(merged.approval_policy)
        .unwrap_or_else(|| default_approval_policy_for_trust(trust_level.as_deref()).to_string());

    let sandbox = active_profile
        .as_ref()
        .and_then(|profile| profile.sandbox_mode.clone())
        .or(merged.sandbox_mode)
        .unwrap_or_else(|| default_sandbox_for_trust(trust_level.as_deref()).to_string());

    let web_search_mode = web_search_mode_from_toml(
        active_profile
            .as_ref()
            .and_then(|profile| profile.web_search.as_ref())
            .or(merged.web_search.as_ref()),
    )
    .unwrap_or_else(|| "cached".to_string());

    let approval_preset = approval_preset_from_policy_and_sandbox(&approval_policy, &sandbox);

    Ok(normalize_runtime_config(RuntimeCodexConfig {
        model,
        reasoning,
        approval_preset: approval_preset.to_string(),
        approval_policy,
        sandbox,
        profile: profile_from_preset(approval_preset).to_string(),
        web_search_mode,
    }))
}

fn default_codex_binary() -> String {
    env::var("ALICIA_CODEX_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "codex".to_string())
}

fn binary_candidates(binary: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        if Path::new(binary).extension().is_some() {
            vec![binary.to_string()]
        } else {
            // On Windows, skip the bare name (no extension) — npm creates
            // extensionless bash scripts that are not valid Win32 executables.
            // Prioritize .exe over .cmd/.bat for direct execution.
            vec![
                format!("{binary}.exe"),
                format!("{binary}.cmd"),
                format!("{binary}.bat"),
            ]
        }
    }

    #[cfg(not(windows))]
    {
        vec![binary.to_string()]
    }
}

fn resolve_binary_path(binary: &str) -> Option<PathBuf> {
    let binary_path = Path::new(binary);
    let has_path_hint = binary_path.is_absolute() || binary.contains(['/', '\\']);

    if has_path_hint {
        for candidate in binary_candidates(binary) {
            let candidate_path = PathBuf::from(&candidate);
            if candidate_path.is_file() {
                return Some(candidate_path);
            }
        }
        return None;
    }

    let path_var = env::var_os("PATH")?;
    let candidates = binary_candidates(binary);

    for directory in env::split_paths(&path_var) {
        for candidate in &candidates {
            let full_path = directory.join(candidate);
            if full_path.is_file() {
                return Some(full_path);
            }
        }
    }

    None
}

#[cfg(windows)]
fn fallback_windows_npm_binary(binary: &str) -> Option<PathBuf> {
    let app_data = env::var_os("APPDATA")?;
    let npm_dir = PathBuf::from(app_data).join("npm");

    for candidate in binary_candidates(binary) {
        let full_path = npm_dir.join(candidate);
        if full_path.is_file() {
            return Some(full_path);
        }
    }

    None
}

#[cfg(not(windows))]
fn fallback_windows_npm_binary(_binary: &str) -> Option<PathBuf> {
    None
}

fn fallback_codex_js_path() -> Option<PathBuf> {
    let cwd = env::current_dir().ok()?;

    for ancestor in cwd.ancestors() {
        let candidate = ancestor
            .join("codex")
            .join("codex-cli")
            .join("bin")
            .join("codex.js");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn resolve_codex_entrypoint(binary: &str) -> Option<PathBuf> {
    if let Some(path) = resolve_binary_path(binary) {
        return Some(path);
    }

    if let Some(path) = fallback_windows_npm_binary(binary) {
        return Some(path);
    }

    if binary == "codex" {
        return fallback_codex_js_path();
    }

    None
}

fn needs_node_wrapper(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            ext.eq_ignore_ascii_case("js")
                || ext.eq_ignore_ascii_case("cjs")
                || ext.eq_ignore_ascii_case("mjs")
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn needs_cmd_wrapper(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"))
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn needs_cmd_wrapper(_path: &Path) -> bool {
    false
}

fn resolve_codex_launch(binary: &str, args: &[String]) -> Result<(String, Vec<String>), String> {
    let resolved_binary = resolve_codex_entrypoint(binary).ok_or_else(|| {
        format!(
            "program not found: `{binary}`. Install Codex CLI, ensure it is on PATH, or set ALICIA_CODEX_BIN to the executable path."
        )
    })?;

    if needs_node_wrapper(&resolved_binary) {
        let node_binary = resolve_binary_path("node").ok_or_else(|| {
            "node runtime not found. Install Node.js or set ALICIA_CODEX_BIN to a Codex executable (.exe/.cmd).".to_string()
        })?;

        let mut final_args = vec![resolved_binary.to_string_lossy().to_string()];
        final_args.extend(args.iter().cloned());
        return Ok((node_binary.to_string_lossy().to_string(), final_args));
    }

    if needs_cmd_wrapper(&resolved_binary) {
        let mut final_args = vec!["/C".to_string(), resolved_binary.to_string_lossy().to_string()];
        final_args.extend(args.iter().cloned());
        return Ok(("cmd".to_string(), final_args));
    }

    Ok((resolved_binary.to_string_lossy().to_string(), args.to_vec()))
}

fn emit_lifecycle(
    app: &AppHandle,
    status: &'static str,
    session_id: Option<u64>,
    pid: Option<u32>,
    exit_code: Option<i32>,
    message: Option<String>,
) {
    let payload = LifecycleEventPayload {
        status,
        session_id,
        pid,
        exit_code,
        message,
    };
    let _ = app.emit("codex://lifecycle", payload);
}

fn emit_stream(app: &AppHandle, channel: &str, session_id: u64, chunk: String) {
    let payload = StreamEventPayload { session_id, chunk };
    let _ = app.emit(channel, payload);
}

fn emit_stdout(app: &AppHandle, session_id: u64, chunk: String) {
    emit_stream(app, "codex://stdout", session_id, chunk);
}

fn emit_stderr(app: &AppHandle, session_id: u64, chunk: String) {
    emit_stream(app, "codex://stderr", session_id, chunk);
}

fn emit_codex_event(
    app: &AppHandle,
    session_id: u64,
    event: Value,
    event_seq: &Arc<AtomicU64>,
) {
    let seq = event_seq.fetch_add(1, Ordering::Relaxed);
    let payload = CodexStructuredEventPayload {
        session_id,
        seq,
        event,
    };
    let _ = app.emit("codex://event", payload);
}

fn emit_terminal_data(app: &AppHandle, terminal_id: u64, event_seq: &Arc<AtomicU64>, chunk: String) {
    let seq = event_seq.fetch_add(1, Ordering::Relaxed);
    let payload = TerminalDataPayload {
        terminal_id,
        seq,
        chunk,
    };
    let _ = app.emit("terminal://data", payload);
}

fn emit_terminal_exit(
    app: &AppHandle,
    terminal_id: u64,
    event_seq: &Arc<AtomicU64>,
    exit_code: Option<i32>,
) {
    let seq = event_seq.fetch_add(1, Ordering::Relaxed);
    let payload = TerminalExitPayload {
        terminal_id,
        seq,
        exit_code,
    };
    let _ = app.emit("terminal://exit", payload);
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

fn spawn_bridge_process(
    app: &AppHandle,
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

async fn bridge_request(
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

#[derive(Debug, Clone)]
struct StatusRateLimitWindow {
    used_percent: f64,
    window_minutes: Option<i64>,
    resets_at: Option<i64>,
}

#[derive(Debug, Clone)]
struct StatusRateLimitSnapshot {
    limit_id: Option<String>,
    limit_name: Option<String>,
    primary: Option<StatusRateLimitWindow>,
    secondary: Option<StatusRateLimitWindow>,
}

fn parse_rate_limit_window(value: &Value) -> Option<StatusRateLimitWindow> {
    let object = value.as_object()?;
    let used_percent = object
        .get("usedPercent")
        .and_then(Value::as_f64)
        .or_else(|| object.get("used_percent").and_then(Value::as_f64))?;
    let window_minutes = object
        .get("windowDurationMins")
        .and_then(Value::as_i64)
        .or_else(|| object.get("window_minutes").and_then(Value::as_i64));
    let resets_at = object
        .get("resetsAt")
        .and_then(Value::as_i64)
        .or_else(|| object.get("resets_at").and_then(Value::as_i64));

    Some(StatusRateLimitWindow {
        used_percent,
        window_minutes,
        resets_at,
    })
}

fn parse_rate_limit_snapshot(value: &Value) -> Option<StatusRateLimitSnapshot> {
    let object = value.as_object()?;
    let limit_id = object
        .get("limitId")
        .and_then(Value::as_str)
        .or_else(|| object.get("limit_id").and_then(Value::as_str))
        .map(|value| value.to_string());
    let limit_name = object
        .get("limitName")
        .and_then(Value::as_str)
        .or_else(|| object.get("limit_name").and_then(Value::as_str))
        .map(|value| value.to_string());
    let primary = object.get("primary").and_then(parse_rate_limit_window);
    let secondary = object.get("secondary").and_then(parse_rate_limit_window);

    if primary.is_none() && secondary.is_none() {
        return None;
    }

    Some(StatusRateLimitSnapshot {
        limit_id,
        limit_name,
        primary,
        secondary,
    })
}

fn pick_rate_limit_snapshot(result: &Value) -> Option<StatusRateLimitSnapshot> {
    let object = result.as_object()?;

    if let Some(snapshot) = object.get("rateLimits").and_then(parse_rate_limit_snapshot) {
        return Some(snapshot);
    }

    let by_limit_id = object.get("rateLimitsByLimitId")?.as_object()?;

    let mut first_snapshot: Option<StatusRateLimitSnapshot> = None;
    for (key, value) in by_limit_id {
        if let Some(mut snapshot) = parse_rate_limit_snapshot(value) {
            if snapshot.limit_id.is_none() {
                snapshot.limit_id = Some(key.clone());
            }
            if snapshot
                .limit_id
                .as_ref()
                .map(|id| id.starts_with("codex"))
                .unwrap_or(false)
            {
                return Some(snapshot);
            }
            if first_snapshot.is_none() {
                first_snapshot = Some(snapshot);
            }
        }
    }

    first_snapshot
}

fn extract_rate_limits_from_app_server_message(message: &Value) -> Option<StatusRateLimitSnapshot> {
    if message
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(|method| method == "account/rateLimits/updated")
    {
        return message
            .get("params")
            .and_then(|params| params.get("rateLimits"))
            .and_then(parse_rate_limit_snapshot);
    }

    if message
        .get("id")
        .and_then(Value::as_str)
        .is_some_and(|id| id == "alicia-rate-limits")
    {
        return message.get("result").and_then(pick_rate_limit_snapshot);
    }

    None
}

fn write_json_line(stdin: &mut ChildStdin, payload: &Value) -> Result<(), String> {
    let serialized =
        serde_json::to_string(payload).map_err(|error| format!("failed to encode json-rpc payload: {error}"))?;
    writeln!(stdin, "{serialized}")
        .map_err(|error| format!("failed to write json-rpc payload to app-server stdin: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("failed to flush app-server stdin: {error}"))
}

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

fn fetch_models_for_picker(binary: &str, cwd: &Path) -> Result<Vec<CodexModel>, String> {
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
            format!("failed to spawn app-server for model/list: executable not found ({error})")
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
                    return Err("timed out waiting for model/list response from app-server".to_string());
                }
                let remaining = deadline.saturating_duration_since(now);
                let message = rx
                    .recv_timeout(remaining)
                    .map_err(|_| "timed out waiting for model/list response from app-server".to_string())?;

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

fn fetch_mcp_statuses_for_startup(binary: &str, cwd: &Path) -> Result<Vec<String>, String> {
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
fn fetch_rate_limits_for_status(binary: &str, cwd: &Path) -> Option<StatusRateLimitSnapshot> {
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
        let serialized = serde_json::to_string(&payload).ok()?;
        if writeln!(stdin, "{serialized}").is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    }
    let _ = stdin.flush();

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

fn format_limit_window_label(window_minutes: Option<i64>) -> String {
    match window_minutes.unwrap_or(0) {
        300 => "5h".to_string(),
        10080 => "week".to_string(),
        value if value > 0 => format!("{value}m"),
        _ => "window".to_string(),
    }
}

fn format_limit_reset_eta(resets_at: Option<i64>) -> String {
    let Some(target_epoch) = resets_at else {
        return "n/a".to_string();
    };

    let now_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64);

    let Some(now_epoch) = now_epoch else {
        return "n/a".to_string();
    };

    let seconds_remaining = (target_epoch - now_epoch).max(0);
    if seconds_remaining == 0 {
        return "now".to_string();
    }

    let hours = seconds_remaining / 3600;
    let minutes = (seconds_remaining % 3600) / 60;
    if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
}

fn format_rate_limit_window_status(window: &StatusRateLimitWindow) -> String {
    let used = window.used_percent.clamp(0.0, 100.0);
    let remaining = (100.0 - used).clamp(0.0, 100.0);
    let reset_eta = format_limit_reset_eta(window.resets_at);

    format!(
        "{:.0}% remaining ({:.0}% used), resets in {reset_eta}",
        remaining, used
    )
}

fn format_non_tui_status(
    session_id: u64,
    pid: Option<u32>,
    thread_id: Option<&str>,
    cwd: &Path,
    runtime: &RuntimeCodexConfig,
    rate_limits: Option<&StatusRateLimitSnapshot>,
) -> String {
    let pid_display = pid
        .map(|value| value.to_string())
        .unwrap_or_else(|| "n/a".to_string());
    let thread_display = thread_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("n/a");

    let mut lines = vec![
        "/status".to_string(),
        "mode: sdk-bridge".to_string(),
        format!("session: #{session_id} (pid {pid_display})"),
        format!("thread: {thread_display}"),
        format!("workspace: {}", cwd.display()),
        format!("model: {}", runtime.model),
        format!("reasoning: {}", runtime.reasoning),
        format!("approval: {}", runtime.approval_policy),
        format!("sandbox: {}", runtime.sandbox),
        format!("web search: {}", runtime.web_search_mode),
    ];

    if let Some(snapshot) = rate_limits {
        if let Some(limit_id) = snapshot.limit_id.as_deref() {
            lines.push(format!("limit id: {limit_id}"));
        }
        if let Some(limit_name) = snapshot.limit_name.as_deref() {
            lines.push(format!("limit name: {limit_name}"));
        }
        if let Some(primary) = snapshot.primary.as_ref() {
            lines.push(format!(
                "remaining {}: {}",
                format_limit_window_label(primary.window_minutes),
                format_rate_limit_window_status(primary)
            ));
        }
        if let Some(secondary) = snapshot.secondary.as_ref() {
            lines.push(format!(
                "remaining {}: {}",
                format_limit_window_label(secondary.window_minutes),
                format_rate_limit_window_status(secondary)
            ));
        }
        if snapshot.primary.is_none() && snapshot.secondary.is_none() {
            lines.push("rate limits: unavailable".to_string());
        }
    } else {
        lines.push("rate limits: unavailable".to_string());
    }

    lines.join("\n")
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

#[tauri::command]
async fn codex_turn_run(
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

#[tauri::command]
async fn codex_thread_open(
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

#[tauri::command]
async fn send_codex_input(
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

fn stop_bridge_process(mut bridge: BridgeProcess) {
    let request_id = bridge.next_request_id.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut stdin) = bridge.stdin.lock() {
        let request = json!({
            "type": "request",
            "id": request_id,
            "method": "shutdown",
            "params": {},
        });
        if let Ok(serialized) = serde_json::to_string(&request) {
            let _ = stdin.write_all(serialized.as_bytes());
            let _ = stdin.write_all(b"\n");
            let _ = stdin.flush();
        }
    }

    let _ = bridge.child.kill();
    let _ = bridge.child.wait();
    fail_pending_requests(&bridge.pending, "codex bridge stopped");
}

#[tauri::command]
async fn start_codex_session(
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

    let binary = config
        .binary
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_codex_binary);

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

    {
        let mut guard = lock_active_session(state.inner())?;
        *guard = Some(ActiveSession {
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

#[tauri::command]
fn resize_codex_pty(
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

#[tauri::command]
async fn stop_codex_session(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
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

#[tauri::command]
async fn codex_bridge_start(
    app: AppHandle,
    state: State<'_, AppState>,
    config: Option<StartCodexSessionConfig>,
) -> Result<StartCodexSessionResponse, String> {
    start_codex_session(app, state, config).await
}

#[tauri::command]
async fn codex_bridge_stop(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    stop_codex_session(app, state).await
}

fn default_terminal_shell() -> String {
    #[cfg(windows)]
    {
        if resolve_binary_path("pwsh.exe").is_some() || resolve_binary_path("pwsh").is_some() {
            return "pwsh.exe".to_string();
        }
        if resolve_binary_path("powershell.exe").is_some()
            || resolve_binary_path("powershell").is_some()
        {
            return "powershell.exe".to_string();
        }
        if let Ok(comspec) = env::var("COMSPEC") {
            if !comspec.trim().is_empty() {
                return comspec;
            }
        }
        return "cmd.exe".to_string();
    }
    #[cfg(not(windows))]
    {
        env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

fn lock_terminals(
    state: &AppState,
) -> Result<MutexGuard<'_, HashMap<u64, TerminalSession>>, String> {
    state
        .terminals
        .lock()
        .map_err(|_| "terminal lock poisoned".to_string())
}

#[tauri::command]
fn terminal_create(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Option<TerminalCreateRequest>,
) -> Result<TerminalCreateResponse, String> {
    let request = request.unwrap_or(TerminalCreateRequest {
        cwd: None,
        shell: None,
    });

    let cwd = request
        .cwd
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    if !cwd.exists() {
        return Err(format!("terminal cwd does not exist: {}", cwd.display()));
    }

    let shell = request
        .shell
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_terminal_shell);

    let terminal_id = state.next_terminal_id.fetch_add(1, Ordering::Relaxed);
    let event_seq = Arc::clone(&state.next_event_seq);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to create PTY: {error}"))?;

    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&shell)
        .to_ascii_lowercase();
    let mut command = PtyCommandBuilder::new(shell.clone());
    if shell_name.starts_with("pwsh") || shell_name.starts_with("powershell") {
        command.arg("-NoLogo");
    } else if shell_name == "cmd" || shell_name == "cmd.exe" {
        command.arg("/Q");
    }
    command.cwd(&cwd);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to spawn PTY process: {error}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to attach PTY reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to attach PTY writer: {error}"))?;

    let app_for_reader = app.clone();
    let event_seq_for_reader = Arc::clone(&event_seq);
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    emit_terminal_exit(&app_for_reader, terminal_id, &event_seq_for_reader, None);
                    break;
                }
                Ok(read) => {
                    let chunk = String::from_utf8_lossy(&buf[..read]).to_string();
                    emit_terminal_data(&app_for_reader, terminal_id, &event_seq_for_reader, chunk);
                }
                Err(error) => {
                    emit_terminal_data(
                        &app_for_reader,
                        terminal_id,
                        &event_seq_for_reader,
                        format!("\r\n[terminal] read error: {error}\r\n"),
                    );
                    emit_terminal_exit(&app_for_reader, terminal_id, &event_seq_for_reader, None);
                    break;
                }
            }
        }
    });

    {
        let mut terminals = lock_terminals(state.inner())?;
        terminals.insert(
            terminal_id,
            TerminalSession {
                terminal_id,
                master: pair.master,
                writer: Arc::new(Mutex::new(writer)),
                child,
            },
        );
    }

    emit_terminal_data(
        &app,
        terminal_id,
        &event_seq,
        format!(
            "[terminal] started {} in {}\r\n",
            shell,
            cwd.to_string_lossy()
        ),
    );

    Ok(TerminalCreateResponse { terminal_id })
}

#[tauri::command]
fn terminal_write(state: State<'_, AppState>, request: TerminalWriteRequest) -> Result<(), String> {
    let writer = {
        let terminals = lock_terminals(state.inner())?;
        let terminal = terminals
            .get(&request.terminal_id)
            .ok_or_else(|| format!("terminal {} not found", request.terminal_id))?;
        Arc::clone(&terminal.writer)
    };

    let mut guard = writer
        .lock()
        .map_err(|_| "terminal writer lock poisoned".to_string())?;
    guard
        .write_all(request.data.as_bytes())
        .map_err(|error| format!("failed to write to terminal: {error}"))?;
    guard
        .flush()
        .map_err(|error| format!("failed to flush terminal write: {error}"))?;
    Ok(())
}

#[tauri::command]
fn terminal_resize(state: State<'_, AppState>, request: TerminalResizeRequest) -> Result<(), String> {
    let mut terminals = lock_terminals(state.inner())?;
    let terminal = terminals
        .get_mut(&request.terminal_id)
        .ok_or_else(|| format!("terminal {} not found", request.terminal_id))?;

    terminal
        .master
        .resize(PtySize {
            rows: request.rows.max(1),
            cols: request.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to resize terminal: {error}"))?;

    Ok(())
}

#[tauri::command]
fn terminal_kill(
    app: AppHandle,
    state: State<'_, AppState>,
    request: TerminalKillRequest,
) -> Result<(), String> {
    let mut terminal = {
        let mut terminals = lock_terminals(state.inner())?;
        terminals
            .remove(&request.terminal_id)
            .ok_or_else(|| format!("terminal {} not found", request.terminal_id))?
    };

    let _ = terminal.child.kill();
    let _ = terminal.child.wait();
    emit_terminal_exit(
        &app,
        terminal.terminal_id,
        &state.next_event_seq,
        Some(-1),
    );
    Ok(())
}
#[tauri::command]
fn run_codex_command(args: Vec<String>, cwd: Option<String>) -> Result<RunCodexCommandResponse, String> {
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

    let output = command
        .output()
        .map_err(|error| {
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

#[tauri::command]
fn codex_models_list(state: State<'_, AppState>) -> Result<CodexModelListResponse, String> {
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

#[tauri::command]
fn codex_wait_for_mcp_startup(state: State<'_, AppState>) -> Result<McpStartupWarmupResponse, String> {
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
            update_codex_config,
            codex_config_get,
            codex_config_set,
            codex_runtime_status,
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
            codex_wait_for_mcp_startup,
            pick_image_file,
            pick_mention_file,
            codex_help_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}















