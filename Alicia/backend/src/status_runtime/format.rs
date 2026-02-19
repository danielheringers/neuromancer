use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::RuntimeCodexConfig;

use super::rate_limit_snapshot::{StatusRateLimitSnapshot, StatusRateLimitWindow};

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

pub(crate) fn format_non_tui_status(
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
