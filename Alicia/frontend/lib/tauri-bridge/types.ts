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
  tools: string[]
  url?: string
}

export interface McpServerListResponse {
  data: McpServerRecord[]
  total: number
  elapsedMs: number
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

export interface CodexStructuredEventPayload {
  sessionId: number
  seq: number
  event: Record<string, unknown>
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
