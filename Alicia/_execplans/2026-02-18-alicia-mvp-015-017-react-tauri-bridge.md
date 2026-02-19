# Alicia React/Next Tauri Bridge and Command Matrix Coverage

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` updated as work proceeds.

This plan follows `.agent/PLANS.md` from repository root.

## Purpose / Big Picture

Transform the existing static React/Next prototype in `Alicia/egui-rust-integration` into a functional desktop UI that communicates with a Tauri backend through `invoke` and `listen`, while preserving the current visual style (title bar, sidebar, timeline/messages, input, status bar).

User-visible outcome:
1. User can start/stop an interactive Codex session.
2. User can send input to an active session.
3. `stdout`/`stderr` events appear in the timeline using the existing terminal-like message style.
4. UI exposes visual controls for model, reasoning, approval preset, sandbox, profile, and web search.
5. Quick action buttons inject `/model`, `/permissions`, `/mcp`, `/resume`, `/fork` as regular session input.
6. A simplified Command Center can run one-shot Codex CLI actions (`mcp`, `features`, `cloud`, `resume`, `fork`).
7. Image attachment flow uses `pick_image_file`; pending attachments appear in input; submit can include path references and optional one-shot execution with `--image`.

Issue mapping:
1. `ALICIA-MVP-015` (UI terminal principal integrado).
2. `ALICIA-MVP-017` (timeline e diff UI de eventos IPC).
3. `ALICIA-MVP-013`/`ALICIA-MVP-028` (uso prático do adapter `codex-cli` por comandos one-shot).

## Progress

- [x] (2026-02-18 17:59Z) Request mapped to AlicIA scope and issue IDs; current frontend/backend contracts inventoried.
- [x] (2026-02-18 18:03Z) Tauri bridge implemented in `lib/tauri-bridge.ts` with invoke aliases, listen aliases, event normalization, and `pick_image_file` integration.
- [x] (2026-02-18 18:08Z) Alicia UI refactored to runtime state flow (`page.tsx`, sidebar, command input, terminal message, title/status bars) covering session lifecycle, prompt send, stdout/stderr timeline, config controls, quick slash actions, command center, and image attachments.
- [x] (2026-02-18 18:11Z) Validation completed (`pnpm build`, `pnpm exec tsc --noEmit`) after excluding Tauri binary artifacts from TypeScript project scope.
- [x] (2026-02-18 18:24Z) Bridge alinhado ao backend real (`start_codex_session`, `send_codex_input`, `stop_codex_session`, `run_codex_command`, `update_codex_config`) com mapeamento explicito de config para flags CLI.
- [x] (2026-02-18 18:24Z) Fluxo de mencoes adicionado no input (`@arquivo` via file picker) para cobrir item "Prompt + imagem + menções" da matriz.
- [x] (2026-02-18 18:24Z) Cobertura da matriz ampliada: quick actions incluem `/approvals`; Command Center adiciona `mcp login/logout` e `cloud exec`.

## Surprises & Discoveries

- Observation: `Alicia/egui-rust-integration` is currently a static mock with no Tauri integration and no backend command constants.
  Evidence: `app/page.tsx` uses hardcoded demo messages and simulated `setTimeout` responses.
- Observation: There is no `src-tauri` folder in this repository path; frontend must tolerate varying backend command/event names.
  Evidence: repository-wide file inventory returned no `src-tauri`/`tauri.conf.*` in this scope.
- Observation: `tsc --noEmit` traversed binary assets under `src-tauri/target/...` and failed with parsing errors unrelated to frontend source.
  Evidence: `TS1490`/`TS1127` errors against generated files in `src-tauri/target/debug/build/.../tauri-codegen-assets/*`.

## Decision Log

- Decision: Add a small frontend-side Tauri bridge module with command/event alias lists and robust payload normalization.
  Rationale: Backend command identifiers are not discoverable in this repo snapshot; alias fallback keeps integration functional across small backend naming drifts.
  Date/Author: 2026-02-18 / Codex
- Decision: Keep existing Alicia visual hierarchy and style tokens while adding controls into sidebar/input/status regions.
  Rationale: Requirement explicitly prioritizes preserving prototype aesthetics.
  Date/Author: 2026-02-18 / Codex
- Decision: Remove web analytics injection from `app/layout.tsx` for desktop-focused runtime compatibility.
  Rationale: `@vercel/analytics` is browser/web analytics-specific and not required for local desktop runtime behavior.
  Date/Author: 2026-02-18 / Codex
- Decision: Exclude `src-tauri/target` from TypeScript project.
  Rationale: Prevent non-source binary artifacts from breaking strict TS validation.
  Date/Author: 2026-02-18 / Codex

## Outcomes & Retrospective

Outcomes achieved:
1. Frontend no longer depends on mocked conversation flow and now calls backend through explicit `invoke`/`listen` bridge.
2. Mandatory UX matrix items are implemented in the main React UI with preserved visual style.
3. Build validations pass for the edited scope (`next build`, strict `tsc --noEmit`, and `pnpm tauri build --debug`).

Remaining risk:
1. Runtime still depends on `codex` binary availability in `PATH`; sem binario, a UI permanece funcional mas comandos retornam erro operacional.

## Context and Orientation

Relevant frontend files:
1. `Alicia/egui-rust-integration/app/page.tsx` (main orchestration and state).
2. `Alicia/egui-rust-integration/components/alicia/command-input.tsx` (composer and send actions).
3. `Alicia/egui-rust-integration/components/alicia/sidebar.tsx` (session/config/action surface).
4. `Alicia/egui-rust-integration/components/alicia/title-bar.tsx` and `status-bar.tsx` (connection/runtime indicators).
5. `Alicia/egui-rust-integration/components/alicia/terminal-message.tsx` (timeline rendering).
6. `Alicia/egui-rust-integration/app/layout.tsx` (desktop compatibility cleanup if needed).

Domain/feature references:
1. `Alicia/13-ui-command-config-matrix.md` (commands/config mapping for UI controls and command center).
2. `Alicia/09-backlog-issues-mvp.md` (issue IDs and acceptance criteria context).

## Plan of Work

Implement in three milestones:

Milestone A: Bridge foundation.
Create a reusable Tauri integration layer for `invoke`/`listen`, command alias fallback, one-shot command execution, and normalized event handling.

Milestone B: UI wiring.
Replace mock chat flow with real state machine: session start/stop, input send, stream rendering, config controls, quick slash actions, command center one-shot actions, image attachments.

Milestone C: Validation and polish.
Ensure no TypeScript regressions and keep layout desktop-safe by removing incompatible dependencies if present.

## Concrete Steps

From repository root:

    Get-Content Alicia/egui-rust-integration/app/page.tsx
    Get-Content Alicia/egui-rust-integration/components/alicia/*.tsx

Implement bridge + UI updates:

    Edit Alicia/egui-rust-integration/lib/tauri-bridge.ts (new)
    Edit Alicia/egui-rust-integration/app/page.tsx
    Edit Alicia/egui-rust-integration/components/alicia/command-input.tsx
    Edit Alicia/egui-rust-integration/components/alicia/sidebar.tsx
    Edit Alicia/egui-rust-integration/components/alicia/title-bar.tsx
    Edit Alicia/egui-rust-integration/components/alicia/status-bar.tsx
    Edit Alicia/egui-rust-integration/components/alicia/terminal-message.tsx
    Edit Alicia/egui-rust-integration/app/layout.tsx (if required)

Validation:

    cd Alicia/egui-rust-integration
    pnpm build

Expected pass criteria:
1. TypeScript build succeeds.
2. UI compiles with no missing types/imports.
3. Runtime path includes concrete `invoke` and `listen` usage for required feature matrix.

## Validation and Acceptance

Functional acceptance checklist:
1. Interactive session controls call Tauri backend start/stop and update UI status.
2. Sending prompt dispatches session input via backend.
3. Incoming output events render timeline entries for stdout/stderr.
4. Config controls are visible and applied through backend update calls.
5. Quick actions submit literal slash commands as input.
6. Command Center triggers one-shot backend command execution for all listed command groups.
7. Attach image uses `pick_image_file` and pending attachments are reflected in outgoing request text and optional one-shot `--image`.

Technical validation:
1. `pnpm build` passes in `Alicia/egui-rust-integration`.

## Idempotence and Recovery

1. All edits are additive in frontend files only; no destructive git operations required.
2. If one alias command is unsupported by backend, bridge falls back to next alias and keeps UI responsive.
3. If Tauri runtime is unavailable (plain browser), UI remains interactive with clear error/system feedback rather than crashing.

## Artifacts and Notes

Edited files:
1. `Alicia/egui-rust-integration/app/page.tsx`
2. `Alicia/egui-rust-integration/app/layout.tsx`
3. `Alicia/egui-rust-integration/components/alicia/sidebar.tsx`
4. `Alicia/egui-rust-integration/components/alicia/command-input.tsx`
5. `Alicia/egui-rust-integration/components/alicia/terminal-message.tsx`
6. `Alicia/egui-rust-integration/components/alicia/title-bar.tsx`
7. `Alicia/egui-rust-integration/components/alicia/status-bar.tsx`
8. `Alicia/egui-rust-integration/lib/tauri-bridge.ts`
9. `Alicia/egui-rust-integration/tsconfig.json`
10. `Alicia/execplans/2026-02-18-alicia-mvp-015-017-react-tauri-bridge.md`

Validation commands executed:
1. `pnpm -C Alicia/egui-rust-integration install --ignore-workspace`
2. `pnpm -C Alicia/egui-rust-integration build`
3. `pnpm -C Alicia/egui-rust-integration exec tsc --noEmit`

Command/config matrix coverage:
1. Session lifecycle (`start/stop`) implemented via sidebar controls + Tauri invoke.
2. Input send + slash quick actions implemented via session input bridge.
3. `stdout/stderr` timeline implemented via normalized listened events.
4. Visual config controls implemented (model, reasoning, approval preset, sandbox, profile, web search) with backend update action.
5. Command Center one-shot implemented for `mcp`, `features`, `cloud`, `resume`, `fork`.
6. Image attachment implemented with `pick_image_file`, pending list in input, submit path references, and one-shot `--image` mode.

## Interfaces and Dependencies

Frontend bridge interface target:
1. `listenToAliciaEvents(onEvent) -> unsubscribe`
2. `startInteractiveSession(config) -> session descriptor`
3. `stopInteractiveSession(sessionId)`
4. `sendInputToSession(sessionId, input)`
5. `updateSessionConfig(config)`
6. `runOneShotCodex(command, args, options)`
7. `pickImageFile() -> path | null`

Event payload target:
1. Session lifecycle (`started`, `stopped`, `error`).
2. Output stream chunks (`stdout`, `stderr`).
3. Optional command-center output events.

Update note (2026-02-18 17:59Z): Plano inicial criado com escopo, milestones e validacao para bridge React/Next com backend Tauri.
Update note (2026-02-18 18:11Z): Plano atualizado com implementacao completa do bridge/UI, validacoes de build/TypeScript e registro de ajustes de compatibilidade desktop/tsconfig.
Update note (2026-02-18 18:24Z): Plano revisado para refletir alinhamento estrito com comandos Tauri reais, suporte a mencoes de arquivos e validacao integrada desktop com `pnpm tauri build --debug`.
