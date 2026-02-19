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
- [ ] Implement `review/start` runtime path (backend + bridge).
- [ ] Render `enteredReviewMode` / `exitedReviewMode` events.
- [ ] Wire `/review` to native API path instead of plain prompt text.
- [ ] Improve `/agent` behavior with runtime-backed status.

### Phase 4 - MCP Operational Panel
- [ ] Wire MCP panel actions to real operations: add/get/remove/login/logout/reload.
- [ ] Surface auth/transport errors and reconnect state.
- [ ] Resync server list after config reload.

### Phase 5 - Apps and Auth
- [ ] Implement `app/list`.
- [ ] Implement `account/read`, `account/login/start`, `account/logout`, `account/rateLimits/read`.
- [ ] Add UI surfaces for auth state and rate limits.

### Phase 6 - Hardening
- [ ] Add feature flags/capability guards for runtime methods.
- [ ] Keep CLI fallback only for unsupported paths.
- [ ] Add regression and contract checks for runtime events and commands.

## API/Type Changes
- [ ] Expand `alicia/frontend/lib/tauri-bridge/types.ts` with:
  - ThreadSummary/ThreadDetail
  - ApprovalRequest/ApprovalDecision
  - TurnDiffUpdate/TurnPlanUpdate
  - ReviewStartResponse
  - AccountState/RateLimitState/AppRecord
- [ ] Update `alicia/frontend/lib/alicia-types.ts` to separate supported vs planned slash commands.
- [ ] Add a structured runtime event envelope for timeline/state updates.

## Acceptance Criteria
- [ ] Slash commands marked as supported call a native runtime endpoint.
- [ ] Approval-required flows are not silently declined.
- [ ] Diff/plan/review updates are visible in real time.
- [ ] Thread/session lifecycle can be managed without manual terminal commands.
- [ ] MCP/Auth/Apps are available via UI with success/error feedback.

## Test Matrix
- [ ] Command/file-change approvals: `accept`, `acceptForSession`, `decline`, `cancel`.
- [ ] Turn streaming: plan/diff/token-usage updates.
- [ ] Thread lifecycle: list/read/resume/fork/archive/unarchive/compact/rollback.
- [ ] Review mode: inline + detached.
- [ ] MCP operations: list/get/add/remove/login/logout/reload.
- [ ] Auth/apps: account read/login/logout/rate limits/app list.
- [ ] Regression: prompt with image/mention/model/sandbox switching.


