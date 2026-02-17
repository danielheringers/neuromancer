use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use codex_utils_sanitizer::redact_secrets;
use serde::Deserialize;
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::ActionKind;
use crate::PermissionProfile;
use crate::PolicyDecision;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    NotRequired,
    Approved,
    Denied,
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultStatus {
    Succeeded,
    Failed,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AuditRecord {
    pub timestamp: i64,
    pub session_id: String,
    pub action_kind: ActionKind,
    pub target: String,
    pub profile: PermissionProfile,
    pub policy_decision: PolicyDecision,
    pub approval_decision: ApprovalDecision,
    pub result_status: ResultStatus,
    pub duration_ms: u64,
}

impl AuditRecord {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        session_id: impl Into<String>,
        action_kind: ActionKind,
        target: impl Into<String>,
        profile: PermissionProfile,
        policy_decision: PolicyDecision,
        approval_decision: ApprovalDecision,
        result_status: ResultStatus,
        duration_ms: u64,
    ) -> Self {
        Self {
            timestamp: unix_timestamp_now(),
            session_id: session_id.into(),
            action_kind,
            target: target.into(),
            profile,
            policy_decision,
            approval_decision,
            result_status,
            duration_ms,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AuditLogger {
    path: PathBuf,
    writer: Arc<Mutex<tokio::fs::File>>,
}

impl AuditLogger {
    pub async fn open(path: impl Into<PathBuf>) -> std::io::Result<Self> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let file = tokio::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&path)
            .await?;

        Ok(Self {
            path,
            writer: Arc::new(Mutex::new(file)),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub async fn append(&self, record: &AuditRecord) -> std::io::Result<()> {
        let mut serialized = serde_json::to_string(record).map_err(|err| {
            std::io::Error::other(format!("failed to serialize audit record: {err}"))
        })?;
        serialized = redact_secrets(serialized);
        serialized.push('\n');

        let mut writer = self.writer.lock().await;
        writer.write_all(serialized.as_bytes()).await?;
        writer.flush().await
    }
}

fn unix_timestamp_now() -> i64 {
    let now = SystemTime::now();
    let Ok(duration_since_epoch) = now.duration_since(UNIX_EPOCH) else {
        return 0;
    };
    let secs = duration_since_epoch.as_secs();
    i64::try_from(secs).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::Value;
    use tempfile::TempDir;

    use super::ApprovalDecision;
    use super::AuditLogger;
    use super::AuditRecord;
    use super::ResultStatus;
    use crate::ActionKind;
    use crate::PermissionProfile;
    use crate::PolicyDecision;

    fn build_record(target: &str) -> AuditRecord {
        AuditRecord::new(
            "sess-1",
            ActionKind::WriteFile,
            target,
            PermissionProfile::ReadWriteWithApproval,
            PolicyDecision::RequireApproval,
            ApprovalDecision::Approved,
            ResultStatus::Succeeded,
            42,
        )
    }

    #[tokio::test]
    async fn append_writes_jsonl_lines() -> anyhow::Result<()> {
        let temp = TempDir::new()?;
        let log_path = temp.path().join("audit.jsonl");
        let logger = AuditLogger::open(&log_path).await?;

        logger.append(&build_record("src/main.rs")).await?;
        logger.append(&build_record("src/lib.rs")).await?;

        let text = tokio::fs::read_to_string(&log_path).await?;
        assert_eq!(text.lines().count(), 2);
        Ok(())
    }

    #[tokio::test]
    async fn append_preserves_existing_content_append_only() -> anyhow::Result<()> {
        let temp = TempDir::new()?;
        let log_path = temp.path().join("audit.jsonl");

        let logger = AuditLogger::open(&log_path).await?;
        logger.append(&build_record("first.txt")).await?;
        drop(logger);

        let logger = AuditLogger::open(&log_path).await?;
        logger.append(&build_record("second.txt")).await?;

        let text = tokio::fs::read_to_string(&log_path).await?;
        assert!(text.contains("first.txt"));
        assert!(text.contains("second.txt"));
        assert_eq!(text.lines().count(), 2);
        Ok(())
    }

    #[tokio::test]
    async fn append_writes_required_schema_fields() -> anyhow::Result<()> {
        let temp = TempDir::new()?;
        let log_path = temp.path().join("audit.jsonl");
        let logger = AuditLogger::open(&log_path).await?;

        logger.append(&build_record("src/main.rs")).await?;

        let text = tokio::fs::read_to_string(&log_path).await?;
        let first_line = text
            .lines()
            .next()
            .ok_or_else(|| std::io::Error::other("expected at least one JSONL line"))?;
        let value: Value = serde_json::from_str(first_line)?;

        for key in [
            "timestamp",
            "session_id",
            "action_kind",
            "target",
            "profile",
            "policy_decision",
            "approval_decision",
            "result_status",
            "duration_ms",
        ] {
            assert!(value.get(key).is_some(), "missing required field: {key}");
        }
        Ok(())
    }

    #[tokio::test]
    async fn append_redacts_secret_patterns_before_persisting() -> anyhow::Result<()> {
        let temp = TempDir::new()?;
        let log_path = temp.path().join("audit.jsonl");
        let logger = AuditLogger::open(&log_path).await?;

        let raw_secret = "sk-abcdefghijklmnopqrstuvwxyz1234567890";
        logger.append(&build_record(raw_secret)).await?;

        let text = tokio::fs::read_to_string(&log_path).await?;
        assert!(!text.contains(raw_secret));
        assert!(text.contains("[REDACTED_SECRET]"));
        Ok(())
    }
}
