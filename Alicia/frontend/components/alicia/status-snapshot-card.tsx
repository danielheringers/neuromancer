"use client"

import {
  Monitor,
  Hash,
  GitBranch,
  Cpu,
  Brain,
  ShieldCheck,
  Box,
  Globe,
  Gauge,
  Clock,
  TrendingDown,
  Server,
} from "lucide-react"

interface UsageWindow {
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

interface StatusDashboardProps {
  data: StatusData
  timestamp?: string
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

function UsageBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background/80">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  )
}

function Row({
  icon: Icon,
  label,
  value,
  valueColor,
}: {
  icon: typeof Monitor
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground/50" />
      <span className="w-24 shrink-0 text-[11px] text-muted-foreground/70">{label}</span>
      <span className={`truncate text-[11px] font-medium ${valueColor || "text-terminal-fg"}`}>{value}</span>
    </div>
  )
}

export function StatusDashboard({ data, timestamp }: StatusDashboardProps) {
  const remainingWeekColor =
    data.remainingWeek.percent > 50
      ? "bg-terminal-green"
      : data.remainingWeek.percent > 20
        ? "bg-terminal-gold"
        : "bg-terminal-red"

  const remainingWeekTextColor =
    data.remainingWeek.percent > 50
      ? "text-terminal-green"
      : data.remainingWeek.percent > 20
        ? "text-terminal-gold"
        : "text-terminal-red"

  return (
    <div className="w-full max-w-xl overflow-hidden rounded-lg border border-panel-border bg-panel-bg">
      <div className="flex items-center justify-between border-b border-panel-border bg-terminal-bg/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded border border-terminal-green/20 bg-terminal-green/15">
            <Monitor className="h-3 w-3 text-terminal-green" />
          </div>
          <span className="text-xs font-bold text-terminal-green">/status</span>
        </div>
        <span className="tabular-nums text-[10px] text-muted-foreground/40">{timestamp || ""}</span>
      </div>

      <div className="px-3 py-2.5">
        <div className="grid grid-cols-2 gap-x-6">
          <Row icon={Cpu} label="mode" value={data.mode} valueColor="text-terminal-cyan" />
          <Row icon={Hash} label="session" value={`#${data.sessionId} (pid ${data.pid})`} />
          <Row icon={GitBranch} label="thread" value={data.thread || "n/a"} valueColor="text-muted-foreground/50" />
          <Row icon={Brain} label="model" value={data.model} valueColor="text-terminal-purple" />
          <Row icon={Gauge} label="reasoning" value={data.reasoning} valueColor="text-terminal-gold" />
          <Row icon={ShieldCheck} label="approval" value={data.approval} valueColor="text-terminal-blue" />
          <Row
            icon={Box}
            label="sandbox"
            value={data.sandbox}
            valueColor={data.sandbox === "read-only" ? "text-terminal-green" : "text-terminal-gold"}
          />
          <Row icon={Globe} label="web search" value={data.webSearch} />
          <Row icon={Server} label="limit id" value={data.limitId} />
        </div>

        <div className="mt-0.5 flex items-center gap-2 py-[3px]">
          <Monitor className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          <span className="w-24 shrink-0 text-[11px] text-muted-foreground/70">workspace</span>
          <span className="truncate text-[11px] text-terminal-cyan" title={data.workspace}>
            {data.workspace}
          </span>
        </div>

        <div className="my-2 border-t border-panel-border" />

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground/70">remaining 5h</span>
              </div>
              <span className="text-[10px] text-muted-foreground/50">
                resets in {data.remaining5h.resetsIn}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <UsageBar percent={data.remaining5h.percent} color="bg-terminal-green" />
              <span className="w-16 text-right text-[10px] font-medium tabular-nums text-terminal-green">
                {data.remaining5h.percent}%
              </span>
            </div>
            <span className="pl-[18px] text-[9px] text-muted-foreground/40">{data.remaining5h.used}% used</span>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <TrendingDown className="h-3 w-3 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground/70">remaining week</span>
              </div>
              <span className="text-[10px] text-muted-foreground/50">
                resets in {data.remainingWeek.resetsIn}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <UsageBar percent={data.remainingWeek.percent} color={remainingWeekColor} />
              <span className={`w-16 text-right text-[10px] font-medium tabular-nums ${remainingWeekTextColor}`}>
                {data.remainingWeek.percent}%
              </span>
            </div>
            <span className="pl-[18px] text-[9px] text-muted-foreground/40">{data.remainingWeek.used}% used</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function StatusSnapshotCard({ snapshot, timestamp }: { snapshot: StatusData; timestamp?: string }) {
  return <StatusDashboard data={snapshot} timestamp={timestamp} />
}
