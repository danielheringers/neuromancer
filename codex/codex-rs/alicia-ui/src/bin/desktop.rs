use std::collections::HashMap;
use std::path::PathBuf;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use clap::Parser;
use clap::ValueEnum;
use codex_alicia_core::AuditLogger;
use codex_alicia_core::PermissionProfile;
use codex_alicia_core::SessionAuditContext;
use codex_alicia_core::SessionManager;
use codex_alicia_core::SessionMode;
use codex_alicia_core::SessionStartRequest;
use codex_alicia_ui::AliciaEguiView;
use codex_alicia_ui::AliciaUiRuntime;
use codex_alicia_ui::CommandLifecycle;

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CliSessionMode {
    Auto,
    Pty,
    Pipe,
}

impl From<CliSessionMode> for SessionMode {
    fn from(value: CliSessionMode) -> Self {
        match value {
            CliSessionMode::Auto => SessionMode::Auto,
            CliSessionMode::Pty => SessionMode::Pty,
            CliSessionMode::Pipe => SessionMode::Pipe,
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CliPermissionProfile {
    ReadOnly,
    ReadWriteWithApproval,
    FullAccess,
}

impl From<CliPermissionProfile> for PermissionProfile {
    fn from(value: CliPermissionProfile) -> Self {
        match value {
            CliPermissionProfile::ReadOnly => PermissionProfile::ReadOnly,
            CliPermissionProfile::ReadWriteWithApproval => PermissionProfile::ReadWriteWithApproval,
            CliPermissionProfile::FullAccess => PermissionProfile::FullAccess,
        }
    }
}

#[derive(Debug, Parser)]
#[command(
    name = "codex-alicia-ui-desktop",
    about = "Abre a interface desktop local da AlicIA."
)]
struct AliciaDesktopCli {
    /// Titulo da janela.
    #[arg(long, default_value = "AlicIA Desktop")]
    title: String,

    /// Identificador da sessao opcional iniciada automaticamente.
    #[arg(long, default_value = "alicia-local")]
    session_id: String,

    /// Diretorio de trabalho para a sessao inicial.
    #[arg(long)]
    cwd: Option<PathBuf>,

    /// Modo da sessao inicial (auto/pty/pipe).
    #[arg(long, value_enum, default_value_t = CliSessionMode::Auto)]
    mode: CliSessionMode,

    /// Caminho opcional para persistencia de auditoria JSONL.
    #[arg(long)]
    audit_path: Option<PathBuf>,

    /// Perfil de permissao inicial aplicado ao runtime.
    #[arg(long, value_enum, default_value_t = CliPermissionProfile::ReadWriteWithApproval)]
    profile: CliPermissionProfile,

    /// Comando opcional para iniciar uma sessao automaticamente apos `--`.
    #[arg(trailing_var_arg = true)]
    command: Vec<String>,
}

struct AliciaDesktopApp {
    runtime: AliciaUiRuntime,
    view: AliciaEguiView,
    tokio_runtime: tokio::runtime::Runtime,
    initial_request: Option<SessionStartRequest>,
}

impl AliciaDesktopApp {
    fn from_cli(cli: AliciaDesktopCli) -> Result<Self, Box<dyn std::error::Error>> {
        let cwd = match cli.cwd {
            Some(path) => path,
            None => std::env::current_dir()?,
        };

        let tokio_runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .build()?;

        let session_manager = SessionManager::new();
        let mut runtime = AliciaUiRuntime::new(session_manager, 2_000);
        runtime
            .store_mut()
            .set_permission_profile(cli.profile.into());

        if let Some(audit_path) = &cli.audit_path {
            let audit_logger = tokio_runtime.block_on(AuditLogger::open(audit_path))?;
            runtime = runtime.with_audit_logger(audit_logger);
        }

        let initial_request = if cli.command.is_empty() {
            None
        } else {
            let program = cli
                .command
                .first()
                .cloned()
                .ok_or_else(|| std::io::Error::other("comando nao informado"))?;
            let args = if cli.command.len() > 1 {
                cli.command[1..].to_vec()
            } else {
                Vec::new()
            };
            let command_display = cli.command.join(" ");
            Some(
                SessionStartRequest::new(
                    cli.session_id,
                    program,
                    args,
                    cwd,
                    std::env::vars().collect::<HashMap<String, String>>(),
                )
                .with_mode(cli.mode.into())
                .with_audit_context(SessionAuditContext::for_execute_command(command_display)),
            )
        };

        Ok(Self {
            runtime,
            view: AliciaEguiView::default(),
            tokio_runtime,
            initial_request,
        })
    }
}

impl eframe::App for AliciaDesktopApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if let Some(request) = self.initial_request.take()
            && let Err(error) = self
                .tokio_runtime
                .block_on(self.runtime.start_session(request))
        {
            eprintln!("{}", error.beginner_message());
        }

        self.runtime.pump_events();
        let _ = self.view.render(ctx, self.runtime.store_mut());

        if let Ok(duration) = SystemTime::now().duration_since(UNIX_EPOCH) {
            let now_unix_s = i64::try_from(duration.as_secs()).unwrap_or(i64::MAX);
            let expired = self
                .runtime
                .store_mut()
                .expire_pending_approvals(now_unix_s);
            if !expired.is_empty() {
                ctx.request_repaint();
            }
        }
    }
}

impl Drop for AliciaDesktopApp {
    fn drop(&mut self) {
        let running_session_ids: Vec<String> = self
            .runtime
            .store()
            .terminal_session_ids()
            .iter()
            .filter(|session_id| {
                self.runtime
                    .store()
                    .terminal_session(session_id.as_str())
                    .is_some_and(|session| session.lifecycle == CommandLifecycle::Running)
            })
            .cloned()
            .collect();

        for session_id in running_session_ids {
            if let Err(error) = self
                .tokio_runtime
                .block_on(self.runtime.stop_session(&session_id))
            {
                eprintln!("{}", error.beginner_message());
            }
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = AliciaDesktopCli::parse();
    let app_title = cli.title.clone();

    let app = AliciaDesktopApp::from_cli(cli)?;
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1200.0, 760.0])
            .with_min_inner_size([860.0, 560.0]),
        ..Default::default()
    };

    eframe::run_native(
        &app_title,
        native_options,
        Box::new(move |_creation_context| Ok(Box::new(app))),
    )?;
    Ok(())
}
