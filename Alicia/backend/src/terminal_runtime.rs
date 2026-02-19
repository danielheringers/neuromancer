use portable_pty::{native_pty_system, CommandBuilder as PtyCommandBuilder, PtySize};
use std::collections::HashMap;
use std::env;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use tauri::{AppHandle, State};

use crate::{
    emit_terminal_data, emit_terminal_exit, resolve_binary_path, AppState,
    TerminalCreateRequest, TerminalCreateResponse, TerminalKillRequest,
    TerminalResizeRequest, TerminalSession, TerminalWriteRequest,
};

fn default_terminal_shell() -> String {
    #[cfg(windows)]
    {
        if resolve_binary_path("pwsh.exe").is_some() || resolve_binary_path("pwsh").is_some() {
            return "pwsh.exe".to_string();
        }
        if resolve_binary_path("powershell.exe").is_some()
            || resolve_binary_path("powershell").is_some()
        {
            return "powershell.exe".to_string();
        }
        if let Ok(comspec) = env::var("COMSPEC") {
            if !comspec.trim().is_empty() {
                return comspec;
            }
        }
        return "cmd.exe".to_string();
    }
    #[cfg(not(windows))]
    {
        env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

fn lock_terminals(
    state: &AppState,
) -> Result<MutexGuard<'_, HashMap<u64, TerminalSession>>, String> {
    state
        .terminals
        .lock()
        .map_err(|_| "terminal lock poisoned".to_string())
}

pub(crate) fn terminal_create_impl(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Option<TerminalCreateRequest>,
) -> Result<TerminalCreateResponse, String> {
    let request = request.unwrap_or(TerminalCreateRequest {
        cwd: None,
        shell: None,
    });

    let cwd = request
        .cwd
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    if !cwd.exists() {
        return Err(format!("terminal cwd does not exist: {}", cwd.display()));
    }

    let shell = request
        .shell
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_terminal_shell);

    let terminal_id = state.next_terminal_id.fetch_add(1, Ordering::Relaxed);
    let event_seq = Arc::clone(&state.next_event_seq);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to create PTY: {error}"))?;

    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&shell)
        .to_ascii_lowercase();
    let mut command = PtyCommandBuilder::new(shell.clone());
    if shell_name.starts_with("pwsh") || shell_name.starts_with("powershell") {
        command.arg("-NoLogo");
    } else if shell_name == "cmd" || shell_name == "cmd.exe" {
        command.arg("/Q");
    }
    command.cwd(&cwd);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to spawn PTY process: {error}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to attach PTY reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to attach PTY writer: {error}"))?;

    let app_for_reader = app.clone();
    let event_seq_for_reader = Arc::clone(&event_seq);
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    emit_terminal_exit(&app_for_reader, terminal_id, &event_seq_for_reader, None);
                    break;
                }
                Ok(read) => {
                    let chunk = String::from_utf8_lossy(&buf[..read]).to_string();
                    emit_terminal_data(&app_for_reader, terminal_id, &event_seq_for_reader, chunk);
                }
                Err(error) => {
                    emit_terminal_data(
                        &app_for_reader,
                        terminal_id,
                        &event_seq_for_reader,
                        format!("\r\n[terminal] read error: {error}\r\n"),
                    );
                    emit_terminal_exit(&app_for_reader, terminal_id, &event_seq_for_reader, None);
                    break;
                }
            }
        }
    });

    {
        let mut terminals = lock_terminals(state.inner())?;
        terminals.insert(
            terminal_id,
            TerminalSession {
                terminal_id,
                master: pair.master,
                writer: Arc::new(Mutex::new(writer)),
                child,
            },
        );
    }

    emit_terminal_data(
        &app,
        terminal_id,
        &event_seq,
        format!(
            "[terminal] started {} in {}\r\n",
            shell,
            cwd.to_string_lossy()
        ),
    );

    Ok(TerminalCreateResponse { terminal_id })
}

pub(crate) fn terminal_write_impl(
    state: State<'_, AppState>,
    request: TerminalWriteRequest,
) -> Result<(), String> {
    let writer = {
        let terminals = lock_terminals(state.inner())?;
        let terminal = terminals
            .get(&request.terminal_id)
            .ok_or_else(|| format!("terminal {} not found", request.terminal_id))?;
        Arc::clone(&terminal.writer)
    };

    let mut guard = writer
        .lock()
        .map_err(|_| "terminal writer lock poisoned".to_string())?;
    guard
        .write_all(request.data.as_bytes())
        .map_err(|error| format!("failed to write to terminal: {error}"))?;
    guard
        .flush()
        .map_err(|error| format!("failed to flush terminal write: {error}"))?;
    Ok(())
}

pub(crate) fn terminal_resize_impl(
    state: State<'_, AppState>,
    request: TerminalResizeRequest,
) -> Result<(), String> {
    let mut terminals = lock_terminals(state.inner())?;
    let terminal = terminals
        .get_mut(&request.terminal_id)
        .ok_or_else(|| format!("terminal {} not found", request.terminal_id))?;

    terminal
        .master
        .resize(PtySize {
            rows: request.rows.max(1),
            cols: request.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to resize terminal: {error}"))?;

    Ok(())
}

pub(crate) fn terminal_kill_impl(
    app: AppHandle,
    state: State<'_, AppState>,
    request: TerminalKillRequest,
) -> Result<(), String> {
    let mut terminal = {
        let mut terminals = lock_terminals(state.inner())?;
        terminals
            .remove(&request.terminal_id)
            .ok_or_else(|| format!("terminal {} not found", request.terminal_id))?
    };

    let _ = terminal.child.kill();
    let _ = terminal.child.wait();
    emit_terminal_exit(&app, terminal.terminal_id, &state.next_event_seq, Some(-1));
    Ok(())
}

