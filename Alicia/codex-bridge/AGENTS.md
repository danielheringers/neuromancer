# Repository Guidelines

## Project Structure & Module Organization
This monorepo has two active projects:

- `alicia/`: desktop app built with Tauri + Next.js.
- `alicia/frontend/`: Next.js UI (`app/`, `components/`, `hooks/`, `lib/`, `styles/`).
- `alicia/backend/`: Rust/Tauri runtime (`src/main.rs`, `tauri.conf.json`).
- `codex/`: upstream Codex workspace.
- `codex/codex-rs/`: Rust workspace with crates like `cli/`, `core/`, `tui/`, `mcp-server/`.
- `codex/sdk/typescript/` and `codex/shell-tool-mcp/`: TypeScript packages with Jest tests.

Keep changes scoped to the affected package to avoid cross-project regressions.

## Build, Test, and Development Commands
Run commands from the matching directory:

- `cd alicia && pnpm run setup`: install frontend dependencies required by Tauri commands.
- `cd alicia && pnpm run dev`: run Next.js + Tauri in development.
- `cd alicia && pnpm run build`: produce a desktop build.
- `cd alicia/frontend && pnpm run lint`: run ESLint for UI code.
- `cd codex && pnpm run format`: check Prettier formatting.
- `cd codex && just fmt && just clippy && just test`: Rust format, lint, and full test sweep.
- `cd codex/codex-rs && cargo test -p <crate>`: run focused Rust tests.
- `cd codex/sdk/typescript && pnpm test`: run TypeScript SDK tests.

## Coding Style & Naming Conventions
- Rust: enforce `cargo fmt`; keep `clippy` clean.
- TypeScript/Markdown/YAML: follow `codex/.prettierrc.toml` (`tabWidth=2`, `printWidth=80`, trailing commas).
- Naming: kebab-case filenames (for example, `components/ui/dropdown-menu.tsx`), PascalCase React exports, snake_case Rust modules.
- Prefer small, composable modules over mixed-responsibility files.

## Testing Guidelines
- Add or update tests for every behavior change.
- Rust tests: unit tests under `#[cfg(test)]` or integration tests in `tests/`.
- TypeScript tests: `tests/*.test.ts` (Jest).
- For `alicia/frontend` UI work, run at least lint plus a dev/build smoke check before opening a PR.

## Commit & Pull Request Guidelines
- Use conventional commits: `type(scope): summary` (for example, `docs(alicia): update setup steps`).
- Keep commits atomic and runnable.
- PRs should include: problem statement, solution summary, validation steps, and linked issue/execplan.
- Add screenshots or GIFs for UI changes, and explicitly call out config or security-impacting changes.
