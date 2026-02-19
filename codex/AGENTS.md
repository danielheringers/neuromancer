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

- Store plans in `.agent/execplans/`.
- Name files as `YYYY-MM-DD-<issue-id>-<short-slug>.md`.
- Each plan must be self-contained and maintain the sections required by `.agent/PLANS.md`.

### Living plan rule

- Update the ExecPlan during implementation, not only at the end.
- Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current.
- At every stop point, split partial work into completed vs remaining entries.

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

### Tests

- Always run tests for impacted crate(s).
- Ask the user before running full workspace test suites such as `cargo test --all-features`.

## Multi-agent mode

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
