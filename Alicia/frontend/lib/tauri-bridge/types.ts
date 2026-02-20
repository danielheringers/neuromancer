export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
export type ApprovalPreset = 'read-only' | 'auto' | 'full-access'
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'
export type WebSearchMode = 'disabled' | 'cached' | 'live'
export type RuntimeReasoning = ReasoningEffort | 'default'

export interface RuntimeCodexConfig {
  model: string
  reasoning: RuntimeReasoning
  approvalPreset: ApprovalPreset
  approvalPolicy: ApprovalPolicy
  sandbox: SandboxMode
  profile: string
  webSearchMode: WebSearchMode
}

export interface StartCodexSessionConfig {
  binary?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface StartCodexSessionResponse {
  sessionId: number
  pid: number
}

export interface RuntimeStatusResponse {
  sessionId?: number
  pid?: number
  workspace: string
  runtimeConfig: RuntimeCodexConfig
}

export const RUNTIME_METHODS = [
  'thread.open',
  'thread.close',
  'thread.list',
  'thread.read',
  'thread.archive',
  'thread.unarchive',
  'thread.compact.start',
  'thread.rollback',
  'thread.fork',
  'turn.run',
  'review.start',
  'turn.steer',
  'turn.interrupt',
  'approval.respond',
  'mcp.warmup',
  'mcp.list',
  'mcp.login',
  'mcp.reload',
  'app.list',
  'account.read',
  'account.login.start',
  'account.logout',
  'account.rate_limits.read',
  'account.rateLimits.read',
  'config.get',
  'config.set',
] as const

export type RuntimeMethod = (typeof RUNTIME_METHODS)[number]

export type RuntimeMethodCapabilities = Record<RuntimeMethod, boolean>

export interface RuntimeCapabilitiesResponse {
  methods: RuntimeMethodCapabilities
  disabledByFlag?: string[]
}

export interface CodexReasoningEffortOption {
  reasoningEffort: ReasoningEffort
  description: string
}

export interface CodexModel {
  id: string
  model: string
  displayName: string
  description: string
  supportedReasoningEfforts: CodexReasoningEffortOption[]
  defaultReasoningEffort: ReasoningEffort
  supportsPersonality: boolean
  isDefault: boolean
  upgrade?: string | null
}

export interface CodexModelListResponse {
  data: CodexModel[]
}

export interface RunCodexCommandResponse {
  stdout: string
  stderr: string
  status: number
  success: boolean
}

export interface McpStartupWarmupResponse {
  readyServers: string[]
  totalReady: number
  elapsedMs: number
}

export interface McpServerRecord {
  id: string
  name: string
  transport: 'stdio' | 'sse' | 'streamable-http'
  status: 'connected' | 'disconnected' | 'error' | 'connecting'
  statusReason?: string | null
  authStatus?: 'unsupported' | 'not_logged_in' | 'bearer_token' | 'oauth'
  tools: string[]
  url?: string
}

export interface McpLoginRequest {
  name: string
  scopes?: string[]
  timeoutSecs?: number
}

export interface McpLoginResponse {
  name: string
  authorizationUrl?: string | null
  started: boolean
  elapsedMs: number
}

export interface McpReloadResponse {
  reloaded: boolean
  elapsedMs: number
}

export interface McpServerListResponse {
  data: McpServerRecord[]
  total: number
  elapsedMs: number
}

export interface AppListRequest {
  cursor?: string | null
  limit?: number | null
  threadId?: string | null
  forceRefetch?: boolean
}

export interface AppRecord {
  id: string
  name: string
  description?: string | null
  logoUrl?: string | null
  logoUrlDark?: string | null
  distributionChannel?: string | null
  installUrl?: string | null
  isAccessible: boolean
  isEnabled: boolean
}

export interface AppListResponse {
  data: AppRecord[]
  nextCursor: string | null
  total: number
  elapsedMs: number
}

export type AccountAuthType =
  | 'api_key'
  | 'chatgpt'
  | 'chatgpt_auth_tokens'
  | 'unknown'

export interface AccountRecord {
  accountType: AccountAuthType
  email?: string | null
  planType?: string | null
}

export interface AccountReadRequest {
  refreshToken?: boolean
}

export interface AccountReadResponse {
  account: AccountRecord | null
  requiresOpenaiAuth: boolean
  authMode: AccountAuthType | 'none'
  elapsedMs: number
}

export interface AccountLoginStartRequest {
  type: 'chatgpt' | 'apiKey' | 'api_key'
  apiKey?: string
}

export interface AccountLoginStartResponse {
  type: AccountAuthType | 'none'
  loginId?: string | null
  authUrl?: string | null
  started: boolean
  elapsedMs: number
}

export interface AccountLogoutResponse {
  loggedOut: boolean
  elapsedMs: number
}

export interface AccountRateLimitWindowRecord {
  usedPercent: number
  windowDurationMins?: number | null
  resetsAt?: number | null
}

export interface AccountCreditsSnapshot {
  hasCredits: boolean
  unlimited: boolean
  balance?: string | null
}

export interface AccountRateLimitSnapshotRecord {
  limitId?: string | null
  limitName?: string | null
  primary?: AccountRateLimitWindowRecord | null
  secondary?: AccountRateLimitWindowRecord | null
  credits?: AccountCreditsSnapshot | null
  planType?: string | null
}

export interface AccountRateLimitsReadResponse {
  rateLimits?: AccountRateLimitSnapshotRecord | null
  rateLimitsByLimitId?: Record<string, AccountRateLimitSnapshotRecord> | null
  elapsedMs: number
}

export interface AccountState {
  authMode: AccountReadResponse["authMode"]
  requiresOpenaiAuth: boolean
  account: AccountRecord | null
}

export interface RateLimitState {
  rateLimits: AccountRateLimitSnapshotRecord | null
  rateLimitsByLimitId: Record<string, AccountRateLimitSnapshotRecord>
}
export interface StreamEventPayload {
  sessionId: number
  chunk: string
}

export interface LifecycleEventPayload {
  status: 'started' | 'stopped' | 'error'
  sessionId?: number
  pid?: number
  exitCode?: number | null
  message?: string | null
}

export interface CodexHelpSnapshot {
  cliTree: string
  slashCommands: string[]
  keyFlags: string[]
}

export type CodexInputItem =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'local_image'
      path: string
    }
  | {
      type: 'mention'
      path: string
    }
  | {
      type: 'skill'
      name: string
    }
  | {
      type: 'image'
      imageUrl: string
    }

export interface CodexTurnRunRequest {
  threadId?: string
  inputItems: CodexInputItem[]
  outputSchema?: Record<string, unknown>
}

export interface CodexTurnRunResponse {
  accepted: boolean
  sessionId: number
  threadId?: string
}

export interface CodexThreadOpenResponse {
  threadId: string
}

export type CodexThreadSortKey = 'created_at' | 'updated_at'

export interface CodexThreadSource {
  kind: string
}

export interface CodexThreadHistoryMessage {
  role: 'user' | 'agent' | 'system'
  content: string
}

export interface CodexThreadTurn {
  id: string
  status: string
  itemCount: number
  messages?: CodexThreadHistoryMessage[]
}

export interface CodexThreadRecord {
  id: string
  codexThreadId?: string
  preview: string
  modelProvider: string
  createdAt: number
  updatedAt: number
  path?: string | null
  cwd?: string
  cliVersion?: string
  source?: CodexThreadSource | string | null
  turnCount?: number
  turns?: CodexThreadTurn[]
}

export type ThreadSummary = CodexThreadRecord

export interface ThreadDetail extends CodexThreadRecord {
  turns: CodexThreadTurn[]
}

export interface CodexThreadListRequest {
  cursor?: string | null
  limit?: number | null
  sortKey?: CodexThreadSortKey | null
  modelProviders?: string[] | null
  sourceKinds?: string[] | null
  archived?: boolean | null
  cwd?: string | null
}

export interface CodexThreadListResponse {
  data: CodexThreadRecord[]
  nextCursor: string | null
}

export interface CodexThreadReadRequest {
  threadId: string
  includeTurns?: boolean
}

export interface CodexThreadReadResponse {
  thread: CodexThreadRecord
}

export interface CodexThreadArchiveRequest {
  threadId: string
}

export interface CodexThreadArchiveResponse {
  id: string
  codexThreadId: string
  archived: boolean
}

export interface CodexThreadUnarchiveRequest {
  threadId: string
}

export interface CodexThreadUnarchiveResponse {
  thread: CodexThreadRecord
}

export interface CodexThreadCompactStartRequest {
  threadId: string
}

export interface CodexThreadCompactStartResponse {
  ok: boolean
  threadId: string
  codexThreadId: string
}

export interface CodexThreadRollbackRequest {
  threadId: string
  numTurns: number
}

export interface CodexThreadRollbackResponse {
  thread: CodexThreadRecord
}

export interface CodexThreadForkRequest {
  threadId: string
  path?: string | null
  model?: string | null
  modelProvider?: string | null
  cwd?: string | null
  persistExtendedHistory?: boolean
}

export interface CodexThreadForkResponse {
  thread: CodexThreadRecord
  threadId?: string
  model?: string
  modelProvider?: string
  cwd?: string
}

export interface CodexTurnSteerRequest {
  threadId: string
  inputItems: CodexInputItem[]
  expectedTurnId: string
}

export interface CodexTurnSteerResponse {
  threadId: string
  codexThreadId: string
  turnId: string
}

export interface CodexTurnInterruptRequest {
  threadId: string
  turnId: string
}

export interface CodexTurnInterruptResponse {
  ok: boolean
  threadId: string
  codexThreadId: string
  turnId: string
}

export type ReviewDelivery = "inline" | "detached"

export type ReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string | null }
  | { type: "custom"; instructions: string }

export interface CodexReviewStartRequest {
  threadId?: string
  target?: ReviewTarget
  delivery?: ReviewDelivery | null
}

export interface CodexReviewStartResponse {
  accepted: boolean
  sessionId: number
  threadId?: string
  reviewThreadId?: string
}

export type ReviewStartResponse = CodexReviewStartResponse

export type ApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel'
  | 'acceptWithExecpolicyAmendment'

export interface CodexApprovalRespondRequest {
  actionId: string
  decision: ApprovalDecision
  remember?: boolean
  execpolicyAmendment?: string[]
}

export interface ApprovalRequest {
  actionId: string
  kind: "command_execution" | "file_change"
  threadId: string
  turnId: string
  itemId?: string
  reason: string
  command?: string
  cwd?: string
  grantRoot?: string
  commandActions?: string[]
  proposedExecpolicyAmendment?: string[]
}

export interface TurnDiffUpdate {
  threadId: string
  turnId: string
  diff: string
}

export type TurnPlanStepStatus = "pending" | "in_progress" | "completed" | "unknown"

export interface TurnPlanStepUpdate {
  step: string
  status: TurnPlanStepStatus
}

export interface TurnPlanUpdate {
  threadId: string
  turnId: string
  explanation?: string | null
  plan: TurnPlanStepUpdate[]
}

export interface RuntimeEventEnvelopeBase {
  type: string
  thread_id?: string
  turn_id?: string
  [key: string]: unknown
}

export interface InvalidRuntimeEventEnvelope {
  type: "__invalid__"
  reason: "invalid-envelope" | "missing-type"
  raw?: unknown
}

export interface ThreadStartedRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "thread.started"
  thread_id: string
}

export interface TurnStartedRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "turn.started"
  thread_id?: string
  turn_id?: string
}

export interface TurnCompletedRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "turn.completed"
}

export interface TurnFailedRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "turn.failed"
  error?: {
    message?: string
    [key: string]: unknown
  }
}

export interface ThreadTokenUsageUpdatedRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "thread.token_usage.updated"
  token_usage?: {
    total?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
      [key: string]: unknown
    }
    [key: string]: unknown
  }
}

export interface TurnDiffUpdatedRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "turn.diff.updated"
  thread_id?: string
  turn_id?: string
  diff?: string
}

export interface TurnPlanUpdatedRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "turn.plan.updated"
  thread_id?: string
  turn_id?: string
  explanation?: string
  plan?: Array<{
    step?: string
    status?: string
    [key: string]: unknown
  }>
}

export interface ApprovalRequestedRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "approval.requested"
  action_id?: string
  kind?: "command_execution" | "file_change"
  thread_id?: string
  turn_id?: string
  item_id?: string
  reason?: string
  command?: string
  cwd?: string
  grant_root?: string
  command_actions?: string[]
  proposed_execpolicy_amendment?: string[]
}

export interface ApprovalResolvedRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "approval.resolved"
  action_id?: string
}

export interface McpOauthLoginCompletedRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "mcp.oauth_login.completed"
  name?: string
  success?: boolean
  error?: string
}

export interface ItemRuntimeEvent extends RuntimeEventEnvelopeBase {
  type: "item.started" | "item.updated" | "item.completed"
  item?: Record<string, unknown>
}

export type CodexRuntimeTimelineEvent =
  | ThreadStartedRuntimeEvent
  | TurnStartedRuntimeEvent
  | TurnCompletedRuntimeEvent
  | TurnFailedRuntimeEvent
  | ThreadTokenUsageUpdatedRuntimeEvent
  | TurnDiffUpdatedRuntimeEvent
  | TurnPlanUpdatedRuntimeEvent
  | ApprovalRequestedRuntimeEvent
  | ApprovalResolvedRuntimeEvent
  | McpOauthLoginCompletedRuntimeEvent
  | ItemRuntimeEvent
  | RuntimeEventEnvelopeBase
  | InvalidRuntimeEventEnvelope

export interface CodexStructuredEventPayload {
  sessionId: number
  seq: number
  event: CodexRuntimeTimelineEvent
}

export interface TerminalCreateRequest {
  cwd?: string
  shell?: string
}

export interface TerminalCreateResponse {
  terminalId: number
}

export interface TerminalDataPayload {
  terminalId: number
  seq: number
  chunk: string
}

export interface TerminalExitPayload {
  terminalId: number
  seq: number
  exitCode?: number | null
}

export type TerminalRuntimeEvent =
  | { type: 'data'; payload: TerminalDataPayload }
  | { type: 'exit'; payload: TerminalExitPayload }

export type CodexRuntimeEvent =
  | { type: 'stdout'; payload: StreamEventPayload }
  | { type: 'stderr'; payload: StreamEventPayload }
  | { type: 'lifecycle'; payload: LifecycleEventPayload }
  | { type: 'event'; payload: CodexStructuredEventPayload }






