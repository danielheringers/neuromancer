export type SpawnedAgentStatus = "pending init" | "running" | "done" | "error"

export interface SpawnedAgent {
  callId: string
  agentId: string
  status: SpawnedAgentStatus
  prompt: string
  ownership: string
  progress?: number
  elapsed?: string
}

export interface WaitingInfo {
  callId: string
  receivers: string[]
}

export interface AgentSpawnerPayload {
  agents: SpawnedAgent[]
  waiting?: WaitingInfo
  timestamp?: string
}

export const AGENT_SPAWNER_MESSAGE_PREFIX = "__ALICIA_AGENT_SPAWNER__:"

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readText(value: unknown): string {
  if (typeof value !== "string") {
    return ""
  }
  return value.trim()
}

function normalizeTool(value: unknown): string {
  const normalized = readText(value).toLowerCase()
  if (normalized === "spawnagent" || normalized === "spawn_agent") {
    return "spawn_agent"
  }
  if (normalized === "sendinput" || normalized === "send_input") {
    return "send_input"
  }
  if (normalized === "resumeagent" || normalized === "resume_agent") {
    return "resume_agent"
  }
  if (normalized === "closeagent" || normalized === "close_agent") {
    return "close_agent"
  }
  if (normalized === "wait") {
    return "wait"
  }
  return normalized
}

function statusFromValue(
  value: unknown,
  fallback: SpawnedAgentStatus,
): SpawnedAgentStatus {
  const normalized = readText(value).toLowerCase()
  if (normalized === "pendinginit" || normalized === "pending init") {
    return "pending init"
  }
  if (normalized === "inprogress" || normalized === "in_progress" || normalized === "running") {
    return "running"
  }
  if (
    normalized === "completed" ||
    normalized === "done" ||
    normalized === "shutdown" ||
    normalized === "success"
  ) {
    return "done"
  }
  if (
    normalized === "failed" ||
    normalized === "errored" ||
    normalized === "error" ||
    normalized === "notfound" ||
    normalized === "not_found"
  ) {
    return "error"
  }
  return fallback
}

function toolStatusFallback(value: unknown): SpawnedAgentStatus {
  const normalized = readText(value).toLowerCase()
  if (normalized === "failed") {
    return "error"
  }
  if (normalized === "completed") {
    return "done"
  }
  return "running"
}

function readStringArray(
  item: Record<string, unknown>,
  keys: string[],
): string[] {
  for (const key of keys) {
    const raw = item[key]
    if (Array.isArray(raw)) {
      const values = raw
        .map((entry) => readText(entry))
        .filter((entry) => entry.length > 0)
      if (values.length > 0) {
        return values
      }
    }

    const single = readText(raw)
    if (single) {
      return [single]
    }
  }

  return []
}

function readStateMap(item: Record<string, unknown>): Record<string, unknown> {
  const candidates = [
    "agentsStates",
    "agents_states",
    "agentStates",
    "agent_states",
  ]
  for (const key of candidates) {
    const value = asObject(item[key])
    if (value) {
      return value
    }
  }
  return {}
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      ordered.push(value)
    }
  }
  return ordered
}

function collabMessageIds(item: Record<string, unknown>): {
  callId: string
  senderThreadId: string
} {
  const callId =
    readText(item.id) ||
    readText(item.callId) ||
    readText(item.call_id) ||
    "collab-call"
  const senderThreadId =
    readText(item.senderThreadId) ||
    readText(item.sender_thread_id)
  return { callId, senderThreadId }
}

export function createAgentSpawnerPayloadFromCollabItem(
  item: Record<string, unknown>,
): AgentSpawnerPayload | null {
  const tool = normalizeTool(item.tool)
  if (!tool) {
    return null
  }

  const { callId, senderThreadId } = collabMessageIds(item)
  const fallbackStatus = toolStatusFallback(item.status)
  const prompt = readText(item.prompt)
  const receiverIds = readStringArray(item, [
    "receiverThreadIds",
    "receiver_thread_ids",
    "receiverThreadId",
    "receiver_thread_id",
    "newThreadId",
    "new_thread_id",
  ])

  const states = readStateMap(item)
  const stateKeys = Object.keys(states).map((entry) => entry.trim()).filter(Boolean)
  const agentIds = unique([...receiverIds, ...stateKeys])

  const agents = agentIds.map((agentId) => {
    const rawState = states[agentId]
    const stateObject = asObject(rawState)
    const stateValue =
      stateObject && "status" in stateObject
        ? (stateObject.status as unknown)
        : rawState
    const status = statusFromValue(stateValue, fallbackStatus)
    const ownership = senderThreadId
      ? `${senderThreadId} -> ${agentId}`
      : agentId

    return {
      callId,
      agentId,
      status,
      prompt,
      ownership,
    } satisfies SpawnedAgent
  })

  let waiting: WaitingInfo | undefined
  if (tool === "wait") {
    const receivers = unique([
      ...agentIds,
      ...readStringArray(item, ["receivers", "receiverIds", "receiver_ids"]),
    ])
    if (receivers.length > 0) {
      waiting = {
        callId,
        receivers,
      }
    }
  }

  if (agents.length === 0 && !waiting) {
    return null
  }

  return {
    agents,
    waiting,
  }
}

export function encodeAgentSpawnerPayload(payload: AgentSpawnerPayload): string {
  return `${AGENT_SPAWNER_MESSAGE_PREFIX}${JSON.stringify(payload)}`
}

function mergeAgentEntry(
  current: SpawnedAgent,
  incoming: SpawnedAgent,
): SpawnedAgent {
  return {
    callId: incoming.callId || current.callId,
    agentId: incoming.agentId || current.agentId,
    status: incoming.status,
    prompt: incoming.prompt || current.prompt,
    ownership: incoming.ownership || current.ownership,
    progress: incoming.progress ?? current.progress,
    elapsed: incoming.elapsed ?? current.elapsed,
  }
}

export function mergeAgentSpawnerPayloads(
  current: AgentSpawnerPayload,
  incoming: AgentSpawnerPayload,
): AgentSpawnerPayload {
  const byKey = new Map<string, SpawnedAgent>()
  const order: string[] = []

  for (const agent of current.agents) {
    const key = `${agent.callId}::${agent.agentId}`
    if (!byKey.has(key)) {
      order.push(key)
      byKey.set(key, agent)
    }
  }

  for (const agent of incoming.agents) {
    const key = `${agent.callId}::${agent.agentId}`
    const existing = byKey.get(key)
    if (existing) {
      byKey.set(key, mergeAgentEntry(existing, agent))
      continue
    }
    order.push(key)
    byKey.set(key, agent)
  }

  const waiting = incoming.waiting ?? current.waiting
  const timestamp = incoming.timestamp ?? current.timestamp

  return {
    agents: order
      .map((key) => byKey.get(key))
      .filter((entry): entry is SpawnedAgent => Boolean(entry)),
    waiting,
    timestamp,
  }
}

function normalizeParsedStatus(value: unknown): SpawnedAgentStatus | null {
  const normalized = readText(value).toLowerCase()
  if (
    normalized === "pending init" ||
    normalized === "running" ||
    normalized === "done" ||
    normalized === "error"
  ) {
    return normalized
  }
  return statusFromValue(value, "running")
}

export function parseAgentSpawnerPayload(
  content: string,
): AgentSpawnerPayload | null {
  if (typeof content !== "string" || !content.startsWith(AGENT_SPAWNER_MESSAGE_PREFIX)) {
    return null
  }

  const raw = content.slice(AGENT_SPAWNER_MESSAGE_PREFIX.length)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const root = asObject(parsed)
  if (!root) {
    return null
  }

  const rawAgents = Array.isArray(root.agents) ? root.agents : []
  const agents: SpawnedAgent[] = []

  for (const entry of rawAgents) {
    const record = asObject(entry)
    if (!record) {
      continue
    }

    const callId = readText(record.callId || record.call_id)
    const agentId = readText(record.agentId || record.agent_id)
    const status = normalizeParsedStatus(record.status)
    const prompt = readText(record.prompt)
    const ownership = readText(record.ownership)

    if (!callId || !agentId || !status || !ownership) {
      continue
    }

    const progress =
      typeof record.progress === "number" && Number.isFinite(record.progress)
        ? record.progress
        : undefined
    const elapsed = readText(record.elapsed) || undefined

    const nextAgent: SpawnedAgent = {
      callId,
      agentId,
      status,
      prompt,
      ownership,
    }

    if (progress !== undefined) {
      nextAgent.progress = progress
    }
    if (elapsed) {
      nextAgent.elapsed = elapsed
    }

    agents.push(nextAgent)
  }
  if (agents.length === 0) {
    return null
  }

  let waiting: WaitingInfo | undefined
  const waitingRecord = asObject(root.waiting)
  if (waitingRecord) {
    const callId = readText(waitingRecord.callId || waitingRecord.call_id)
    const receivers = readStringArray(waitingRecord, [
      "receivers",
      "receiverIds",
      "receiver_ids",
    ])
    if (callId && receivers.length > 0) {
      waiting = { callId, receivers }
    }
  }

  const timestamp = readText(root.timestamp) || undefined

  return {
    agents,
    waiting,
    timestamp,
  }
}

