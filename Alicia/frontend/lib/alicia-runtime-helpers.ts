import {
  type AliciaState,
  type McpServer,
  type ReasoningEffort,
  type Session,
} from "@/lib/alicia-types"
import {
  RUNTIME_METHODS,
  type CodexModel,
  type CodexThreadRecord,
  type CodexThreadTurn,
  type RuntimeCodexConfig,
  type RuntimeMethod,
  type RuntimeMethodCapabilities,
} from "@/lib/tauri-bridge"
import {
  createAgentSpawnerPayloadFromCollabItem,
  encodeAgentSpawnerPayload,
} from "@/lib/agent-spawner-events"

export interface Message {
  id: number
  type: "user" | "agent" | "system"
  content: string
  timestamp: string
}

export type ApprovalRequestKind = "command_execution" | "file_change"

export interface ApprovalRequestState {
  actionId: string
  kind: ApprovalRequestKind
  threadId: string
  turnId: string
  itemId: string
  reason: string
  command: string
  cwd: string
  grantRoot: string
  commandActions: unknown[]
  proposedExecpolicyAmendment: string[]
}

export interface TurnPlanStepState {
  step: string
  status: "pending" | "inProgress" | "completed"
}

export interface TurnPlanState {
  threadId: string
  turnId: string
  explanation: string | null
  plan: TurnPlanStepState[]
}

export interface DiffLineView {
  type: "add" | "remove" | "context"
  content: string
  lineNumber: number
}

export interface DiffFileView {
  filename: string
  lines: DiffLineView[]
}

export interface TurnDiffState {
  threadId: string
  turnId: string
  diff: string
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
function syncAccountRateMethodCapabilities(
  capabilities: RuntimeMethodCapabilities,
): RuntimeMethodCapabilities {
  const accountRateSupported =
    capabilities["account.rate_limits.read"] !== false &&
    capabilities["account.rateLimits.read"] !== false

  if (
    capabilities["account.rate_limits.read"] === accountRateSupported &&
    capabilities["account.rateLimits.read"] === accountRateSupported
  ) {
    return capabilities
  }

  return {
    ...capabilities,
    "account.rate_limits.read": accountRateSupported,
    "account.rateLimits.read": accountRateSupported,
  }
}

export function createDefaultRuntimeMethodCapabilities(): RuntimeMethodCapabilities {
  return Object.fromEntries(
    RUNTIME_METHODS.map((method) => [method, true]),
  ) as RuntimeMethodCapabilities
}

export function normalizeRuntimeMethodCapabilities(
  value: unknown,
  fallback: RuntimeMethodCapabilities = createDefaultRuntimeMethodCapabilities(),
): RuntimeMethodCapabilities {
  const base: RuntimeMethodCapabilities = { ...fallback }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return syncAccountRateMethodCapabilities(base)
  }

  const record = value as Record<string, unknown>
  for (const method of RUNTIME_METHODS) {
    if (typeof record[method] === "boolean") {
      base[method] = record[method] as boolean
    }
  }

  return syncAccountRateMethodCapabilities(base)
}

export function isRuntimeMethodSupported(
  capabilities: RuntimeMethodCapabilities,
  method: RuntimeMethod,
): boolean {
  return capabilities[method] !== false
}

export function markRuntimeMethodUnsupported(
  capabilities: RuntimeMethodCapabilities,
  method: RuntimeMethod,
): RuntimeMethodCapabilities {
  if (capabilities[method] === false) {
    return capabilities
  }

  return normalizeRuntimeMethodCapabilities(
    {
      ...capabilities,
      [method]: false,
    },
    capabilities,
  )
}

export const INITIAL_ALICIA_STATE: AliciaState = {
  model: "default",
  reasoningEffort: "medium",
  approvalPreset: "auto",
  sandboxMode: "read-only",
  runtimeCapabilities: createDefaultRuntimeMethodCapabilities(),
  mcpServers: [],
  apps: [],
  account: {
    authMode: "unknown",
    requiresOpenaiAuth: false,
    account: null,
  },
  rateLimits: null,
  rateLimitsByLimitId: {},
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

function normalizeHistoryMessageRole(value: unknown): Message["type"] | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()

  if (normalized === "user") {
    return "user"
  }
  if (normalized === "agent" || normalized === "assistant") {
    return "agent"
  }
  if (normalized === "system") {
    return "system"
  }

  return null
}

export function mapThreadTurnsToMessages(turns: CodexThreadTurn[]): Message[] {
  const mapped: Message[] = []
  let nextId = -1

  for (const turn of turns) {
    const historyMessages = Array.isArray(turn.messages) ? turn.messages : []
    for (const entry of historyMessages) {
      const role = normalizeHistoryMessageRole(entry.role)
      const content = typeof entry.content === "string" ? entry.content.trim() : ""
      if (!role || content.length === 0) {
        continue
      }
      mapped.push({
        id: nextId,
        type: role,
        content,
        timestamp: timestampNow(),
      })
      nextId -= 1
    }
  }

  return mapped
}
function normalizeEpochSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

function relativeFromEpochSeconds(epochSeconds: number | null): string {
  if (epochSeconds == null) {
    return "unknown"
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const deltaSeconds = Math.max(0, nowSeconds - epochSeconds)

  if (deltaSeconds < 60) {
    return "just now"
  }

  const minutes = Math.floor(deltaSeconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }

  const days = Math.floor(hours / 24)
  if (days === 1) {
    return "yesterday"
  }
  if (days < 7) {
    return `${days}d ago`
  }

  return new Date(epochSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function normalizeThreadSourceKind(
  source: CodexThreadRecord["source"],
): string | null {
  if (typeof source === "string" && source.trim().length > 0) {
    return source.trim()
  }

  if (
    source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    typeof source.kind === "string" &&
    source.kind.trim().length > 0
  ) {
    return source.kind.trim()
  }

  return null
}

function buildThreadSessionName(thread: CodexThreadRecord): string {
  const preview = thread.preview.trim().replace(/\s+/g, " ")
  if (preview.length > 0) {
    return preview.length > 90 ? `${preview.slice(0, 87)}...` : preview
  }

  const shortId = thread.id.trim().slice(0, 8)
  return shortId ? `Thread ${shortId}` : "Thread"
}

interface MapThreadRecordOptions {
  activeThreadId?: string | null
  fallbackModel?: string
}

export function mapThreadRecordToSession(
  thread: CodexThreadRecord,
  options: MapThreadRecordOptions = {},
): Session {
  const normalizedUpdatedAt = normalizeEpochSeconds(thread.updatedAt)
  const normalizedCreatedAt = normalizeEpochSeconds(thread.createdAt)
  const sourceKind = normalizeThreadSourceKind(thread.source)
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  const turnCount =
    typeof thread.turnCount === "number" &&
      Number.isFinite(thread.turnCount) &&
      thread.turnCount >= 0
      ? Math.trunc(thread.turnCount)
      : turns.length

  const canonicalThreadId =
    typeof thread.codexThreadId === "string" && thread.codexThreadId.trim().length > 0
      ? thread.codexThreadId.trim()
      : thread.id
  const activeThreadId =
    typeof options.activeThreadId === "string" ? options.activeThreadId.trim() : ""
  const isActive =
    activeThreadId.length > 0 &&
    (activeThreadId === thread.id || activeThreadId === canonicalThreadId)

  return {
    id: canonicalThreadId,
    threadId: canonicalThreadId,
    name: buildThreadSessionName(thread),
    time: relativeFromEpochSeconds(normalizedUpdatedAt ?? normalizedCreatedAt),
    active: isActive,
    messageCount: turnCount,
    model: thread.modelProvider.trim() || options.fallbackModel || "default",
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedUpdatedAt,
    sourceKind,
    cwd: typeof thread.cwd === "string" && thread.cwd.trim().length > 0
      ? thread.cwd
      : undefined,
  }
}

export function mapThreadRecordsToSessions(
  records: CodexThreadRecord[],
  options: MapThreadRecordOptions = {},
): Session[] {
  const deduped = new Map<string, CodexThreadRecord>()
  for (const record of records) {
    const fallbackId = typeof record?.id === "string" ? record.id.trim() : ""
    const codexId =
      typeof record?.codexThreadId === "string"
        ? record.codexThreadId.trim()
        : ""
    const canonicalId = codexId || fallbackId
    if (!canonicalId || deduped.has(canonicalId)) {
      continue
    }
    deduped.set(canonicalId, {
      ...record,
      id: fallbackId || canonicalId,
      codexThreadId: canonicalId,
    })
  }

  return Array.from(deduped.values())
    .sort((left, right) => {
      const leftUpdated = normalizeEpochSeconds(left.updatedAt) ?? 0
      const rightUpdated = normalizeEpochSeconds(right.updatedAt) ?? 0
      if (leftUpdated !== rightUpdated) {
        return rightUpdated - leftUpdated
      }
      const leftCreated = normalizeEpochSeconds(left.createdAt) ?? 0
      const rightCreated = normalizeEpochSeconds(right.createdAt) ?? 0
      return rightCreated - leftCreated
    })
    .map((record) => mapThreadRecordToSession(record, options))
}

export function isRuntimeCommandUnavailable(error: unknown): boolean {
  const message = String(error ?? "").toLowerCase()
  return (
    message.includes("unknown command") ||
    message.includes("command not found") ||
    message.includes("unsupported method") ||
    message.includes("unsupported command")
  )
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

  const normalizeAuthStatus = (
    raw: unknown,
  ): McpServer["authStatus"] => {
    const value = String(raw ?? "").trim()
    if (value === "notLoggedIn" || value === "not_logged_in") {
      return "not_logged_in"
    }
    if (value === "bearerToken" || value === "bearer_token") {
      return "bearer_token"
    }
    if (value === "oAuth" || value === "oauth" || value === "o_auth") {
      return "oauth"
    }
    return "unsupported"
  }

  const statusFromAuth = (
    authStatus: McpServer["authStatus"],
  ): McpServer["status"] => (authStatus === "not_logged_in" ? "disconnected" : "connected")

  const reasonFromAuth = (
    authStatus: McpServer["authStatus"],
  ): string | null => {
    if (authStatus === "not_logged_in") {
      return "OAuth required"
    }
    if (authStatus === "bearer_token") {
      return "Using bearer token auth"
    }
    if (authStatus === "oauth") {
      return "OAuth connected"
    }
    return null
  }

  try {
    const parsed = JSON.parse(output) as unknown
    if (Array.isArray(parsed)) {
      const mapped = parsed
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null
          }

          const record = entry as Record<string, unknown>
          const name =
            typeof record.name === "string" ? record.name.trim() : ""
          if (!name) {
            return null
          }

          const transportConfig =
            record.transport &&
            typeof record.transport === "object" &&
            !Array.isArray(record.transport)
              ? (record.transport as Record<string, unknown>)
              : null

          const transportType = String(transportConfig?.type ?? "stdio").trim().toLowerCase()
          const transport: McpServer["transport"] =
            transportType === "sse"
              ? "sse"
              : transportType === "streamable_http" || transportType === "streamable-http"
                ? "streamable-http"
                : "stdio"

          const authStatus = normalizeAuthStatus(record.auth_status ?? record.authStatus)

          const statusReason = reasonFromAuth(authStatus)
          const url =
            typeof transportConfig?.url === "string" && transportConfig.url.trim().length > 0
              ? transportConfig.url.trim()
              : undefined

          return {
            id: makeUniqueId(name),
            name,
            transport,
            status: statusFromAuth(authStatus),
            statusReason,
            authStatus,
            tools: [],
            url,
          } as McpServer
        })
        .filter((entry): entry is McpServer => entry !== null)

      mapped.sort((a, b) => a.name.localeCompare(b.name))
      return mapped
    }
  } catch {
    // fall through to plain-text parsing
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
        authStatus: "unsupported",
        statusReason: null,
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
  if (
    itemType === "collab_tool_call" ||
    itemType === "collabToolCall" ||
    itemType === "collabAgentToolCall"
  ) {
    const payload = createAgentSpawnerPayloadFromCollabItem(item)
    if (payload) {
      return encodeAgentSpawnerPayload(payload)
    }

    const tool = String(item.tool ?? "collab")
    const status = String(item.status ?? "in_progress")
    return `[collab:${status}] ${tool}`
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

  if (itemType === "entered_review_mode" || itemType === "enteredReviewMode") {
    const review = String(item.review ?? "").trim()
    return review ? `[review] started: ${review}` : "[review] started"
  }

  if (itemType === "exited_review_mode" || itemType === "exitedReviewMode") {
    const review = String(item.review ?? "").trim()
    return review ? `[review] completed\n${review}` : "[review] completed"
  }

  if (itemType === "error") {
    return `[error] ${String(item.message ?? "unknown")}`
  }
  return null
}

export function normalizePlanStepStatus(value: unknown): "pending" | "inProgress" | "completed" {
  const normalized = String(value ?? "pending")
  if (normalized === "inProgress" || normalized === "in_progress") {
    return "inProgress"
  }
  if (normalized === "completed") {
    return "completed"
  }
  return "pending"
}

export function parseUnifiedDiffFiles(diff: string): DiffFileView[] {
  const trimmed = diff.trim()
  if (!trimmed) {
    return []
  }

  const files: DiffFileView[] = []
  let current: DiffFileView | null = null
  let oldLine = 0
  let newLine = 0

  const ensureCurrent = (fallback = "changes.diff"): DiffFileView => {
    if (current) {
      return current
    }

    current = {
      filename: fallback,
      lines: [],
    }
    files.push(current)
    oldLine = 0
    newLine = 0
    return current
  }

  const startFile = (filename: string) => {
    current = {
      filename,
      lines: [],
    }
    files.push(current)
    oldLine = 0
    newLine = 0
  }

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      const match = rawLine.match(/^diff --git a\/(.+?) b\/(.+)$/)
      const filename = match?.[2] ?? "changes.diff"
      startFile(filename)
      continue
    }

    if (rawLine.startsWith("+++ ")) {
      const value = rawLine.slice(4).trim()
      if (value && value !== "/dev/null") {
        const nextFilename = value.replace(/^b\//, "")
        ensureCurrent(nextFilename).filename = nextFilename
      }
      continue
    }

    if (rawLine.startsWith("@@")) {
      const match = rawLine.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
      if (match) {
        oldLine = Number(match[1])
        newLine = Number(match[2])
      }
      continue
    }

    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      const target = ensureCurrent()
      target.lines.push({
        type: "add",
        content: rawLine.slice(1),
        lineNumber: newLine > 0 ? newLine : target.lines.length + 1,
      })
      if (newLine > 0) {
        newLine += 1
      }
      continue
    }

    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      const target = ensureCurrent()
      target.lines.push({
        type: "remove",
        content: rawLine.slice(1),
        lineNumber: oldLine > 0 ? oldLine : target.lines.length + 1,
      })
      if (oldLine > 0) {
        oldLine += 1
      }
      continue
    }

    if (rawLine.startsWith(" ")) {
      const target = ensureCurrent()
      target.lines.push({
        type: "context",
        content: rawLine.slice(1),
        lineNumber: newLine > 0 ? newLine : target.lines.length + 1,
      })
      if (oldLine > 0) {
        oldLine += 1
      }
      if (newLine > 0) {
        newLine += 1
      }
    }
  }

  return files.filter((file) => file.lines.length > 0)
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






