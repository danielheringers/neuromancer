use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use codex_alicia_core::ActionKind;
use codex_alicia_core::ApprovalDecision;
use codex_alicia_core::ApprovalResolution;
use codex_alicia_core::AuditLogger;
use codex_alicia_core::AuditRecord;
use codex_alicia_core::IpcEvent;
use codex_alicia_core::IpcMessage;
use codex_alicia_core::PermissionProfile;
use codex_alicia_core::PolicyDecision;
use codex_alicia_core::ResultStatus;
use codex_alicia_core::SessionManager;
use codex_alicia_core::SessionMode;
use codex_alicia_core::SessionStartRequest;
use codex_alicia_core::ipc::ActionProposed;
use codex_alicia_core::ipc::ApprovalRequested;
use codex_alicia_ui::AliciaUiRuntime;
use pretty_assertions::assert_eq;
use serde_json::Value;
use tempfile::TempDir;

fn inherited_env() -> HashMap<String, String> {
    std::env::vars().collect()
}

fn shell_echo_command(marker: &str) -> (String, Vec<String>) {
    if cfg!(windows) {
        let cmd = std::env::var("COMSPEC").unwrap_or_else(|_| String::from("cmd.exe"));
        let script = format!("echo {marker}");
        (cmd, vec![String::from("/C"), script])
    } else {
        (
            String::from("/bin/sh"),
            vec![String::from("-c"), format!("echo {marker}")],
        )
    }
}

fn shell_long_running_command_with_start_marker(marker: &str) -> (String, Vec<String>) {
    if cfg!(windows) {
        let cmd = std::env::var("COMSPEC").unwrap_or_else(|_| String::from("cmd.exe"));
        let script = format!("echo {marker} & ping -n 20 127.0.0.1 > NUL");
        (cmd, vec![String::from("/C"), script])
    } else {
        (
            String::from("/bin/sh"),
            vec![String::from("-c"), format!("echo {marker}; sleep 20")],
        )
    }
}

fn parse_jsonl_lines(text: &str) -> Vec<Value> {
    text.lines()
        .map(serde_json::from_str::<Value>)
        .filter_map(Result::ok)
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn e2e_happy_path_approval_execution_and_audit() -> Result<(), Box<dyn std::error::Error>> {
    let session_manager = SessionManager::new();
    let mut runtime = AliciaUiRuntime::new(session_manager, 512);
    runtime
        .store_mut()
        .set_permission_profile(PermissionProfile::ReadWriteWithApproval);

    assert_eq!(
        runtime
            .store()
            .permission_profile()
            .decision_for(ActionKind::WriteFile),
        PolicyDecision::RequireApproval
    );

    runtime
        .store_mut()
        .push(IpcMessage::new(IpcEvent::ActionProposed(ActionProposed {
            action_id: String::from("act-e2e-happy"),
            action_kind: ActionKind::WriteFile,
            target: String::from("src/main.rs"),
        })));
    runtime.store_mut().attach_approval_command(
        String::from("act-e2e-happy"),
        vec![
            String::from("cargo"),
            String::from("test"),
            String::from("-p"),
            String::from("codex-alicia-ui"),
        ],
    );
    runtime
        .store_mut()
        .push(IpcMessage::new(IpcEvent::ApprovalRequested(
            ApprovalRequested {
                action_id: String::from("act-e2e-happy"),
                summary: String::from("Atualizar UI com aprovação"),
                expires_at_unix_s: 4_102_444_800, // 2100-01-01
            },
        )));

    let approved = runtime.store_mut().approve("act-e2e-happy")?;
    assert!(matches!(
        approved.event,
        IpcEvent::ApprovalResolved(ref event)
            if event.action_id == "act-e2e-happy"
                && event.resolution == ApprovalResolution::Approved
    ));
    assert_eq!(runtime.store().pending_approval_count(), 0);

    let marker = "alicia_e2e_happy_ok";
    let (program, args) = shell_echo_command(marker);
    runtime
        .start_session(
            SessionStartRequest::new(
                "sess-e2e-happy",
                program,
                args,
                PathBuf::from("."),
                inherited_env(),
            )
            .with_mode(SessionMode::Pipe),
        )
        .await?;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let mut saw_output = false;
    let mut finished_success = false;

    while tokio::time::Instant::now() < deadline {
        runtime.pump_events();

        if let Some(text) = runtime.store().active_terminal_text()
            && text.contains(marker)
        {
            saw_output = true;
        }

        if let Some(session) = runtime.store().terminal_session("sess-e2e-happy")
            && matches!(
                session.lifecycle,
                codex_alicia_ui::CommandLifecycle::Finished {
                    exit_code: 0,
                    duration_ms: _
                }
            )
        {
            finished_success = true;
        }

        if saw_output && finished_success {
            break;
        }

        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    assert!(saw_output, "expected command output marker");
    assert!(finished_success, "expected successful command lifecycle");

    let record = AuditRecord::new(
        "sess-e2e-happy",
        ActionKind::WriteFile,
        "src/main.rs",
        PermissionProfile::ReadWriteWithApproval,
        PolicyDecision::RequireApproval,
        ApprovalDecision::Approved,
        ResultStatus::Succeeded,
        42,
    );
    runtime.store_mut().add_audit_record(record.clone());

    let temp = TempDir::new()?;
    let path = temp.path().join("audit.jsonl");
    let logger = AuditLogger::open(&path).await?;
    logger.append(&record).await?;

    let text = tokio::fs::read_to_string(&path).await?;
    let entries = parse_jsonl_lines(&text);
    assert_eq!(entries.len(), 1);

    let entry = &entries[0];
    assert_eq!(
        entry.get("policy_decision").and_then(Value::as_str),
        Some("require_approval")
    );
    assert_eq!(
        entry.get("approval_decision").and_then(Value::as_str),
        Some("approved")
    );
    assert_eq!(
        entry.get("result_status").and_then(Value::as_str),
        Some("succeeded")
    );
    assert_eq!(
        entry.get("session_id").and_then(Value::as_str),
        Some("sess-e2e-happy")
    );

    assert!(
        runtime
            .store()
            .timeline()
            .iter()
            .any(|entry| entry.summary.contains("audit session=sess-e2e-happy")),
        "expected timeline to contain audit summary entry"
    );

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn e2e_denied_and_expired_blocked_audit() -> Result<(), Box<dyn std::error::Error>> {
    let session_manager = SessionManager::new();
    let mut runtime = AliciaUiRuntime::new(session_manager, 256);
    runtime
        .store_mut()
        .set_permission_profile(PermissionProfile::ReadWriteWithApproval);

    runtime
        .store_mut()
        .push(IpcMessage::new(IpcEvent::ActionProposed(ActionProposed {
            action_id: String::from("act-denied"),
            action_kind: ActionKind::ExecuteCommand,
            target: String::from("cargo test"),
        })));
    runtime
        .store_mut()
        .push(IpcMessage::new(IpcEvent::ApprovalRequested(
            ApprovalRequested {
                action_id: String::from("act-denied"),
                summary: String::from("Executar comando sensível"),
                expires_at_unix_s: 4_102_444_800, // 2100-01-01
            },
        )));
    let denied = runtime.store_mut().deny("act-denied")?;
    assert!(matches!(
        denied.event,
        IpcEvent::ApprovalResolved(ref event)
            if event.action_id == "act-denied"
                && event.resolution == ApprovalResolution::Denied
    ));

    runtime
        .store_mut()
        .push(IpcMessage::new(IpcEvent::ActionProposed(ActionProposed {
            action_id: String::from("act-expired"),
            action_kind: ActionKind::ApplyPatch,
            target: String::from("src/lib.rs"),
        })));
    runtime
        .store_mut()
        .push(IpcMessage::new(IpcEvent::ApprovalRequested(
            ApprovalRequested {
                action_id: String::from("act-expired"),
                summary: String::from("Aplicar patch"),
                expires_at_unix_s: 100,
            },
        )));

    let expired = runtime.store_mut().expire_pending_approvals(101);
    assert_eq!(expired.len(), 1);
    assert!(matches!(
        expired.first().map(|message| &message.event),
        Some(IpcEvent::ApprovalResolved(event))
            if event.action_id == "act-expired"
                && event.resolution == ApprovalResolution::Expired
    ));

    assert_eq!(runtime.store().pending_approval_count(), 0);
    assert_eq!(
        runtime
            .store()
            .approval("act-denied")
            .map(|approval| approval.status),
        Some(codex_alicia_ui::ApprovalStatus::Denied)
    );
    assert_eq!(
        runtime
            .store()
            .approval("act-expired")
            .map(|approval| approval.status),
        Some(codex_alicia_ui::ApprovalStatus::Expired)
    );

    assert!(
        !runtime
            .store()
            .events()
            .iter()
            .any(|message| matches!(message.event, IpcEvent::CommandStarted(_))),
        "execution should not start when approval was denied or expired"
    );

    let denied_record = AuditRecord::new(
        "sess-denied",
        ActionKind::ExecuteCommand,
        "cargo test",
        PermissionProfile::ReadWriteWithApproval,
        PolicyDecision::RequireApproval,
        ApprovalDecision::Denied,
        ResultStatus::Blocked,
        7,
    );
    let expired_record = AuditRecord::new(
        "sess-expired",
        ActionKind::ApplyPatch,
        "src/lib.rs",
        PermissionProfile::ReadWriteWithApproval,
        PolicyDecision::RequireApproval,
        ApprovalDecision::Expired,
        ResultStatus::Blocked,
        9,
    );

    let temp = TempDir::new()?;
    let path = temp.path().join("audit.jsonl");
    let logger = AuditLogger::open(&path).await?;
    logger.append(&denied_record).await?;
    logger.append(&expired_record).await?;

    let text = tokio::fs::read_to_string(&path).await?;
    let entries = parse_jsonl_lines(&text);
    assert_eq!(entries.len(), 2);

    let denied_entry = &entries[0];
    assert_eq!(
        denied_entry
            .get("approval_decision")
            .and_then(Value::as_str),
        Some("denied")
    );
    assert_eq!(
        denied_entry.get("result_status").and_then(Value::as_str),
        Some("blocked")
    );

    let expired_entry = &entries[1];
    assert_eq!(
        expired_entry
            .get("approval_decision")
            .and_then(Value::as_str),
        Some("expired")
    );
    assert_eq!(
        expired_entry.get("result_status").and_then(Value::as_str),
        Some("blocked")
    );

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn e2e_safe_cancel_persists_final_audit_state() -> Result<(), Box<dyn std::error::Error>> {
    let temp = TempDir::new()?;
    let path = temp.path().join("audit.jsonl");
    let audit_logger = AuditLogger::open(&path).await?;

    let session_manager = SessionManager::new();
    let mut runtime = AliciaUiRuntime::new(session_manager, 256).with_audit_logger(audit_logger);
    runtime
        .store_mut()
        .set_permission_profile(PermissionProfile::ReadWriteWithApproval);

    let marker = "alicia_cancel_start";
    let (program, args) = shell_long_running_command_with_start_marker(marker);
    runtime
        .start_session(
            SessionStartRequest::new(
                "sess-e2e-cancel",
                program,
                args,
                PathBuf::from("."),
                inherited_env(),
            )
            .with_mode(SessionMode::Pipe),
        )
        .await?;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let mut started = false;
    while tokio::time::Instant::now() < deadline {
        runtime.pump_events();
        if let Some(text) = runtime.store().active_terminal_text()
            && text.contains(marker)
        {
            started = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(started, "expected command to start before cancellation");

    runtime.stop_session("sess-e2e-cancel").await?;
    assert!(!runtime.session_manager().is_active("sess-e2e-cancel").await);

    let record = runtime
        .store()
        .audit_records()
        .iter()
        .find(|record| record.session_id == "sess-e2e-cancel")
        .ok_or_else(|| std::io::Error::other("expected in-memory audit record"))?;
    assert_eq!(record.result_status, ResultStatus::Failed);

    let text = tokio::fs::read_to_string(&path).await?;
    let entries = parse_jsonl_lines(&text);
    let persisted = entries
        .iter()
        .find(|entry| entry.get("session_id").and_then(Value::as_str) == Some("sess-e2e-cancel"))
        .ok_or_else(|| std::io::Error::other("expected persisted cancel audit entry"))?;
    assert_eq!(
        persisted.get("result_status").and_then(Value::as_str),
        Some("failed")
    );

    Ok(())
}
