# Repository Guidelines

## Project Structure & Module Organization
This repository is a monorepo with two active areas:
- `alicia/`: desktop app built with Next.js + Tauri.
- `codex/`: upstream Codex workspace (Rust crates plus TypeScript packages).

Within `alicia/frontend`, organize UI code by responsibility:
- `app/` for routes, layouts, and page-level composition.
- `components/` for reusable UI and feature components.
- `hooks/`, `lib/`, and `styles/` for shared logic, utilities, and styling.

Tauri runtime code lives in `alicia/backend` (for example `src/main.rs`, `tauri.conf.json`).

## Build, Test, and Development Commands
Run from `alicia/frontend` unless noted otherwise:
- `pnpm dev`: start the Next.js dev server.
- `pnpm build`: run a production build check.
- `pnpm start`: serve the production build locally.
- `pnpm lint`: run ESLint across frontend files.
- `pnpm tauri:dev`: launch desktop app in development mode.
- `pnpm tauri:build`: generate desktop build artifacts.

First-time setup from `alicia/`: `pnpm run setup`.

## Coding Style & Naming Conventions
Use TypeScript and keep modules focused and composable.
- Formatting: Prettier defaults from `codex/.prettierrc.toml` (`tabWidth=2`, `printWidth=80`, trailing commas).
- Filenames: kebab-case (example: `command-palette.tsx`).
- React component exports: PascalCase.
- Hooks: `useXxx` naming.
- Rust modules in backend: snake_case.

Run lint/format checks before opening a PR.

## Testing Guidelines
Frontend changes should include at least:
1. `pnpm lint`
2. `pnpm build` or a `pnpm tauri:dev` smoke run

When changing `codex/`, run relevant project tests there (for example `just test` in Rust workspace or `pnpm test` in TypeScript packages).

## Commit & Pull Request Guidelines
Follow existing commit style: `type(scope): summary` (examples: `fix(alicia): ...`, `docs(alicia): ...`, `chore(alicia): ...`).

Keep commits atomic and runnable. PRs should include:
- problem statement and solution summary
- validation steps/commands run
- linked issue or execplan
- screenshots/GIFs for UI changes
- notes for config, security, or runtime-impacting updates
