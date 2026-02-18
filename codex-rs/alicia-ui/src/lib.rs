use std::collections::HashMap;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::Duration;
use std::time::Instant;

use codex_alicia_core::ActionKind;
use codex_alicia_core::ApprovalDecision;
use codex_alicia_core::ApprovalResolution;
use codex_alicia_core::AuditLogger;
use codex_alicia_core::AuditRecord;
use codex_alicia_core::CommandOutputStream;
use codex_alicia_core::IpcEvent;
use codex_alicia_core::IpcMessage;
use codex_alicia_core::PermissionProfile;
use codex_alicia_core::PolicyDecision;
use codex_alicia_core::ResultStatus;
use codex_alicia_core::SessionAuditContext;
use codex_alicia_core::SessionManager;
use codex_alicia_core::SessionManagerError;
use codex_alicia_core::SessionStartRequest;
use codex_alicia_core::ensure_target_in_workspace;
use codex_alicia_core::ipc::ActionProposed;
use codex_alicia_core::ipc::ApprovalRequested;
use codex_alicia_core::ipc::ApprovalResolved;
use codex_alicia_core::ipc::CommandFinished;
use codex_alicia_core::ipc::CommandOutputChunk;
use codex_alicia_core::ipc::CommandStarted;
use codex_alicia_core::ipc::PatchApplied;
use codex_alicia_core::ipc::PatchPreviewReady;
use codex_alicia_core::network_decision_for_profile;
use codex_alicia_core::resolve_effective_profile;
use thiserror::Error;
use tokio::sync::mpsc;

const DEFAULT_SCROLLBACK_LINES: usize = 2_000;
const OUTPUT_PREVIEW_MAX_CHARS: usize = 80;
const ALICIA_BOOT_DURATION_MS: f32 = 1_450.0;
const ALICIA_UI_VERSION: &str = "v0.1.0-alpha";
const ALICIA_UI_MODEL: &str = "gpt-4o-mini";

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
    pub file_previews: Vec<PatchFilePreview>,
    pub applied: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchFilePreview {
    pub file_path: String,
    pub hunks: Vec<PatchHunkPreview>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchHunkPreview {
    pub hunk_id: String,
    pub header: String,
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
    pub added_lines: usize,
    pub removed_lines: usize,
    pub decision: PatchHunkDecision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatchHunkDecision {
    Pending,
    Approved,
    Rejected,
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
    #[error("patch preview not found for action `{0}`")]
    PatchPreviewNotFound(String),
    #[error("patch file `{file_path}` not found for action `{action_id}`")]
    PatchFileNotFound {
        action_id: String,
        file_path: String,
    },
    #[error("patch hunk `{hunk_id}` not found for action `{action_id}` file `{file_path}`")]
    PatchHunkNotFound {
        action_id: String,
        file_path: String,
        hunk_id: String,
    },
}

impl UiEventStoreError {
    pub fn beginner_message(&self) -> String {
        match self {
            Self::SessionNotFound(_) => beginner_error_message(
                "Nao encontrei a sessao selecionada.",
                "Escolha outra sessao ativa ou inicie uma nova sessao.",
            ),
            Self::SessionInputNotBound(_) => beginner_error_message(
                "A sessao ainda nao esta pronta para receber texto.",
                "Aguarde a sessao iniciar e tente novamente.",
            ),
            Self::SessionInputSendFailed { .. } => beginner_error_message(
                "Nao consegui enviar seu texto para o terminal.",
                "Confira se a sessao ainda esta ativa e tente de novo.",
            ),
            Self::ApprovalNotPending(_) => beginner_error_message(
                "Essa aprovacao ja foi resolvida.",
                "Atualize a tela e siga para a proxima aprovacao pendente.",
            ),
            Self::PatchPreviewNotFound(_) => beginner_error_message(
                "Nao encontrei a previa dessa mudanca.",
                "Gere a previa novamente antes de aprovar ou rejeitar.",
            ),
            Self::PatchFileNotFound { .. } => beginner_error_message(
                "Nao encontrei o arquivo da mudanca selecionada.",
                "Atualize a previa e tente abrir o arquivo novamente.",
            ),
            Self::PatchHunkNotFound { .. } => beginner_error_message(
                "Nao encontrei o bloco da mudanca selecionada.",
                "Atualize a previa do diff e escolha o bloco novamente.",
            ),
        }
    }
}

#[derive(Debug, Error)]
pub enum AliciaUiRuntimeError {
    #[error("{0}")]
    SessionManager(#[from] SessionManagerError),
    #[error("failed to resolve effective profile for workspace `{workspace}`: {source}")]
    ResolveProfileFailed {
        workspace: String,
        #[source]
        source: codex_alicia_core::ProjectPolicyConfigError,
    },
    #[error("workspace guard blocked session `{session_id}` for cwd `{cwd}`: {source}")]
    WorkspaceGuardBlocked {
        session_id: String,
        cwd: String,
        #[source]
        source: codex_alicia_core::PolicyBridgeError,
    },
    #[error("command execution blocked for session `{session_id}`: {reason}")]
    CommandBlocked { session_id: String, reason: String },
    #[error("timed out waiting for session `{session_id}` to finish after cancellation")]
    SessionStopTimeout { session_id: String },
    #[error("failed to persist audit record for session `{session_id}`: {source}")]
    AuditWriteFailed {
        session_id: String,
        #[source]
        source: std::io::Error,
    },
}

impl AliciaUiRuntimeError {
    pub fn beginner_message(&self) -> String {
        match self {
            Self::SessionManager(error) => match error {
                SessionManagerError::SessionAlreadyExists(_) => beginner_error_message(
                    "Ja existe uma sessao com esse identificador.",
                    "Use outro identificador de sessao e tente iniciar novamente.",
                ),
                SessionManagerError::SessionNotFound(_) => beginner_error_message(
                    "Nao encontrei a sessao que voce tentou usar.",
                    "Confirme o identificador da sessao ou inicie uma nova sessao.",
                ),
                SessionManagerError::PtyUnavailable => beginner_error_message(
                    "Este ambiente nao suporta terminal PTY.",
                    "Inicie a sessao no modo pipe.",
                ),
                SessionManagerError::SpawnFailed { .. } => beginner_error_message(
                    "Nao consegui iniciar a sessao.",
                    "Confirme o comando e o diretorio de trabalho antes de tentar de novo.",
                ),
            },
            Self::ResolveProfileFailed { .. } => beginner_error_message(
                "Nao consegui carregar a politica efetiva do projeto.",
                "Revise o arquivo .codex/alicia-policy.toml e tente novamente.",
            ),
            Self::WorkspaceGuardBlocked { .. } => beginner_error_message(
                "A sessao foi bloqueada por tentar usar caminho fora do workspace.",
                "Use um diretorio dentro do workspace atual.",
            ),
            Self::CommandBlocked { reason, .. } => beginner_error_message(
                &format!("A execucao foi bloqueada pela policy: {reason}"),
                "Aprove explicitamente a acao ou ajuste o perfil de permissao.",
            ),
            Self::SessionStopTimeout { .. } => beginner_error_message(
                "A sessao demorou demais para encerrar.",
                "Tente cancelar novamente ou finalize o processo manualmente no sistema.",
            ),
            Self::AuditWriteFailed { .. } => beginner_error_message(
                "A tarefa foi encerrada, mas nao consegui salvar o log de auditoria.",
                "Verifique permissoes de escrita do arquivo de auditoria e tente novamente.",
            ),
        }
    }
}

fn beginner_error_message(problem: &str, next_step: &str) -> String {
    format!("{problem} Proximo passo: {next_step}")
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
                file_previews: event
                    .files
                    .iter()
                    .map(|file_path| PatchFilePreview {
                        file_path: file_path.clone(),
                        hunks: Vec::new(),
                    })
                    .collect(),
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
                    file_previews: event
                        .files
                        .iter()
                        .map(|file_path| PatchFilePreview {
                            file_path: file_path.clone(),
                            hunks: Vec::new(),
                        })
                        .collect(),
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

    pub fn resolved_approval_decision_for_command(
        &self,
        command: &[String],
    ) -> Option<ApprovalDecision> {
        for message in self.events.iter().rev() {
            let IpcEvent::ApprovalResolved(event) = &message.event else {
                continue;
            };
            let Some(approval) = self.approvals.get(&event.action_id) else {
                continue;
            };
            if approval
                .command
                .as_ref()
                .is_none_or(|stored| stored != command)
            {
                continue;
            }
            return Some(match event.resolution {
                ApprovalResolution::Approved => ApprovalDecision::Approved,
                ApprovalResolution::Denied => ApprovalDecision::Denied,
                ApprovalResolution::Expired => ApprovalDecision::Expired,
            });
        }

        for approval in self.approvals.values() {
            if approval
                .command
                .as_ref()
                .is_none_or(|stored| stored != command)
            {
                continue;
            }
            match approval.status {
                ApprovalStatus::Pending => {}
                ApprovalStatus::Approved => return Some(ApprovalDecision::Approved),
                ApprovalStatus::Denied => return Some(ApprovalDecision::Denied),
                ApprovalStatus::Expired => return Some(ApprovalDecision::Expired),
            }
        }

        None
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

    pub fn attach_patch_file_diff(
        &mut self,
        action_id: &str,
        file_path: impl Into<String>,
        unified_diff: &str,
    ) -> Result<usize, UiEventStoreError> {
        let file_path = file_path.into();
        let hunks = parse_unified_diff_hunks(unified_diff);
        let preview = self
            .patch_previews
            .get_mut(action_id)
            .ok_or_else(|| UiEventStoreError::PatchPreviewNotFound(action_id.to_string()))?;

        if !preview.files.iter().any(|file| file == &file_path) {
            preview.files.push(file_path.clone());
        }

        if let Some(file_preview) = preview
            .file_previews
            .iter_mut()
            .find(|file| file.file_path == file_path)
        {
            file_preview.hunks = hunks.clone();
        } else {
            preview.file_previews.push(PatchFilePreview {
                file_path: file_path.clone(),
                hunks: hunks.clone(),
            });
        }

        if let Some(approval) = self.approvals.get_mut(action_id)
            && !approval.impact_files.iter().any(|file| file == &file_path)
        {
            approval.impact_files.push(file_path.clone());
        }

        self.timeline.push(TimelineEntry {
            sequence: self.next_sequence,
            summary: format!(
                "patch_hunks_loaded {} file={} hunks={}",
                action_id,
                file_path,
                hunks.len()
            ),
        });
        self.next_sequence = self.next_sequence.saturating_add(1);

        Ok(hunks.len())
    }

    pub fn set_patch_hunk_decision(
        &mut self,
        action_id: &str,
        file_path: &str,
        hunk_id: &str,
        decision: PatchHunkDecision,
    ) -> Result<(), UiEventStoreError> {
        let preview = self
            .patch_previews
            .get_mut(action_id)
            .ok_or_else(|| UiEventStoreError::PatchPreviewNotFound(action_id.to_string()))?;

        let file_preview = preview
            .file_previews
            .iter_mut()
            .find(|file| file.file_path == file_path)
            .ok_or_else(|| UiEventStoreError::PatchFileNotFound {
                action_id: action_id.to_string(),
                file_path: file_path.to_string(),
            })?;

        let hunk = file_preview
            .hunks
            .iter_mut()
            .find(|hunk| hunk.hunk_id == hunk_id)
            .ok_or_else(|| UiEventStoreError::PatchHunkNotFound {
                action_id: action_id.to_string(),
                file_path: file_path.to_string(),
                hunk_id: hunk_id.to_string(),
            })?;

        hunk.decision = decision;
        self.timeline.push(TimelineEntry {
            sequence: self.next_sequence,
            summary: format!(
                "patch_hunk_decision {} file={} hunk={} decision={}",
                action_id,
                file_path,
                hunk_id,
                patch_hunk_decision_name(decision)
            ),
        });
        self.next_sequence = self.next_sequence.saturating_add(1);

        Ok(())
    }

    pub fn approve_patch_hunk(
        &mut self,
        action_id: &str,
        file_path: &str,
        hunk_id: &str,
    ) -> Result<(), UiEventStoreError> {
        self.set_patch_hunk_decision(action_id, file_path, hunk_id, PatchHunkDecision::Approved)
    }

    pub fn reject_patch_hunk(
        &mut self,
        action_id: &str,
        file_path: &str,
        hunk_id: &str,
    ) -> Result<(), UiEventStoreError> {
        self.set_patch_hunk_decision(action_id, file_path, hunk_id, PatchHunkDecision::Rejected)
    }

    pub fn unresolved_patch_hunk_count(&self, action_id: &str) -> Option<usize> {
        let preview = self.patch_previews.get(action_id)?;
        Some(
            preview
                .file_previews
                .iter()
                .flat_map(|file| file.hunks.iter())
                .filter(|hunk| hunk.decision == PatchHunkDecision::Pending)
                .count(),
        )
    }
}

#[derive(Debug)]
pub struct AliciaUiRuntime {
    session_manager: SessionManager,
    events_rx: tokio::sync::broadcast::Receiver<IpcMessage>,
    store: UiEventStore,
    audit_logger: Option<AuditLogger>,
    workspace_root: PathBuf,
}

impl AliciaUiRuntime {
    pub fn new(session_manager: SessionManager, max_scrollback_lines: usize) -> Self {
        let events_rx = session_manager.event_receiver();
        let workspace_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        Self {
            session_manager,
            events_rx,
            store: UiEventStore::new(max_scrollback_lines),
            audit_logger: None,
            workspace_root,
        }
    }

    pub fn with_workspace_root(mut self, workspace_root: PathBuf) -> Self {
        self.workspace_root = workspace_root;
        self
    }

    pub fn with_audit_logger(mut self, audit_logger: AuditLogger) -> Self {
        self.audit_logger = Some(audit_logger);
        self
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
        let mut request = request;
        let session_id = request.session_id.clone();
        let command = command_tokens(&request.program, &request.args);
        let command_target = command_target(
            &request.program,
            &request.args,
            request.audit_context.target.as_str(),
        );
        let guard =
            ensure_target_in_workspace(&self.workspace_root, &request.cwd).map_err(|source| {
                AliciaUiRuntimeError::WorkspaceGuardBlocked {
                    session_id: session_id.clone(),
                    cwd: request.cwd.to_string_lossy().to_string(),
                    source,
                }
            })?;
        request.cwd = guard.canonical_target;

        let fallback_profile = self.store.permission_profile();
        let effective_profile = resolve_effective_profile(&self.workspace_root, fallback_profile)
            .map_err(|source| AliciaUiRuntimeError::ResolveProfileFailed {
            workspace: self.workspace_root.to_string_lossy().to_string(),
            source,
        })?;
        self.store.set_permission_profile(effective_profile);

        let exec_decision = effective_profile.decision_for(ActionKind::ExecuteCommand);
        let network_decision = network_decision_for_profile(effective_profile);
        let policy_decision = combine_policy_decisions(exec_decision, network_decision);
        let store_approval_decision = self.store.resolved_approval_decision_for_command(&command);
        let requested_approval_decision = selected_approval_decision(
            request.audit_context.approval_decision,
            store_approval_decision,
        );
        let approval_decision =
            effective_approval_decision(policy_decision, requested_approval_decision);

        if let Some(reason) = blocked_reason(policy_decision, approval_decision) {
            self.record_blocked_audit(
                &session_id,
                command_target.as_str(),
                effective_profile,
                policy_decision,
                approval_decision,
            )
            .await?;
            return Err(AliciaUiRuntimeError::CommandBlocked { session_id, reason });
        }

        request.audit_context = SessionAuditContext {
            action_kind: ActionKind::ExecuteCommand,
            target: command_target,
            profile: effective_profile,
            policy_decision,
            approval_decision,
        };

        self.session_manager.start(request).await?;
        self.bind_session_input(&session_id).await?;
        self.pump_events();
        Ok(())
    }

    pub async fn stop_session(&mut self, session_id: &str) -> Result<(), AliciaUiRuntimeError> {
        self.session_manager.cancel(session_id).await?;
        self.store.unbind_session_input(session_id);
        let finished_event = self
            .wait_for_session_finished_event(session_id, Duration::from_secs(10))
            .await
            .ok_or_else(|| AliciaUiRuntimeError::SessionStopTimeout {
                session_id: session_id.to_string(),
            })?;
        self.record_cancellation_audit(session_id, &finished_event)
            .await?;
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

    async fn record_blocked_audit(
        &mut self,
        session_id: &str,
        target: &str,
        profile: PermissionProfile,
        policy_decision: PolicyDecision,
        approval_decision: ApprovalDecision,
    ) -> Result<(), AliciaUiRuntimeError> {
        let record = AuditRecord::new(
            session_id,
            ActionKind::ExecuteCommand,
            target,
            profile,
            policy_decision,
            approval_decision,
            ResultStatus::Blocked,
            0,
        );
        if let Some(audit_logger) = self.audit_logger.clone() {
            audit_logger.append(&record).await.map_err(|source| {
                AliciaUiRuntimeError::AuditWriteFailed {
                    session_id: session_id.to_string(),
                    source,
                }
            })?;
        }
        self.store.add_audit_record(record);
        Ok(())
    }

    async fn wait_for_session_finished_event(
        &mut self,
        session_id: &str,
        timeout: Duration,
    ) -> Option<CommandFinished> {
        let deadline = tokio::time::Instant::now() + timeout;

        loop {
            let now = tokio::time::Instant::now();
            if now >= deadline {
                return None;
            }

            let remaining = deadline.saturating_duration_since(now);
            match tokio::time::timeout(remaining, self.events_rx.recv()).await {
                Ok(Ok(message)) => {
                    let mut finished = None;
                    if let IpcEvent::CommandFinished(event) = &message.event
                        && event.command_id == session_id
                    {
                        finished = Some(event.clone());
                    }
                    self.store.push(message);
                    if finished.is_some() {
                        return finished;
                    }
                }
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => return None,
                Err(_) => return None,
            }
        }
    }

    async fn record_cancellation_audit(
        &mut self,
        session_id: &str,
        finished_event: &CommandFinished,
    ) -> Result<(), AliciaUiRuntimeError> {
        let Some(audit_logger) = self.audit_logger.clone() else {
            return Ok(());
        };

        let target = self
            .store
            .terminal_session(session_id)
            .and_then(|session| {
                if session.command.is_empty() {
                    None
                } else {
                    Some(session.command.join(" "))
                }
            })
            .unwrap_or_else(|| session_id.to_string());
        let profile = self.store.permission_profile();
        let policy_decision = profile.decision_for(ActionKind::ExecuteCommand);
        let approval_decision = match policy_decision {
            PolicyDecision::RequireApproval => ApprovalDecision::Approved,
            PolicyDecision::Allow | PolicyDecision::Deny => ApprovalDecision::NotRequired,
        };
        let result_status = if finished_event.exit_code == 0 {
            ResultStatus::Succeeded
        } else {
            ResultStatus::Failed
        };
        let record = AuditRecord::new(
            session_id,
            ActionKind::ExecuteCommand,
            target,
            profile,
            policy_decision,
            approval_decision,
            result_status,
            finished_event.duration_ms,
        );
        audit_logger.append(&record).await.map_err(|source| {
            AliciaUiRuntimeError::AuditWriteFailed {
                session_id: session_id.to_string(),
                source,
            }
        })?;
        self.store.add_audit_record(record);
        Ok(())
    }
}

// ─── Demo types for faithful React-style UI ───

#[derive(Debug, Clone)]
struct DemoChatMessage {
    role: DemoMessageRole,
    content: &'static str,
    timestamp: &'static str,
    tool_calls: Vec<DemoToolCall>,
    code_blocks: Vec<DemoCodeBlock>,
    diff: Option<DemoDiff>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DemoMessageRole {
    System,
    User,
    Agent,
}

#[derive(Debug, Clone)]
struct DemoToolCall {
    icon: &'static str,
    name: &'static str,
    detail: &'static str,
}

#[derive(Debug, Clone)]
struct DemoCodeBlock {
    language: &'static str,
    filename: &'static str,
    content: &'static str,
}

#[derive(Debug, Clone)]
struct DemoDiffLine {
    line_type: DemoDiffLineType,
    content: &'static str,
    line_number: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DemoDiffLineType {
    Add,
    Remove,
    Context,
}

#[derive(Debug, Clone)]
struct DemoDiff {
    filename: &'static str,
    lines: Vec<DemoDiffLine>,
    added: usize,
    removed: usize,
}

const ALICIA_ASCII_ART: &str = "\
     _    _     ___ ____ ___    _    \n\
    / \\  | |   |_ _/ ___|_ _|  / \\   \n\
   / _ \\ | |    | | |    | |  / _ \\  \n\
  / ___ \\| |___ | | |___ | | / ___ \\ \n\
 /_/   \\_\\_____|___\\____|___/_/   \\_\\";

struct BootStage {
    label: &'static str,
    detail: &'static str,
    threshold: f32,
}

const BOOT_STAGES: &[BootStage] = &[
    BootStage { label: "Loading configuration", detail: "~/.config/alicia/config.toml", threshold: 0.08 },
    BootStage { label: "Setting up workspace", detail: "~/projects/my-app", threshold: 0.20 },
    BootStage { label: "Connecting MCP servers", detail: "6 servers", threshold: 0.45 },
    BootStage { label: "Validating API credentials", detail: "verified", threshold: 0.65 },
    BootStage { label: "Initializing sandbox", detail: "ready", threshold: 0.82 },
    BootStage { label: "System ready", detail: "Alicia v0.1.0-alpha", threshold: 0.95 },
];

#[derive(Debug)]
pub struct AliciaEguiView {
    terminal_input_buffer: String,
    status_message: Option<String>,
    boot_started_at: Option<Instant>,
    boot_completed: bool,
    demo_messages: Vec<DemoChatMessage>,
}

impl Default for AliciaEguiView {
    fn default() -> Self {
        Self {
            terminal_input_buffer: String::new(),
            status_message: None,
            boot_started_at: None,
            boot_completed: false,
            demo_messages: build_demo_messages(),
        }
    }
}

impl AliciaEguiView {
    pub fn render(&mut self, ctx: &egui::Context, store: &mut UiEventStore) -> Vec<IpcMessage> {
        self.apply_theme(ctx);

        if !self.boot_completed && self.render_boot_screen(ctx) {
            return Vec::new();
        }

        let pending_approvals: Vec<ApprovalItem> =
            store.pending_approvals().into_iter().cloned().collect();
        let unapplied_previews: Vec<PatchPreviewState> = store
            .unapplied_diff_previews()
            .into_iter()
            .cloned()
            .collect();
        let timeline: Vec<TimelineEntry> = store.timeline().to_vec();
        let session_ids = store.terminal_session_ids().to_vec();
        if store.active_session_id().is_none()
            && let Some(first_session_id) = session_ids.first()
            && let Err(error) = store.set_active_session(first_session_id)
        {
            self.status_message = Some(error.beginner_message());
        }

        let changed_files = collect_changed_files(&unapplied_previews);
        let show_right_panel = !pending_approvals.is_empty() || !unapplied_previews.is_empty();
        let mut requested_resolutions: Vec<(String, ApprovalResolution)> = Vec::new();
        let mut requested_hunk_decisions: Vec<(String, String, String, PatchHunkDecision)> =
            Vec::new();
        let mut emitted_messages = Vec::new();

        // ═══ TITLE BAR ═══
        egui::TopBottomPanel::top("alicia_title_bar")
            .exact_height(36.0)
            .show(ctx, |ui| {
                egui::Frame::new()
                    .fill(alicia_color_terminal_bg())
                    .inner_margin(egui::Margin::symmetric(12, 7))
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            // Traffic light buttons
                            ui.label(
                                egui::RichText::new("\u{25CF}")
                                    .color(alicia_color_terminal_red()),
                            );
                            ui.label(
                                egui::RichText::new("\u{25CF}")
                                    .color(alicia_color_terminal_gold()),
                            );
                            ui.label(
                                egui::RichText::new("\u{25CF}")
                                    .color(alicia_color_terminal_green()),
                            );
                            ui.add_space(8.0);
                            ui.separator();
                            ui.add_space(4.0);
                            ui.label(
                                egui::RichText::new(format!("ALICIA {ALICIA_UI_VERSION}"))
                                    .monospace()
                                    .strong()
                                    .color(alicia_color_terminal_fg()),
                            );
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    let current_dir = std::env::current_dir()
                                        .map(|path| path.to_string_lossy().to_string())
                                        .unwrap_or_else(|_| String::from("."));
                                    ui.label(
                                        egui::RichText::new(current_dir)
                                            .monospace()
                                            .small()
                                            .color(alicia_color_terminal_comment()),
                                    );
                                    ui.separator();
                                    ui.label(
                                        egui::RichText::new("Connected")
                                            .monospace()
                                            .color(alicia_color_terminal_green()),
                                    );
                                    ui.label(
                                        egui::RichText::new("\u{25CF}")
                                            .color(alicia_color_terminal_green()),
                                    );
                                },
                            );
                        });
                    });
            });

        // ═══ SIDEBAR ═══
        egui::SidePanel::left("alicia_sidebar")
            .default_width(240.0)
            .resizable(true)
            .show(ctx, |ui| {
                egui::Frame::new()
                    .fill(alicia_color_sidebar_bg())
                    .inner_margin(egui::Margin::same(12))
                    .show(ui, |ui| {
                        // ── Agent Info Card ──
                        egui::Frame::new()
                            .fill(alicia_color_panel_bg())
                            .stroke(egui::Stroke::new(1.0, alicia_color_border()))
                            .corner_radius(egui::CornerRadius::same(8))
                            .inner_margin(egui::Margin::same(10))
                            .show(ui, |ui| {
                                ui.horizontal(|ui| {
                                    egui::Frame::new()
                                        .fill(alicia_color_terminal_green().gamma_multiply(0.15))
                                        .corner_radius(egui::CornerRadius::same(6))
                                        .inner_margin(egui::Margin::same(6))
                                        .show(ui, |ui| {
                                            ui.label(
                                                egui::RichText::new("[A]")
                                                    .monospace()
                                                    .strong()
                                                    .color(alicia_color_terminal_green()),
                                            );
                                        });
                                    ui.vertical(|ui| {
                                        ui.label(
                                            egui::RichText::new("Alicia Agent")
                                                .monospace()
                                                .strong()
                                                .color(alicia_color_terminal_fg()),
                                        );
                                        ui.label(
                                            egui::RichText::new(ALICIA_UI_MODEL)
                                                .small()
                                                .monospace()
                                                .color(alicia_color_terminal_comment()),
                                        );
                                    });
                                });
                                ui.add_space(6.0);
                                ui.horizontal(|ui| {
                                    ui.label(
                                        egui::RichText::new("1.2k tokens")
                                            .small()
                                            .monospace()
                                            .color(alicia_color_terminal_comment()),
                                    );
                                    ui.separator();
                                    ui.label(
                                        egui::RichText::new("Fast")
                                            .small()
                                            .monospace()
                                            .color(alicia_color_terminal_gold()),
                                    );
                                });
                            });

                        ui.add_space(12.0);

                        // ── Sessions Section ──
                        ui.label(
                            egui::RichText::new("SESSIONS")
                                .monospace()
                                .small()
                                .strong()
                                .color(alicia_color_terminal_comment()),
                        );
                        ui.add_space(4.0);

                        let active_session = store.active_session_id().map(str::to_string);
                        let mut selected_session: Option<String> = None;
                        if session_ids.is_empty() {
                            let demo_sessions = [
                                ("Refactor auth module", "2m ago", true),
                                ("Fix database migrat...", "15m ago", false),
                                ("Add API endpoints", "1h ago", false),
                                ("Update test suite", "3h ago", false),
                            ];
                            for (name, time, is_active) in &demo_sessions {
                                let card_bg = if *is_active {
                                    alicia_color_highlight_bg()
                                } else {
                                    alicia_color_panel_bg()
                                };
                                let border_color = if *is_active {
                                    alicia_color_terminal_green()
                                } else {
                                    alicia_color_border()
                                };
                                egui::Frame::new()
                                    .fill(card_bg)
                                    .stroke(egui::Stroke::new(1.0, border_color))
                                    .corner_radius(egui::CornerRadius::same(6))
                                    .inner_margin(egui::Margin::symmetric(8, 5))
                                    .show(ui, |ui| {
                                        ui.horizontal(|ui| {
                                            ui.label(
                                                egui::RichText::new(
                                                    if *is_active { "\u{25CF}" } else { "\u{25CB}" },
                                                )
                                                .monospace()
                                                .small()
                                                .color(if *is_active {
                                                    alicia_color_terminal_green()
                                                } else {
                                                    alicia_color_terminal_comment()
                                                }),
                                            );
                                            ui.label(
                                                egui::RichText::new(*name)
                                                    .monospace()
                                                    .small()
                                                    .color(if *is_active {
                                                        alicia_color_terminal_fg()
                                                    } else {
                                                        alicia_color_terminal_comment()
                                                    }),
                                            );
                                            ui.with_layout(
                                                egui::Layout::right_to_left(egui::Align::Center),
                                                |ui| {
                                                    ui.label(
                                                        egui::RichText::new(*time)
                                                            .monospace()
                                                            .small()
                                                            .color(alicia_color_terminal_comment()),
                                                    );
                                                },
                                            );
                                        });
                                    });
                                ui.add_space(3.0);
                            }
                        } else {
                            for session_id in &session_ids {
                                let is_active =
                                    active_session.as_deref() == Some(session_id.as_str());
                                let button = egui::Button::new(
                                    egui::RichText::new(if is_active {
                                        format!("\u{25CF} {session_id}")
                                    } else {
                                        format!("\u{25CB} {session_id}")
                                    })
                                    .monospace()
                                    .small()
                                    .color(if is_active {
                                        alicia_color_terminal_green()
                                    } else {
                                        alicia_color_terminal_fg()
                                    }),
                                )
                                .selected(is_active)
                                .fill(if is_active {
                                    alicia_color_highlight_bg()
                                } else {
                                    alicia_color_panel_bg()
                                });

                                if ui.add(button).clicked() {
                                    selected_session = Some(session_id.clone());
                                }
                            }
                        }

                        if let Some(selected_session) = selected_session
                            && active_session.as_deref() != Some(selected_session.as_str())
                            && let Err(error) = store.set_active_session(&selected_session)
                        {
                            self.status_message = Some(error.beginner_message());
                        }

                        ui.add_space(12.0);
                        ui.separator();
                        ui.add_space(8.0);

                        // ── Changes Section ──
                        ui.horizontal(|ui| {
                            ui.label(
                                egui::RichText::new("CHANGES")
                                    .monospace()
                                    .small()
                                    .strong()
                                    .color(alicia_color_terminal_comment()),
                            );
                            let count = if changed_files.is_empty() {
                                4
                            } else {
                                changed_files.len()
                            };
                            egui::Frame::new()
                                .fill(alicia_color_terminal_blue().gamma_multiply(0.2))
                                .corner_radius(egui::CornerRadius::same(8))
                                .inner_margin(egui::Margin::symmetric(6, 1))
                                .show(ui, |ui| {
                                    ui.label(
                                        egui::RichText::new(format!("{count}"))
                                            .small()
                                            .monospace()
                                            .color(alicia_color_terminal_blue()),
                                    );
                                });
                        });
                        ui.add_space(4.0);

                        if changed_files.is_empty() {
                            let demo_changes: &[(&str, &str, fn() -> egui::Color32)] = &[
                                ("M", "src/auth/handler.rs", alicia_color_terminal_gold),
                                ("A", "src/db/schema.rs", alicia_color_terminal_green),
                                ("M", "src/api/routes.rs", alicia_color_terminal_gold),
                                ("D", "tests/auth_test.rs", alicia_color_terminal_red),
                            ];
                            for (status, file, color_fn) in demo_changes {
                                let color = color_fn();
                                ui.horizontal(|ui| {
                                    egui::Frame::new()
                                        .fill(color.gamma_multiply(0.15))
                                        .corner_radius(egui::CornerRadius::same(3))
                                        .inner_margin(egui::Margin::symmetric(4, 1))
                                        .show(ui, |ui| {
                                            ui.label(
                                                egui::RichText::new(*status)
                                                    .monospace()
                                                    .small()
                                                    .strong()
                                                    .color(color),
                                            );
                                        });
                                    ui.label(
                                        egui::RichText::new(*file)
                                            .monospace()
                                            .small()
                                            .color(alicia_color_terminal_fg()),
                                    );
                                });
                                ui.add_space(2.0);
                            }
                        } else {
                            for file in &changed_files {
                                ui.horizontal(|ui| {
                                    egui::Frame::new()
                                        .fill(
                                            alicia_color_terminal_gold().gamma_multiply(0.15),
                                        )
                                        .corner_radius(egui::CornerRadius::same(3))
                                        .inner_margin(egui::Margin::symmetric(4, 1))
                                        .show(ui, |ui| {
                                            ui.label(
                                                egui::RichText::new("M")
                                                    .monospace()
                                                    .small()
                                                    .strong()
                                                    .color(alicia_color_terminal_gold()),
                                            );
                                        });
                                    ui.label(
                                        egui::RichText::new(file)
                                            .monospace()
                                            .small()
                                            .color(alicia_color_terminal_fg()),
                                    );
                                });
                                ui.add_space(2.0);
                            }
                        }

                        ui.add_space(12.0);
                        ui.separator();
                        ui.add_space(8.0);

                        // ── Project Section ──
                        ui.label(
                            egui::RichText::new("PROJECT")
                                .monospace()
                                .small()
                                .strong()
                                .color(alicia_color_terminal_comment()),
                        );
                        ui.add_space(4.0);

                        if let Some(active_session_id) = store.active_session_id() {
                            if let Some(session) = store.terminal_session(active_session_id) {
                                ui.horizontal(|ui| {
                                    ui.label(
                                        egui::RichText::new("~")
                                            .monospace()
                                            .color(alicia_color_terminal_purple()),
                                    );
                                    ui.label(
                                        egui::RichText::new(format!("cwd: {}", session.cwd))
                                            .monospace()
                                            .small()
                                            .color(alicia_color_terminal_fg()),
                                    );
                                });
                            } else {
                                render_demo_project_info(ui);
                            }
                        } else {
                            render_demo_project_info(ui);
                        }

                        ui.add_space(12.0);
                        ui.separator();
                        ui.add_space(4.0);

                        // ── Settings ──
                        ui.horizontal(|ui| {
                            ui.label(
                                egui::RichText::new("Settings")
                                    .monospace()
                                    .color(alicia_color_terminal_comment()),
                            );
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    render_kbd(ui, ",");
                                },
                            );
                        });
                    });
            });

        if show_right_panel {
            egui::SidePanel::right("alicia_approval_panel")
                .default_width(340.0)
                .resizable(true)
                .show(ctx, |ui| {
                    egui::Frame::new()
                        .fill(alicia_color_panel_bg())
                        .inner_margin(egui::Margin::same(12))
                        .show(ui, |ui| {
                            ui.label(
                                egui::RichText::new("Approval Queue")
                                    .heading()
                                    .color(alicia_color_terminal_gold()),
                            );
                            ui.add_space(8.0);
                            if pending_approvals.is_empty() {
                                ui.label(
                                    egui::RichText::new("No pending approvals")
                                        .monospace()
                                        .color(alicia_color_terminal_comment()),
                                );
                            } else {
                                egui::ScrollArea::vertical()
                                    .max_height(260.0)
                                    .show(ui, |ui| {
                                        for approval in &pending_approvals {
                                            egui::Frame::new()
                                                .fill(alicia_color_highlight_bg())
                                                .stroke(egui::Stroke::new(
                                                    1.0,
                                                    alicia_color_border(),
                                                ))
                                                .corner_radius(egui::CornerRadius::same(8))
                                                .inner_margin(egui::Margin::same(10))
                                                .show(ui, |ui| {
                                                    ui.label(
                                                        egui::RichText::new(&approval.summary)
                                                            .monospace()
                                                            .color(alicia_color_terminal_fg()),
                                                    );
                                                    ui.label(
                                                        egui::RichText::new(format!(
                                                            "id: {}",
                                                            approval.action_id
                                                        ))
                                                        .small()
                                                        .monospace()
                                                        .color(alicia_color_terminal_comment()),
                                                    );
                                                    if let Some(target) = approval.target.as_deref()
                                                    {
                                                        ui.label(
                                                            egui::RichText::new(format!(
                                                                "target: {target}"
                                                            ))
                                                            .small()
                                                            .monospace()
                                                            .color(alicia_color_terminal_comment()),
                                                        );
                                                    }
                                                    ui.horizontal(|ui| {
                                                        if ui.button("Approve").clicked() {
                                                            requested_resolutions.push((
                                                                approval.action_id.clone(),
                                                                ApprovalResolution::Approved,
                                                            ));
                                                        }
                                                        if ui.button("Reject").clicked() {
                                                            requested_resolutions.push((
                                                                approval.action_id.clone(),
                                                                ApprovalResolution::Denied,
                                                            ));
                                                        }
                                                    });
                                                });
                                            ui.add_space(8.0);
                                        }
                                    });
                            }

                            ui.add_space(8.0);
                            ui.separator();
                            ui.add_space(8.0);
                            ui.label(
                                egui::RichText::new("Diff Preview")
                                    .heading()
                                    .color(alicia_color_terminal_blue()),
                            );
                            if unapplied_previews.is_empty() {
                                ui.label(
                                    egui::RichText::new("No unapplied patch")
                                        .monospace()
                                        .color(alicia_color_terminal_comment()),
                                );
                            } else {
                                egui::ScrollArea::vertical().show(ui, |ui| {
                                    for preview in &unapplied_previews {
                                        egui::Frame::new()
                                            .fill(alicia_color_highlight_bg())
                                            .stroke(egui::Stroke::new(1.0, alicia_color_border()))
                                            .corner_radius(egui::CornerRadius::same(8))
                                            .inner_margin(egui::Margin::same(10))
                                            .show(ui, |ui| {
                                                ui.label(
                                                    egui::RichText::new(format!(
                                                        "Action {}",
                                                        preview.action_id
                                                    ))
                                                    .monospace()
                                                    .color(alicia_color_terminal_fg()),
                                                );
                                                for file_preview in &preview.file_previews {
                                                    ui.add_space(6.0);
                                                    ui.label(
                                                        egui::RichText::new(format!(
                                                            "* {}",
                                                            file_preview.file_path
                                                        ))
                                                        .monospace()
                                                        .color(alicia_color_terminal_cyan()),
                                                    );
                                                    for hunk in &file_preview.hunks {
                                                        let decision_color = match hunk.decision {
                                                            PatchHunkDecision::Pending => {
                                                                alicia_color_terminal_gold()
                                                            }
                                                            PatchHunkDecision::Approved => {
                                                                alicia_color_terminal_green()
                                                            }
                                                            PatchHunkDecision::Rejected => {
                                                                alicia_color_terminal_red()
                                                            }
                                                        };

                                                        egui::Frame::new()
                                                            .fill(alicia_color_panel_bg())
                                                            .stroke(egui::Stroke::new(
                                                                1.0,
                                                                decision_color,
                                                            ))
                                                            .corner_radius(
                                                                egui::CornerRadius::same(6),
                                                            )
                                                            .inner_margin(egui::Margin::same(8))
                                                            .show(ui, |ui| {
                                                                ui.label(
                                                                    egui::RichText::new(format!(
                                                                        "{} (+{} / -{})",
                                                                        hunk.hunk_id,
                                                                        hunk.added_lines,
                                                                        hunk.removed_lines
                                                                    ))
                                                                    .small()
                                                                    .monospace()
                                                                    .color(decision_color),
                                                                );
                                                                ui.horizontal(|ui| {
                                                                    if ui
                                                                        .button("Approve hunk")
                                                                        .clicked()
                                                                    {
                                                                        requested_hunk_decisions
                                                                        .push((
                                                                        preview.action_id.clone(),
                                                                        file_preview
                                                                            .file_path
                                                                            .clone(),
                                                                        hunk.hunk_id.clone(),
                                                                        PatchHunkDecision::Approved,
                                                                    ));
                                                                    }
                                                                    if ui
                                                                        .button("Reject hunk")
                                                                        .clicked()
                                                                    {
                                                                        requested_hunk_decisions
                                                                        .push((
                                                                        preview.action_id.clone(),
                                                                        file_preview
                                                                            .file_path
                                                                            .clone(),
                                                                        hunk.hunk_id.clone(),
                                                                        PatchHunkDecision::Rejected,
                                                                    ));
                                                                    }
                                                                });
                                                            });
                                                    }
                                                }
                                            });
                                        ui.add_space(8.0);
                                    }
                                });
                            }
                        });
                });
        }

        // ═══ STATUS BAR ═══
        egui::TopBottomPanel::bottom("alicia_status_bar")
            .exact_height(24.0)
            .show(ctx, |ui| {
                egui::Frame::new()
                    .fill(alicia_color_panel_bg())
                    .inner_margin(egui::Margin::symmetric(10, 3))
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.label(
                                egui::RichText::new("main")
                                    .monospace()
                                    .small()
                                    .color(alicia_color_terminal_green()),
                            );
                            ui.separator();
                            ui.label(
                                egui::RichText::new(format!(
                                    "{} errors",
                                    store.pending_approval_count()
                                ))
                                .monospace()
                                .small()
                                .color(alicia_color_terminal_fg()),
                            );
                            ui.label(
                                egui::RichText::new("2 warnings")
                                    .monospace()
                                    .small()
                                    .color(alicia_color_terminal_gold()),
                            );

                            if let Some(status_message) = self.status_message.as_deref() {
                                ui.separator();
                                ui.label(
                                    egui::RichText::new(status_message)
                                        .monospace()
                                        .small()
                                        .color(alicia_color_terminal_fg()),
                                );
                            }

                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    ui.label(
                                        egui::RichText::new("Rust")
                                            .monospace()
                                            .small()
                                            .color(alicia_color_terminal_comment()),
                                    );
                                    ui.separator();
                                    ui.label(
                                        egui::RichText::new("UTF-8")
                                            .monospace()
                                            .small()
                                            .color(alicia_color_terminal_comment()),
                                    );
                                    ui.separator();
                                    ui.label(
                                        egui::RichText::new("Latency: 142ms")
                                            .monospace()
                                            .small()
                                            .color(alicia_color_terminal_comment()),
                                    );
                                    ui.separator();
                                    ui.label(
                                        egui::RichText::new(ALICIA_UI_MODEL)
                                            .monospace()
                                            .small()
                                            .color(alicia_color_terminal_comment()),
                                    );
                                    ui.separator();
                                    ui.label(
                                        egui::RichText::new(format!(
                                            "sandbox: {}",
                                            permission_profile_name(
                                                store.permission_profile()
                                            )
                                        ))
                                        .monospace()
                                        .small()
                                        .color(alicia_color_terminal_cyan()),
                                    );
                                },
                            );
                        });
                    });
            });

        // ═══ CENTRAL PANEL ═══
        egui::CentralPanel::default().show(ctx, |ui| {
            egui::Frame::new()
                .fill(alicia_color_terminal_bg())
                .inner_margin(egui::Margin::same(12))
                .show(ui, |ui| {
                    // ── Welcome Section ──
                    ui.vertical_centered(|ui| {
                        ui.add_space(16.0);
                        egui::Frame::new()
                            .fill(alicia_color_terminal_green().gamma_multiply(0.12))
                            .corner_radius(egui::CornerRadius::same(12))
                            .inner_margin(egui::Margin::same(14))
                            .show(ui, |ui| {
                                ui.label(
                                    egui::RichText::new("[A]")
                                        .monospace()
                                        .strong()
                                        .size(20.0)
                                        .color(alicia_color_terminal_green()),
                                );
                            });
                        ui.add_space(8.0);
                        ui.label(
                            egui::RichText::new("Alicia")
                                .monospace()
                                .size(20.0)
                                .strong()
                                .color(alicia_color_terminal_fg()),
                        );
                        ui.label(
                            egui::RichText::new("Your AI-powered coding agent")
                                .monospace()
                                .color(alicia_color_terminal_comment()),
                        );
                        ui.add_space(8.0);
                        ui.horizontal(|ui| {
                            let avail = ui.available_width();
                            let badge_width = 320.0_f32;
                            let pad = ((avail - badge_width) / 2.0).max(0.0);
                            ui.add_space(pad);
                            render_badge(ui, "Sandbox Mode", alicia_color_terminal_cyan());
                            render_badge(ui, "Auto-approve: Off", alicia_color_terminal_comment());
                            render_badge(
                                ui,
                                &format!("Model: {ALICIA_UI_MODEL}"),
                                alicia_color_terminal_purple(),
                            );
                        });
                        ui.add_space(12.0);
                    });

                    // ── Messages Area ──
                    egui::ScrollArea::vertical()
                        .auto_shrink([false, false])
                        .stick_to_bottom(true)
                        .show(ui, |ui| {
                            if timeline.is_empty() {
                                // Show demo messages (React-style)
                                for msg in &self.demo_messages {
                                    render_chat_message(ui, msg);
                                }
                            } else {
                                // Show real timeline events in chat-style
                                for entry in timeline.iter().rev().take(80).rev() {
                                    let (sender, accent) =
                                        timeline_sender_style(entry.summary.as_str());
                                    egui::Frame::new()
                                        .fill(alicia_color_panel_bg())
                                        .corner_radius(egui::CornerRadius::same(6))
                                        .inner_margin(egui::Margin::symmetric(12, 8))
                                        .show(ui, |ui| {
                                            ui.horizontal(|ui| {
                                                egui::Frame::new()
                                                    .fill(accent.gamma_multiply(0.15))
                                                    .corner_radius(egui::CornerRadius::same(4))
                                                    .inner_margin(egui::Margin::same(4))
                                                    .show(ui, |ui| {
                                                        ui.label(
                                                            egui::RichText::new(">_")
                                                                .monospace()
                                                                .small()
                                                                .color(accent),
                                                        );
                                                    });
                                                ui.label(
                                                    egui::RichText::new(sender)
                                                        .monospace()
                                                        .small()
                                                        .strong()
                                                        .color(accent),
                                                );
                                                ui.label(
                                                    egui::RichText::new(format!(
                                                        "#{}",
                                                        entry.sequence
                                                    ))
                                                    .monospace()
                                                    .small()
                                                    .color(alicia_color_terminal_comment()),
                                                );
                                            });
                                            ui.add_space(2.0);
                                            ui.label(
                                                egui::RichText::new(entry.summary.as_str())
                                                    .monospace()
                                                    .color(alicia_color_terminal_fg()),
                                            );
                                        });
                                    ui.add_space(6.0);
                                }
                            }

                            if let Some(active_terminal_text) = store.active_terminal_text() {
                                ui.add_space(4.0);
                                ui.label(
                                    egui::RichText::new("Terminal Output")
                                        .monospace()
                                        .small()
                                        .color(alicia_color_terminal_blue()),
                                );
                                let mut output = active_terminal_text;
                                ui.add(
                                    egui::TextEdit::multiline(&mut output)
                                        .font(egui::TextStyle::Monospace)
                                        .desired_rows(14)
                                        .interactive(false),
                                );
                            }
                        });

                    // ── Command Input ──
                    ui.add_space(8.0);
                    egui::Frame::new()
                        .fill(alicia_color_panel_bg())
                        .stroke(egui::Stroke::new(
                            1.0,
                            alicia_color_terminal_green().gamma_multiply(0.4),
                        ))
                        .corner_radius(egui::CornerRadius::same(8))
                        .inner_margin(egui::Margin::same(10))
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.label(
                                    egui::RichText::new(">")
                                        .monospace()
                                        .strong()
                                        .color(alicia_color_terminal_green()),
                                );
                                let response = ui.add(
                                    egui::TextEdit::multiline(
                                        &mut self.terminal_input_buffer,
                                    )
                                    .font(egui::TextStyle::Monospace)
                                    .desired_rows(2)
                                    .hint_text("Ask Alicia anything..."),
                                );

                                let enter_pressed =
                                    ui.input(|input| input.key_pressed(egui::Key::Enter));
                                let shift_pressed =
                                    ui.input(|input| input.modifiers.shift);

                                // Send button
                                let send_enabled =
                                    !self.terminal_input_buffer.trim().is_empty();
                                let send_button = egui::Button::new(
                                    egui::RichText::new("^")
                                        .monospace()
                                        .strong()
                                        .color(if send_enabled {
                                            alicia_color_terminal_bg()
                                        } else {
                                            alicia_color_terminal_comment()
                                        }),
                                )
                                .fill(if send_enabled {
                                    alicia_color_terminal_green()
                                } else {
                                    alicia_color_highlight_bg()
                                })
                                .corner_radius(egui::CornerRadius::same(6));

                                let mut should_send = ui.add(send_button).clicked();
                                if response.has_focus()
                                    && enter_pressed
                                    && !shift_pressed
                                {
                                    should_send = true;
                                }
                                if should_send {
                                    self.send_input(store);
                                }
                            });
                            ui.add_space(4.0);
                            ui.horizontal(|ui| {
                                render_kbd(ui, "Enter");
                                ui.label(
                                    egui::RichText::new("send")
                                        .small()
                                        .monospace()
                                        .color(alicia_color_terminal_comment()),
                                );
                                ui.add_space(6.0);
                                render_kbd(ui, "Shift+Enter");
                                ui.label(
                                    egui::RichText::new("newline")
                                        .small()
                                        .monospace()
                                        .color(alicia_color_terminal_comment()),
                                );
                                ui.add_space(6.0);
                                render_kbd(ui, "/");
                                ui.label(
                                    egui::RichText::new("commands")
                                        .small()
                                        .monospace()
                                        .color(alicia_color_terminal_comment()),
                                );
                            });
                        });
                });
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
                    self.status_message = Some(error.beginner_message());
                }
            }
        }

        for (action_id, file_path, hunk_id, decision) in requested_hunk_decisions {
            match store.set_patch_hunk_decision(&action_id, &file_path, &hunk_id, decision) {
                Ok(()) => {
                    self.status_message = Some(format!(
                        "Bloco {} ({}) atualizado para {}.",
                        hunk_id,
                        file_path,
                        patch_hunk_decision_name(decision)
                    ));
                }
                Err(error) => {
                    self.status_message = Some(error.beginner_message());
                }
            }
        }

        if store.has_running_sessions() {
            ctx.request_repaint_after(Duration::from_millis(33));
        }

        emitted_messages
    }

    fn render_boot_screen(&mut self, ctx: &egui::Context) -> bool {
        let started_at = self.boot_started_at.get_or_insert_with(Instant::now);
        let elapsed_ms = started_at.elapsed().as_secs_f32() * 1_000.0;
        let progress = (elapsed_ms / ALICIA_BOOT_DURATION_MS).clamp(0.0, 1.0);

        if progress >= 1.0 {
            self.boot_completed = true;
            return false;
        }

        egui::CentralPanel::default().show(ctx, |ui| {
            egui::Frame::new()
                .fill(alicia_color_terminal_bg())
                .inner_margin(egui::Margin::same(20))
                .show(ui, |ui| {
                    // Top bar replica
                    ui.horizontal(|ui| {
                        ui.label(
                            egui::RichText::new("\u{25CF}")
                                .color(alicia_color_terminal_red()),
                        );
                        ui.label(
                            egui::RichText::new("\u{25CF}")
                                .color(alicia_color_terminal_gold()),
                        );
                        ui.label(
                            egui::RichText::new("\u{25CF}")
                                .color(alicia_color_terminal_green()),
                        );
                    });

                    ui.add_space(24.0);

                    // ASCII Art
                    for line in ALICIA_ASCII_ART.lines() {
                        ui.label(
                            egui::RichText::new(line)
                                .monospace()
                                .color(alicia_color_terminal_green()),
                        );
                    }
                    ui.add_space(4.0);
                    ui.label(
                        egui::RichText::new(format!(
                            "  {ALICIA_UI_VERSION}  |  AI Terminal Agent"
                        ))
                        .monospace()
                        .color(alicia_color_terminal_comment()),
                    );

                    ui.add_space(20.0);

                    // Boot stages
                    for stage in BOOT_STAGES {
                        let done = progress >= stage.threshold;
                        let active = !done
                            && progress >= (stage.threshold - 0.12_f32).max(0.0);
                        ui.horizontal(|ui| {
                            let (indicator, color) = if done {
                                ("\u{2713}", alicia_color_terminal_green())
                            } else if active {
                                ("~", alicia_color_terminal_gold())
                            } else {
                                (".", alicia_color_terminal_comment())
                            };
                            ui.label(
                                egui::RichText::new(indicator)
                                    .monospace()
                                    .color(color),
                            );
                            ui.label(
                                egui::RichText::new(stage.label)
                                    .monospace()
                                    .color(if done || active {
                                        alicia_color_terminal_fg()
                                    } else {
                                        alicia_color_terminal_comment()
                                    }),
                            );
                            if done || active {
                                ui.label(
                                    egui::RichText::new(stage.detail)
                                        .monospace()
                                        .small()
                                        .color(alicia_color_terminal_comment()),
                                );
                            }
                        });
                    }

                    ui.add_space(18.0);
                    ui.add(
                        egui::ProgressBar::new(progress)
                            .desired_width(400.0)
                            .fill(alicia_color_terminal_green())
                            .text(format!("{:.0}%", progress * 100.0)),
                    );
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        ui.label(
                            egui::RichText::new("PID: 48291")
                                .monospace()
                                .small()
                                .color(alicia_color_terminal_comment()),
                        );
                        ui.separator();
                        ui.label(
                            egui::RichText::new("MEM: 42MB")
                                .monospace()
                                .small()
                                .color(alicia_color_terminal_comment()),
                        );
                        ui.separator();
                        ui.label(
                            egui::RichText::new("rustc 1.82.0")
                                .monospace()
                                .small()
                                .color(alicia_color_terminal_comment()),
                        );
                    });
                });
        });

        ctx.request_repaint_after(Duration::from_millis(16));
        true
    }

    fn apply_theme(&self, ctx: &egui::Context) {
        let mut visuals = egui::Visuals::dark();
        visuals.panel_fill = alicia_color_panel_bg();
        visuals.extreme_bg_color = alicia_color_terminal_bg();
        visuals.faint_bg_color = alicia_color_highlight_bg();
        visuals.window_fill = alicia_color_panel_bg();
        visuals.window_stroke = egui::Stroke::new(1.0, alicia_color_border());
        visuals.widgets.noninteractive.bg_fill = alicia_color_panel_bg();
        visuals.widgets.inactive.bg_fill = alicia_color_panel_bg();
        visuals.widgets.hovered.bg_fill = alicia_color_highlight_bg();
        visuals.widgets.active.bg_fill = alicia_color_highlight_bg();
        visuals.widgets.inactive.fg_stroke.color = alicia_color_terminal_fg();
        visuals.widgets.hovered.fg_stroke.color = alicia_color_terminal_fg();
        visuals.widgets.active.fg_stroke.color = alicia_color_terminal_fg();
        visuals.selection.bg_fill = alicia_color_terminal_cyan();
        visuals.selection.stroke = egui::Stroke::new(1.0, alicia_color_terminal_bg());
        ctx.set_visuals(visuals);
    }

    fn send_input(&mut self, store: &UiEventStore) {
        if self.terminal_input_buffer.trim().is_empty() {
            return;
        }

        let mut payload = self.terminal_input_buffer.trim_end().as_bytes().to_vec();
        payload.push(b'\n');
        match store.send_input_to_active_session(payload) {
            Ok(()) => {
                self.terminal_input_buffer.clear();
                self.status_message = Some(String::from("Input enviado para a sessão."));
            }
            Err(error) => {
                self.status_message = Some(error.beginner_message());
            }
        }
    }
}

fn timeline_sender_style(summary: &str) -> (&'static str, egui::Color32) {
    if summary.starts_with("command_output_chunk") {
        return ("Alicia", alicia_color_terminal_green());
    }
    if summary.starts_with("approval_") || summary.starts_with("action_") {
        return ("Policy", alicia_color_terminal_gold());
    }
    if summary.starts_with("patch_") {
        return ("Diff", alicia_color_terminal_blue());
    }
    if summary.starts_with("audit") {
        return ("Audit", alicia_color_terminal_purple());
    }
    ("System", alicia_color_terminal_comment())
}

fn collect_changed_files(unapplied_previews: &[PatchPreviewState]) -> Vec<String> {
    let mut files = Vec::new();
    for preview in unapplied_previews {
        for file in &preview.files {
            if !files.iter().any(|existing| existing == file) {
                files.push(file.clone());
            }
        }
    }
    files
}

// ─── New helper rendering functions for React-faithful UI ───

fn render_badge(ui: &mut egui::Ui, text: &str, color: egui::Color32) {
    egui::Frame::new()
        .fill(color.gamma_multiply(0.1))
        .stroke(egui::Stroke::new(1.0, color.gamma_multiply(0.3)))
        .corner_radius(egui::CornerRadius::same(10))
        .inner_margin(egui::Margin::symmetric(8, 3))
        .show(ui, |ui| {
            ui.label(
                egui::RichText::new(text)
                    .monospace()
                    .small()
                    .color(color),
            );
        });
}

fn render_kbd(ui: &mut egui::Ui, text: &str) {
    egui::Frame::new()
        .fill(alicia_color_highlight_bg())
        .stroke(egui::Stroke::new(1.0, alicia_color_border()))
        .corner_radius(egui::CornerRadius::same(4))
        .inner_margin(egui::Margin::symmetric(4, 1))
        .show(ui, |ui| {
            ui.label(
                egui::RichText::new(text)
                    .monospace()
                    .small()
                    .color(alicia_color_terminal_comment()),
            );
        });
}

fn render_demo_project_info(ui: &mut egui::Ui) {
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("~")
                .monospace()
                .color(alicia_color_terminal_purple()),
        );
        ui.label(
            egui::RichText::new("main")
                .monospace()
                .small()
                .color(alicia_color_terminal_fg()),
        );
        ui.label(
            egui::RichText::new("+3")
                .small()
                .monospace()
                .color(alicia_color_terminal_green()),
        );
        ui.label(
            egui::RichText::new("-1")
                .small()
                .monospace()
                .color(alicia_color_terminal_red()),
        );
    });
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("*")
                .monospace()
                .color(alicia_color_terminal_comment()),
        );
        ui.label(
            egui::RichText::new("Rust + Cargo")
                .monospace()
                .small()
                .color(alicia_color_terminal_fg()),
        );
    });
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("@")
                .monospace()
                .color(alicia_color_terminal_comment()),
        );
        ui.label(
            egui::RichText::new("Session: 4m 32s")
                .monospace()
                .small()
                .color(alicia_color_terminal_fg()),
        );
    });
}

fn render_chat_message(ui: &mut egui::Ui, msg: &DemoChatMessage) {
    let (role_text, role_color, icon) = match msg.role {
        DemoMessageRole::System => ("system", alicia_color_terminal_purple(), ">_"),
        DemoMessageRole::User => ("you", alicia_color_terminal_blue(), "U"),
        DemoMessageRole::Agent => ("alicia", alicia_color_terminal_green(), "[A]"),
    };

    egui::Frame::new()
        .fill(alicia_color_panel_bg())
        .corner_radius(egui::CornerRadius::same(6))
        .inner_margin(egui::Margin::symmetric(12, 8))
        .show(ui, |ui| {
            // Header: avatar, role, timestamp
            ui.horizontal(|ui| {
                egui::Frame::new()
                    .fill(role_color.gamma_multiply(0.15))
                    .corner_radius(egui::CornerRadius::same(4))
                    .inner_margin(egui::Margin::same(4))
                    .show(ui, |ui| {
                        ui.label(
                            egui::RichText::new(icon)
                                .monospace()
                                .small()
                                .color(role_color),
                        );
                    });
                ui.label(
                    egui::RichText::new(role_text)
                        .monospace()
                        .strong()
                        .color(role_color),
                );
                ui.label(
                    egui::RichText::new(msg.timestamp)
                        .monospace()
                        .small()
                        .color(alicia_color_terminal_comment()),
                );
            });

            ui.add_space(4.0);

            // Content
            ui.label(
                egui::RichText::new(msg.content)
                    .monospace()
                    .color(alicia_color_terminal_fg()),
            );

            // Tool calls
            if !msg.tool_calls.is_empty() {
                ui.add_space(6.0);
                egui::Frame::new()
                    .fill(alicia_color_highlight_bg())
                    .stroke(egui::Stroke::new(1.0, alicia_color_border()))
                    .corner_radius(egui::CornerRadius::same(6))
                    .inner_margin(egui::Margin::symmetric(10, 6))
                    .show(ui, |ui| {
                        for tool in &msg.tool_calls {
                            ui.horizontal(|ui| {
                                ui.label(
                                    egui::RichText::new(tool.icon)
                                        .monospace()
                                        .color(alicia_color_terminal_comment()),
                                );
                                ui.label(
                                    egui::RichText::new(format!(
                                        "{}: {}",
                                        tool.name, tool.detail
                                    ))
                                    .monospace()
                                    .small()
                                    .color(alicia_color_terminal_fg()),
                                );
                                ui.with_layout(
                                    egui::Layout::right_to_left(egui::Align::Center),
                                    |ui| {
                                        ui.label(
                                            egui::RichText::new("\u{2713}")
                                                .monospace()
                                                .color(alicia_color_terminal_green()),
                                        );
                                    },
                                );
                            });
                        }
                    });
            }

            // Code blocks
            for block in &msg.code_blocks {
                ui.add_space(6.0);
                render_demo_code_block(ui, block);
            }

            // Diff
            if let Some(diff) = &msg.diff {
                ui.add_space(6.0);
                render_demo_diff_block(ui, diff);
            }
        });
    ui.add_space(6.0);
}

fn render_demo_code_block(ui: &mut egui::Ui, block: &DemoCodeBlock) {
    egui::Frame::new()
        .fill(alicia_color_highlight_bg())
        .stroke(egui::Stroke::new(1.0, alicia_color_border()))
        .corner_radius(egui::CornerRadius::same(6))
        .inner_margin(egui::Margin::same(0))
        .show(ui, |ui| {
            // Header
            egui::Frame::new()
                .fill(alicia_color_panel_bg())
                .inner_margin(egui::Margin::symmetric(10, 6))
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(
                            egui::RichText::new(block.filename)
                                .monospace()
                                .small()
                                .color(alicia_color_terminal_fg()),
                        );
                        ui.with_layout(
                            egui::Layout::right_to_left(egui::Align::Center),
                            |ui| {
                                render_badge(ui, block.language, alicia_color_terminal_cyan());
                            },
                        );
                    });
                });
            // Code content with line numbers
            egui::Frame::new()
                .inner_margin(egui::Margin::symmetric(10, 8))
                .show(ui, |ui| {
                    for (i, line) in block.content.lines().enumerate() {
                        ui.horizontal(|ui| {
                            ui.label(
                                egui::RichText::new(format!("{:>3}", i + 1))
                                    .monospace()
                                    .small()
                                    .color(alicia_color_terminal_comment()),
                            );
                            ui.add_space(8.0);
                            render_syntax_line(ui, line);
                        });
                    }
                });
        });
}

fn render_syntax_line(ui: &mut egui::Ui, line: &str) {
    let trimmed = line.trim();
    let color = if trimmed.starts_with("//") {
        alicia_color_terminal_comment()
    } else if trimmed.starts_with("use ")
        || trimmed.starts_with("pub ")
        || trimmed.starts_with("mod ")
    {
        alicia_color_terminal_purple()
    } else if trimmed.contains("fn ")
        || trimmed.contains("struct ")
        || trimmed.contains("impl ")
        || trimmed.contains("enum ")
    {
        alicia_color_terminal_blue()
    } else if trimmed.contains('"') {
        alicia_color_terminal_gold()
    } else {
        alicia_color_terminal_fg()
    };
    ui.label(
        egui::RichText::new(line)
            .monospace()
            .small()
            .color(color),
    );
}

fn render_demo_diff_block(ui: &mut egui::Ui, diff: &DemoDiff) {
    egui::Frame::new()
        .fill(alicia_color_highlight_bg())
        .stroke(egui::Stroke::new(1.0, alicia_color_border()))
        .corner_radius(egui::CornerRadius::same(6))
        .inner_margin(egui::Margin::same(0))
        .show(ui, |ui| {
            // Header
            egui::Frame::new()
                .fill(alicia_color_panel_bg())
                .inner_margin(egui::Margin::symmetric(10, 6))
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(
                            egui::RichText::new(diff.filename)
                                .monospace()
                                .small()
                                .color(alicia_color_terminal_cyan()),
                        );
                        ui.label(
                            egui::RichText::new(format!("+{}", diff.added))
                                .small()
                                .monospace()
                                .color(alicia_color_terminal_green()),
                        );
                        ui.label(
                            egui::RichText::new(format!("/ -{}", diff.removed))
                                .small()
                                .monospace()
                                .color(alicia_color_terminal_red()),
                        );
                        ui.with_layout(
                            egui::Layout::right_to_left(egui::Align::Center),
                            |ui| {
                                let _ = ui.button(
                                    egui::RichText::new("Reject")
                                        .monospace()
                                        .small()
                                        .color(alicia_color_terminal_red()),
                                );
                                let _ = ui.button(
                                    egui::RichText::new("Apply")
                                        .monospace()
                                        .small()
                                        .color(alicia_color_terminal_green()),
                                );
                            },
                        );
                    });
                });
            // Diff lines
            egui::Frame::new()
                .inner_margin(egui::Margin::symmetric(10, 6))
                .show(ui, |ui| {
                    for line in &diff.lines {
                        ui.horizontal(|ui| {
                            if let Some(num) = line.line_number {
                                ui.label(
                                    egui::RichText::new(format!("{num:>3}"))
                                        .monospace()
                                        .small()
                                        .color(alicia_color_terminal_comment()),
                                );
                            } else {
                                ui.label(
                                    egui::RichText::new("   ")
                                        .monospace()
                                        .small(),
                                );
                            }
                            ui.add_space(4.0);
                            let (indicator, color) = match line.line_type {
                                DemoDiffLineType::Add => {
                                    ("+", alicia_color_terminal_green())
                                }
                                DemoDiffLineType::Remove => {
                                    ("-", alicia_color_terminal_red())
                                }
                                DemoDiffLineType::Context => {
                                    (" ", alicia_color_terminal_comment())
                                }
                            };
                            ui.label(
                                egui::RichText::new(indicator)
                                    .monospace()
                                    .small()
                                    .color(color),
                            );
                            ui.label(
                                egui::RichText::new(line.content)
                                    .monospace()
                                    .small()
                                    .color(color),
                            );
                        });
                    }
                });
        });
}

fn build_demo_messages() -> Vec<DemoChatMessage> {
    vec![
        DemoChatMessage {
            role: DemoMessageRole::System,
            content: "Alicia v0.1.0-alpha initialized. Working directory: ~/projects/my-app\nSandbox mode enabled. Model: gpt-4o-mini",
            timestamp: "09:41:02",
            tool_calls: vec![],
            code_blocks: vec![],
            diff: None,
        },
        DemoChatMessage {
            role: DemoMessageRole::User,
            content: "Refactor the authentication handler to use JWT tokens instead of session cookies. Make sure to handle token refresh.",
            timestamp: "09:41:15",
            tool_calls: vec![],
            code_blocks: vec![],
            diff: None,
        },
        DemoChatMessage {
            role: DemoMessageRole::Agent,
            content: "I'll refactor the authentication system to use JWT tokens. Let me first analyze the current codebase to understand the existing auth implementation.",
            timestamp: "09:41:16",
            tool_calls: vec![
                DemoToolCall { icon: "Q", name: "Search", detail: "auth handler src/auth/" },
                DemoToolCall { icon: ">_", name: "Read", detail: "src/auth/handler.rs" },
                DemoToolCall { icon: ">_", name: "Read", detail: "src/auth/middleware.rs" },
                DemoToolCall { icon: "Q", name: "Search", detail: "session references 12 files found" },
            ],
            code_blocks: vec![],
            diff: None,
        },
        DemoChatMessage {
            role: DemoMessageRole::Agent,
            content: "I've analyzed the codebase. Here's the new JWT token implementation:",
            timestamp: "09:41:22",
            tool_calls: vec![],
            code_blocks: vec![DemoCodeBlock {
                language: "rust",
                filename: "src/auth/token.rs",
                content: "use jsonwebtoken::{encode, decode, Header, Validation};\nuse serde::{Deserialize, Serialize};\nuse chrono::{Utc, Duration};\n\n#[derive(Debug, Serialize, Deserialize)]\npub struct Claims {\n    pub sub: String,\n    pub exp: usize,\n    pub iat: usize,\n}\n\npub fn create_token(user_id: &str) -> Result<String, AuthError> {\n    let now = Utc::now();\n    let claims = Claims {\n        sub: user_id.to_string(),\n        exp: (now + Duration::hours(24)).timestamp() as usize,\n        iat: now.timestamp() as usize,\n    };\n    encode(\n        &Header::default(),\n        &claims,\n        &EncodingKey::from_secret(get_secret().as_ref()),\n    )\n    .map_err(|e| AuthError::TokenCreation(e.to_string()))\n}",
            }],
            diff: None,
        },
        DemoChatMessage {
            role: DemoMessageRole::Agent,
            content: "Now updating the middleware to validate JWT tokens on each request:",
            timestamp: "09:41:28",
            tool_calls: vec![],
            code_blocks: vec![],
            diff: Some(DemoDiff {
                filename: "src/auth/middleware.rs",
                added: 7,
                removed: 3,
                lines: vec![
                    DemoDiffLine { line_type: DemoDiffLineType::Context, content: "  use actix_web::{HttpRequest, HttpResponse};", line_number: Some(1) },
                    DemoDiffLine { line_type: DemoDiffLineType::Remove, content: "  use crate::session::SessionStore;", line_number: Some(2) },
                    DemoDiffLine { line_type: DemoDiffLineType::Add, content: "  use crate::auth::token::{verify_token, Claims};", line_number: Some(2) },
                    DemoDiffLine { line_type: DemoDiffLineType::Add, content: "  use actix_web::HttpMessage;", line_number: Some(3) },
                    DemoDiffLine { line_type: DemoDiffLineType::Context, content: "", line_number: Some(4) },
                    DemoDiffLine { line_type: DemoDiffLineType::Context, content: "  pub async fn auth_middleware(", line_number: Some(5) },
                    DemoDiffLine { line_type: DemoDiffLineType::Context, content: "      req: HttpRequest,", line_number: Some(6) },
                    DemoDiffLine { line_type: DemoDiffLineType::Remove, content: "      session: SessionStore,", line_number: Some(7) },
                    DemoDiffLine { line_type: DemoDiffLineType::Add, content: "  ) -> Result<HttpResponse, AuthError> {", line_number: Some(7) },
                    DemoDiffLine { line_type: DemoDiffLineType::Remove, content: "      let session_id = req.cookie(\"session_id\")", line_number: Some(8) },
                    DemoDiffLine { line_type: DemoDiffLineType::Add, content: "      let token = req.headers()", line_number: Some(8) },
                    DemoDiffLine { line_type: DemoDiffLineType::Add, content: "          .get(\"Authorization\")", line_number: Some(9) },
                    DemoDiffLine { line_type: DemoDiffLineType::Add, content: "          .and_then(|v| v.to_str().ok())", line_number: Some(10) },
                    DemoDiffLine { line_type: DemoDiffLineType::Add, content: "          .and_then(|v| v.strip_prefix(\"Bearer \"))", line_number: Some(11) },
                    DemoDiffLine { line_type: DemoDiffLineType::Add, content: "          .ok_or(AuthError::MissingToken)?;", line_number: Some(12) },
                    DemoDiffLine { line_type: DemoDiffLineType::Add, content: "      let claims = verify_token(token)?;", line_number: Some(13) },
                    DemoDiffLine { line_type: DemoDiffLineType::Add, content: "      req.extensions_mut().insert(claims);", line_number: Some(14) },
                ],
            }),
        },
    ]
}

fn alicia_color_terminal_bg() -> egui::Color32 {
    egui::Color32::from_rgb(13, 17, 23)
}

fn alicia_color_sidebar_bg() -> egui::Color32 {
    egui::Color32::from_rgb(16, 22, 28)
}

fn alicia_color_panel_bg() -> egui::Color32 {
    egui::Color32::from_rgb(21, 27, 35)
}

fn alicia_color_highlight_bg() -> egui::Color32 {
    egui::Color32::from_rgb(26, 34, 44)
}

fn alicia_color_border() -> egui::Color32 {
    egui::Color32::from_rgb(47, 64, 83)
}

fn alicia_color_terminal_fg() -> egui::Color32 {
    egui::Color32::from_rgb(230, 237, 243)
}

fn alicia_color_terminal_comment() -> egui::Color32 {
    egui::Color32::from_rgb(118, 131, 149)
}

fn alicia_color_terminal_green() -> egui::Color32 {
    egui::Color32::from_rgb(63, 185, 80)
}

fn alicia_color_terminal_blue() -> egui::Color32 {
    egui::Color32::from_rgb(88, 166, 255)
}

fn alicia_color_terminal_gold() -> egui::Color32 {
    egui::Color32::from_rgb(210, 153, 34)
}

fn alicia_color_terminal_purple() -> egui::Color32 {
    egui::Color32::from_rgb(188, 140, 255)
}

fn alicia_color_terminal_red() -> egui::Color32 {
    egui::Color32::from_rgb(248, 81, 73)
}

fn alicia_color_terminal_cyan() -> egui::Color32 {
    egui::Color32::from_rgb(86, 211, 194)
}

fn command_target(program: &str, args: &[String], audit_target: &str) -> String {
    if audit_target.is_empty() {
        command_tokens(program, args).join(" ")
    } else {
        audit_target.to_string()
    }
}

fn command_tokens(program: &str, args: &[String]) -> Vec<String> {
    let mut command = Vec::with_capacity(args.len() + 1);
    command.push(program.to_string());
    command.extend(args.iter().cloned());
    command
}

fn selected_approval_decision(
    requested_decision: ApprovalDecision,
    store_decision: Option<ApprovalDecision>,
) -> ApprovalDecision {
    if let Some(store_decision) = store_decision {
        store_decision
    } else {
        requested_decision
    }
}

fn combine_policy_decisions(
    exec_decision: PolicyDecision,
    network_decision: PolicyDecision,
) -> PolicyDecision {
    match (exec_decision, network_decision) {
        (PolicyDecision::Deny, _) | (_, PolicyDecision::Deny) => PolicyDecision::Deny,
        (PolicyDecision::RequireApproval, _) | (_, PolicyDecision::RequireApproval) => {
            PolicyDecision::RequireApproval
        }
        (PolicyDecision::Allow, PolicyDecision::Allow) => PolicyDecision::Allow,
    }
}

fn effective_approval_decision(
    policy_decision: PolicyDecision,
    requested_approval_decision: ApprovalDecision,
) -> ApprovalDecision {
    match policy_decision {
        PolicyDecision::Allow | PolicyDecision::Deny => ApprovalDecision::NotRequired,
        PolicyDecision::RequireApproval => requested_approval_decision,
    }
}

fn blocked_reason(
    policy_decision: PolicyDecision,
    approval_decision: ApprovalDecision,
) -> Option<String> {
    match policy_decision {
        PolicyDecision::Allow => None,
        PolicyDecision::Deny => Some(String::from("policy decision is deny")),
        PolicyDecision::RequireApproval => match approval_decision {
            ApprovalDecision::Approved => None,
            ApprovalDecision::NotRequired => Some(String::from(
                "approval required but no explicit decision was provided",
            )),
            ApprovalDecision::Denied => {
                Some(String::from("approval required and was explicitly denied"))
            }
            ApprovalDecision::Expired => {
                Some(String::from("approval required but the decision expired"))
            }
        },
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

fn patch_hunk_decision_name(decision: PatchHunkDecision) -> &'static str {
    match decision {
        PatchHunkDecision::Pending => "pending",
        PatchHunkDecision::Approved => "approved",
        PatchHunkDecision::Rejected => "rejected",
    }
}

fn parse_hunk_range(raw: &str, prefix: char) -> Option<(usize, usize)> {
    let raw = raw.strip_prefix(prefix)?;
    let mut parts = raw.split(',');
    let start = parts.next()?.parse::<usize>().ok()?;
    let count = parts
        .next()
        .map_or(Some(1_usize), |value| value.parse::<usize>().ok())?;
    Some((start, count))
}

fn parse_unified_diff_hunks(unified_diff: &str) -> Vec<PatchHunkPreview> {
    let mut hunks = Vec::new();
    let mut current_hunk: Option<PatchHunkPreview> = None;
    let mut hunk_index = 0_usize;

    for line in unified_diff.lines() {
        if line.starts_with("@@") {
            if let Some(previous) = current_hunk.take() {
                hunks.push(previous);
            }

            let mut parts = line.split_whitespace();
            if parts.next() != Some("@@") {
                continue;
            }

            let Some(old_range) = parts.next() else {
                continue;
            };
            let Some(new_range) = parts.next() else {
                continue;
            };

            let Some((old_start, old_count)) = parse_hunk_range(old_range, '-') else {
                continue;
            };
            let Some((new_start, new_count)) = parse_hunk_range(new_range, '+') else {
                continue;
            };

            hunk_index = hunk_index.saturating_add(1);
            current_hunk = Some(PatchHunkPreview {
                hunk_id: format!("hunk-{hunk_index}"),
                header: line.to_string(),
                old_start,
                old_count,
                new_start,
                new_count,
                added_lines: 0,
                removed_lines: 0,
                decision: PatchHunkDecision::Pending,
            });
            continue;
        }

        if let Some(current_hunk) = current_hunk.as_mut() {
            if line.starts_with('+') && !line.starts_with("+++") {
                current_hunk.added_lines = current_hunk.added_lines.saturating_add(1);
                continue;
            }
            if line.starts_with('-') && !line.starts_with("---") {
                current_hunk.removed_lines = current_hunk.removed_lines.saturating_add(1);
            }
        }
    }

    if let Some(previous) = current_hunk.take() {
        hunks.push(previous);
    }

    hunks
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::Duration;

    use codex_alicia_core::ActionKind;
    use codex_alicia_core::ApprovalDecision;
    use codex_alicia_core::IpcEvent;
    use codex_alicia_core::IpcMessage;
    use codex_alicia_core::PermissionProfile;
    use codex_alicia_core::PolicyDecision;
    use codex_alicia_core::ResultStatus;
    use codex_alicia_core::SessionManager;
    use codex_alicia_core::SessionManagerError;
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
    use super::AliciaUiRuntimeError;
    use super::ApprovalPrompt;
    use super::ApprovalStatus;
    use super::CommandLifecycle;
    use super::PatchHunkDecision;
    use super::UiEventStore;
    use super::UiEventStoreError;

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

    fn inherited_env() -> HashMap<String, String> {
        std::env::vars().collect()
    }

    fn sample_unified_diff() -> &'static str {
        "@@ -1,2 +1,3 @@\n-line_1\n+line_1_new\n line_2\n+line_3\n@@ -10,1 +11,2 @@\n-old_tail\n+new_tail_a\n+new_tail_b\n"
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
    fn resolved_approval_decision_for_command_reads_approval_state() {
        let mut store = UiEventStore::default();
        let command = vec!["cargo".to_string(), "test".to_string()];

        store.push(IpcMessage::new(IpcEvent::ActionProposed(ActionProposed {
            action_id: "act-command".to_string(),
            action_kind: ActionKind::ExecuteCommand,
            target: "cargo test".to_string(),
        })));
        store.attach_approval_command("act-command", command.clone());
        store.push(IpcMessage::new(IpcEvent::ApprovalRequested(
            ApprovalRequested {
                action_id: "act-command".to_string(),
                summary: "Executar comando".to_string(),
                expires_at_unix_s: 1_735_689_600,
            },
        )));

        assert_eq!(store.resolved_approval_decision_for_command(&command), None);

        let approve_result = store.approve("act-command");
        assert!(approve_result.is_ok());
        assert_eq!(
            store.resolved_approval_decision_for_command(&command),
            Some(ApprovalDecision::Approved)
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
    fn loads_patch_hunks_and_tracks_impact_per_hunk() {
        let mut store = UiEventStore::default();
        store.push(IpcMessage::new(IpcEvent::PatchPreviewReady(
            PatchPreviewReady {
                action_id: "act-hunks".to_string(),
                files: vec!["src/main.rs".to_string()],
            },
        )));

        let load_result =
            store.attach_patch_file_diff("act-hunks", "src/main.rs", sample_unified_diff());
        assert_eq!(load_result, Ok(2));

        let unresolved_count = store.unresolved_patch_hunk_count("act-hunks");
        assert_eq!(unresolved_count, Some(2));

        let preview = store.diff_preview("act-hunks");
        let Some(preview) = preview else {
            panic!("expected patch preview");
        };
        assert_eq!(preview.file_previews.len(), 1);
        let file_preview = &preview.file_previews[0];
        assert_eq!(file_preview.file_path, "src/main.rs");
        assert_eq!(file_preview.hunks.len(), 2);
        assert_eq!(file_preview.hunks[0].added_lines, 2);
        assert_eq!(file_preview.hunks[0].removed_lines, 1);
        assert_eq!(file_preview.hunks[1].added_lines, 2);
        assert_eq!(file_preview.hunks[1].removed_lines, 1);

        assert!(
            store
                .timeline()
                .iter()
                .any(|entry| entry.summary.contains("patch_hunks_loaded act-hunks")),
            "expected timeline to register loaded hunks"
        );
    }

    #[test]
    fn allows_approving_and_rejecting_hunks_individually() {
        let mut store = UiEventStore::default();
        store.push(IpcMessage::new(IpcEvent::PatchPreviewReady(
            PatchPreviewReady {
                action_id: "act-granular".to_string(),
                files: vec!["src/main.rs".to_string()],
            },
        )));
        let load_result =
            store.attach_patch_file_diff("act-granular", "src/main.rs", sample_unified_diff());
        assert_eq!(load_result, Ok(2));

        let approve_result = store.approve_patch_hunk("act-granular", "src/main.rs", "hunk-1");
        assert_eq!(approve_result, Ok(()));
        let reject_result = store.reject_patch_hunk("act-granular", "src/main.rs", "hunk-2");
        assert_eq!(reject_result, Ok(()));

        assert_eq!(store.unresolved_patch_hunk_count("act-granular"), Some(0));

        let preview = store.diff_preview("act-granular");
        let Some(preview) = preview else {
            panic!("expected patch preview");
        };
        let file_preview = &preview.file_previews[0];
        assert_eq!(file_preview.hunks[0].decision, PatchHunkDecision::Approved);
        assert_eq!(file_preview.hunks[1].decision, PatchHunkDecision::Rejected);

        assert!(
            store.timeline().iter().any(|entry| entry.summary.contains(
                "patch_hunk_decision act-granular file=src/main.rs hunk=hunk-1 decision=approved"
            )),
            "expected approved hunk decision in timeline"
        );
        assert!(
            store.timeline().iter().any(|entry| entry.summary.contains(
                "patch_hunk_decision act-granular file=src/main.rs hunk=hunk-2 decision=rejected"
            )),
            "expected rejected hunk decision in timeline"
        );
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

    #[test]
    fn store_errors_include_clear_next_step_message() {
        let errors = vec![
            UiEventStoreError::SessionNotFound("sess-missing".to_string()),
            UiEventStoreError::SessionInputNotBound("sess-not-bound".to_string()),
            UiEventStoreError::SessionInputSendFailed {
                session_id: "sess-send".to_string(),
                reason: "channel closed".to_string(),
            },
            UiEventStoreError::ApprovalNotPending("act-ready".to_string()),
        ];

        for error in errors {
            let message = error.beginner_message();
            assert!(
                message.contains("Proximo passo:"),
                "expected beginner guidance in message: {message}"
            );
            assert!(
                !message.contains('`'),
                "message should avoid technical formatting: {message}"
            );
        }
    }

    #[test]
    fn runtime_errors_include_clear_next_step_message() {
        let errors = vec![
            AliciaUiRuntimeError::SessionManager(SessionManagerError::SessionNotFound(
                "sess-runtime".to_string(),
            )),
            AliciaUiRuntimeError::ResolveProfileFailed {
                workspace: "workspace".to_string(),
                source: codex_alicia_core::ProjectPolicyConfigError::ReadFailed {
                    path: ".codex/alicia-policy.toml".to_string(),
                    source: std::io::Error::other("missing file"),
                },
            },
            AliciaUiRuntimeError::WorkspaceGuardBlocked {
                session_id: "sess-workspace".to_string(),
                cwd: "../outside".to_string(),
                source: codex_alicia_core::PolicyBridgeError::TargetOutsideWorkspace {
                    workspace: "/repo".to_string(),
                    target: "/outside".to_string(),
                },
            },
            AliciaUiRuntimeError::CommandBlocked {
                session_id: "sess-blocked".to_string(),
                reason: "approval required".to_string(),
            },
            AliciaUiRuntimeError::SessionStopTimeout {
                session_id: "sess-timeout".to_string(),
            },
            AliciaUiRuntimeError::AuditWriteFailed {
                session_id: "sess-audit".to_string(),
                source: std::io::Error::other("disk full"),
            },
        ];

        for error in errors {
            let message = error.beginner_message();
            assert!(
                message.contains("Proximo passo:"),
                "expected beginner guidance in message: {message}"
            );
            assert!(
                !message.contains('`'),
                "message should avoid technical formatting: {message}"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runtime_blocks_command_without_explicit_approval_in_read_write_profile() {
        let session_manager = SessionManager::new();
        let mut runtime = AliciaUiRuntime::new(session_manager, 128);
        runtime
            .store_mut()
            .set_permission_profile(PermissionProfile::ReadWriteWithApproval);

        let (program, args) = shell_echo_command("blocked-by-approval");
        let session_id = "sess-blocked-approval";
        let request = SessionStartRequest::new(
            session_id,
            program,
            args,
            PathBuf::from("."),
            inherited_env(),
        )
        .with_mode(SessionMode::Pipe);

        let result = runtime.start_session(request).await;
        assert!(matches!(
            result,
            Err(AliciaUiRuntimeError::CommandBlocked { .. })
        ));
        assert!(!runtime.session_manager().is_active(session_id).await);

        let blocked_record = runtime
            .store()
            .audit_records()
            .iter()
            .find(|record| record.session_id == session_id);
        let Some(blocked_record) = blocked_record else {
            panic!("expected blocked audit record");
        };
        assert_eq!(
            blocked_record.policy_decision,
            PolicyDecision::RequireApproval
        );
        assert_eq!(
            blocked_record.approval_decision,
            ApprovalDecision::NotRequired
        );
        assert_eq!(blocked_record.result_status, ResultStatus::Blocked);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runtime_blocks_command_with_denied_approval_in_read_write_profile() {
        let session_manager = SessionManager::new();
        let mut runtime = AliciaUiRuntime::new(session_manager, 128);
        runtime
            .store_mut()
            .set_permission_profile(PermissionProfile::ReadWriteWithApproval);

        let marker = "denied-by-policy";
        let (program, args) = shell_echo_command(marker);
        let mut command = vec![program.clone()];
        command.extend(args.clone());
        runtime
            .store_mut()
            .push(IpcMessage::new(IpcEvent::ActionProposed(ActionProposed {
                action_id: "act-denied-cmd".to_string(),
                action_kind: ActionKind::ExecuteCommand,
                target: command.join(" "),
            })));
        runtime
            .store_mut()
            .attach_approval_command("act-denied-cmd", command);
        runtime
            .store_mut()
            .push(IpcMessage::new(IpcEvent::ApprovalRequested(
                ApprovalRequested {
                    action_id: "act-denied-cmd".to_string(),
                    summary: "executar comando negado".to_string(),
                    expires_at_unix_s: 4_102_444_800,
                },
            )));
        let deny_result = runtime.store_mut().deny("act-denied-cmd");
        assert!(deny_result.is_ok(), "expected denial to resolve");

        let session_id = "sess-denied-approval";
        let request = SessionStartRequest::new(
            session_id,
            program,
            args,
            PathBuf::from("."),
            inherited_env(),
        )
        .with_mode(SessionMode::Pipe);
        let result = runtime.start_session(request).await;
        assert!(matches!(
            result,
            Err(AliciaUiRuntimeError::CommandBlocked { .. })
        ));

        let blocked_record = runtime
            .store()
            .audit_records()
            .iter()
            .find(|record| record.session_id == session_id);
        let Some(blocked_record) = blocked_record else {
            panic!("expected blocked audit record");
        };
        assert_eq!(
            blocked_record.policy_decision,
            PolicyDecision::RequireApproval
        );
        assert_eq!(blocked_record.approval_decision, ApprovalDecision::Denied);
        assert_eq!(blocked_record.result_status, ResultStatus::Blocked);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runtime_allows_command_with_resolved_approval_in_read_write_profile() {
        let session_manager = SessionManager::new();
        let mut runtime = AliciaUiRuntime::new(session_manager, 128);
        runtime
            .store_mut()
            .set_permission_profile(PermissionProfile::ReadWriteWithApproval);

        let marker = "approved-by-policy";
        let (program, args) = shell_echo_command(marker);
        let mut command = vec![program.clone()];
        command.extend(args.clone());
        runtime
            .store_mut()
            .push(IpcMessage::new(IpcEvent::ActionProposed(ActionProposed {
                action_id: "act-approved-cmd".to_string(),
                action_kind: ActionKind::ExecuteCommand,
                target: command.join(" "),
            })));
        runtime
            .store_mut()
            .attach_approval_command("act-approved-cmd", command);
        runtime
            .store_mut()
            .push(IpcMessage::new(IpcEvent::ApprovalRequested(
                ApprovalRequested {
                    action_id: "act-approved-cmd".to_string(),
                    summary: "executar comando aprovado".to_string(),
                    expires_at_unix_s: 4_102_444_800,
                },
            )));
        let approve_result = runtime.store_mut().approve("act-approved-cmd");
        assert!(approve_result.is_ok(), "expected approval to resolve");

        let request = SessionStartRequest::new(
            "sess-approved-approval",
            program,
            args,
            PathBuf::from("."),
            inherited_env(),
        )
        .with_mode(SessionMode::Pipe);

        if let Err(error) = runtime.start_session(request).await {
            panic!("expected approved execution to start: {error}");
        }

        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        let mut saw_marker = false;
        let mut finished_ok = false;
        while tokio::time::Instant::now() < deadline {
            runtime.pump_events();
            if let Some(text) = runtime.store().active_terminal_text()
                && text.contains(marker)
            {
                saw_marker = true;
            }
            if let Some(session) = runtime.store().terminal_session("sess-approved-approval")
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

        assert!(saw_marker, "expected approved command output marker");
        assert!(
            finished_ok,
            "expected approved command to finish successfully"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runtime_bridges_session_events_and_input() {
        let session_manager = SessionManager::new();
        let mut runtime = AliciaUiRuntime::new(session_manager, 128);
        runtime
            .store_mut()
            .set_permission_profile(PermissionProfile::FullAccess);
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
