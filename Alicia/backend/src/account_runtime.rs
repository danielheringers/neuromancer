use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

fn parse_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|raw| u64::try_from(raw).ok()))
        .or_else(|| value.as_str().and_then(|raw| raw.trim().parse::<u64>().ok()))
}

fn parse_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|raw| i64::try_from(raw).ok()))
        .or_else(|| value.as_str().and_then(|raw| raw.trim().parse::<i64>().ok()))
}

fn parse_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|raw| raw as f64))
        .or_else(|| value.as_u64().map(|raw| raw as f64))
        .or_else(|| value.as_str().and_then(|raw| raw.trim().parse::<f64>().ok()))
}

fn parse_bool(value: &Value) -> Option<bool> {
    if let Some(raw) = value.as_bool() {
        return Some(raw);
    }

    if let Some(raw) = value.as_i64() {
        return Some(raw != 0);
    }

    if let Some(raw) = value.as_u64() {
        return Some(raw != 0);
    }

    value
        .as_str()
        .map(str::trim)
        .map(|raw| raw.eq_ignore_ascii_case("true") || raw == "1")
}

fn normalize_auth_mode(value: &str) -> String {
    match value.trim() {
        "apiKey" | "apikey" | "api_key" => "api_key".to_string(),
        "chatgpt" => "chatgpt".to_string(),
        "chatgptAuthTokens" | "chatgptauthtokens" | "chatgpt_auth_tokens" => {
            "chatgpt_auth_tokens".to_string()
        }
        "" | "none" | "null" => "none".to_string(),
        _ => "unknown".to_string(),
    }
}

fn normalize_account_type(value: &str) -> String {
    normalize_auth_mode(value)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppListRequest {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub thread_id: Option<String>,
    #[serde(default)]
    pub force_refetch: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub logo_url: Option<String>,
    pub logo_url_dark: Option<String>,
    pub distribution_channel: Option<String>,
    pub install_url: Option<String>,
    pub is_accessible: bool,
    pub is_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppListResponse {
    pub data: Vec<AppRecord>,
    pub next_cursor: Option<String>,
    pub total: usize,
    pub elapsed_ms: u64,
}

fn parse_optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
        .map(str::to_string)
}

fn parse_app_record(value: &Value) -> Option<AppRecord> {
    let entry = value.as_object()?;
    let id = parse_optional_string(entry.get("id"))?;
    let name = parse_optional_string(entry.get("name"))?;

    let description = parse_optional_string(entry.get("description"));
    let logo_url = parse_optional_string(entry.get("logoUrl").or_else(|| entry.get("logo_url")));
    let logo_url_dark = parse_optional_string(
        entry
            .get("logoUrlDark")
            .or_else(|| entry.get("logo_url_dark")),
    );
    let distribution_channel = parse_optional_string(
        entry
            .get("distributionChannel")
            .or_else(|| entry.get("distribution_channel")),
    );
    let install_url =
        parse_optional_string(entry.get("installUrl").or_else(|| entry.get("install_url")));
    let is_accessible = entry
        .get("isAccessible")
        .or_else(|| entry.get("is_accessible"))
        .and_then(parse_bool)
        .unwrap_or(false);
    let is_enabled = entry
        .get("isEnabled")
        .or_else(|| entry.get("is_enabled"))
        .and_then(parse_bool)
        .unwrap_or(false);

    Some(AppRecord {
        id,
        name,
        description,
        logo_url,
        logo_url_dark,
        distribution_channel,
        install_url,
        is_accessible,
        is_enabled,
    })
}

pub fn parse_app_list_bridge_result(result: &Value, fallback_elapsed_ms: u64) -> AppListResponse {
    let mut data = result
        .get("data")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(parse_app_record)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    data.sort_by(|left, right| left.name.cmp(&right.name));

    let next_cursor =
        parse_optional_string(result.get("nextCursor").or_else(|| result.get("next_cursor")));
    let total = result
        .get("total")
        .and_then(parse_u64)
        .and_then(|count| usize::try_from(count).ok())
        .unwrap_or(data.len());
    let elapsed_ms = result
        .get("elapsedMs")
        .or_else(|| result.get("elapsed_ms"))
        .and_then(parse_u64)
        .unwrap_or(fallback_elapsed_ms);

    AppListResponse {
        data,
        next_cursor,
        total,
        elapsed_ms,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRecord {
    pub account_type: String,
    pub email: Option<String>,
    pub plan_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountReadRequest {
    #[serde(default)]
    pub refresh_token: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountReadResponse {
    pub account: Option<AccountRecord>,
    pub requires_openai_auth: bool,
    pub auth_mode: String,
    pub elapsed_ms: u64,
}

fn parse_account_record(value: &Value) -> Option<AccountRecord> {
    let entry = value.as_object()?;
    let account_type = parse_optional_string(entry.get("type"))
        .map(|raw| normalize_account_type(&raw))
        .unwrap_or_else(|| "unknown".to_string());
    let email = parse_optional_string(entry.get("email"));
    let plan_type =
        parse_optional_string(entry.get("planType").or_else(|| entry.get("plan_type")));

    Some(AccountRecord {
        account_type,
        email,
        plan_type,
    })
}

pub fn parse_account_read_bridge_result(
    result: &Value,
    fallback_elapsed_ms: u64,
) -> AccountReadResponse {
    let account = result.get("account").and_then(parse_account_record);
    let requires_openai_auth = result
        .get("requiresOpenaiAuth")
        .or_else(|| result.get("requires_openai_auth"))
        .and_then(parse_bool)
        .unwrap_or(false);
    let auth_mode = account
        .as_ref()
        .map(|entry| entry.account_type.clone())
        .unwrap_or_else(|| "none".to_string());
    let elapsed_ms = result
        .get("elapsedMs")
        .or_else(|| result.get("elapsed_ms"))
        .and_then(parse_u64)
        .unwrap_or(fallback_elapsed_ms);

    AccountReadResponse {
        account,
        requires_openai_auth,
        auth_mode,
        elapsed_ms,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountLoginStartRequest {
    #[serde(rename = "type")]
    pub login_type: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountLoginStartResponse {
    pub login_type: String,
    pub login_id: Option<String>,
    pub auth_url: Option<String>,
    pub started: bool,
    pub elapsed_ms: u64,
}

pub fn parse_account_login_start_bridge_result(
    result: &Value,
    fallback_elapsed_ms: u64,
) -> AccountLoginStartResponse {
    let login_type = result
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .map(normalize_account_type)
        .unwrap_or_else(|| "unknown".to_string());
    let login_id =
        parse_optional_string(result.get("loginId").or_else(|| result.get("login_id")));
    let auth_url = parse_optional_string(result.get("authUrl").or_else(|| result.get("auth_url")));
    let started = result.get("started").and_then(parse_bool).unwrap_or(true);
    let elapsed_ms = result
        .get("elapsedMs")
        .or_else(|| result.get("elapsed_ms"))
        .and_then(parse_u64)
        .unwrap_or(fallback_elapsed_ms);

    AccountLoginStartResponse {
        login_type,
        login_id,
        auth_url,
        started,
        elapsed_ms,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountLogoutResponse {
    pub logged_out: bool,
    pub elapsed_ms: u64,
}

pub fn parse_account_logout_bridge_result(
    result: &Value,
    fallback_elapsed_ms: u64,
) -> AccountLogoutResponse {
    let logged_out = result
        .get("loggedOut")
        .or_else(|| result.get("logged_out"))
        .and_then(parse_bool)
        .unwrap_or(true);
    let elapsed_ms = result
        .get("elapsedMs")
        .or_else(|| result.get("elapsed_ms"))
        .and_then(parse_u64)
        .unwrap_or(fallback_elapsed_ms);

    AccountLogoutResponse {
        logged_out,
        elapsed_ms,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRateLimitWindowRecord {
    pub used_percent: f64,
    pub window_duration_mins: Option<i64>,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountCreditsSnapshot {
    pub has_credits: bool,
    pub unlimited: bool,
    pub balance: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRateLimitSnapshotRecord {
    pub limit_id: Option<String>,
    pub limit_name: Option<String>,
    pub primary: Option<AccountRateLimitWindowRecord>,
    pub secondary: Option<AccountRateLimitWindowRecord>,
    pub credits: Option<AccountCreditsSnapshot>,
    pub plan_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRateLimitsReadResponse {
    pub rate_limits: Option<AccountRateLimitSnapshotRecord>,
    pub rate_limits_by_limit_id: Option<HashMap<String, AccountRateLimitSnapshotRecord>>,
    pub elapsed_ms: u64,
}

fn parse_rate_limit_window(value: &Value) -> Option<AccountRateLimitWindowRecord> {
    let entry = value.as_object()?;
    let used_percent = entry
        .get("usedPercent")
        .or_else(|| entry.get("used_percent"))
        .and_then(parse_f64)?;
    let window_duration_mins = entry
        .get("windowDurationMins")
        .or_else(|| entry.get("window_duration_mins"))
        .and_then(parse_i64);
    let resets_at = entry
        .get("resetsAt")
        .or_else(|| entry.get("resets_at"))
        .and_then(parse_i64);

    Some(AccountRateLimitWindowRecord {
        used_percent,
        window_duration_mins,
        resets_at,
    })
}

fn parse_credits_snapshot(value: &Value) -> Option<AccountCreditsSnapshot> {
    let entry = value.as_object()?;
    let has_credits = entry
        .get("hasCredits")
        .or_else(|| entry.get("has_credits"))
        .and_then(parse_bool)
        .unwrap_or(false);
    let unlimited = entry
        .get("unlimited")
        .and_then(parse_bool)
        .unwrap_or(false);
    let balance = parse_optional_string(entry.get("balance"));

    Some(AccountCreditsSnapshot {
        has_credits,
        unlimited,
        balance,
    })
}

fn parse_rate_limit_snapshot(value: &Value) -> Option<AccountRateLimitSnapshotRecord> {
    let entry = value.as_object()?;
    let limit_id = parse_optional_string(entry.get("limitId").or_else(|| entry.get("limit_id")));
    let limit_name =
        parse_optional_string(entry.get("limitName").or_else(|| entry.get("limit_name")));
    let primary = entry.get("primary").and_then(parse_rate_limit_window);
    let secondary = entry.get("secondary").and_then(parse_rate_limit_window);
    let credits = entry.get("credits").and_then(parse_credits_snapshot);
    let plan_type =
        parse_optional_string(entry.get("planType").or_else(|| entry.get("plan_type")));

    Some(AccountRateLimitSnapshotRecord {
        limit_id,
        limit_name,
        primary,
        secondary,
        credits,
        plan_type,
    })
}

pub fn parse_account_rate_limits_bridge_result(
    result: &Value,
    fallback_elapsed_ms: u64,
) -> AccountRateLimitsReadResponse {
    let rate_limits = result
        .get("rateLimits")
        .or_else(|| result.get("rate_limits"))
        .and_then(parse_rate_limit_snapshot);

    let rate_limits_by_limit_id = result
        .get("rateLimitsByLimitId")
        .or_else(|| result.get("rate_limits_by_limit_id"))
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(limit_id, snapshot)| {
                    let mut parsed = parse_rate_limit_snapshot(snapshot)?;
                    if parsed.limit_id.is_none() {
                        parsed.limit_id = Some(limit_id.clone());
                    }
                    Some((limit_id.clone(), parsed))
                })
                .collect::<HashMap<_, _>>()
        })
        .filter(|entries| !entries.is_empty());

    let elapsed_ms = result
        .get("elapsedMs")
        .or_else(|| result.get("elapsed_ms"))
        .and_then(parse_u64)
        .unwrap_or(fallback_elapsed_ms);

    AccountRateLimitsReadResponse {
        rate_limits,
        rate_limits_by_limit_id,
        elapsed_ms,
    }
}
