# Repository Guidelines

## Project Structure & Module Organization
This repository is the Rust/Tauri backend for AlicIA. Keep changes scoped to clear runtime boundaries.

- `src/main.rs`: Tauri entrypoint, command registration, and shared app state.
- `src/*_runtime.rs`: focused runtime modules (session, terminal, command, launch, bridge, MCP, events).
- `src/status_runtime/`: status fetch/format helpers split into small files.
- `capabilities/default.json`: Tauri capability and permission config.
- `icons/`: packaged application icons.
- `tauri.conf.json`: app packaging and runtime configuration.

## Build, Test, and Development Commands
Run commands from this directory (`alicia/backend`):

- `cargo check`: fast compile validation while iterating.
- `cargo tauri dev`: run the desktop app in development mode.
- `cargo tauri build`: create production bundles.
- `cargo test`: run Rust tests (unit + integration).
- `cargo fmt --all`: apply Rust formatting.
- `cargo clippy --all-targets --all-features -- -D warnings`: enforce lint-clean code.

## Coding Style & Naming Conventions
- Rust edition is 2021; use `cargo fmt` as the source of truth for style.
- Use `snake_case` for modules/functions and `PascalCase` for structs/enums.
- Follow existing module naming (`session_runtime.rs`, `terminal_runtime.rs`).
- Keep Tauri command handlers thin: validate/route in `main.rs`, implement behavior in runtime modules.
- Prefer small, composable functions over large mixed-responsibility blocks.

## Testing Guidelines
- Add tests with behavior changes.
- Place unit tests in-module with `#[cfg(test)]`; place integration tests under `tests/`.
- Use descriptive test names (example: `should_emit_terminal_exit_on_child_shutdown`).
- Before opening a PR, run: `cargo fmt --all`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test`.

## Commit & Pull Request Guidelines
- Follow observed commit style: `type(scope): summary` (examples: `fix(alicia): ...`, `chore(alicia): ...`).
- Keep commits atomic and runnable.
- PRs should include:
  - problem statement and solution summary,
  - affected modules/files,
  - validation commands executed,
  - linked issue/execplan,
  - screenshots/GIFs when UI or Tauri window behavior changes.
