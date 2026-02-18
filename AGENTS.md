# AGENTS.md - AlicIA Delivery Playbook

Este documento define como agentes devem operar neste repositorio com foco no projeto AlicIA.

## Repository Sync (neuromancer)

- Keep `upstream` pointed to `https://github.com/openai/codex.git`.
- Keep `origin` pointed to `https://github.com/danielheringers/neuromancer.git`.
- Treat `main` as an upstream mirror branch (do not put project-specific work directly on `main`).
- Do project-specific work on the `neuromancer` branch (or feature branches based on it).
- Standard update flow:
  1. `git fetch upstream`
  2. `git checkout main`
  3. `git merge --ff-only upstream/main`
  4. `git push origin main`
  5. `git checkout neuromancer`
  6. `git merge main`
  7. `git push origin neuromancer`

## AlicIA Scope and Source of Truth

AlicIA e o escopo padrao de trabalho deste repositorio.

- Canonical product/architecture scope (prevails on conflict):
  - `Alicia/00-plano-mestre.md`
  - `Alicia/01-arquitetura-tecnica.md`
  - `Alicia/02-seguranca-e-permissoes.md`
  - `Alicia/03-ux-produto.md`
  - `Alicia/04-roadmap-estimativas.md`
  - `Alicia/05-riscos-mitigacoes.md`
  - `Alicia/06-backlog-mvp.md`
  - `Alicia/07-plano-release-oss.md`
- Execution artifacts (must stay aligned):
  - `Alicia/08-plano-execucao-sprints.md`
  - `Alicia/09-backlog-issues-mvp.md`
  - `Alicia/10-contratos-tecnicos-v1.md`
  - `Alicia/11-mapa-reuso-codex.md`
  - `Alicia/12-guia-mvp-instalacao-troubleshooting-checklist.md`

## ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `.agent/PLANS.md`) from design to implementation.

### When ExecPlan is mandatory

Use an ExecPlan before coding when at least one condition is true:
- the task touches multiple crates or more than one subsystem (Core, UI, Adapters, QA/CI, Docs),
- the work is expected to take more than 30 minutes,
- there is uncertainty in design, requirements, or external dependencies,
- the task changes security behavior, policy, approval, filesystem guard, network policy, or auditing,
- the task introduces or changes user-visible behavior in AlicIA.

### ExecPlan file location and naming

- Store plans in `Alicia/execplans/`.
- Name files as `YYYY-MM-DD-<issue-id>-<short-slug>.md`.
- Each plan must be self-contained and maintain the sections required by `.agent/PLANS.md`.

### Living plan rule

- Update the ExecPlan during implementation, not only at the end.
- Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current.
- At every stop point, split partial work into completed vs remaining entries.

## Operational Development Flow (AlicIA)

### 1) Intake and framing

1. Read request and map to issue IDs from `Alicia/09-backlog-issues-mvp.md`.
2. Confirm acceptance criteria and risks from the mapped issue(s).
3. If scope is complex, create/update ExecPlan first.

### 2) Reuse-first design

1. Check `Alicia/11-mapa-reuso-codex.md` before creating modules.
2. Prefer integration with existing `codex-rs` components over parallel engines.
3. Record design decisions in ExecPlan `Decision Log`.

### 3) Implementation by milestone

1. Implement one milestone at a time.
2. Keep behavior observable at each milestone (tests, CLI, or UI output).
3. Update docs as behavior changes.

### 4) Validation gates

Run at least the impacted crate tests. For AlicIA changes, prefer this baseline:

- `cargo test -p codex-alicia-core`
- `cargo test -p codex-alicia-adapters`
- `cargo test -p codex-alicia-ui`

If a change affects one crate only, run that crate first.

### 5) Closeout and planning continuity

Before considering a task closed:

1. Update `Alicia/12-guia-mvp-instalacao-troubleshooting-checklist.md` when release readiness status changes.
2. Update `Alicia/09-backlog-issues-mvp.md` when issue status/coverage changes.
3. Update the current ExecPlan with what was completed and what remains.
4. Report: issue IDs covered, criteria satisfied, remaining blockers/risks.

## Technical Guardrails (Non-negotiable)

- Keep cross-platform parity (Windows, macOS, Linux) from the start.
- Enforce security-critical behavior:
  - block writes/actions outside workspace,
  - apply network policy by profile,
  - require explicit approval for sensitive actions,
  - fail closed when there is no explicit decision,
  - emit append-only JSONL audit logs with redaction.
- Do not introduce non-MVP features unless explicitly requested.

## Rust / codex-rs Rules

In `codex-rs`:

- Crate names are prefixed with `codex-`.
- Inline `format!` args into `{}` whenever possible.
- Collapse if-statements and prefer method references over redundant closures.
- Prefer exhaustive `match` statements.
- Prefer full-object assertions in tests (`assert_eq!`).
- Do not create helper methods used only once.
- If API changes, update relevant docs.

### Formatting and lint

- Run `just fmt` in `codex-rs` after Rust changes.
- If `just fmt` is unavailable in the current shell (common on Windows), run `cargo fmt --all` as fallback.
- Before finalizing a large AlicIA Rust change, run:
  - `cargo clippy --fix --all-features --tests --allow-dirty -p codex-alicia-ui`
  - adjust `-p` to the impacted crate(s).

### Tests

- Always run tests for impacted crate(s).
- Ask the user before running full workspace test suites such as `cargo test --all-features`.

## Multi-agent mode (default for AlicIA)

Use multi-agent execution for multi-file or multi-stream tasks.

- `explorer`: discovery and dependency mapping.
- `worker`: implementation and targeted fixes.
- `default`: orchestration, integration, and final validation.

Concurrency guardrail:
- Keep at most 6 concurrent sub-agents.
- Reserve at least 1 slot for review/validation in complex tasks.

Required handoff in summaries:
- files changed,
- commands/tests executed,
- acceptance criteria covered,
- blockers/risks and next actions.
