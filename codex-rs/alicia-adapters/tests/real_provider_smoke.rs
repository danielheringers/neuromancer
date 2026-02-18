use std::env;

use anyhow::Result;
use anyhow::bail;
use codex_alicia_adapters::ClaudeCodeAdapter;
use codex_alicia_core::IpcEvent;
use pretty_assertions::assert_eq;
use semver::Version;

#[tokio::test]
async fn real_provider_claude_code_smoke() -> Result<()> {
    if env::var("ALICIA_REAL_PROVIDER_CLAUDE_CODE").as_deref() != Ok("1") {
        eprintln!(
            "skipping real claude-code provider smoke: set ALICIA_REAL_PROVIDER_CLAUDE_CODE=1"
        );
        return Ok(());
    }

    let executable =
        env::var("ALICIA_CLAUDE_CODE_BIN").unwrap_or_else(|_| "claude-code".to_string());
    let adapter =
        ClaudeCodeAdapter::new(executable).with_minimum_supported_version(Version::new(0, 0, 0));

    let version = adapter.probe_version().await?;
    assert!(version >= Version::new(0, 0, 0));

    let args = vec!["--version".to_string()];
    let cwd = tempfile::TempDir::new()?;
    let messages = adapter
        .run_simple_task("sess-real-claude-code", &args, cwd.path())
        .await?;

    let Some(IpcEvent::CommandStarted(started)) = messages.first().map(|message| &message.event)
    else {
        bail!("missing CommandStarted event in real_provider_claude_code_smoke");
    };
    assert_eq!(started.command_id, "sess-real-claude-code");
    assert!(messages.iter().any(|message| matches!(
        &message.event,
        IpcEvent::CommandOutputChunk(event) if !event.chunk.trim().is_empty()
    )));
    let Some(IpcEvent::CommandFinished(finished)) = messages.last().map(|message| &message.event)
    else {
        bail!("missing CommandFinished event in real_provider_claude_code_smoke");
    };
    assert_eq!(finished.command_id, "sess-real-claude-code");
    assert_eq!(finished.exit_code, 0);

    Ok(())
}
