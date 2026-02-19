# Repository Guidelines

## Project Structure & Module Organization
This repository is a monorepo with two active projects:

- `alicia/`: desktop app built with Tauri + Next.js.
- `alicia/frontend/`: Next.js UI (`app/`, `components/`, `hooks/`, `lib/`, `styles/`).
- `alicia/backend/`: Rust/Tauri runtime (`src/main.rs`, `tauri.conf.json`).
- `codex/`: upstream Codex workspace.
- `codex/codex-rs/`: Rust workspace (core crates such as `cli/`, `core/`, `tui/`, `mcp-server/`).
- `codex/sdk/typescript/` and `codex/shell-tool-mcp/`: TypeScript packages with Jest-based tests.

## Build, Test, and Development Commands
Run commands from the indicated directory.

- `cd alicia && pnpm run setup`: install frontend dependencies used by Tauri commands.
- `cd alicia && pnpm run dev`: run Next.js + Tauri desktop app in development.
- `cd alicia && pnpm run build`: produce desktop build via Tauri.
- `cd alicia/frontend && pnpm run lint`: lint frontend code with ESLint.
- `cd codex && pnpm run format`: check Prettier formatting for repo-level JS/MD/YAML.
- `cd codex && just fmt && just clippy && just test`: Rust format, lint, and test sweep (`just test` uses `cargo nextest`).
- `cd codex/codex-rs && cargo test -p <crate>`: targeted Rust validation.
- `cd codex/sdk/typescript && pnpm test` (or `pnpm coverage`): SDK tests.

## Coding Style & Naming Conventions
- Rust: format with `cargo fmt`; keep Clippy clean (`just clippy`).
- TypeScript/Markdown: Prettier defaults from `codex/.prettierrc.toml` (`tabWidth=2`, `printWidth=80`, trailing commas).
- Follow existing naming: kebab-case filenames (for example `components/ui/dropdown-menu.tsx`), PascalCase for React component exports, snake_case module names in Rust.
- Keep modules focused; prefer small, composable functions over large mixed-responsibility files.

## Testing Guidelines
- Add/update tests with every behavior change.
- Rust tests: inline unit tests (`#[cfg(test)]`) or crate-level integration tests under `tests/`.
- TypeScript tests: place Jest tests in `tests/` with `*.test.ts`.
- For UI changes in `alicia/frontend`, include at minimum lint + build/dev smoke validation.

## Commit & Pull Request Guidelines
- Use conventional-style commits observed in history: `type(scope): summary` (e.g., `docs(alicia): ...`, `alicia-core: ...`, `ci: ...`).
- Keep commits atomic and runnable.
- PRs should include: problem statement, solution summary, validation steps, and linked issue/execplan.
- Include screenshots/GIFs for frontend/Tauri UI changes and call out config/security-impacting updates explicitly.

## Multi-Agent Playbook (AlicIA)
- Use explicit multi-agent orchestration for maintenance tasks in `alicia/*`.
- Always define ownership boundaries before implementation:
  - `alicia-frontend` owns only `alicia/frontend/**`.
  - `alicia-backend` owns only `alicia/backend/**`.
  - `alicia-codex-bridge` owns only `alicia/codex-bridge/**`.
- Follow this execution sequence:
  1. Spawn `alicia-planner` (read-only) for plan, impacted files, risks, and validation checklist.
  2. Spawn implementers in parallel (`alicia-frontend`, `alicia-backend`, `alicia-codex-bridge`) only when each has relevant scope.
  3. Spawn `alicia-test` to run lint/build/tests relevant to the changed scope.
  4. Spawn `alicia-reviewer` (read-only) for final bug/regression/security review.
  5. Wait for all agents, then publish a consolidated summary with findings, validations, and next actions.
- If one subproject depends on another, state the expected contract first (API/event/schema) before editing.

## Default prompt template:
Use multi-agent with the AlicIA team.

Workflow:
1) Spawn `alicia-planner` (read-only) to produce plan, risks, and touched files.
2) Spawn implementation agents in parallel with strict ownership:
- `alicia-frontend` -> only `alicia/frontend/**`
- `alicia-backend` -> only `alicia/backend/**`
- `alicia-codex-bridge` -> only `alicia/codex-bridge/**`
3) Spawn `alicia-test` to validate lint/build/tests for affected scopes.
4) Spawn `alicia-reviewer` (read-only) for final correctness/security/regression review.
5) Wait for all agents and consolidate final output with changed files, validations run, findings, and next steps.
