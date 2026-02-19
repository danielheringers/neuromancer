import {
  type AliciaState,
  type McpServer,
  type ReasoningEffort,
} from "@/lib/alicia-types"
import { type CodexModel, type RuntimeCodexConfig } from "@/lib/tauri-bridge"

export interface Message {
  id: number
  type: "user" | "agent" | "system"
  content: string
  timestamp: string
}

export interface RuntimeState {
  connected: boolean
  state: "idle" | "starting" | "running" | "stopping" | "error"
  sessionId: number | null
  pid: number | null
  workspace: string
}

export interface TerminalTab {
  id: number
  title: string
  alive: boolean
}

export const INITIAL_ALICIA_STATE: AliciaState = {
  model: "default",
  reasoningEffort: "medium",
  approvalPreset: "auto",
  sandboxMode: "read-only",
  mcpServers: [],
  sessions: [],
  fileChanges: [],
  activePanel: null,
}

const MODELS_CACHE_KEY = "alicia.codex.models.catalog.v1"
const AUTO_TERMINAL_BOOT_KEY = "__alicia_auto_terminal_boot_done__"

interface ModelsCachePayload {
  cachedAt: number
  data: CodexModel[]
}

export function readModelsCache(): ModelsCachePayload | null {
  if (typeof window === "undefined") {
    return null
  }
  try {
    const raw = window.localStorage.getItem(MODELS_CACHE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as { cachedAt?: unknown; data?: unknown }
    if (
      typeof parsed.cachedAt !== "number" ||
      !Number.isFinite(parsed.cachedAt)
    ) {
      return null
    }
    if (!Array.isArray(parsed.data)) {
      return null
    }
    return { cachedAt: parsed.cachedAt, data: parsed.data as CodexModel[] }
  } catch {
    return null
  }
}

export function writeModelsCache(payload: ModelsCachePayload): void {
  if (typeof window === "undefined") {
    return
  }
  try {
    window.localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // best effort
  }
}

export function wasAutoTerminalBootDone(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  const scopedWindow = window as unknown as Record<string, unknown>
  return scopedWindow[AUTO_TERMINAL_BOOT_KEY] === true
}

export function markAutoTerminalBootDone(done: boolean): void {
  if (typeof window === "undefined") {
    return
  }
  const scopedWindow = window as unknown as Record<string, unknown>
  scopedWindow[AUTO_TERMINAL_BOOT_KEY] = done
}

export function timestampNow(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function relativeNowLabel(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function parseMcpListOutput(output: string): McpServer[] {
  const seenIds = new Map<string, number>()

  const stripAnsi = (value: string) =>
    value
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/\u001b\][^\u0007]*\u0007/g, "")

  const makeUniqueId = (name: string): string => {
    const baseId =
      name
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-|-$/g, "") || "server"
    const count = seenIds.get(baseId) ?? 0
    seenIds.set(baseId, count + 1)
    return count === 0 ? baseId : `${baseId}-${count + 1}`
  }

  return output
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean)
    .filter((line) => {
      if (/^[\-+=|\s]+$/.test(line)) {
        return false
      }
      return !/^name(\s|$)/i.test(line)
    })
    .map((line) => {
      const name = line.split(/\s+/)[0]
      let status: McpServer["status"] = "disconnected"
      if (/(connected|online|ready|ok)/i.test(line)) {
        status = "connected"
      } else if (/(error|failed|offline)/i.test(line)) {
        status = "error"
      }
      return {
        id: makeUniqueId(name),
        name,
        status,
        transport: /sse/i.test(line) ? "sse" : "stdio",
        tools: [],
      }
    })
}

export function normalizeConfig(config: RuntimeCodexConfig) {
  return {
    model: config.model.trim() || "default",
    reasoningEffort: (
      ["none", "minimal", "low", "medium", "high", "xhigh"].includes(
        config.reasoning,
      )
        ? config.reasoning
        : "medium"
    ) as ReasoningEffort,
    approvalPreset:
      config.approvalPreset === "read-only" ||
      config.approvalPreset === "auto" ||
      config.approvalPreset === "full-access"
        ? config.approvalPreset
        : config.sandbox === "read-only"
          ? "read-only"
          : config.sandbox === "danger-full-access" &&
              config.approvalPolicy === "never"
            ? "full-access"
            : "auto",
    sandboxMode:
      config.sandbox === "read-only" ||
      config.sandbox === "workspace-write" ||
      config.sandbox === "danger-full-access"
        ? config.sandbox
        : "read-only",
  }
}

export function formatStructuredItem(
  item: Record<string, unknown>,
): string | null {
  const itemType = String(item.type ?? "")
  if (itemType === "agent_message") {
    const text = String(item.text ?? "")
    return text.trim() ? text : null
  }
  if (itemType === "command_execution") {
    const command = String(item.command ?? "command")
    const status = String(item.status ?? "in_progress")
    const output = String(item.aggregated_output ?? "")
    return `[command:${status}] ${command}${output ? `\n${output}` : ""}`
  }
  if (itemType === "mcp_tool_call") {
    return `[mcp:${String(item.status ?? "in_progress")}] ${String(item.tool ?? "tool")}`
  }
  if (itemType === "file_change") {
    return "[file_change] changes applied"
  }
  if (itemType === "reasoning") {
    return `[reasoning]\n${String(item.text ?? "")}`
  }
  if (itemType === "error") {
    return `[error] ${String(item.message ?? "unknown")}`
  }
  return null
}

export function itemIdentity(item: Record<string, unknown>): string | null {
  if (typeof item.id === "string" && item.id.trim().length > 0) {
    return item.id
  }
  if (typeof item.id === "number" && Number.isFinite(item.id)) {
    return String(item.id)
  }
  return null
}

export function mergeTerminalBuffer(previous: string, chunk: string): string {
  const next = `${previous}${chunk}`
  const max = 400_000
  return next.length <= max ? next : next.slice(next.length - max)
}

