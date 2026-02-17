use std::collections::HashMap;
use std::collections::VecDeque;
use std::time::Duration;

use codex_alicia_core::ActionKind;
use codex_alicia_core::ApprovalDecision;
use codex_alicia_core::ApprovalResolution;
use codex_alicia_core::AuditRecord;
use codex_alicia_core::CommandOutputStream;
use codex_alicia_core::IpcEvent;
use codex_alicia_core::IpcMessage;
use codex_alicia_core::PermissionProfile;
use codex_alicia_core::PolicyDecision;
use codex_alicia_core::ResultStatus;
use codex_alicia_core::SessionManager;
use codex_alicia_core::SessionManagerError;
use codex_alicia_core::SessionStartRequest;
use codex_alicia_core::ipc::ActionProposed;
use codex_alicia_core::ipc::ApprovalRequested;
use codex_alicia_core::ipc::ApprovalResolved;
use codex_alicia_core::ipc::CommandFinished;
use codex_alicia_core::ipc::CommandOutputChunk;
use codex_alicia_core::ipc::CommandStarted;
use codex_alicia_core::ipc::PatchApplied;
use codex_alicia_core::ipc::PatchPreviewReady;
use thiserror::Error;
use tokio::sync::mpsc;

const DEFAULT_SCROLLBACK_LINES: usize = 2_000;
const OUTPUT_PREVIEW_MAX_CHARS: usize = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandLifecycle {
    Running,
    Finished { exit_code: i32, duration_ms: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalSessionState {
    pub session_id: String,
    pub command: Vec<String>,
    pub cwd: String,
    pub lifecycle: CommandLifecycle,
    lines: VecDeque<String>,
    partial_line: String,
}

impl TerminalSessionState {
    fn from_started(event: &CommandStarted) -> Self {
        Self {
            session_id: event.command_id.clone(),
            command: event.command.clone(),
            cwd: event.cwd.clone(),
            lifecycle: CommandLifecycle::Running,
            lines: VecDeque::new(),
            partial_line: String::new(),
        }
    }

    fn pending_session(session_id: String) -> Self {
        Self {
            session_id,
            command: Vec::new(),
            cwd: String::new(),
            lifecycle: CommandLifecycle::Running,
            lines: VecDeque::new(),
            partial_line: String::new(),
        }
    }

    fn reset_for_started(&mut self, event: &CommandStarted) {
        self.command = event.command.clone();
        self.cwd = event.cwd.clone();
        self.lifecycle = CommandLifecycle::Running;
        self.lines.clear();
        self.partial_line.clear();
    }

    fn append_output_chunk(&mut self, chunk: &str, max_scrollback_lines: usize) {
        for ch in chunk.chars() {
            if ch == '\n' {
                if self.partial_line.ends_with('\r') {
                    self.partial_line.pop();
                }
                self.lines.push_back(std::mem::take(&mut self.partial_line));
                while self.lines.len() > max_scrollback_lines {
                    self.lines.pop_front();
                }
                continue;
            }

            self.partial_line.push(ch);
        }
    }

    pub fn visible_lines(&self) -> Vec<String> {
        let mut lines: Vec<String> = self.lines.iter().cloned().collect();
        if !self.partial_line.is_empty() {
            lines.push(self.partial_line.clone());
        }
        lines
    }

    pub fn visible_text(&self) -> String {
        self.visible_lines().join("\n")
    }

    fn trim_scrollback_to(&mut self, max_scrollback_lines: usize) {
        while self.lines.len() > max_scrollback_lines {
            self.lines.pop_front();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Denied,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalItem {
    pub action_id: String,
    pub summary: String,
    pub expires_at_unix_s: i64,
    pub status: ApprovalStatus,
    pub action_kind: Option<ActionKind>,
    pub target: Option<String>,
    pub command: Option<Vec<String>>,
    pub impact_files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalPrompt {
    pub action_id: String,
    pub status: ApprovalStatus,
    pub what: String,
    pub where_target: Option<String>,
    pub action_kind: Option<ActionKind>,
    pub command: Option<String>,
    pub impact: Option<String>,
    pub expires_at_unix_s: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchPreviewState {
    pub action_id: String,
    pub files: Vec<String>,
    pub applied: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimelineEntry {
    pub sequence: u64,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum UiEventStoreError {
    #[error("session `{0}` not found")]
    SessionNotFound(String),
    #[error("session `{0}` is not bound for input")]
    SessionInputNotBound(String),
    #[error("failed to send input to session `{session_id}`: {reason}")]
    SessionInputSendFailed { session_id: String, reason: String },
    #[error("approval `{0}` is not pending")]
    ApprovalNotPending(String),
}

#[derive(Debug, Error)]
pub enum AliciaUiRuntimeError {
    #[error("{0}")]
    SessionManager(#[from] SessionManagerError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActionContext {
    action_kind: ActionKind,
    target: String,
}

#[derive(Debug)]
pub struct UiEventStore {
    events: Vec<IpcMessage>,
    timeline: Vec<TimelineEntry>,
    next_sequence: u64,
    permission_profile: PermissionProfile,
    sessions: HashMap<String, TerminalSessionState>,
    session_order: Vec<String>,
    active_session_id: Option<String>,
    session_input_writers: HashMap<String, mpsc::Sender<Vec<u8>>>,
    approvals: HashMap<String, ApprovalItem>,
    pending_approval_ids: VecDeque<String>,
    action_contexts: HashMap<String, ActionContext>,
    approval_commands: HashMap<String, Vec<String>>,
    patch_previews: HashMap<String, PatchPreviewState>,
    audit_records: Vec<AuditRecord>,
    max_scrollback_lines: usize,
}

impl Default for UiEventStore {
    fn default() -> Self {
        Self::new(DEFAULT_SCROLLBACK_LINES)
    }
}

impl UiEventStore {
    pub fn new(max_scrollback_lines: usize) -> Self {
        Self {
            events: Vec::new(),
            timeline: Vec::new(),
            next_sequence: 0,
            permission_profile: PermissionProfile::ReadWriteWithApproval,
            sessions: HashMap::new(),
            session_order: Vec::new(),
            active_session_id: None,
            session_input_writers: HashMap::new(),
            approvals: HashMap::new(),
            pending_approval_ids: VecDeque::new(),
            action_contexts: HashMap::new(),
            approval_commands: HashMap::new(),
            patch_previews: HashMap::new(),
            audit_records: Vec::new(),
            max_scrollback_lines: max_scrollback_lines.max(1),
        }
    }

    pub fn push(&mut self, message: IpcMessage) {
        let summary = match &message.event {
            IpcEvent::ActionProposed(event) => {
                format!(
                    "action_proposed {} {} {}",
                    event.action_id,
                    action_kind_name(event.action_kind),
                    event.target
                )
            }
            IpcEvent::ApprovalRequested(event) => {
                format!("approval_requested {} {}", event.action_id, event.summary)
            }
            IpcEvent::ApprovalResolved(event) => {
                format!(
                    "approval_resolved {} {}",
                    event.action_id,
                    approval_resolution_name(event.resolution)
                )
            }
            IpcEvent::CommandStarted(event) => {
                let command = if event.command.is_empty() {
                    String::from("<empty>")
                } else {
                    event.command.join(" ")
                };
                format!("command_started {} {}", event.command_id, command)
            }
            IpcEvent::CommandOutputChunk(event) => {
                let mut preview: String =
                    event.chunk.chars().take(OUTPUT_PREVIEW_MAX_CHARS).collect();
                if event.chunk.chars().count() > OUTPUT_PREVIEW_MAX_CHARS {
                    preview.push_str("...");
                }
                format!(
                    "command_output_chunk {} {} {}",
                    event.command_id,
                    command_output_stream_name(event.stream),
                    preview.replace('\n', "\\n")
                )
            }
            IpcEvent::CommandFinished(event) => {
                format!(
                    "command_finished {} exit={} duration={}ms",
                    event.command_id, event.exit_code, event.duration_ms
                )
            }
            IpcEvent::PatchPreviewReady(event) => {
                format!(
                    "patch_preview_ready {} files={}",
                    event.action_id,
                    event.files.len()
                )
            }
            IpcEvent::PatchApplied(event) => {
                format!(
                    "patch_applied {} files={}",
                    event.action_id,
                    event.files.len()
                )
            }
        };

        self.timeline.push(TimelineEntry {
            sequence: self.next_sequence,
            summary,
        });
        self.next_sequence = self.next_sequence.saturating_add(1);

        self.apply_event(&message.event);
        self.events.push(message);
    }

    fn apply_event(&mut self, event: &IpcEvent) {
        match event {
            IpcEvent::ActionProposed(event) => self.apply_action_proposed(event),
            IpcEvent::ApprovalRequested(event) => self.apply_approval_requested(event),
            IpcEvent::ApprovalResolved(event) => self.apply_approval_resolved(event),
            IpcEvent::CommandStarted(event) => self.apply_command_started(event),
            IpcEvent::CommandOutputChunk(event) => self.apply_command_output_chunk(event),
            IpcEvent::CommandFinished(event) => self.apply_command_finished(event),
            IpcEvent::PatchPreviewReady(event) => self.apply_patch_preview_ready(event),
            IpcEvent::PatchApplied(event) => self.apply_patch_applied(event),
        }
    }

    fn apply_action_proposed(&mut self, event: &ActionProposed) {
        self.action_contexts.insert(
            event.action_id.clone(),
            ActionContext {
                action_kind: event.action_kind,
                target: event.target.clone(),
            },
        );

        if let Some(approval) = self.approvals.get_mut(&event.action_id) {
            approval.action_kind = Some(event.action_kind);
            approval.target = Some(event.target.clone());
        }
    }

    fn apply_approval_requested(&mut self, event: &ApprovalRequested) {
        let action_context = self.action_contexts.get(&event.action_id).cloned();
        let approval_command = self.approval_commands.get(&event.action_id).cloned();
        let impact_files = self
            .patch_previews
            .get(&event.action_id)
            .map_or_else(Vec::new, |preview| preview.files.clone());

        let entry = self
            .approvals
            .entry(event.action_id.clone())
            .or_insert_with(|| ApprovalItem {
                action_id: event.action_id.clone(),
                summary: event.summary.clone(),
                expires_at_unix_s: event.expires_at_unix_s,
                status: ApprovalStatus::Pending,
                action_kind: action_context.as_ref().map(|ctx| ctx.action_kind),
                target: action_context.as_ref().map(|ctx| ctx.target.clone()),
                command: approval_command.clone(),
                impact_files: impact_files.clone(),
            });

        entry.summary = event.summary.clone();
        entry.expires_at_unix_s = event.expires_at_unix_s;
        entry.status = ApprovalStatus::Pending;

        if let Some(action_context) = action_context {
            entry.action_kind = Some(action_context.action_kind);
            entry.target = Some(action_context.target);
        }

        if let Some(approval_command) = approval_command {
            entry.command = Some(approval_command);
        }

        if !impact_files.is_empty() {
            entry.impact_files = impact_files;
        }

        if !self
            .pending_approval_ids
            .iter()
            .any(|id| id == &event.action_id)
        {
            self.pending_approval_ids.push_back(event.action_id.clone());
        }
    }

    fn apply_approval_resolved(&mut self, event: &ApprovalResolved) {
        if let Some(approval) = self.approvals.get_mut(&event.action_id) {
            approval.status = match event.resolution {
                ApprovalResolution::Approved => ApprovalStatus::Approved,
                ApprovalResolution::Denied => ApprovalStatus::Denied,
                ApprovalResolution::Expired => ApprovalStatus::Expired,
            };
        }

        self.remove_pending_approval(&event.action_id);
    }

    fn apply_command_started(&mut self, event: &CommandStarted) {
        if let Some(session) = self.sessions.get_mut(&event.command_id) {
            session.reset_for_started(event);
        } else {
            self.sessions.insert(
                event.command_id.clone(),
                TerminalSessionState::from_started(event),
            );
        }

        if !self.session_order.iter().any(|id| id == &event.command_id) {
            self.session_order.push(event.command_id.clone());
        }

        if self.active_session_id.is_none() {
            self.active_session_id = Some(event.command_id.clone());
        }
    }

    fn apply_command_output_chunk(&mut self, event: &CommandOutputChunk) {
        if !self.sessions.contains_key(&event.command_id) {
            self.sessions.insert(
                event.command_id.clone(),
                TerminalSessionState::pending_session(event.command_id.clone()),
            );
            self.session_order.push(event.command_id.clone());
            if self.active_session_id.is_none() {
                self.active_session_id = Some(event.command_id.clone());
            }
        }

        if let Some(session) = self.sessions.get_mut(&event.command_id) {
            session.append_output_chunk(&event.chunk, self.max_scrollback_lines);
        }
    }

    fn apply_command_finished(&mut self, event: &CommandFinished) {
        if !self.sessions.contains_key(&event.command_id) {
            self.sessions.insert(
                event.command_id.clone(),
                TerminalSessionState::pending_session(event.command_id.clone()),
            );
            self.session_order.push(event.command_id.clone());
        }

        if let Some(session) = self.sessions.get_mut(&event.command_id) {
            session.lifecycle = CommandLifecycle::Finished {
                exit_code: event.exit_code,
                duration_ms: event.duration_ms,
            };
        }
    }

    fn apply_patch_preview_ready(&mut self, event: &PatchPreviewReady) {
        self.patch_previews.insert(
            event.action_id.clone(),
            PatchPreviewState {
                action_id: event.action_id.clone(),
                files: event.files.clone(),
                applied: false,
            },
        );

        if let Some(approval) = self.approvals.get_mut(&event.action_id) {
            approval.impact_files = event.files.clone();
        }
    }

    fn apply_patch_applied(&mut self, event: &PatchApplied) {
        if let Some(preview) = self.patch_previews.get_mut(&event.action_id) {
            preview.applied = true;
            if preview.files.is_empty() {
                preview.files = event.files.clone();
            }
        } else {
            self.patch_previews.insert(
                event.action_id.clone(),
                PatchPreviewState {
                    action_id: event.action_id.clone(),
                    files: event.files.clone(),
                    applied: true,
                },
            );
        }

        if let Some(approval) = self.approvals.get_mut(&event.action_id)
            && approval.impact_files.is_empty()
        {
            approval.impact_files = event.files.clone();
        }
    }

    fn remove_pending_approval(&mut self, action_id: &str) {
        self.pending_approval_ids
            .retain(|pending_id| pending_id != action_id);
    }

    pub fn events(&self) -> &[IpcMessage] {
        &self.events
    }

    pub fn timeline(&self) -> &[TimelineEntry] {
        &self.timeline
    }

    pub fn has_running_sessions(&self) -> bool {
        self.sessions
            .values()
            .any(|session| matches!(session.lifecycle, CommandLifecycle::Running))
    }

    pub fn pending_approval_count(&self) -> usize {
        self.pending_approval_ids.len()
    }

    pub fn pending_approvals(&self) -> Vec<&ApprovalItem> {
        self.pending_approval_ids
            .iter()
            .filter_map(|action_id| self.approvals.get(action_id))
            .collect()
    }

    pub fn approval(&self, action_id: &str) -> Option<&ApprovalItem> {
        self.approvals.get(action_id)
    }

    pub fn approval_prompt(&self, action_id: &str) -> Option<ApprovalPrompt> {
        let approval = self.approvals.get(action_id)?;
        let command = approval.command.as_ref().map(|command| command.join(" "));
        let impact = if approval.impact_files.is_empty() {
            None
        } else {
            Some(format!(
                "{} arquivo(s): {}",
                approval.impact_files.len(),
                approval.impact_files.join(", ")
            ))
        };

        Some(ApprovalPrompt {
            action_id: approval.action_id.clone(),
            status: approval.status,
            what: approval.summary.clone(),
            where_target: approval.target.clone(),
            action_kind: approval.action_kind,
            command,
            impact,
            expires_at_unix_s: approval.expires_at_unix_s,
        })
    }

    pub fn attach_approval_command(&mut self, action_id: impl Into<String>, command: Vec<String>) {
        let action_id = action_id.into();
        self.approval_commands
            .insert(action_id.clone(), command.clone());

        if let Some(approval) = self.approvals.get_mut(&action_id) {
            approval.command = Some(command);
        }
    }

    pub fn resolve_pending_approval(
        &mut self,
        action_id: &str,
        resolution: ApprovalResolution,
    ) -> Result<IpcMessage, UiEventStoreError> {
        let Some(approval) = self.approvals.get(action_id) else {
            return Err(UiEventStoreError::ApprovalNotPending(action_id.to_string()));
        };

        if approval.status != ApprovalStatus::Pending {
            return Err(UiEventStoreError::ApprovalNotPending(action_id.to_string()));
        }

        let message = IpcMessage::new(IpcEvent::ApprovalResolved(ApprovalResolved {
            action_id: action_id.to_string(),
            resolution,
        }));
        self.push(message.clone());
        Ok(message)
    }

    pub fn approve(&mut self, action_id: &str) -> Result<IpcMessage, UiEventStoreError> {
        self.resolve_pending_approval(action_id, ApprovalResolution::Approved)
    }

    pub fn deny(&mut self, action_id: &str) -> Result<IpcMessage, UiEventStoreError> {
        self.resolve_pending_approval(action_id, ApprovalResolution::Denied)
    }

    pub fn expire_pending_approvals(&mut self, now_unix_s: i64) -> Vec<IpcMessage> {
        let to_expire: Vec<String> = self
            .pending_approval_ids
            .iter()
            .filter_map(|action_id| {
                let approval = self.approvals.get(action_id)?;
                if approval.expires_at_unix_s < now_unix_s {
                    return Some(action_id.clone());
                }
                None
            })
            .collect();

        let mut messages = Vec::with_capacity(to_expire.len());
        for action_id in to_expire {
            if let Ok(message) =
                self.resolve_pending_approval(&action_id, ApprovalResolution::Expired)
            {
                messages.push(message);
            }
        }

        messages
    }

    pub fn add_audit_record(&mut self, record: AuditRecord) {
        let summary = format!(
            "audit session={} action={} target={} policy={} approval={} result={}",
            record.session_id,
            action_kind_name(record.action_kind),
            record.target,
            policy_decision_name(record.policy_decision),
            approval_decision_name(record.approval_decision),
            result_status_name(record.result_status)
        );

        self.timeline.push(TimelineEntry {
            sequence: self.next_sequence,
            summary,
        });
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.audit_records.push(record);
    }

    pub fn audit_records(&self) -> &[AuditRecord] {
        &self.audit_records
    }

    pub fn permission_profile(&self) -> PermissionProfile {
        self.permission_profile
    }

    pub fn set_permission_profile(&mut self, profile: PermissionProfile) {
        self.permission_profile = profile;
    }

    pub fn terminal_session_ids(&self) -> &[String] {
        &self.session_order
    }

    pub fn active_session_id(&self) -> Option<&str> {
        self.active_session_id.as_deref()
    }

    pub fn set_active_session(&mut self, session_id: &str) -> Result<(), UiEventStoreError> {
        if !self.sessions.contains_key(session_id) {
            return Err(UiEventStoreError::SessionNotFound(session_id.to_string()));
        }

        self.active_session_id = Some(session_id.to_string());
        Ok(())
    }

    pub fn terminal_session(&self, session_id: &str) -> Option<&TerminalSessionState> {
        self.sessions.get(session_id)
    }

    pub fn active_terminal_text(&self) -> Option<String> {
        let active_session_id = self.active_session_id.as_ref()?;
        let session = self.sessions.get(active_session_id)?;
        Some(session.visible_text())
    }

    pub fn max_scrollback_lines(&self) -> usize {
        self.max_scrollback_lines
    }

    pub fn set_max_scrollback_lines(&mut self, max_scrollback_lines: usize) {
        self.max_scrollback_lines = max_scrollback_lines.max(1);
        for session in self.sessions.values_mut() {
            session.trim_scrollback_to(self.max_scrollback_lines);
        }
    }

    pub fn bind_session_input(
        &mut self,
        session_id: impl Into<String>,
        writer: mpsc::Sender<Vec<u8>>,
    ) {
        self.session_input_writers.insert(session_id.into(), writer);
    }

    pub fn unbind_session_input(&mut self, session_id: &str) {
        self.session_input_writers.remove(session_id);
    }

    pub fn send_input_to_session(
        &self,
        session_id: &str,
        input: impl AsRef<[u8]>,
    ) -> Result<(), UiEventStoreError> {
        let Some(writer) = self.session_input_writers.get(session_id) else {
            return Err(UiEventStoreError::SessionInputNotBound(
                session_id.to_string(),
            ));
        };

        writer.try_send(input.as_ref().to_vec()).map_err(|error| {
            UiEventStoreError::SessionInputSendFailed {
                session_id: session_id.to_string(),
                reason: error.to_string(),
            }
        })
    }

    pub fn send_input_to_active_session(
        &self,
        input: impl AsRef<[u8]>,
    ) -> Result<(), UiEventStoreError> {
        let Some(active_session_id) = self.active_session_id.as_deref() else {
            return Err(UiEventStoreError::SessionNotFound(
                "<active_session>".to_string(),
            ));
        };

        self.send_input_to_session(active_session_id, input)
    }

    pub fn diff_preview(&self, action_id: &str) -> Option<&PatchPreviewState> {
        self.patch_previews.get(action_id)
    }

    pub fn unapplied_diff_previews(&self) -> Vec<&PatchPreviewState> {
        self.patch_previews
            .values()
            .filter(|preview| !preview.applied)
            .collect()
    }
}

#[derive(Debug)]
pub struct AliciaUiRuntime {
    session_manager: SessionManager,
    events_rx: tokio::sync::broadcast::Receiver<IpcMessage>,
    store: UiEventStore,
}

impl AliciaUiRuntime {
    pub fn new(session_manager: SessionManager, max_scrollback_lines: usize) -> Self {
        let events_rx = session_manager.event_receiver();
        Self {
            session_manager,
            events_rx,
            store: UiEventStore::new(max_scrollback_lines),
        }
    }

    pub fn store(&self) -> &UiEventStore {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut UiEventStore {
        &mut self.store
    }

    pub fn session_manager(&self) -> &SessionManager {
        &self.session_manager
    }

    pub async fn start_session(
        &mut self,
        request: SessionStartRequest,
    ) -> Result<(), AliciaUiRuntimeError> {
        let session_id = request.session_id.clone();
        self.session_manager.start(request).await?;
        self.bind_session_input(&session_id).await?;
        self.pump_events();
        Ok(())
    }

    pub async fn stop_session(&mut self, session_id: &str) -> Result<(), AliciaUiRuntimeError> {
        self.session_manager.stop(session_id).await?;
        self.store.unbind_session_input(session_id);
        self.pump_events();
        Ok(())
    }

    pub async fn bind_session_input(
        &mut self,
        session_id: &str,
    ) -> Result<(), AliciaUiRuntimeError> {
        let reattached = self.session_manager.reattach(session_id).await?;
        self.store
            .bind_session_input(session_id.to_string(), reattached.writer_tx);
        Ok(())
    }

    pub fn send_input_to_active_session(
        &self,
        input: impl AsRef<[u8]>,
    ) -> Result<(), UiEventStoreError> {
        self.store.send_input_to_active_session(input)
    }

    pub fn send_line_to_active_session(&self, line: &str) -> Result<(), UiEventStoreError> {
        let mut payload = line.as_bytes().to_vec();
        payload.push(b'\n');
        self.store.send_input_to_active_session(payload)
    }

    pub fn pump_events(&mut self) -> usize {
        let mut processed = 0;

        loop {
            match self.events_rx.try_recv() {
                Ok(message) => {
                    self.store.push(message);
                    processed += 1;
                }
                Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::TryRecvError::Empty) => break,
                Err(tokio::sync::broadcast::error::TryRecvError::Closed) => break,
            }
        }

        processed
    }
}

#[derive(Debug, Default)]
pub struct AliciaEguiView {
    terminal_input_buffer: String,
    status_message: Option<String>,
}

impl AliciaEguiView {
    pub fn render(&mut self, ctx: &egui::Context, store: &mut UiEventStore) -> Vec<IpcMessage> {
        let pending_approvals: Vec<ApprovalItem> =
            store.pending_approvals().into_iter().cloned().collect();
        let unapplied_previews: Vec<PatchPreviewState> = store
            .unapplied_diff_previews()
            .into_iter()
            .cloned()
            .collect();
        let timeline: Vec<TimelineEntry> = store.timeline().to_vec();
        let session_ids = store.terminal_session_ids().to_vec();
        let mut requested_resolutions: Vec<(String, ApprovalResolution)> = Vec::new();
        let mut emitted_messages = Vec::new();

        egui::TopBottomPanel::top("alicia_status_bar").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.label(format!(
                    "Perfil ativo: {}",
                    permission_profile_name(store.permission_profile())
                ));
                ui.separator();
                ui.label(format!(
                    "Aprovações pendentes: {}",
                    store.pending_approval_count()
                ));
                if let Some(status_message) = self.status_message.as_deref() {
                    ui.separator();
                    ui.label(status_message);
                }
            });
        });

        egui::SidePanel::right("alicia_approval_queue")
            .resizable(true)
            .default_width(340.0)
            .show(ctx, |ui| {
                ui.heading("Fila de Aprovações");
                ui.separator();

                if pending_approvals.is_empty() {
                    ui.label("Sem aprovações pendentes.");
                } else {
                    egui::ScrollArea::vertical().show(ui, |ui| {
                        for approval in &pending_approvals {
                            ui.group(|ui| {
                                ui.label(format!("Ação: {}", approval.action_id));
                                ui.label(format!("O que: {}", approval.summary));

                                if let Some(action_kind) = approval.action_kind {
                                    ui.label(format!("Tipo: {}", action_kind_name(action_kind)));
                                }

                                if let Some(target) = approval.target.as_deref() {
                                    ui.label(format!("Onde: {target}"));
                                }

                                if let Some(command) = approval.command.as_ref() {
                                    ui.label(format!("Comando: {}", command.join(" ")));
                                }

                                if approval.impact_files.is_empty() {
                                    ui.label("Impacto: sem diff informado");
                                } else {
                                    ui.label(format!(
                                        "Impacto: {} arquivo(s)",
                                        approval.impact_files.len()
                                    ));
                                    for file in &approval.impact_files {
                                        ui.label(format!("- {file}"));
                                    }
                                }

                                ui.label(format!(
                                    "Expira em unix={} (status: {})",
                                    approval.expires_at_unix_s,
                                    approval_status_name(approval.status)
                                ));

                                ui.horizontal(|ui| {
                                    if ui.button("Aprovar").clicked() {
                                        requested_resolutions.push((
                                            approval.action_id.clone(),
                                            ApprovalResolution::Approved,
                                        ));
                                    }
                                    if ui.button("Rejeitar").clicked() {
                                        requested_resolutions.push((
                                            approval.action_id.clone(),
                                            ApprovalResolution::Denied,
                                        ));
                                    }
                                });
                            });
                            ui.separator();
                        }
                    });
                }
                ui.heading("Diff Preview");
                ui.separator();
                if unapplied_previews.is_empty() {
                    ui.label("Nenhum diff pendente de aplicação.");
                } else {
                    egui::ScrollArea::vertical().show(ui, |ui| {
                        for preview in &unapplied_previews {
                            ui.group(|ui| {
                                ui.label(format!("Ação: {}", preview.action_id));
                                ui.label(format!("Arquivos: {}", preview.files.len()));
                                for file in &preview.files {
                                    ui.label(format!("- {file}"));
                                }
                            });
                            ui.separator();
                        }
                    });
                }
            });

        egui::TopBottomPanel::bottom("alicia_timeline")
            .resizable(true)
            .default_height(200.0)
            .show(ctx, |ui| {
                ui.heading("Timeline");
                ui.separator();
                egui::ScrollArea::vertical().show(ui, |ui| {
                    for entry in &timeline {
                        ui.label(format!("#{} {}", entry.sequence, entry.summary));
                    }
                });
            });

        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("Terminal");

            if session_ids.is_empty() {
                ui.label("Nenhuma sessão ativa.");
            } else {
                let previous_active = store.active_session_id().map(str::to_string);
                let mut selected_session = previous_active
                    .clone()
                    .or_else(|| session_ids.first().cloned())
                    .unwrap_or_default();

                egui::ComboBox::from_label("Sessão")
                    .selected_text(selected_session.clone())
                    .show_ui(ui, |ui| {
                        for session_id in &session_ids {
                            ui.selectable_value(
                                &mut selected_session,
                                session_id.clone(),
                                session_id.as_str(),
                            );
                        }
                    });

                if previous_active.as_deref() != Some(selected_session.as_str())
                    && let Err(error) = store.set_active_session(&selected_session)
                {
                    self.status_message = Some(error.to_string());
                }

                let mut terminal_text = store.active_terminal_text().unwrap_or_default();
                ui.add(
                    egui::TextEdit::multiline(&mut terminal_text)
                        .font(egui::TextStyle::Monospace)
                        .desired_rows(20)
                        .interactive(false),
                );

                ui.horizontal(|ui| {
                    let response = ui.text_edit_singleline(&mut self.terminal_input_buffer);
                    let mut should_send = ui.button("Enviar").clicked();
                    if response.lost_focus()
                        && ui.input(|input| input.key_pressed(egui::Key::Enter))
                    {
                        should_send = true;
                    }

                    if should_send && !self.terminal_input_buffer.is_empty() {
                        let mut payload = self.terminal_input_buffer.clone().into_bytes();
                        payload.push(b'\n');

                        match store.send_input_to_active_session(payload) {
                            Ok(()) => {
                                self.terminal_input_buffer.clear();
                                self.status_message =
                                    Some(String::from("Input enviado para a sessão."));
                            }
                            Err(error) => {
                                self.status_message = Some(error.to_string());
                            }
                        }
                    }
                });
            }
        });

        for (action_id, resolution) in requested_resolutions {
            match store.resolve_pending_approval(&action_id, resolution) {
                Ok(message) => {
                    emitted_messages.push(message);
                    self.status_message = Some(format!(
                        "Aprovação {} marcada como {}.",
                        action_id,
                        approval_resolution_name(resolution)
                    ));
                }
                Err(error) => {
                    self.status_message = Some(error.to_string());
                }
            }
        }

        if store.has_running_sessions() {
            ctx.request_repaint_after(Duration::from_millis(33));
        }

        emitted_messages
    }
}

fn action_kind_name(action_kind: ActionKind) -> &'static str {
    match action_kind {
        ActionKind::ReadFile => "read_file",
        ActionKind::WriteFile => "write_file",
        ActionKind::ExecuteCommand => "execute_command",
        ActionKind::ApplyPatch => "apply_patch",
        ActionKind::NetworkAccess => "network_access",
    }
}

fn approval_resolution_name(resolution: ApprovalResolution) -> &'static str {
    match resolution {
        ApprovalResolution::Approved => "approved",
        ApprovalResolution::Denied => "denied",
        ApprovalResolution::Expired => "expired",
    }
}

fn approval_status_name(status: ApprovalStatus) -> &'static str {
    match status {
        ApprovalStatus::Pending => "pending",
        ApprovalStatus::Approved => "approved",
        ApprovalStatus::Denied => "denied",
        ApprovalStatus::Expired => "expired",
    }
}

fn command_output_stream_name(stream: CommandOutputStream) -> &'static str {
    match stream {
        CommandOutputStream::Stdout => "stdout",
        CommandOutputStream::Stderr => "stderr",
    }
}

fn permission_profile_name(profile: PermissionProfile) -> &'static str {
    match profile {
        PermissionProfile::ReadOnly => "read_only",
        PermissionProfile::ReadWriteWithApproval => "read_write_with_approval",
        PermissionProfile::FullAccess => "full_access",
    }
}

fn policy_decision_name(policy_decision: PolicyDecision) -> &'static str {
    match policy_decision {
        PolicyDecision::Allow => "allow",
        PolicyDecision::RequireApproval => "require_approval",
        PolicyDecision::Deny => "deny",
    }
}

fn approval_decision_name(approval_decision: ApprovalDecision) -> &'static str {
    match approval_decision {
        ApprovalDecision::NotRequired => "not_required",
        ApprovalDecision::Approved => "approved",
        ApprovalDecision::Denied => "denied",
        ApprovalDecision::Expired => "expired",
    }
}

fn result_status_name(result_status: ResultStatus) -> &'static str {
    match result_status {
        ResultStatus::Succeeded => "succeeded",
        ResultStatus::Failed => "failed",
        ResultStatus::Blocked => "blocked",
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::Duration;

    use codex_alicia_core::IpcEvent;
    use codex_alicia_core::IpcMessage;
    use codex_alicia_core::SessionManager;
    use codex_alicia_core::SessionMode;
    use codex_alicia_core::SessionStartRequest;
    use codex_alicia_core::ipc::ActionProposed;
    use codex_alicia_core::ipc::ApprovalRequested;
    use codex_alicia_core::ipc::CommandOutputChunk;
    use codex_alicia_core::ipc::CommandStarted;
    use codex_alicia_core::ipc::PatchApplied;
    use codex_alicia_core::ipc::PatchPreviewReady;
    use pretty_assertions::assert_eq;
    use tokio::sync::mpsc::error::TryRecvError;

    use super::AliciaUiRuntime;
    use super::ApprovalPrompt;
    use super::ApprovalStatus;
    use super::CommandLifecycle;
    use super::UiEventStore;

    fn start_event(session_id: &str) -> IpcMessage {
        IpcMessage::new(IpcEvent::CommandStarted(CommandStarted {
            command_id: session_id.to_string(),
            command: vec!["sh".to_string(), "-c".to_string(), "echo hi".to_string()],
            cwd: ".".to_string(),
        }))
    }

    fn shell_echo_input_command() -> (String, Vec<String>) {
        if cfg!(windows) {
            let cmd = std::env::var("COMSPEC").unwrap_or_else(|_| String::from("cmd.exe"));
            let script = String::from("set /p ALICIA_INPUT=& echo !ALICIA_INPUT!");
            (cmd, vec![String::from("/V:ON"), String::from("/C"), script])
        } else {
            (
                String::from("/bin/sh"),
                vec![
                    String::from("-c"),
                    String::from("read ALICIA_INPUT; echo $ALICIA_INPUT"),
                ],
            )
        }
    }

    fn inherited_env() -> HashMap<String, String> {
        std::env::vars().collect()
    }

    #[test]
    fn stores_events_and_counts_pending_approvals() {
        let mut store = UiEventStore::default();

        store.push(start_event("cmd-1"));
        store.push(IpcMessage::new(IpcEvent::ApprovalRequested(
            ApprovalRequested {
                action_id: "act-1".to_string(),
                summary: "requires approval".to_string(),
                expires_at_unix_s: 1_735_689_600,
            },
        )));

        assert_eq!(store.events().len(), 2);
        assert_eq!(store.pending_approval_count(), 1);
    }

    #[test]
    fn terminal_scrollback_keeps_recent_lines() {
        let mut store = UiEventStore::new(3);
        store.push(start_event("cmd-scroll"));
        store.push(IpcMessage::new(IpcEvent::CommandOutputChunk(
            CommandOutputChunk {
                command_id: "cmd-scroll".to_string(),
                stream: codex_alicia_core::CommandOutputStream::Stdout,
                chunk: "a\nb\nc\nd\n".to_string(),
            },
        )));

        let terminal = store.active_terminal_text();
        let Some(terminal) = terminal else {
            panic!("expected active terminal text");
        };

        assert_eq!(terminal, "b\nc\nd");
    }

    #[test]
    fn routes_input_to_the_selected_session() {
        let mut store = UiEventStore::default();
        store.push(start_event("sess-1"));
        store.push(start_event("sess-2"));

        let set_result = store.set_active_session("sess-2");
        assert_eq!(set_result, Ok(()));

        let (tx_1, mut rx_1) = tokio::sync::mpsc::channel(4);
        let (tx_2, mut rx_2) = tokio::sync::mpsc::channel(4);
        store.bind_session_input("sess-1", tx_1);
        store.bind_session_input("sess-2", tx_2);

        let send_result = store.send_input_to_active_session("echo Alicia");
        assert_eq!(send_result, Ok(()));

        assert_eq!(rx_1.try_recv(), Err(TryRecvError::Empty));
        assert_eq!(rx_2.try_recv(), Ok(b"echo Alicia".to_vec()));
    }

    #[test]
    fn approval_prompt_contains_context_and_decision_updates_state() {
        let mut store = UiEventStore::default();
        store.push(IpcMessage::new(IpcEvent::ActionProposed(ActionProposed {
            action_id: "act-ctx".to_string(),
            action_kind: codex_alicia_core::ActionKind::WriteFile,
            target: "src/main.rs".to_string(),
        })));
        store.attach_approval_command(
            "act-ctx",
            vec!["cargo".to_string(), "test".to_string(), "-p".to_string()],
        );
        store.push(IpcMessage::new(IpcEvent::PatchPreviewReady(
            PatchPreviewReady {
                action_id: "act-ctx".to_string(),
                files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
            },
        )));
        store.push(IpcMessage::new(IpcEvent::ApprovalRequested(
            ApprovalRequested {
                action_id: "act-ctx".to_string(),
                summary: "Editar arquivos críticos".to_string(),
                expires_at_unix_s: 1_735_689_600,
            },
        )));

        let prompt = store.approval_prompt("act-ctx");
        let Some(prompt) = prompt else {
            panic!("expected approval prompt");
        };

        let expected = ApprovalPrompt {
            action_id: "act-ctx".to_string(),
            status: ApprovalStatus::Pending,
            what: "Editar arquivos críticos".to_string(),
            where_target: Some("src/main.rs".to_string()),
            action_kind: Some(codex_alicia_core::ActionKind::WriteFile),
            command: Some("cargo test -p".to_string()),
            impact: Some("2 arquivo(s): src/main.rs, src/lib.rs".to_string()),
            expires_at_unix_s: 1_735_689_600,
        };
        assert_eq!(prompt, expected);

        let decision = store.approve("act-ctx");
        let Ok(decision) = decision else {
            panic!("approval should resolve");
        };

        assert!(matches!(
            decision.event,
            IpcEvent::ApprovalResolved(ref event)
            if event.action_id == "act-ctx"
                && event.resolution == codex_alicia_core::ApprovalResolution::Approved
        ));

        assert_eq!(store.pending_approval_count(), 0);
        assert_eq!(
            store.approval("act-ctx").map(|item| item.status),
            Some(ApprovalStatus::Approved)
        );
    }

    #[test]
    fn timeline_preserves_order_and_diff_preview_is_available_before_apply() {
        let mut store = UiEventStore::default();
        store.push(IpcMessage::new(IpcEvent::PatchPreviewReady(
            PatchPreviewReady {
                action_id: "act-diff".to_string(),
                files: vec!["src/a.rs".to_string()],
            },
        )));

        let preview_before = store.diff_preview("act-diff");
        let Some(preview_before) = preview_before else {
            panic!("expected preview before apply");
        };
        assert_eq!(preview_before.applied, false);

        store.push(IpcMessage::new(IpcEvent::PatchApplied(PatchApplied {
            action_id: "act-diff".to_string(),
            files: vec!["src/a.rs".to_string()],
        })));

        let preview_after = store.diff_preview("act-diff");
        let Some(preview_after) = preview_after else {
            panic!("expected preview after apply");
        };
        assert_eq!(preview_after.applied, true);

        let timeline = store.timeline();
        assert_eq!(timeline.len(), 2);
        assert_eq!(timeline[0].sequence, 0);
        assert_eq!(timeline[1].sequence, 1);
        assert!(timeline[0].summary.contains("patch_preview_ready"));
        assert!(timeline[1].summary.contains("patch_applied"));
    }

    #[test]
    fn expire_pending_approvals_marks_final_state() {
        let mut store = UiEventStore::default();
        store.push(IpcMessage::new(IpcEvent::ApprovalRequested(
            ApprovalRequested {
                action_id: "act-expire".to_string(),
                summary: "aprovação com timeout".to_string(),
                expires_at_unix_s: 100,
            },
        )));

        let expired_messages = store.expire_pending_approvals(101);
        assert_eq!(expired_messages.len(), 1);
        assert!(matches!(
            expired_messages.first().map(|message| &message.event),
            Some(IpcEvent::ApprovalResolved(event))
            if event.action_id == "act-expire"
                && event.resolution == codex_alicia_core::ApprovalResolution::Expired
        ));

        assert_eq!(store.pending_approval_count(), 0);
        assert_eq!(
            store.approval("act-expire").map(|item| item.status),
            Some(ApprovalStatus::Expired)
        );
    }

    #[test]
    fn command_finished_state_is_tracked() {
        let mut store = UiEventStore::default();
        store.push(start_event("cmd-finish"));
        store.push(IpcMessage::new(IpcEvent::CommandFinished(
            codex_alicia_core::ipc::CommandFinished {
                command_id: "cmd-finish".to_string(),
                exit_code: 0,
                duration_ms: 42,
            },
        )));

        let session = store.terminal_session("cmd-finish");
        let Some(session) = session else {
            panic!("expected terminal session state");
        };

        assert_eq!(
            session.lifecycle,
            CommandLifecycle::Finished {
                exit_code: 0,
                duration_ms: 42
            }
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runtime_bridges_session_events_and_input() {
        let session_manager = SessionManager::new();
        let mut runtime = AliciaUiRuntime::new(session_manager, 128);
        let session_id = "sess-runtime-bridge";
        let marker = "alicia_runtime_bridge_ok";
        let (program, args) = shell_echo_input_command();

        let request = SessionStartRequest::new(
            session_id,
            program,
            args,
            PathBuf::from("."),
            inherited_env(),
        )
        .with_mode(SessionMode::Pipe);

        if let Err(error) = runtime.start_session(request).await {
            panic!("failed to start runtime session: {error}");
        }

        let active_deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while runtime.store().active_session_id() != Some(session_id) {
            runtime.pump_events();
            if tokio::time::Instant::now() >= active_deadline {
                panic!("active session was not set in time");
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }

        if let Err(error) = runtime.send_line_to_active_session(marker) {
            panic!("failed to send input to active session: {error}");
        }

        let done_deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        let mut saw_marker = false;
        let mut finished_ok = false;

        while tokio::time::Instant::now() < done_deadline {
            runtime.pump_events();

            if let Some(text) = runtime.store().active_terminal_text()
                && text.contains(marker)
            {
                saw_marker = true;
            }

            if let Some(session) = runtime.store().terminal_session(session_id)
                && matches!(
                    session.lifecycle,
                    CommandLifecycle::Finished {
                        exit_code: 0,
                        duration_ms: _
                    }
                )
            {
                finished_ok = true;
            }

            if saw_marker && finished_ok {
                break;
            }

            tokio::time::sleep(Duration::from_millis(25)).await;
        }

        assert!(saw_marker, "expected marker in terminal output");
        assert!(
            finished_ok,
            "expected finished lifecycle with zero exit code"
        );
    }
}
