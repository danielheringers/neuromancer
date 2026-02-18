use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use clap::Parser;
use clap::ValueEnum;
use codex_alicia_core::AuditLogger;
use codex_alicia_core::PermissionProfile;
use codex_alicia_core::SessionAuditContext;
use codex_alicia_core::SessionManager;
use codex_alicia_core::SessionMode;
use codex_alicia_core::SessionStartRequest;
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

#[derive(Debug, Parser)]
#[command(
    name = "codex-alicia-ui-app",
    about = "Executa uma sessao AlicIA local para teste rapido."
)]
struct AliciaAppCli {
    /// Identificador da sessao.
    #[arg(long, default_value = "alicia-local")]
    session_id: String,

    /// Diretorio de trabalho da sessao.
    #[arg(long)]
    cwd: Option<PathBuf>,

    /// Modo de sessao (auto/pty/pipe).
    #[arg(long, value_enum, default_value_t = CliSessionMode::Pipe)]
    mode: CliSessionMode,

    /// Caminho opcional do JSONL de auditoria.
    #[arg(long)]
    audit_path: Option<PathBuf>,

    /// Cancela a sessao automaticamente apos X ms.
    #[arg(long)]
    cancel_after_ms: Option<u64>,

    /// Comando a executar, preferencialmente apos `--`.
    #[arg(required = true, trailing_var_arg = true)]
    command: Vec<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = AliciaAppCli::parse();
    let cwd = match cli.cwd {
        Some(path) => path,
        None => std::env::current_dir()?,
    };

    let command_display = cli.command.join(" ");
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

    let session_manager = if let Some(path) = &cli.audit_path {
        let logger = AuditLogger::open(path).await?;
        SessionManager::with_audit_logger(logger)
    } else {
        SessionManager::new()
    };
    let mut runtime = AliciaUiRuntime::new(session_manager, 2_000);
    runtime
        .store_mut()
        .set_permission_profile(PermissionProfile::FullAccess);
    let request = SessionStartRequest::new(
        cli.session_id.clone(),
        program,
        args,
        cwd.clone(),
        inherited_env(),
    )
    .with_mode(cli.mode.into())
    .with_audit_context(SessionAuditContext::for_execute_command(command_display));

    if let Err(error) = runtime.start_session(request).await {
        eprintln!("{}", error.beginner_message());
        return Ok(());
    }

    println!("Sessao iniciada: {}", cli.session_id);
    println!("Diretorio: {}", cwd.display());
    if let Some(audit_path) = &cli.audit_path {
        println!("Auditoria: {}", audit_path.display());
    }

    let mut printed_lines = 0_usize;
    let cancel_deadline = cli
        .cancel_after_ms
        .map(|ms| tokio::time::Instant::now() + Duration::from_millis(ms));
    let mut cancellation_requested = false;
    let mut final_exit_code = 1_i32;

    loop {
        runtime.pump_events();

        if let Some(session) = runtime.store().terminal_session(&cli.session_id) {
            let lines = session.visible_lines();
            if printed_lines < lines.len() {
                for line in &lines[printed_lines..] {
                    println!("{line}");
                }
                printed_lines = lines.len();
            }

            if let CommandLifecycle::Finished {
                exit_code,
                duration_ms,
            } = session.lifecycle
            {
                final_exit_code = exit_code;
                println!("Sessao finalizada (exit_code={exit_code}, duration_ms={duration_ms}).");
                break;
            }
        }

        if let Some(deadline) = cancel_deadline
            && !cancellation_requested
            && tokio::time::Instant::now() >= deadline
        {
            cancellation_requested = true;
            println!("Solicitando cancelamento da sessao...");
            if let Err(error) = runtime.stop_session(&cli.session_id).await {
                eprintln!("{}", error.beginner_message());
                break;
            }
        }

        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    if final_exit_code == 0 {
        Ok(())
    } else {
        let exit_code = if final_exit_code < 0 {
            1
        } else {
            final_exit_code
        };
        std::process::exit(exit_code);
    }
}

fn inherited_env() -> HashMap<String, String> {
    std::env::vars().collect()
}
