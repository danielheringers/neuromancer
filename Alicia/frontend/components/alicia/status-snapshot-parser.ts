export interface UsageWindow {
  percent: number
  used: number
  resetsIn: string
}

export interface StatusData {
  mode: string
  sessionId: number
  pid: number
  thread: string | null
  workspace: string
  model: string
  reasoning: string
  approval: string
  sandbox: string
  webSearch: string
  limitId: string
  remaining5h: UsageWindow
  remainingWeek: UsageWindow
}

const DEFAULT_WINDOW: UsageWindow = {
  percent: 0,
  used: 0,
  resetsIn: "n/a",
}

function parseSession(session: string): { sessionId: number; pid: number } {
  const fullMatch = session.match(/#?(\d+)\s*\(pid\s*(\d+)\)/i)
  if (fullMatch) {
    return {
      sessionId: Number(fullMatch[1]),
      pid: Number(fullMatch[2]),
    }
  }

  const sessionId = Number(session.match(/#?(\d+)/)?.[1] || 0)
  const pid = Number(session.match(/pid\s*(\d+)/i)?.[1] || 0)
  return { sessionId, pid }
}

function parseWindow(value: string): UsageWindow {
  const fullMatch = value.match(
    /^([0-9]+(?:\.[0-9]+)?)%\s+remaining\s+\(([0-9]+(?:\.[0-9]+)?)%\s+used\),\s+resets\s+in\s+(.+)$/i,
  )

  if (fullMatch) {
    return {
      percent: Math.max(0, Math.min(100, Number(fullMatch[1]))),
      used: Math.max(0, Number(fullMatch[2])),
      resetsIn: fullMatch[3].trim(),
    }
  }

  const percent = Number(value.match(/([0-9]+(?:\.[0-9]+)?)%\s+remaining/i)?.[1] || 0)
  const used = Number(value.match(/\(([0-9]+(?:\.[0-9]+)?)%\s+used\)/i)?.[1] || 0)
  const resetsIn = value.match(/resets\s+in\s+(.+)$/i)?.[1]?.trim() || "n/a"

  return {
    percent: Math.max(0, Math.min(100, percent)),
    used: Math.max(0, used),
    resetsIn,
  }
}

export function parseStatusSnapshot(content: string): StatusData | null {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0 || lines[0] !== "/status") {
    return null
  }

  const parsed: StatusData = {
    mode: "unknown",
    sessionId: 0,
    pid: 0,
    thread: null,
    workspace: "",
    model: "",
    reasoning: "",
    approval: "",
    sandbox: "",
    webSearch: "",
    limitId: "",
    remaining5h: { ...DEFAULT_WINDOW },
    remainingWeek: { ...DEFAULT_WINDOW },
  }

  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":")
    if (separator <= 0) {
      continue
    }

    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (key === "mode") {
      parsed.mode = value
      continue
    }

    if (key === "session") {
      const sessionValues = parseSession(value)
      parsed.sessionId = sessionValues.sessionId
      parsed.pid = sessionValues.pid
      continue
    }

    if (key === "thread") {
      parsed.thread = value.toLowerCase() === "n/a" ? null : value
      continue
    }

    if (key === "workspace") {
      parsed.workspace = value
      continue
    }

    if (key === "model") {
      parsed.model = value
      continue
    }

    if (key === "reasoning") {
      parsed.reasoning = value
      continue
    }

    if (key === "approval") {
      parsed.approval = value
      continue
    }

    if (key === "sandbox") {
      parsed.sandbox = value
      continue
    }

    if (key === "web search") {
      parsed.webSearch = value
      continue
    }

    if (key === "limit id") {
      parsed.limitId = value
      continue
    }

    if (key === "remaining 5h") {
      parsed.remaining5h = parseWindow(value)
      continue
    }

    if (key === "remaining week") {
      parsed.remainingWeek = parseWindow(value)
    }
  }

  return parsed
}
