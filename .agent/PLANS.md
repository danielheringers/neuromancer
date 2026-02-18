# Codex Execution Plans (ExecPlans)

This document defines how to create and execute an ExecPlan in this repository.

An ExecPlan is a living implementation specification that a stateless coding agent (or a newcomer) can follow end-to-end without relying on prior conversation context.

## How to use this file

When drafting an ExecPlan, follow this document exactly. If anything here conflicts with an old habit, this file wins.

When implementing an ExecPlan:

- do not stop to ask for generic "next steps" when a next milestone is already defined,
- keep the living sections updated continuously,
- resolve ambiguities with explicit decisions and document them,
- keep behavior demonstrable, not only compilable.

When discussing or revising a plan, record the reason for every major change in the plan itself.

## Non-negotiable requirements

Every ExecPlan must be:

1. Self-contained: all information needed to execute the work must be in the plan.
2. Living: updated as implementation progresses.
3. Novice-friendly: understandable by someone with no prior repository history.
4. Outcome-focused: leads to visible, testable behavior.
5. Plain-language: define repository-specific terms at first use.

## Required structure in every ExecPlan

Each ExecPlan must include these sections, with these exact names:

- `Purpose / Big Picture`
- `Progress`
- `Surprises & Discoveries`
- `Decision Log`
- `Outcomes & Retrospective`
- `Context and Orientation`
- `Plan of Work`
- `Concrete Steps`
- `Validation and Acceptance`
- `Idempotence and Recovery`
- `Artifacts and Notes`
- `Interfaces and Dependencies`

## Progress section rules

`Progress` must always contain checkbox items and timestamps in UTC, for example:

- [x] (2026-02-18 19:30Z) Mapped current policy bridge behavior and confirmed test baseline.
- [ ] Add command-approval integration in runtime start path.
- [ ] Partial item (completed: tests drafted; remaining: edge-case handling).

At every pause, split partial work into done vs remaining explicitly.

## Formatting rules for ExecPlans

When sharing an ExecPlan inside chat, it must be one fenced markdown block labeled `md`.

When storing an ExecPlan in a `.md` file where the entire file is the plan, do not wrap it in triple backticks.

Inside the plan file:

- do not nest code fences,
- show commands/snippets as indented blocks,
- keep prose first (lists are secondary, except `Progress` where checkboxes are required).

## Milestone rules

Milestones must be independently verifiable increments.

Each milestone narrative must explain:

- what new behavior exists after the milestone,
- which files are changed,
- commands to run,
- what result proves success.

## Validation rules

Validation is mandatory. An ExecPlan must define:

- exact commands and working directory,
- expected outputs or pass criteria,
- at least one behavior-level proof (CLI, UI flow, integration output, or test that failed before and passes after).

## Safety and idempotence

Every ExecPlan must include safe retry guidance.

If a step can leave partial state, explain how to recover without destructive commands.

Prefer additive changes that keep tests runnable throughout implementation.

## Decision logging policy

For any design change, add an entry in `Decision Log` with:

- Decision:
- Rationale:
- Date/Author:

If the implementation changes direction mid-way, document why and reflect that in `Progress` and `Plan of Work`.

## Template skeleton

Use this skeleton as the starting point:

# <Short action-oriented title>

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` updated as work proceeds.

This plan follows `.agent/PLANS.md` from repository root.

## Purpose / Big Picture

Explain user-visible value and how to observe it working.

## Progress

- [ ] (YYYY-MM-DD HH:MMZ) Initial step.

## Surprises & Discoveries

- Observation:
  Evidence:

## Decision Log

- Decision:
  Rationale:
  Date/Author:

## Outcomes & Retrospective

Summarize achieved outcomes, remaining gaps, and lessons learned.

## Context and Orientation

Explain repository context and key files for a newcomer.

## Plan of Work

Describe the sequence of concrete edits in prose.

## Concrete Steps

List exact commands with working directory and short expected outputs.

## Validation and Acceptance

Describe behavioral acceptance criteria and required tests.

## Idempotence and Recovery

Describe safe re-run and rollback/recovery guidance.

## Artifacts and Notes

Include concise transcripts/diff snippets that prove progress.

## Interfaces and Dependencies

Specify final interfaces, modules, and signatures to exist.

## Update note requirement

When revising an ExecPlan, append a short note at the bottom stating:

- what changed,
- why it changed,
- when it changed.
