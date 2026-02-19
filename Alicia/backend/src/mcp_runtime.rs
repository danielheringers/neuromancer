use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStartupWarmupResponse {
    pub ready_servers: Vec<String>,
    pub total_ready: usize,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerListEntry {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub status: String,
    pub tools: Vec<String>,
    pub url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerListResponse {
    pub data: Vec<McpServerListEntry>,
    pub total: usize,
    pub elapsed_ms: u64,
}

pub fn parse_mcp_startup_warmup_bridge_result(
    result: &Value,
    fallback_elapsed_ms: u64,
) -> McpStartupWarmupResponse {
    let mut ready_servers = result
        .get("readyServers")
        .or_else(|| result.get("ready_servers"))
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    ready_servers.sort();
    ready_servers.dedup();

    let total_ready = result
        .get("totalReady")
        .or_else(|| result.get("total_ready"))
        .and_then(|value| {
            value
                .as_u64()
                .and_then(|count| usize::try_from(count).ok())
                .or_else(|| value.as_i64().and_then(|count| usize::try_from(count).ok()))
                .or_else(|| value.as_str().and_then(|raw| raw.trim().parse::<usize>().ok()))
        })
        .unwrap_or(ready_servers.len());

    let elapsed_ms = result
        .get("elapsedMs")
        .or_else(|| result.get("elapsed_ms"))
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().and_then(|millis| u64::try_from(millis).ok()))
                .or_else(|| value.as_str().and_then(|raw| raw.trim().parse::<u64>().ok()))
        })
        .unwrap_or(fallback_elapsed_ms);

    McpStartupWarmupResponse {
        ready_servers,
        total_ready,
        elapsed_ms,
    }
}

fn normalize_mcp_server_id_base(name: &str) -> String {
    let mut normalized = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            normalized.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' {
            normalized.push(ch);
        } else {
            normalized.push('-');
        }
    }

    let mut compact = String::with_capacity(normalized.len());
    let mut previous_dash = false;
    for ch in normalized.chars() {
        if ch == '-' {
            if !previous_dash {
                compact.push(ch);
                previous_dash = true;
            }
        } else {
            compact.push(ch);
            previous_dash = false;
        }
    }

    let compact = compact.trim_matches('-');
    if compact.is_empty() {
        "server".to_string()
    } else {
        compact.to_string()
    }
}

fn make_unique_mcp_server_id(base_id: &str, seen_ids: &mut HashMap<String, usize>) -> String {
    let count = seen_ids.get(base_id).copied().unwrap_or(0);
    seen_ids.insert(base_id.to_string(), count + 1);
    if count == 0 {
        base_id.to_string()
    } else {
        format!("{base_id}-{}", count + 1)
    }
}

pub fn parse_mcp_server_list_bridge_result(
    result: &Value,
    fallback_elapsed_ms: u64,
) -> McpServerListResponse {
    let mut seen_ids = HashMap::<String, usize>::new();
    let mut data = result
        .get("data")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(Value::as_object)
                .filter_map(|entry| {
                    let name = entry
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .map(str::to_string)?;

                    let base_id = entry
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|id| !id.is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| normalize_mcp_server_id_base(&name));
                    let id = make_unique_mcp_server_id(&base_id, &mut seen_ids);

                    let transport = entry
                        .get("transport")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(|value| match value {
                            "stdio" | "sse" | "streamable-http" => value.to_string(),
                            _ => "stdio".to_string(),
                        })
                        .unwrap_or_else(|| "stdio".to_string());

                    let status = entry
                        .get("status")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(|value| match value {
                            "connected" | "disconnected" | "error" | "connecting" => {
                                value.to_string()
                            }
                            _ => "connected".to_string(),
                        })
                        .unwrap_or_else(|| "connected".to_string());

                    let mut tools = entry
                        .get("tools")
                        .and_then(Value::as_array)
                        .map(|tools| {
                            tools
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::trim)
                                .filter(|tool| !tool.is_empty())
                                .map(str::to_string)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    tools.sort();
                    tools.dedup();

                    let url = entry
                        .get("url")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string);

                    Some(McpServerListEntry {
                        id,
                        name,
                        transport,
                        status,
                        tools,
                        url,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    data.sort_by(|a, b| a.name.cmp(&b.name));

    let total = result
        .get("total")
        .and_then(|value| {
            value
                .as_u64()
                .and_then(|count| usize::try_from(count).ok())
                .or_else(|| value.as_i64().and_then(|count| usize::try_from(count).ok()))
                .or_else(|| value.as_str().and_then(|raw| raw.trim().parse::<usize>().ok()))
        })
        .unwrap_or(data.len());

    let elapsed_ms = result
        .get("elapsedMs")
        .or_else(|| result.get("elapsed_ms"))
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().and_then(|millis| u64::try_from(millis).ok()))
                .or_else(|| value.as_str().and_then(|raw| raw.trim().parse::<u64>().ok()))
        })
        .unwrap_or(fallback_elapsed_ms);

    McpServerListResponse {
        data,
        total,
        elapsed_ms,
    }
}

pub fn mcp_servers_from_names(names: Vec<String>, elapsed_ms: u64) -> McpServerListResponse {
    let mut seen_ids = HashMap::<String, usize>::new();
    let mut data = names
        .into_iter()
        .map(|name| {
            let base_id = normalize_mcp_server_id_base(&name);
            let id = make_unique_mcp_server_id(&base_id, &mut seen_ids);
            McpServerListEntry {
                id,
                name,
                transport: "stdio".to_string(),
                status: "connected".to_string(),
                tools: Vec::new(),
                url: None,
            }
        })
        .collect::<Vec<_>>();
    data.sort_by(|a, b| a.name.cmp(&b.name));

    McpServerListResponse {
        total: data.len(),
        data,
        elapsed_ms,
    }
}
