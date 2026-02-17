use std::path::Path;
use std::path::PathBuf;
use std::time::Instant;

use codex_alicia_core::CommandOutputStream;
use codex_alicia_core::IpcEvent;
use codex_alicia_core::IpcMessage;
use codex_alicia_core::ipc::CommandFinished;
use codex_alicia_core::ipc::CommandOutputChunk;
use codex_alicia_core::ipc::CommandStarted;
use semver::Version;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderCapabilities {
    pub supports_patch_preview: bool,
    pub supports_network_actions: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum AdapterError {
    #[error("unsupported event `{event_type}` for provider `{provider}`")]
    UnsupportedEvent {
        provider: String,
        event_type: String,
    },
    #[error("provider `{provider}` returned unsupported version `{version}` (minimum `{minimum}`)")]
    UnsupportedProviderVersion {
        provider: String,
        version: String,
        minimum: String,
    },
    #[error("provider `{provider}` command failed: {message}")]
    ProviderCommandFailed { provider: String, message: String },
    #[error("{0}")]
    Internal(String),
}

pub trait ProviderAdapter {
    fn provider_name(&self) -> &'static str;
    fn capabilities(&self) -> ProviderCapabilities;
    fn normalize_event(&self, message: IpcMessage) -> Result<IpcMessage, AdapterError>;
}

#[derive(Debug, Default)]
pub struct LoopbackAdapter;

impl ProviderAdapter for LoopbackAdapter {
    fn provider_name(&self) -> &'static str {
        "loopback"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_patch_preview: true,
            supports_network_actions: true,
        }
    }

    fn normalize_event(&self, message: IpcMessage) -> Result<IpcMessage, AdapterError> {
        Ok(message)
    }
}

#[derive(Debug, Clone)]
pub struct CodexCliAdapter {
    executable: PathBuf,
    minimum_supported_version: Version,
}

impl CodexCliAdapter {
    pub fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            minimum_supported_version: Version::new(0, 0, 0),
        }
    }

    pub fn with_minimum_supported_version(mut self, version: Version) -> Self {
        self.minimum_supported_version = version;
        self
    }

    pub async fn probe_version(&self) -> Result<Version, AdapterError> {
        probe_cli_version(
            &self.executable,
            self.provider_name(),
            &self.minimum_supported_version,
        )
        .await
    }

    pub async fn run_simple_task(
        &self,
        session_id: &str,
        args: &[String],
        cwd: &Path,
    ) -> Result<Vec<IpcMessage>, AdapterError> {
        self.probe_version().await?;
        run_cli_simple_task(
            &self.executable,
            self.provider_name(),
            session_id,
            args,
            cwd,
        )
        .await
    }
}

impl ProviderAdapter for CodexCliAdapter {
    fn provider_name(&self) -> &'static str {
        "codex-cli"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_patch_preview: true,
            supports_network_actions: true,
        }
    }

    fn normalize_event(&self, message: IpcMessage) -> Result<IpcMessage, AdapterError> {
        Ok(message)
    }
}

#[derive(Debug, Clone)]
pub struct ClaudeCodeAdapter {
    executable: PathBuf,
    minimum_supported_version: Version,
}

impl ClaudeCodeAdapter {
    pub fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            minimum_supported_version: Version::new(0, 0, 0),
        }
    }

    pub fn with_minimum_supported_version(mut self, version: Version) -> Self {
        self.minimum_supported_version = version;
        self
    }

    pub async fn probe_version(&self) -> Result<Version, AdapterError> {
        probe_cli_version(
            &self.executable,
            self.provider_name(),
            &self.minimum_supported_version,
        )
        .await
    }

    pub async fn run_simple_task(
        &self,
        session_id: &str,
        args: &[String],
        cwd: &Path,
    ) -> Result<Vec<IpcMessage>, AdapterError> {
        self.probe_version().await?;
        run_cli_simple_task(
            &self.executable,
            self.provider_name(),
            session_id,
            args,
            cwd,
        )
        .await
    }
}

impl ProviderAdapter for ClaudeCodeAdapter {
    fn provider_name(&self) -> &'static str {
        "claude-code"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_patch_preview: true,
            supports_network_actions: true,
        }
    }

    fn normalize_event(&self, message: IpcMessage) -> Result<IpcMessage, AdapterError> {
        Ok(message)
    }
}

async fn probe_cli_version(
    executable: &Path,
    provider_name: &str,
    minimum_supported_version: &Version,
) -> Result<Version, AdapterError> {
    let output = tokio::process::Command::new(executable)
        .arg("--version")
        .output()
        .await
        .map_err(|err| AdapterError::ProviderCommandFailed {
            provider: provider_name.to_string(),
            message: err.to_string(),
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = if stderr.is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    };

    if !output.status.success() {
        return Err(AdapterError::ProviderCommandFailed {
            provider: provider_name.to_string(),
            message: combined,
        });
    }

    let Some(version) = parse_version_from_output(&combined) else {
        return Err(AdapterError::ProviderCommandFailed {
            provider: provider_name.to_string(),
            message: format!("could not parse provider version from output: {combined}"),
        });
    };

    if version < *minimum_supported_version {
        return Err(AdapterError::UnsupportedProviderVersion {
            provider: provider_name.to_string(),
            version: version.to_string(),
            minimum: minimum_supported_version.to_string(),
        });
    }

    Ok(version)
}

async fn run_cli_simple_task(
    executable: &Path,
    provider_name: &str,
    session_id: &str,
    args: &[String],
    cwd: &Path,
) -> Result<Vec<IpcMessage>, AdapterError> {
    let started_at = Instant::now();
    let mut command = Vec::with_capacity(args.len() + 1);
    command.push(executable.to_string_lossy().to_string());
    command.extend(args.iter().cloned());

    let mut messages = vec![IpcMessage::new(IpcEvent::CommandStarted(CommandStarted {
        command_id: session_id.to_string(),
        command,
        cwd: cwd.to_string_lossy().to_string(),
    }))];

    let output = tokio::process::Command::new(executable)
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|err| AdapterError::ProviderCommandFailed {
            provider: provider_name.to_string(),
            message: err.to_string(),
        })?;

    if !output.stdout.is_empty() {
        messages.push(IpcMessage::new(IpcEvent::CommandOutputChunk(
            CommandOutputChunk {
                command_id: session_id.to_string(),
                stream: CommandOutputStream::Stdout,
                chunk: String::from_utf8_lossy(&output.stdout).to_string(),
            },
        )));
    }

    if !output.stderr.is_empty() {
        messages.push(IpcMessage::new(IpcEvent::CommandOutputChunk(
            CommandOutputChunk {
                command_id: session_id.to_string(),
                stream: CommandOutputStream::Stderr,
                chunk: String::from_utf8_lossy(&output.stderr).to_string(),
            },
        )));
    }

    messages.push(IpcMessage::new(IpcEvent::CommandFinished(
        CommandFinished {
            command_id: session_id.to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            duration_ms: started_at
                .elapsed()
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX),
        },
    )));

    Ok(messages)
}

fn parse_version_from_output(output: &str) -> Option<Version> {
    output.split_whitespace().find_map(|raw_token| {
        let token = raw_token
            .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-' && c != '+');
        let token = token.strip_prefix('v').unwrap_or(token);
        Version::parse(token).ok()
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;

    use codex_alicia_core::ActionKind;
    use codex_alicia_core::IpcEvent;
    use codex_alicia_core::IpcMessage;
    use codex_alicia_core::ipc::ActionProposed;
    use pretty_assertions::assert_eq;
    use semver::Version;
    use tempfile::TempDir;

    use super::AdapterError;
    use super::ClaudeCodeAdapter;
    use super::CodexCliAdapter;
    use super::LoopbackAdapter;
    use super::ProviderAdapter;

    #[cfg(unix)]
    fn write_fake_cli_script(
        dir: &Path,
        binary_name: &str,
        provider_label: &str,
        version: &str,
    ) -> std::io::Result<PathBuf> {
        use std::os::unix::fs::PermissionsExt;

        let script_path = dir.join(binary_name);
        let script = format!(
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"{provider_label} {version}\"\n  exit 0\nfi\necho \"task-output\"\necho \"task-error\" 1>&2\nexit 7\n"
        );
        fs::write(&script_path, script)?;
        let mut permissions = fs::metadata(&script_path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions)?;
        Ok(script_path)
    }

    #[cfg(windows)]
    fn write_fake_cli_script(
        dir: &Path,
        binary_name: &str,
        provider_label: &str,
        version: &str,
    ) -> std::io::Result<PathBuf> {
        let script_path = dir.join(format!("{binary_name}.cmd"));
        let script = format!(
            "@echo off\r\nif \"%1\"==\"--version\" (\r\n  echo {provider_label} {version}\r\n  exit /b 0\r\n)\r\necho task-output\r\necho task-error 1>&2\r\nexit /b 7\r\n"
        );
        fs::write(&script_path, script)?;
        Ok(script_path)
    }

    #[test]
    fn loopback_adapter_returns_the_same_message() {
        let adapter = LoopbackAdapter;
        let message = IpcMessage::new(IpcEvent::ActionProposed(ActionProposed {
            action_id: "act-1".to_string(),
            action_kind: ActionKind::ReadFile,
            target: "README.md".to_string(),
        }));

        let result = adapter.normalize_event(message.clone());
        let Ok(result) = result else {
            panic!("loopback adapter failed to normalize message");
        };

        assert_eq!(result, message);
    }

    #[tokio::test]
    async fn codex_cli_adapter_accepts_supported_version() -> anyhow::Result<()> {
        let temp = TempDir::new()?;
        let executable = write_fake_cli_script(temp.path(), "fake-codex", "codex", "1.2.3")?;
        let adapter =
            CodexCliAdapter::new(executable).with_minimum_supported_version(Version::new(1, 0, 0));

        let version = adapter.probe_version().await?;
        assert_eq!(version, Version::new(1, 2, 3));
        Ok(())
    }

    #[tokio::test]
    async fn codex_cli_adapter_rejects_unsupported_version() -> anyhow::Result<()> {
        let temp = TempDir::new()?;
        let executable = write_fake_cli_script(temp.path(), "fake-codex", "codex", "0.9.0")?;
        let adapter =
            CodexCliAdapter::new(executable).with_minimum_supported_version(Version::new(1, 0, 0));

        let version_result = adapter.probe_version().await;
        assert!(matches!(
            version_result,
            Err(AdapterError::UnsupportedProviderVersion {
                ref version,
                ref minimum,
                ..
            }) if version == "0.9.0" && minimum == "1.0.0"
        ));
        Ok(())
    }

    #[tokio::test]
    async fn codex_cli_adapter_runs_task_and_normalizes_output() -> anyhow::Result<()> {
        let temp = TempDir::new()?;
        let executable = write_fake_cli_script(temp.path(), "fake-codex", "codex", "1.2.3")?;
        let adapter =
            CodexCliAdapter::new(executable).with_minimum_supported_version(Version::new(1, 0, 0));

        let args = vec!["run".to_string(), "demo".to_string()];
        let messages = adapter
            .run_simple_task("sess-codex-cli", &args, temp.path())
            .await?;

        assert!(matches!(
            messages.first().map(|message| &message.event),
            Some(IpcEvent::CommandStarted(event)) if event.command_id == "sess-codex-cli"
        ));
        assert!(messages.iter().any(|message| matches!(
            &message.event,
            IpcEvent::CommandOutputChunk(event)
            if event.stream == codex_alicia_core::CommandOutputStream::Stdout
                && event.chunk.contains("task-output")
        )));
        assert!(messages.iter().any(|message| matches!(
            &message.event,
            IpcEvent::CommandOutputChunk(event)
            if event.stream == codex_alicia_core::CommandOutputStream::Stderr
                && event.chunk.contains("task-error")
        )));
        assert!(messages.iter().any(|message| matches!(
            &message.event,
            IpcEvent::CommandFinished(event) if event.exit_code == 7
        )));

        Ok(())
    }

    #[tokio::test]
    async fn claude_code_adapter_accepts_supported_version() -> anyhow::Result<()> {
        let temp = TempDir::new()?;
        let executable = write_fake_cli_script(temp.path(), "fake-claude", "claude-code", "2.4.0")?;
        let adapter = ClaudeCodeAdapter::new(executable)
            .with_minimum_supported_version(Version::new(2, 0, 0));

        let version = adapter.probe_version().await?;
        assert_eq!(version, Version::new(2, 4, 0));
        Ok(())
    }

    #[tokio::test]
    async fn claude_code_adapter_runs_task_and_normalizes_output() -> anyhow::Result<()> {
        let temp = TempDir::new()?;
        let executable = write_fake_cli_script(temp.path(), "fake-claude", "claude-code", "2.4.0")?;
        let adapter = ClaudeCodeAdapter::new(executable)
            .with_minimum_supported_version(Version::new(2, 0, 0));

        let args = vec!["run".to_string(), "demo".to_string()];
        let messages = adapter
            .run_simple_task("sess-claude-code", &args, temp.path())
            .await?;

        assert!(messages.iter().any(|message| matches!(
            &message.event,
            IpcEvent::CommandFinished(event) if event.command_id == "sess-claude-code" && event.exit_code == 7
        )));
        Ok(())
    }
}
