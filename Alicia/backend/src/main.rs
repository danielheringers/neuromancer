use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, State};

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEventPayload {
    session_id: u64,
    chunk: String,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexHelpSnapshot {
    cli_tree: &'static str,
    slash_commands: Vec<&'static str>,
    key_flags: Vec<&'static str>,
}

struct ActiveSession {
    session_id: u64,
    pid: Option<u32>,
    binary: String,
    cwd: PathBuf,
    env_overrides: HashMap<String, String>,
    thread_id: Option<String>,
    busy: bool,
}
struct AppState {
    active_session: Mutex<Option<ActiveSession>>,
    next_session_id: AtomicU64,
    runtime_config: Mutex<RuntimeCodexConfig>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            active_session: Mutex::new(None),
            next_session_id: AtomicU64::new(1),
            runtime_config: Mutex::new(RuntimeCodexConfig::default()),
        }
    }
}

fn lock_active_session(state: &AppState) -> Result<MutexGuard<'_, Option<ActiveSession>>, String> {
    state
        .active_session
        .lock()
        .map_err(|_| "active session lock poisoned".to_string())
}

fn clear_session_if_current(app: &AppHandle, session_id: u64) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let mut guard = lock_active_session(state.inner())?;

    if guard
        .as_ref()
        .map(|active| active.session_id == session_id)
        .unwrap_or(false)
    {
        *guard = None;
        return Ok(true);
    }

    Ok(false)
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

fn build_exec_turn_args(
    config: &RuntimeCodexConfig,
    thread_id: Option<&str>,
    prompt: &str,
) -> Vec<String> {
    let normalized = normalize_runtime_config(config.clone());
    let mut args = vec![
        "exec".to_string(),
        "--json".to_string(),
        "--skip-git-repo-check".to_string(),
        "--sandbox".to_string(),
        normalized.sandbox.clone(),
    ];

    if normalized.model != "default" {
        args.push("--model".to_string());
        args.push(normalized.model);
    }

    if normalized.reasoning != "default" {
        args.push("-c".to_string());
        args.push(format!("model_reasoning_effort={}", normalized.reasoning));
    }


    args.push("-c".to_string());
    args.push(format!("web_search={}", normalized.web_search_mode));

    if normalized.web_search_mode == "live" {
        args.push("--search".to_string());
    }

    if let Some(thread_id) = thread_id {
        args.push("resume".to_string());
        args.push(thread_id.to_string());
    }

    args.push(prompt.to_string());
    args
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

#[derive(Default)]
struct ParsedExecJsonOutput {
    thread_id: Option<String>,
    stdout_chunks: Vec<String>,
    stderr_chunks: Vec<String>,
}

fn push_if_not_blank(target: &mut Vec<String>, value: Option<&str>) {
    if let Some(value) = value {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            target.push(trimmed.to_string());
        }
    }
}

fn parse_exec_item_completed(item: &serde_json::Value, parsed: &mut ParsedExecJsonOutput) {
    let item_type = item.get("type").and_then(|value| value.as_str()).unwrap_or_default();

    match item_type {
        "agent_message" => {
            push_if_not_blank(
                &mut parsed.stdout_chunks,
                item.get("text").and_then(|value| value.as_str()),
            );
        }
        "command_execution" => {
            push_if_not_blank(
                &mut parsed.stdout_chunks,
                item.get("aggregated_output").and_then(|value| value.as_str()),
            );

            let status = item
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or_default();

            if status == "failed" || status == "declined" {
                let command = item
                    .get("command")
                    .and_then(|value| value.as_str())
                    .unwrap_or("command");
                let exit_code = item
                    .get("exit_code")
                    .and_then(|value| value.as_i64())
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "unknown".to_string());

                parsed
                    .stderr_chunks
                    .push(format!("[command] {command} failed (exit={exit_code})"));
            }
        }
        "error" => {
            push_if_not_blank(
                &mut parsed.stderr_chunks,
                item.get("message").and_then(|value| value.as_str()),
            );
        }
        _ => {}
    }
}

fn parse_exec_json_event(event: &serde_json::Value, parsed: &mut ParsedExecJsonOutput) {
    let event_type = event
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    match event_type {
        "thread.started" => {
            if let Some(thread_id) = event.get("thread_id").and_then(|value| value.as_str()) {
                parsed.thread_id = Some(thread_id.to_string());
            }
        }
        "item.completed" => {
            if let Some(item) = event.get("item") {
                parse_exec_item_completed(item, parsed);
            }
        }
        "turn.failed" => {
            push_if_not_blank(
                &mut parsed.stderr_chunks,
                event
                    .get("error")
                    .and_then(|value| value.get("message"))
                    .and_then(|value| value.as_str()),
            );
        }
        "error" => {
            push_if_not_blank(
                &mut parsed.stderr_chunks,
                event.get("message").and_then(|value| value.as_str()),
            );
        }
        _ => {}
    }
}

fn parse_exec_jsonl_output(stdout: &str) -> ParsedExecJsonOutput {
    let mut parsed = ParsedExecJsonOutput::default();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(event) => parse_exec_json_event(&event, &mut parsed),
            Err(_) => continue,
        }
    }

    parsed
}

fn strip_ansi_and_normalize_lines(raw: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut in_escape = false;

    for ch in raw.chars() {
        if in_escape {
            if ('@'..='~').contains(&ch) {
                in_escape = false;
            }
            continue;
        }

        if ch == '\u{1b}' {
            in_escape = true;
            continue;
        }

        match ch {
            '\r' => current.clear(),
            '\n' => {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    lines.push(trimmed.to_string());
                }
                current.clear();
            }
            _ if ch.is_control() && ch != '\t' => {}
            _ => current.push(ch),
        }
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        lines.push(trimmed.to_string());
    }

    lines
}

fn run_exec_turn(
    binary: &str,
    cwd: &Path,
    env_overrides: &HashMap<String, String>,
    runtime_config: &RuntimeCodexConfig,
    thread_id: Option<&str>,
    prompt: &str,
) -> Result<RunCodexCommandResponse, String> {
    let args = build_exec_turn_args(runtime_config, thread_id, prompt);
    let (program, resolved_args) = resolve_codex_launch(binary, &args)?;

    let mut command = Command::new(program);
    command.args(resolved_args);
    command.current_dir(cwd);

    for (key, value) in env_overrides {
        command.env(key, value);
    }

    let output = command.output().map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            format!("failed to run codex exec command: executable not found ({error})")
        } else {
            format!("failed to run codex exec command: {error}")
        }
    })?;

    Ok(RunCodexCommandResponse {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        status: output.status.code().unwrap_or(-1),
        success: output.status.success(),
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
        return Err("custom start args are not supported in non-TUI mode".to_string());
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
    let pid = Some(0);

    {
        let mut guard = lock_active_session(state.inner())?;
        *guard = Some(ActiveSession {
            session_id,
            pid,
            binary,
            cwd,
            env_overrides,
            thread_id: None,
            busy: false,
        });
    }

    emit_lifecycle(&app, "started", Some(session_id), pid, None, None);

    Ok(StartCodexSessionResponse { session_id, pid: 0 })
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

fn format_non_tui_status(
    session_id: u64,
    pid: Option<u32>,
    thread_id: Option<&str>,
    cwd: &Path,
    runtime: &RuntimeCodexConfig,
) -> String {
    let pid_display = pid
        .map(|value| value.to_string())
        .unwrap_or_else(|| "n/a".to_string());
    let thread_display = thread_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("n/a");

    format!(
        "/status (non-TUI compatibility)\nmode: exec --json\nsession: #{session_id} (pid {pid_display})\nthread: {thread_display}\nworkspace: {}\nmodel: {}\nreasoning: {}\napproval: {}\nsandbox: {}\nweb search: {}\n\nNote: the full TUI rate-limit/context dashboard is unavailable in non-TUI mode.",
        cwd.display(),
        runtime.model,
        runtime.reasoning,
        runtime.approval_policy,
        runtime.sandbox,
        runtime.web_search_mode,
    )
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

    let (session_id, pid, binary, cwd, env_overrides, thread_id) = {
        let mut guard = lock_active_session(state.inner())?;
        let active = guard
            .as_mut()
            .ok_or_else(|| "no active codex session".to_string())?;

        if active.busy {
            return Err("codex session is still processing the previous turn".to_string());
        }

        if let Some((command, _args)) = slash_command {
            if command.eq_ignore_ascii_case("/status") {
                let chunk = format_non_tui_status(
                    active.session_id,
                    active.pid,
                    active.thread_id.as_deref(),
                    &active.cwd,
                    &runtime_config,
                );
                emit_stdout(&app, active.session_id, chunk);
            } else {
                emit_stderr(
                    &app,
                    active.session_id,
                    format!(
                        "slash command `{command}` is not available in non-TUI mode. Supported compatibility command: /status"
                    ),
                );
            }
            return Ok(());
        }

        active.busy = true;

        (
            active.session_id,
            active.pid,
            active.binary.clone(),
            active.cwd.clone(),
            active.env_overrides.clone(),
            active.thread_id.clone(),
        )
    };

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let run_result = tauri::async_runtime::spawn_blocking(move || {
            run_exec_turn(
                &binary,
                &cwd,
                &env_overrides,
                &runtime_config,
                thread_id.as_deref(),
                &prompt,
            )
        })
        .await;

        let mut emitted_any_output = false;

        match run_result {
            Ok(Ok(result)) => {
                let parsed = parse_exec_jsonl_output(&result.stdout);
                let discovered_thread_id = parsed.thread_id.clone();

                for chunk in parsed.stdout_chunks {
                    emit_stdout(&app_for_task, session_id, chunk);
                    emitted_any_output = true;
                }

                for chunk in parsed.stderr_chunks {
                    emit_stderr(&app_for_task, session_id, chunk);
                    emitted_any_output = true;
                }

                for chunk in strip_ansi_and_normalize_lines(&result.stderr) {
                    emit_stderr(&app_for_task, session_id, chunk);
                    emitted_any_output = true;
                }

                if !result.success {
                    emit_stderr(
                        &app_for_task,
                        session_id,
                        format!("[exec] codex exited with status {}", result.status),
                    );
                    emit_lifecycle(
                        &app_for_task,
                        "error",
                        Some(session_id),
                        pid,
                        Some(result.status),
                        Some("codex exec failed".to_string()),
                    );
                    emitted_any_output = true;
                }

                finish_session_turn(&app_for_task, session_id, discovered_thread_id);
            }
            Ok(Err(error)) => {
                emit_stderr(&app_for_task, session_id, error.clone());
                emit_lifecycle(
                    &app_for_task,
                    "error",
                    Some(session_id),
                    pid,
                    None,
                    Some(error),
                );
                finish_session_turn(&app_for_task, session_id, None);
                emitted_any_output = true;
            }
            Err(error) => {
                let message = format!("failed to run codex exec task: {error}");
                emit_stderr(&app_for_task, session_id, message.clone());
                emit_lifecycle(
                    &app_for_task,
                    "error",
                    Some(session_id),
                    pid,
                    None,
                    Some(message),
                );
                finish_session_turn(&app_for_task, session_id, None);
                emitted_any_output = true;
            }
        }

        if !emitted_any_output {
            // Wake frontend state machine even when no visible text was produced.
            emit_stdout(&app_for_task, session_id, String::new());
        }
    });

    Ok(())
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
fn stop_codex_session(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let (session_id, pid, busy) = {
        let guard = lock_active_session(state.inner())?;
        let active = guard
            .as_ref()
            .ok_or_else(|| "no active codex session".to_string())?;

        (active.session_id, active.pid, active.busy)
    };

    if busy {
        return Err("cannot stop session while a turn is still running".to_string());
    }

    if clear_session_if_current(&app, session_id)? {
        emit_lifecycle(
            &app,
            "stopped",
            Some(session_id),
            pid,
            None,
            Some("stopped by request".to_string()),
        );
    }

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
            update_codex_config,
            codex_runtime_status,
            load_codex_default_config,
            send_codex_input,
            stop_codex_session,
            resize_codex_pty,
            run_codex_command,
            pick_image_file,
            pick_mention_file,
            codex_help_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}









