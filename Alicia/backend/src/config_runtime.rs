use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::RuntimeCodexConfig;

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

pub(crate) fn normalize_runtime_config(mut config: RuntimeCodexConfig) -> RuntimeCodexConfig {
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

    let raw =
        fs::read_to_string(path).map_err(|error| format!("failed to read `{}`: {error}", path.display()))?;

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

pub(crate) async fn load_runtime_config_from_codex() -> Result<RuntimeCodexConfig, String> {
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

    if let Some(config) = read_codex_config_file(&resolved_cwd.join(".codex").join("config.toml"))? {
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
