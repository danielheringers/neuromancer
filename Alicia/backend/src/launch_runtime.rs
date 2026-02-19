use std::env;
use std::path::{Path, PathBuf};

pub(crate) fn default_codex_binary() -> String {
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
            // On Windows, skip the bare name (no extension) - npm creates
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

pub(crate) fn resolve_binary_path(binary: &str) -> Option<PathBuf> {
    let binary_path = Path::new(binary);
    if binary_path.components().count() > 1 {
        if binary_path.is_file() {
            return Some(binary_path.to_path_buf());
        }

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
    let candidates = [
        cwd.join("Alicia").join("codex-cli").join("dist").join("index.js"),
        cwd.join("codex-cli").join("dist").join("index.js"),
    ];

    for candidate in candidates {
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

    if binary.eq_ignore_ascii_case("codex") {
        return fallback_codex_js_path();
    }

    None
}

fn needs_node_wrapper(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("js") => true,
        Some(ext) if ext.eq_ignore_ascii_case("mjs") => true,
        Some(ext) if ext.eq_ignore_ascii_case("cjs") => true,
        _ => false,
    }
}

#[cfg(windows)]
fn needs_cmd_wrapper(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some(ext) if ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat")
    )
}

#[cfg(not(windows))]
fn needs_cmd_wrapper(_path: &Path) -> bool {
    false
}

pub(crate) fn resolve_codex_launch(
    binary: &str,
    args: &[String],
) -> Result<(String, Vec<String>), String> {
    let resolved_binary = resolve_codex_entrypoint(binary).ok_or_else(|| {
        format!("failed to locate codex binary `{binary}`. Set ALICIA_CODEX_BIN to a valid executable path.")
    })?;

    if needs_node_wrapper(&resolved_binary) {
        let node_binary = resolve_binary_path("node").ok_or_else(|| {
            "failed to locate node executable required to run codex JavaScript entrypoint"
                .to_string()
        })?;
        let mut resolved_args = vec![resolved_binary.to_string_lossy().to_string()];
        resolved_args.extend(args.iter().cloned());
        return Ok((node_binary.to_string_lossy().to_string(), resolved_args));
    }

    if needs_cmd_wrapper(&resolved_binary) {
        let mut resolved_args = vec!["/c".to_string(), resolved_binary.to_string_lossy().to_string()];
        resolved_args.extend(args.iter().cloned());
        return Ok(("cmd".to_string(), resolved_args));
    }

    Ok((resolved_binary.to_string_lossy().to_string(), args.to_vec()))
}
