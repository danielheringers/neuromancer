"use client"

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
export type ApprovalPreset = "read-only" | "auto" | "full-access"
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"
export type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never"
export type WebSearchMode = "disabled" | "cached" | "live"
export type RuntimeReasoning = ReasoningEffort | "default"

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

export interface RunCodexCommandResponse {
  stdout: string
  stderr: string
  status: number
  success: boolean
}

export interface StreamEventPayload {
  sessionId: number
  chunk: string
}

export interface LifecycleEventPayload {
  status: "started" | "stopped" | "error"
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

export type CodexRuntimeEvent =
  | { type: "stdout"; payload: StreamEventPayload }
  | { type: "stderr"; payload: StreamEventPayload }
  | { type: "lifecycle"; payload: LifecycleEventPayload }

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function normalizeStreamPayload(payload: unknown): StreamEventPayload {
  const source = (payload ?? {}) as Record<string, unknown>
  return {
    sessionId: asNumber(source.sessionId ?? source.session_id) ?? 0,
    chunk: String(source.chunk ?? ""),
  }
}

function normalizeLifecyclePayload(payload: unknown): LifecycleEventPayload {
  const source = (payload ?? {}) as Record<string, unknown>
  const status = String(source.status ?? "error") as LifecycleEventPayload["status"]
  return {
    status,
    sessionId: asNumber(source.sessionId ?? source.session_id),
    pid: asNumber(source.pid),
    exitCode: asNumber(source.exitCode ?? source.exit_code),
    message: source.message == null ? null : String(source.message),
  }
}

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false
  }

  return "__TAURI_INTERNALS__" in window
}

export async function listenToCodexEvents(
  onEvent: (event: CodexRuntimeEvent) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined
  }

  const unlistenFns: UnlistenFn[] = await Promise.all([
    listen("codex://stdout", (event) => {
      onEvent({ type: "stdout", payload: normalizeStreamPayload(event.payload) })
    }),
    listen("codex://stderr", (event) => {
      onEvent({ type: "stderr", payload: normalizeStreamPayload(event.payload) })
    }),
    listen("codex://lifecycle", (event) => {
      onEvent({ type: "lifecycle", payload: normalizeLifecyclePayload(event.payload) })
    }),
  ])

  return () => {
    for (const unlisten of unlistenFns) {
      unlisten()
    }
  }
}

export async function codexRuntimeStatus(): Promise<RuntimeStatusResponse> {
  return invoke<RuntimeStatusResponse>("codex_runtime_status")
}

export async function loadCodexDefaultConfig(): Promise<RuntimeCodexConfig> {
  return invoke<RuntimeCodexConfig>("load_codex_default_config")
}

export async function startCodexSession(
  config?: StartCodexSessionConfig,
): Promise<StartCodexSessionResponse> {
  return invoke<StartCodexSessionResponse>("start_codex_session", { config })
}

export async function stopCodexSession(): Promise<void> {
  await invoke("stop_codex_session")
}

export async function sendCodexInput(text: string): Promise<void> {
  await invoke("send_codex_input", { text })
}

export async function updateCodexRuntimeConfig(
  config: RuntimeCodexConfig,
): Promise<RuntimeCodexConfig> {
  return invoke<RuntimeCodexConfig>("update_codex_config", { config })
}

export async function runCodexCommand(
  args: string[],
  cwd?: string,
): Promise<RunCodexCommandResponse> {
  return invoke<RunCodexCommandResponse>("run_codex_command", { args, cwd })
}

export async function pickImageFile(): Promise<string | null> {
  return invoke<string | null>("pick_image_file")
}

export async function pickMentionFile(): Promise<string | null> {
  return invoke<string | null>("pick_mention_file")
}

export async function codexHelpSnapshot(): Promise<CodexHelpSnapshot> {
  return invoke<CodexHelpSnapshot>("codex_help_snapshot")
}

export async function resizeCodexPty(rows: number, cols: number): Promise<void> {
  await invoke("resize_codex_pty", { rows, cols })
}
