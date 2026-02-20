import { invoke } from '@tauri-apps/api/core'

import type {
  CodexApprovalRespondRequest,
  CodexHelpSnapshot,
  CodexModelListResponse,
  CodexThreadArchiveRequest,
  CodexThreadArchiveResponse,
  CodexThreadCompactStartRequest,
  CodexThreadCompactStartResponse,
  CodexThreadForkRequest,
  CodexThreadForkResponse,
  CodexThreadListRequest,
  CodexThreadListResponse,
  CodexThreadOpenResponse,
  CodexThreadReadRequest,
  CodexThreadReadResponse,
  CodexThreadRollbackRequest,
  CodexThreadRollbackResponse,
  CodexThreadUnarchiveRequest,
  CodexThreadUnarchiveResponse,
  CodexTurnInterruptRequest,
  CodexTurnInterruptResponse,
  CodexReviewStartRequest,
  CodexReviewStartResponse,
  CodexTurnRunRequest,
  CodexTurnRunResponse,
  CodexTurnSteerRequest,
  CodexTurnSteerResponse,
  McpLoginRequest,
  McpLoginResponse,
  McpReloadResponse,
  McpServerListResponse,
  McpStartupWarmupResponse,
  AppListRequest,
  AppListResponse,
  AccountReadRequest,
  AccountReadResponse,
  AccountLoginStartRequest,
  AccountLoginStartResponse,
  AccountLogoutResponse,
  AccountRateLimitsReadResponse,
  RunCodexCommandResponse,
  RuntimeCodexConfig,
  RuntimeStatusResponse,
  RuntimeCapabilitiesResponse,
  StartCodexSessionConfig,
  StartCodexSessionResponse,
  TerminalCreateRequest,
  TerminalCreateResponse,
} from '@/lib/tauri-bridge/types'

export async function codexRuntimeStatus(): Promise<RuntimeStatusResponse> {
  return invoke<RuntimeStatusResponse>('codex_runtime_status')
}

export async function codexRuntimeCapabilities(): Promise<RuntimeCapabilitiesResponse> {
  return invoke<RuntimeCapabilitiesResponse>('codex_runtime_capabilities')
}

export async function loadCodexDefaultConfig(): Promise<RuntimeCodexConfig> {
  return invoke<RuntimeCodexConfig>('load_codex_default_config')
}

export async function codexBridgeStart(
  config?: StartCodexSessionConfig,
): Promise<StartCodexSessionResponse> {
  return invoke<StartCodexSessionResponse>('codex_bridge_start', { config })
}

export async function codexBridgeStop(): Promise<void> {
  await invoke('codex_bridge_stop')
}

export async function startCodexSession(
  config?: StartCodexSessionConfig,
): Promise<StartCodexSessionResponse> {
  return invoke<StartCodexSessionResponse>('start_codex_session', { config })
}

export async function stopCodexSession(): Promise<void> {
  await invoke('stop_codex_session')
}

export async function codexTurnRun(
  request: CodexTurnRunRequest,
): Promise<CodexTurnRunResponse> {
  return invoke<CodexTurnRunResponse>('codex_turn_run', { request })
}

export async function codexTurnSteer(
  request: CodexTurnSteerRequest,
): Promise<CodexTurnSteerResponse> {
  return invoke<CodexTurnSteerResponse>('codex_turn_steer', { request })
}

export async function codexTurnInterrupt(
  request: CodexTurnInterruptRequest,
): Promise<CodexTurnInterruptResponse> {
  return invoke<CodexTurnInterruptResponse>('codex_turn_interrupt', { request })
}
export async function codexReviewStart(
  request: CodexReviewStartRequest,
): Promise<CodexReviewStartResponse> {
  return invoke<CodexReviewStartResponse>('codex_review_start', { request })
}

export async function codexThreadOpen(
  threadId?: string,
): Promise<CodexThreadOpenResponse> {
  return invoke<CodexThreadOpenResponse>('codex_thread_open', { threadId })
}

export async function codexThreadList(
  request?: CodexThreadListRequest,
): Promise<CodexThreadListResponse> {
  return invoke<CodexThreadListResponse>('codex_thread_list', { request })
}

export async function codexThreadRead(
  request: CodexThreadReadRequest,
): Promise<CodexThreadReadResponse> {
  return invoke<CodexThreadReadResponse>('codex_thread_read', { request })
}

export async function codexThreadArchive(
  request: CodexThreadArchiveRequest,
): Promise<CodexThreadArchiveResponse> {
  return invoke<CodexThreadArchiveResponse>('codex_thread_archive', { request })
}

export async function codexThreadUnarchive(
  request: CodexThreadUnarchiveRequest,
): Promise<CodexThreadUnarchiveResponse> {
  return invoke<CodexThreadUnarchiveResponse>('codex_thread_unarchive', {
    request,
  })
}

export async function codexThreadCompactStart(
  request: CodexThreadCompactStartRequest,
): Promise<CodexThreadCompactStartResponse> {
  return invoke<CodexThreadCompactStartResponse>('codex_thread_compact_start', {
    request,
  })
}

export async function codexThreadRollback(
  request: CodexThreadRollbackRequest,
): Promise<CodexThreadRollbackResponse> {
  return invoke<CodexThreadRollbackResponse>('codex_thread_rollback', { request })
}

export async function codexThreadFork(
  request: CodexThreadForkRequest,
): Promise<CodexThreadForkResponse> {
  return invoke<CodexThreadForkResponse>('codex_thread_fork', { request })
}

export async function codexApprovalRespond(
  request: CodexApprovalRespondRequest,
): Promise<void> {
  await invoke('codex_approval_respond', { request })
}

export async function sendCodexInput(text: string): Promise<void> {
  await invoke('send_codex_input', { text })
}

export async function updateCodexRuntimeConfig(
  config: RuntimeCodexConfig,
): Promise<RuntimeCodexConfig> {
  return invoke<RuntimeCodexConfig>('update_codex_config', { config })
}

export async function codexConfigGet(): Promise<RuntimeCodexConfig> {
  return invoke<RuntimeCodexConfig>('codex_config_get')
}

export async function codexConfigSet(
  patch: RuntimeCodexConfig,
): Promise<RuntimeCodexConfig> {
  return invoke<RuntimeCodexConfig>('codex_config_set', { patch })
}

export async function runCodexCommand(
  args: string[],
  cwd?: string,
): Promise<RunCodexCommandResponse> {
  return invoke<RunCodexCommandResponse>('run_codex_command', { args, cwd })
}

export async function codexModelsList(): Promise<CodexModelListResponse> {
  return invoke<CodexModelListResponse>('codex_models_list')
}

export async function codexWaitForMcpStartup(): Promise<McpStartupWarmupResponse> {
  return invoke<McpStartupWarmupResponse>('codex_wait_for_mcp_startup')
}

export async function codexMcpList(): Promise<McpServerListResponse> {
  return invoke<McpServerListResponse>('codex_mcp_list')
}

export async function codexAppList(
  request?: AppListRequest,
): Promise<AppListResponse> {
  return invoke<AppListResponse>('codex_app_list', { request })
}

export async function codexAccountRead(
  request?: AccountReadRequest,
): Promise<AccountReadResponse> {
  return invoke<AccountReadResponse>('codex_account_read', { request })
}

export async function codexAccountLoginStart(
  request: AccountLoginStartRequest,
): Promise<AccountLoginStartResponse> {
  return invoke<AccountLoginStartResponse>('codex_account_login_start', { request })
}

export async function codexAccountLogout(): Promise<AccountLogoutResponse> {
  return invoke<AccountLogoutResponse>('codex_account_logout')
}

export async function codexAccountRateLimitsRead(): Promise<AccountRateLimitsReadResponse> {
  return invoke<AccountRateLimitsReadResponse>('codex_account_rate_limits_read')
}
export async function codexMcpLogin(
  request: McpLoginRequest,
): Promise<McpLoginResponse> {
  return invoke<McpLoginResponse>('codex_mcp_login', { request })
}

export async function codexMcpReload(): Promise<McpReloadResponse> {
  return invoke<McpReloadResponse>('codex_mcp_reload')
}

export async function terminalCreate(
  request?: TerminalCreateRequest,
): Promise<TerminalCreateResponse> {
  return invoke<TerminalCreateResponse>('terminal_create', { request })
}

export async function terminalWrite(
  terminalId: number,
  data: string,
): Promise<void> {
  await invoke('terminal_write', {
    request: { terminalId, data },
  })
}

export async function terminalResize(
  terminalId: number,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke('terminal_resize', {
    request: { terminalId, cols, rows },
  })
}

export async function terminalKill(terminalId: number): Promise<void> {
  await invoke('terminal_kill', {
    request: { terminalId },
  })
}

export async function pickImageFile(): Promise<string | null> {
  return invoke<string | null>('pick_image_file')
}

export async function pickMentionFile(): Promise<string | null> {
  return invoke<string | null>('pick_mention_file')
}

export async function codexHelpSnapshot(): Promise<CodexHelpSnapshot> {
  return invoke<CodexHelpSnapshot>('codex_help_snapshot')
}

export async function resizeCodexPty(rows: number, cols: number): Promise<void> {
  await invoke('resize_codex_pty', { rows, cols })
}





