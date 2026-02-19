use serde::Deserialize;
use serde::Serialize;

use crate::policy::ActionKind;

pub const IPC_PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcMessage {
    pub protocol_version: u16,
    #[serde(flatten)]
    pub event: IpcEvent,
}

impl IpcMessage {
    pub fn new(event: IpcEvent) -> Self {
        Self {
            protocol_version: IPC_PROTOCOL_VERSION,
            event,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IpcEvent {
    ActionProposed(ActionProposed),
    ApprovalRequested(ApprovalRequested),
    ApprovalResolved(ApprovalResolved),
    CommandStarted(CommandStarted),
    CommandOutputChunk(CommandOutputChunk),
    CommandFinished(CommandFinished),
    PatchPreviewReady(PatchPreviewReady),
    PatchApplied(PatchApplied),
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionProposed {
    pub action_id: String,
    pub action_kind: ActionKind,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequested {
    pub action_id: String,
    pub summary: String,
    pub expires_at_unix_s: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalResolved {
    pub action_id: String,
    pub resolution: ApprovalResolution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalResolution {
    Approved,
    Denied,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandStarted {
    pub command_id: String,
    pub command: Vec<String>,
    pub cwd: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutputChunk {
    pub command_id: String,
    pub stream: CommandOutputStream,
    pub chunk: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandOutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandFinished {
    pub command_id: String,
    pub exit_code: i32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchPreviewReady {
    pub action_id: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchApplied {
    pub action_id: String,
    pub files: Vec<String>,
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::ActionProposed;
    use super::ApprovalRequested;
    use super::CommandOutputChunk;
    use super::CommandOutputStream;
    use super::IpcEvent;
    use super::IpcMessage;
    use crate::policy::ActionKind;

    #[test]
    fn serializes_command_output_chunk_message() {
        let message = IpcMessage::new(IpcEvent::CommandOutputChunk(CommandOutputChunk {
            command_id: "cmd-1".to_string(),
            stream: CommandOutputStream::Stdout,
            chunk: "hello".to_string(),
        }));

        let serialized = serde_json::to_value(message);
        let Ok(serialized) = serialized else {
            panic!("failed to serialize command output chunk message");
        };

        let expected = json!({
            "protocolVersion": 1,
            "type": "command_output_chunk",
            "commandId": "cmd-1",
            "stream": "stdout",
            "chunk": "hello"
        });
        assert_eq!(serialized, expected);
    }

    #[test]
    fn deserializes_action_proposed_message() {
        let raw = json!({
            "protocolVersion": 1,
            "type": "action_proposed",
            "actionId": "act-1",
            "actionKind": "write_file",
            "target": "src/main.rs"
        });

        let parsed: Result<IpcMessage, serde_json::Error> = serde_json::from_value(raw);
        let Ok(parsed) = parsed else {
            panic!("failed to deserialize action proposed message");
        };

        let expected = IpcMessage::new(IpcEvent::ActionProposed(ActionProposed {
            action_id: "act-1".to_string(),
            action_kind: ActionKind::WriteFile,
            target: "src/main.rs".to_string(),
        }));

        assert_eq!(parsed, expected);
    }

    #[test]
    fn rejects_invalid_payloads() {
        let missing_required_field = json!({
            "protocolVersion": 1,
            "type": "approval_requested",
            "actionId": "act-2",
            "summary": "needs user confirmation"
        });

        let parsed: Result<IpcMessage, serde_json::Error> =
            serde_json::from_value(missing_required_field);
        assert!(parsed.is_err());

        let unknown_event_type = json!({
            "protocolVersion": 1,
            "type": "non_existing_event"
        });

        let parsed: Result<IpcMessage, serde_json::Error> =
            serde_json::from_value(unknown_event_type);
        assert!(parsed.is_err());
    }

    #[test]
    fn deserializes_approval_requested_message() {
        let raw = json!({
            "protocolVersion": 1,
            "type": "approval_requested",
            "actionId": "act-2",
            "summary": "needs user confirmation",
            "expiresAtUnixS": 1735689600
        });

        let parsed: Result<IpcMessage, serde_json::Error> = serde_json::from_value(raw);
        let Ok(parsed) = parsed else {
            panic!("failed to deserialize approval requested message");
        };

        let expected = IpcMessage::new(IpcEvent::ApprovalRequested(ApprovalRequested {
            action_id: "act-2".to_string(),
            summary: "needs user confirmation".to_string(),
            expires_at_unix_s: 1_735_689_600,
        }));
        assert_eq!(parsed, expected);
    }
}
