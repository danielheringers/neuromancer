use serde_json::Value;

#[derive(Debug, Clone)]
pub(crate) struct StatusRateLimitWindow {
    pub(crate) used_percent: f64,
    pub(crate) window_minutes: Option<i64>,
    pub(crate) resets_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub(crate) struct StatusRateLimitSnapshot {
    pub(crate) limit_id: Option<String>,
    pub(crate) limit_name: Option<String>,
    pub(crate) primary: Option<StatusRateLimitWindow>,
    pub(crate) secondary: Option<StatusRateLimitWindow>,
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

pub(crate) fn extract_rate_limits_from_app_server_message(
    message: &Value,
) -> Option<StatusRateLimitSnapshot> {
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
