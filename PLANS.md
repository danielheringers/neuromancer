# Alicia Codex Parity Plan

## Goal
Cover primary Codex App Server capabilities in Alicia UI, with CLI fallback only when needed.

## Phase Checklist

### Phase 1 - Critical Runtime Parity
- [x] Implement real approval flow (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`) in bridge/backend/UI.
- [x] Remove implicit auto-decline behavior from bridge.
- [x] Render `turn/diff/updated` in UI state (aggregated turn diff).
- [x] Render `turn/plan/updated` in UI state (plan and status).
- [x] Wire existing `approval-request.tsx` and `diff-viewer.tsx` to live runtime events.
- [x] Expose approval actions: `accept`, `acceptForSession`, `decline`, `cancel`.

### Phase 2 - Threads and Turns
- [x] Implement commands for `thread/list`, `thread/read`, `thread/archive`, `thread/unarchive`, `thread/compact/start`, `thread/rollback`.
- [x] Implement `turn/steer` and `turn/interrupt`.
- [x] Update Session picker to work with real thread records.

### Phase 3 - Review and Agentic UX
- [x] Implement `review/start` runtime path (backend + bridge).
- [x] Render `enteredReviewMode` / `exitedReviewMode` events.
- [x] Wire `/review` to native API path instead of plain prompt text.
- [x] Improve `/agent` behavior with runtime-backed status.

### Phase 4 - MCP Operational Panel
- [x] Wire MCP panel actions to real operations: add/get/remove/login/logout/reload.
- [x] Surface auth/transport errors and reconnect state.
- [x] Resync server list after config reload.

### Phase 5 - Apps and Auth
- [x] Implement `app/list`.
- [x] Implement `account/read`, `account/login/start`, `account/logout`, `account/rateLimits/read`.
- [x] Add UI surfaces for auth state and rate limits.

### Phase 6 - Hardening
- [x] Add feature flags/capability guards for runtime methods.
- [x] Keep CLI fallback only for unsupported paths.
- [x] Add regression and contract checks for runtime events and commands.

## API/Type Changes
- [x] Expand `alicia/frontend/lib/tauri-bridge/types.ts` with:
  - ThreadSummary/ThreadDetail
  - ApprovalRequest/ApprovalDecision
  - TurnDiffUpdate/TurnPlanUpdate
  - ReviewStartResponse
  - AccountState/RateLimitState/AppRecord
- [x] Update `alicia/frontend/lib/alicia-types.ts` to separate supported vs planned slash commands.
- [x] Add a structured runtime event envelope for timeline/state updates.

## Acceptance Criteria
- [x] Slash commands marked as supported call a native runtime endpoint.
- [x] Approval-required flows are not silently declined.
- [x] Diff/plan/review updates are visible in real time.
- [x] Thread/session lifecycle can be managed without manual terminal commands.
- [x] MCP/Auth/Apps are available via UI with success/error feedback.

## Test Matrix
- [x] Command/file-change approvals: `accept`, `acceptForSession`, `decline`, `cancel`.
- [x] Turn streaming: plan/diff/token-usage updates.
- [x] Thread lifecycle: list/read/resume/fork/archive/unarchive/compact/rollback.
- [x] Review mode: inline + detached.
- [x] MCP operations: list/get/add/remove/login/logout/reload.
- [x] Auth/apps: account read/login/logout/rate limits/app list.
- [x] Regression: prompt with image/mention/model/sandbox switching.




## Validation Notes
- Automated checks executed: pnpm -C Alicia/frontend run build, pnpm -C Alicia/frontend exec tsc --noEmit, cargo check --manifest-path Alicia/backend/Cargo.toml.
- Approval fallback hardened in bridge: approval request failures now return explicit runtime error instead of implicit decline.
- Thread lifecycle coverage in UI slash flow: /agent archive, /agent unarchive, /agent compact, /agent rollback use native runtime commands.
- Structured event envelope validation active in listeners and event handler with invalid-envelope signaling.

