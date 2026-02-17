use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use anyhow::Error as AnyhowError;
use codex_utils_pty::ProcessHandle;
use codex_utils_pty::SpawnedProcess;
use codex_utils_pty::conpty_supported;
use codex_utils_pty::spawn_pipe_process;
use codex_utils_pty::spawn_pty_process;
use thiserror::Error;
use tokio::sync::Mutex;
use tokio::sync::broadcast;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

use crate::ActionKind;
use crate::ApprovalDecision;
use crate::AuditRecord;
use crate::PermissionProfile;
use crate::PolicyDecision;
use crate::ResultStatus;
use crate::ipc::CommandFinished;
use crate::ipc::CommandOutputChunk;
use crate::ipc::CommandOutputStream;
use crate::ipc::CommandStarted;
use crate::ipc::IpcEvent;
use crate::ipc::IpcMessage;

const SESSION_EVENTS_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionMode {
    Auto,
    Pty,
    Pipe,
}

#[derive(Debug, Clone)]
pub struct SessionStartRequest {
    pub session_id: String,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: HashMap<String, String>,
    pub arg0: Option<String>,
    pub mode: SessionMode,
    pub audit_context: SessionAuditContext,
}

impl SessionStartRequest {
    pub fn new(
        session_id: impl Into<String>,
        program: impl Into<String>,
        args: Vec<String>,
        cwd: PathBuf,
        env: HashMap<String, String>,
    ) -> Self {
        let program = program.into();
        Self {
            session_id: session_id.into(),
            program,
            args,
            cwd,
            env,
            arg0: None,
            mode: SessionMode::Auto,
            audit_context: SessionAuditContext::for_execute_command(String::new()),
        }
    }

    pub fn with_mode(mut self, mode: SessionMode) -> Self {
        self.mode = mode;
        self
    }

    pub fn with_arg0(mut self, arg0: impl Into<String>) -> Self {
        self.arg0 = Some(arg0.into());
        self
    }

    pub fn with_audit_context(mut self, audit_context: SessionAuditContext) -> Self {
        self.audit_context = audit_context;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionAuditContext {
    pub action_kind: ActionKind,
    pub target: String,
    pub profile: PermissionProfile,
    pub policy_decision: PolicyDecision,
    pub approval_decision: ApprovalDecision,
}

impl SessionAuditContext {
    pub fn for_execute_command(target: impl Into<String>) -> Self {
        Self {
            action_kind: ActionKind::ExecuteCommand,
            target: target.into(),
            profile: PermissionProfile::FullAccess,
            policy_decision: PolicyDecision::Allow,
            approval_decision: ApprovalDecision::NotRequired,
        }
    }
}

pub struct ReattachedSession {
    pub writer_tx: mpsc::Sender<Vec<u8>>,
    pub output_rx: broadcast::Receiver<Vec<u8>>,
    pub has_exited: bool,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Error)]
pub enum SessionManagerError {
    #[error("session `{0}` already exists")]
    SessionAlreadyExists(String),
    #[error("session `{0}` not found")]
    SessionNotFound(String),
    #[error("pty is not supported in this environment")]
    PtyUnavailable,
    #[error("failed to spawn session `{session_id}`: {source}")]
    SpawnFailed {
        session_id: String,
        #[source]
        source: AnyhowError,
    },
}

#[derive(Debug, Clone)]
struct SessionRecord {
    handle: Arc<ProcessHandle>,
    audit_context: SessionAuditContext,
    cancellation_requested: bool,
}

#[derive(Debug, Clone)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionRecord>>>,
    events_tx: broadcast::Sender<IpcMessage>,
    audit_logger: Option<crate::AuditLogger>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    pub fn new() -> Self {
        let (events_tx, _) = broadcast::channel(SESSION_EVENTS_CAPACITY);
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            events_tx,
            audit_logger: None,
        }
    }

    pub fn with_audit_logger(audit_logger: crate::AuditLogger) -> Self {
        let mut manager = Self::new();
        manager.audit_logger = Some(audit_logger);
        manager
    }

    pub fn event_receiver(&self) -> broadcast::Receiver<IpcMessage> {
        self.events_tx.subscribe()
    }

    pub async fn start(&self, request: SessionStartRequest) -> Result<(), SessionManagerError> {
        if request.program.is_empty() {
            return Err(SessionManagerError::SpawnFailed {
                session_id: request.session_id,
                source: AnyhowError::msg("missing program for session start"),
            });
        }

        {
            let sessions = self.sessions.lock().await;
            if sessions.contains_key(&request.session_id) {
                return Err(SessionManagerError::SessionAlreadyExists(
                    request.session_id.clone(),
                ));
            }
        }

        let started_at = Instant::now();
        let SpawnedProcess {
            session,
            output_rx,
            exit_rx,
        } = self.spawn_process(&request).await?;
        let command = build_command(&request.program, &request.args);
        let command_text = command.join(" ");
        let handle = Arc::new(session);
        let mut audit_context = request.audit_context.clone();
        if audit_context.target.is_empty() {
            audit_context.target = command_text;
        }

        {
            let mut sessions = self.sessions.lock().await;
            if sessions.contains_key(&request.session_id) {
                handle.terminate();
                return Err(SessionManagerError::SessionAlreadyExists(
                    request.session_id.clone(),
                ));
            }
            sessions.insert(
                request.session_id.clone(),
                SessionRecord {
                    handle: Arc::clone(&handle),
                    audit_context,
                    cancellation_requested: false,
                },
            );
        }

        self.spawn_output_forwarder(request.session_id.clone(), output_rx);
        self.spawn_exit_watcher(
            request.session_id.clone(),
            exit_rx,
            started_at,
            self.audit_logger.clone(),
        );

        let _ = self
            .events_tx
            .send(IpcMessage::new(IpcEvent::CommandStarted(CommandStarted {
                command_id: request.session_id,
                command,
                cwd: request.cwd.to_string_lossy().to_string(),
            })));

        Ok(())
    }

    pub async fn stop(&self, session_id: &str) -> Result<(), SessionManagerError> {
        let handle = {
            let mut sessions = self.sessions.lock().await;
            let Some(record) = sessions.get_mut(session_id) else {
                return Err(SessionManagerError::SessionNotFound(session_id.to_string()));
            };
            record.cancellation_requested = true;
            Arc::clone(&record.handle)
        };

        if handle.has_exited() {
            return Ok(());
        }

        handle.terminate();
        Ok(())
    }

    pub async fn cancel(&self, session_id: &str) -> Result<(), SessionManagerError> {
        self.stop(session_id).await
    }

    pub async fn is_cancellation_requested(
        &self,
        session_id: &str,
    ) -> Result<bool, SessionManagerError> {
        let sessions = self.sessions.lock().await;
        let Some(record) = sessions.get(session_id) else {
            return Err(SessionManagerError::SessionNotFound(session_id.to_string()));
        };
        Ok(record.cancellation_requested)
    }

    pub async fn reattach(
        &self,
        session_id: &str,
    ) -> Result<ReattachedSession, SessionManagerError> {
        let record = {
            let sessions = self.sessions.lock().await;
            sessions.get(session_id).cloned()
        };

        let Some(record) = record else {
            return Err(SessionManagerError::SessionNotFound(session_id.to_string()));
        };

        Ok(ReattachedSession {
            writer_tx: record.handle.writer_sender(),
            output_rx: record.handle.output_receiver(),
            has_exited: record.handle.has_exited(),
            exit_code: record.handle.exit_code(),
        })
    }

    pub async fn is_active(&self, session_id: &str) -> bool {
        let sessions = self.sessions.lock().await;
        sessions.contains_key(session_id)
    }

    async fn spawn_process(
        &self,
        request: &SessionStartRequest,
    ) -> Result<SpawnedProcess, SessionManagerError> {
        let spawned = match request.mode {
            SessionMode::Auto => {
                if conpty_supported() {
                    spawn_pty_process(
                        &request.program,
                        &request.args,
                        &request.cwd,
                        &request.env,
                        &request.arg0,
                    )
                    .await
                } else {
                    spawn_pipe_process(
                        &request.program,
                        &request.args,
                        &request.cwd,
                        &request.env,
                        &request.arg0,
                    )
                    .await
                }
            }
            SessionMode::Pty => {
                if !conpty_supported() {
                    return Err(SessionManagerError::PtyUnavailable);
                }
                spawn_pty_process(
                    &request.program,
                    &request.args,
                    &request.cwd,
                    &request.env,
                    &request.arg0,
                )
                .await
            }
            SessionMode::Pipe => {
                spawn_pipe_process(
                    &request.program,
                    &request.args,
                    &request.cwd,
                    &request.env,
                    &request.arg0,
                )
                .await
            }
        };

        spawned.map_err(|source| SessionManagerError::SpawnFailed {
            session_id: request.session_id.clone(),
            source,
        })
    }

    fn spawn_output_forwarder(
        &self,
        session_id: String,
        mut output_rx: broadcast::Receiver<Vec<u8>>,
    ) {
        let events_tx = self.events_tx.clone();
        tokio::spawn(async move {
            loop {
                match output_rx.recv().await {
                    Ok(bytes) => {
                        let chunk = String::from_utf8_lossy(&bytes).to_string();
                        if chunk.is_empty() {
                            continue;
                        }
                        let _ = events_tx.send(IpcMessage::new(IpcEvent::CommandOutputChunk(
                            CommandOutputChunk {
                                command_id: session_id.clone(),
                                // PTY and pipe outputs are multiplexed by codex-utils-pty.
                                stream: CommandOutputStream::Stdout,
                                chunk,
                            },
                        )));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    fn spawn_exit_watcher(
        &self,
        session_id: String,
        exit_rx: oneshot::Receiver<i32>,
        started_at: Instant,
        audit_logger: Option<crate::AuditLogger>,
    ) {
        let sessions = Arc::clone(&self.sessions);
        let events_tx = self.events_tx.clone();
        tokio::spawn(async move {
            let exit_code = exit_rx.await.unwrap_or(-1);
            let duration_ms: u64 = started_at
                .elapsed()
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX);
            let _ = events_tx.send(IpcMessage::new(IpcEvent::CommandFinished(
                CommandFinished {
                    command_id: session_id.clone(),
                    exit_code,
                    duration_ms,
                },
            )));
            let removed_session = {
                let mut lock = sessions.lock().await;
                lock.remove(&session_id)
            };
            if let Some(audit_logger) = audit_logger
                && let Some(removed_session) = removed_session
            {
                let result_status = if exit_code == 0 && !removed_session.cancellation_requested {
                    ResultStatus::Succeeded
                } else {
                    ResultStatus::Failed
                };
                let audit_record = AuditRecord::new(
                    session_id,
                    removed_session.audit_context.action_kind,
                    removed_session.audit_context.target,
                    removed_session.audit_context.profile,
                    removed_session.audit_context.policy_decision,
                    removed_session.audit_context.approval_decision,
                    result_status,
                    duration_ms,
                );
                let _ = audit_logger.append(&audit_record).await;
            }
        });
    }
}

fn build_command(program: &str, args: &[String]) -> Vec<String> {
    let mut command = Vec::with_capacity(args.len() + 1);
    command.push(program.to_string());
    command.extend(args.iter().cloned());
    command
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::Duration;

    use anyhow::Result;
    use pretty_assertions::assert_eq;
    use serde_json::Value;
    use tempfile::TempDir;

    use super::SessionAuditContext;
    use super::SessionManager;
    use super::SessionManagerError;
    use super::SessionMode;
    use super::SessionStartRequest;
    use crate::ActionKind;
    use crate::ApprovalDecision;
    use crate::AuditLogger;
    use crate::IpcEvent;
    use crate::IpcMessage;
    use crate::PermissionProfile;
    use crate::PolicyDecision;

    fn shell_command(script: &str) -> (String, Vec<String>) {
        if cfg!(windows) {
            let cmd = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
            (cmd, vec!["/C".to_string(), script.to_string()])
        } else {
            (
                "/bin/sh".to_string(),
                vec!["-c".to_string(), script.to_string()],
            )
        }
    }

    fn delayed_echo_script(marker: &str) -> String {
        if cfg!(windows) {
            format!("ping -n 2 127.0.0.1 > NUL & echo {marker}")
        } else {
            format!("sleep 0.2; echo {marker}")
        }
    }

    fn long_running_script() -> String {
        if cfg!(windows) {
            "ping -n 20 127.0.0.1 > NUL".to_string()
        } else {
            "sleep 20".to_string()
        }
    }

    fn env_map() -> std::collections::HashMap<String, String> {
        std::env::vars().collect()
    }

    fn long_running_script_with_marker_start(marker: &str) -> String {
        if cfg!(windows) {
            format!("echo {marker} & ping -n 20 127.0.0.1 > NUL")
        } else {
            format!("echo {marker}; sleep 20")
        }
    }

    fn command_id_for_event(event: &IpcEvent) -> Option<&str> {
        match event {
            IpcEvent::CommandStarted(evt) => Some(evt.command_id.as_str()),
            IpcEvent::CommandOutputChunk(evt) => Some(evt.command_id.as_str()),
            IpcEvent::CommandFinished(evt) => Some(evt.command_id.as_str()),
            _ => None,
        }
    }

    async fn recv_events_until_finished(
        events_rx: &mut tokio::sync::broadcast::Receiver<IpcMessage>,
        session_id: &str,
        timeout_ms: u64,
    ) -> Vec<IpcMessage> {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
        let mut events = Vec::new();
        loop {
            let now = tokio::time::Instant::now();
            if now >= deadline {
                break;
            }
            let remaining = deadline.saturating_duration_since(now);
            match tokio::time::timeout(remaining, events_rx.recv()).await {
                Ok(Ok(message)) => {
                    if command_id_for_event(&message.event) != Some(session_id) {
                        continue;
                    }
                    let is_finished = matches!(message.event, IpcEvent::CommandFinished(_));
                    events.push(message);
                    if is_finished {
                        break;
                    }
                }
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                Err(_) => break,
            }
        }

        events
    }

    async fn wait_for_output_marker(
        output_rx: &mut tokio::sync::broadcast::Receiver<Vec<u8>>,
        marker: &str,
        timeout_ms: u64,
    ) -> bool {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            let now = tokio::time::Instant::now();
            if now >= deadline {
                return false;
            }
            let remaining = deadline.saturating_duration_since(now);
            match tokio::time::timeout(remaining, output_rx.recv()).await {
                Ok(Ok(chunk)) => {
                    if String::from_utf8_lossy(&chunk).contains(marker) {
                        return true;
                    }
                }
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => return false,
                Err(_) => return false,
            }
        }
    }

    async fn wait_for_session_inactive(
        manager: &SessionManager,
        session_id: &str,
        timeout_ms: u64,
    ) -> bool {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            if !manager.is_active(session_id).await {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_pipe_session_emits_started_output_and_finished_events() -> Result<()> {
        let manager = SessionManager::new();
        let mut events_rx = manager.event_receiver();
        let marker = "alicia_bridge_pipe_ok";
        let (program, args) = shell_command(&format!("echo {marker}"));
        let request =
            SessionStartRequest::new("sess-pipe", program, args, PathBuf::from("."), env_map())
                .with_mode(SessionMode::Pipe);

        manager.start(request).await?;

        let events = recv_events_until_finished(&mut events_rx, "sess-pipe", 10_000).await;
        assert!(
            events.iter().any(
                |message| matches!(&message.event, IpcEvent::CommandStarted(event) if event.command_id == "sess-pipe")
            ),
            "missing command started event"
        );
        assert!(
            events.iter().any(
                |message| matches!(&message.event, IpcEvent::CommandOutputChunk(event) if event.chunk.contains(marker))
            ),
            "missing command output event with marker"
        );
        assert!(
            events.iter().any(
                |message| matches!(&message.event, IpcEvent::CommandFinished(event) if event.exit_code == 0)
            ),
            "missing command finished event with exit code 0"
        );

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reattach_returns_live_receivers_for_running_session() -> Result<()> {
        let manager = SessionManager::new();
        let marker = "reattach_bridge_ok";
        let (program, args) = shell_command(&delayed_echo_script(marker));
        let request = SessionStartRequest::new(
            "sess-reattach",
            program,
            args,
            PathBuf::from("."),
            env_map(),
        )
        .with_mode(SessionMode::Pipe);
        manager.start(request).await?;

        assert!(manager.is_active("sess-reattach").await);

        let mut attached = manager.reattach("sess-reattach").await?;
        assert!(!attached.has_exited);
        assert!(attached.exit_code.is_none());

        let saw_marker = wait_for_output_marker(&mut attached.output_rx, marker, 10_000).await;
        assert!(
            saw_marker,
            "reattached output did not receive expected marker"
        );

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stop_terminates_and_removes_active_session() -> Result<()> {
        let manager = SessionManager::new();
        let mut events_rx = manager.event_receiver();
        let (program, args) = shell_command(&long_running_script());
        let request =
            SessionStartRequest::new("sess-stop", program, args, PathBuf::from("."), env_map())
                .with_mode(SessionMode::Pipe);

        manager.start(request).await?;
        assert!(manager.is_active("sess-stop").await);

        manager.stop("sess-stop").await?;
        let finished_events = recv_events_until_finished(&mut events_rx, "sess-stop", 10_000).await;
        assert!(
            finished_events
                .iter()
                .any(|event| matches!(event.event, IpcEvent::CommandFinished(_))),
            "expected command finished after stop"
        );
        assert!(
            wait_for_session_inactive(&manager, "sess-stop", 5_000).await,
            "session should become inactive after stop"
        );

        let reattach_result = manager.reattach("sess-stop").await;
        assert!(matches!(
            reattach_result,
            Err(SessionManagerError::SessionNotFound(ref id)) if id == "sess-stop"
        ));

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn duplicate_session_ids_are_rejected() -> Result<()> {
        let manager = SessionManager::new();
        let mut events_rx = manager.event_receiver();
        let (program, args) = shell_command(&long_running_script());
        let request = SessionStartRequest::new(
            "sess-dup",
            program.clone(),
            args.clone(),
            PathBuf::from("."),
            env_map(),
        )
        .with_mode(SessionMode::Pipe);
        manager.start(request).await?;

        let duplicate =
            SessionStartRequest::new("sess-dup", program, args, PathBuf::from("."), env_map())
                .with_mode(SessionMode::Pipe);

        let duplicate_result = manager.start(duplicate).await;
        assert!(matches!(
            duplicate_result,
            Err(SessionManagerError::SessionAlreadyExists(ref id)) if id == "sess-dup"
        ));

        manager.stop("sess-dup").await?;
        let _ = recv_events_until_finished(&mut events_rx, "sess-dup", 10_000).await;
        assert!(wait_for_session_inactive(&manager, "sess-dup", 5_000).await);

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_does_not_corrupt_future_session_with_same_id() -> Result<()> {
        let manager = SessionManager::new();
        let mut events_rx = manager.event_receiver();
        let first_marker = "cancel_first_start";
        let (program, args) = shell_command(&long_running_script_with_marker_start(first_marker));
        manager
            .start(
                SessionStartRequest::new(
                    "sess-cancel-reuse",
                    program,
                    args,
                    PathBuf::from("."),
                    env_map(),
                )
                .with_mode(SessionMode::Pipe),
            )
            .await?;

        manager.cancel("sess-cancel-reuse").await?;
        let first_run_events =
            recv_events_until_finished(&mut events_rx, "sess-cancel-reuse", 10_000).await;
        assert!(
            first_run_events
                .iter()
                .any(|event| matches!(event.event, IpcEvent::CommandFinished(_))),
            "expected first cancelled run to emit command finished"
        );
        assert!(
            wait_for_session_inactive(&manager, "sess-cancel-reuse", 5_000).await,
            "expected first cancelled run to fully leave session map"
        );

        let second_marker = "cancel_reuse_second_ok";
        let (program, args) = shell_command(&format!("echo {second_marker}"));
        manager
            .start(
                SessionStartRequest::new(
                    "sess-cancel-reuse",
                    program,
                    args,
                    PathBuf::from("."),
                    env_map(),
                )
                .with_mode(SessionMode::Pipe),
            )
            .await?;

        let second_run_events =
            recv_events_until_finished(&mut events_rx, "sess-cancel-reuse", 10_000).await;
        assert!(
            second_run_events.iter().any(|message| {
                matches!(&message.event, IpcEvent::CommandOutputChunk(event) if event.chunk.contains(second_marker))
            }),
            "expected second run output marker for reused session id"
        );
        assert!(
            second_run_events.iter().any(|message| {
                matches!(
                    &message.event,
                    IpcEvent::CommandFinished(event) if event.exit_code == 0
                )
            }),
            "expected second run to finish successfully"
        );

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelled_session_appends_failed_audit_record() -> Result<()> {
        let temp = TempDir::new()?;
        let audit_path = temp.path().join("audit.jsonl");
        let audit_logger = AuditLogger::open(&audit_path).await?;
        let manager = SessionManager::with_audit_logger(audit_logger);
        let mut events_rx = manager.event_receiver();

        let context = SessionAuditContext {
            action_kind: ActionKind::ExecuteCommand,
            target: "long_running_task".to_string(),
            profile: PermissionProfile::ReadWriteWithApproval,
            policy_decision: PolicyDecision::RequireApproval,
            approval_decision: ApprovalDecision::Approved,
        };

        let (program, args) = shell_command(&long_running_script());
        manager
            .start(
                SessionStartRequest::new(
                    "sess-audit-cancel",
                    program,
                    args,
                    PathBuf::from("."),
                    HashMap::new(),
                )
                .with_mode(SessionMode::Pipe)
                .with_audit_context(context),
            )
            .await?;

        manager.cancel("sess-audit-cancel").await?;
        let _ = recv_events_until_finished(&mut events_rx, "sess-audit-cancel", 10_000).await;
        assert!(wait_for_session_inactive(&manager, "sess-audit-cancel", 5_000).await);

        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        let mut parsed: Vec<Value> = Vec::new();
        while tokio::time::Instant::now() < deadline {
            let text = tokio::fs::read_to_string(&audit_path)
                .await
                .unwrap_or_default();
            parsed = text
                .lines()
                .map(serde_json::from_str::<Value>)
                .filter_map(Result::ok)
                .collect();
            if !parsed.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }

        assert!(!parsed.is_empty(), "expected at least one audit record");
        let entry = parsed
            .iter()
            .find(|item| {
                item.get("session_id").and_then(Value::as_str) == Some("sess-audit-cancel")
            })
            .expect("audit entry for cancelled session should exist");
        assert_eq!(
            entry.get("result_status").and_then(Value::as_str),
            Some("failed")
        );
        assert_eq!(
            entry.get("approval_decision").and_then(Value::as_str),
            Some("approved")
        );

        Ok(())
    }

    #[test]
    fn command_builder_keeps_program_as_first_token() {
        let command = super::build_command(
            "cargo",
            &[
                "test".to_string(),
                "-p".to_string(),
                "codex-core".to_string(),
            ],
        );
        assert_eq!(
            command,
            vec![
                "cargo".to_string(),
                "test".to_string(),
                "-p".to_string(),
                "codex-core".to_string()
            ]
        );
    }
}
