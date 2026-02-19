"use client"

import {
  Bot,
  Clock,
  FileCode2,
  FolderTree,
  GitBranch,
  Layers,
  MessageSquare,
  Settings,
  Cpu,
  Zap,
  Shield,
  PlugZap,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  GitFork,
  Plus,
  ShieldCheck,
  ShieldOff,
  Power,
  ChevronsUpDown,
} from "lucide-react"
import { useMemo, useState } from "react"
import {
  type AliciaState,
  type ApprovalPreset,
  APPROVAL_PRESETS,
  type Session,
} from "@/lib/alicia-types"

interface SidebarProps {
  state: AliciaState
  modelLabel: string
  sessionPid: number | null
  runtimeState: "idle" | "starting" | "running" | "stopping" | "error"
  onOpenPanel: (panel: AliciaState["activePanel"]) => void
  onStartSession: () => void
  onStopSession: () => void
  onResumeSession: () => void
  onForkSession: () => void
  onSelectSession: (sessionId: string) => void
}

interface SessionDayGroup {
  dayKey: string
  dayLabel: string
  sortTime: number
  sessions: Session[]
}

interface SessionYearGroup {
  yearKey: string
  yearLabel: string
  sortYear: number
  days: SessionDayGroup[]
}

const approvalColors: Record<ApprovalPreset, string> = {
  "read-only": "text-terminal-blue",
  auto: "text-terminal-green",
  "full-access": "text-terminal-red",
}

const approvalIcons: Record<ApprovalPreset, typeof Shield> = {
  "read-only": ShieldCheck,
  auto: Shield,
  "full-access": ShieldOff,
}

const statusColor = {
  modified: "text-terminal-blue",
  added: "text-terminal-green",
  deleted: "text-terminal-red",
}

const statusLabel = {
  modified: "M",
  added: "A",
  deleted: "D",
}

function resolveSessionEpochSeconds(session: Session): number | null {
  const updated =
    typeof session.updatedAt === "number" &&
    Number.isFinite(session.updatedAt) &&
    session.updatedAt > 0
      ? session.updatedAt
      : null

  if (updated != null) {
    return updated
  }

  const created =
    typeof session.createdAt === "number" &&
    Number.isFinite(session.createdAt) &&
    session.createdAt > 0
      ? session.createdAt
      : null

  return created
}

function buildSessionGroups(sessions: Session[]): SessionYearGroup[] {
  const yearMap = new Map<
    string,
    {
      yearLabel: string
      sortYear: number
      days: Map<string, SessionDayGroup>
    }
  >()

  for (const session of sessions) {
    const epochSeconds = resolveSessionEpochSeconds(session)

    let yearKey = "unknown"
    let yearLabel = "No year"
    let sortYear = -1
    let dayKey = "unknown"
    let dayLabel = "No day"
    let sortTime = 0

    if (epochSeconds != null) {
      const date = new Date(epochSeconds * 1000)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, "0")
      const day = String(date.getDate()).padStart(2, "0")

      yearKey = String(year)
      yearLabel = String(year)
      sortYear = year
      dayKey = `${month}-${day}`
      dayLabel = `${month}/${day}`
      sortTime = Math.floor(
        new Date(year, date.getMonth(), date.getDate()).getTime() / 1000,
      )
    }

    let yearEntry = yearMap.get(yearKey)
    if (!yearEntry) {
      yearEntry = {
        yearLabel,
        sortYear,
        days: new Map<string, SessionDayGroup>(),
      }
      yearMap.set(yearKey, yearEntry)
    }

    let dayEntry = yearEntry.days.get(dayKey)
    if (!dayEntry) {
      dayEntry = {
        dayKey,
        dayLabel,
        sortTime,
        sessions: [],
      }
      yearEntry.days.set(dayKey, dayEntry)
    }

    dayEntry.sessions.push(session)
    dayEntry.sortTime = Math.max(dayEntry.sortTime, sortTime)
  }

  return Array.from(yearMap.entries())
    .map(([yearKey, yearValue]) => {
      const days = Array.from(yearValue.days.values())
        .map((day) => ({
          ...day,
          sessions: [...day.sessions].sort((left, right) => {
            const leftTime = resolveSessionEpochSeconds(left) ?? 0
            const rightTime = resolveSessionEpochSeconds(right) ?? 0
            if (leftTime !== rightTime) {
              return rightTime - leftTime
            }
            return left.name.localeCompare(right.name)
          }),
        }))
        .sort((left, right) => {
          if (left.sortTime !== right.sortTime) {
            return right.sortTime - left.sortTime
          }
          return right.dayKey.localeCompare(left.dayKey)
        })

      return {
        yearKey,
        yearLabel: yearValue.yearLabel,
        sortYear: yearValue.sortYear,
        days,
      }
    })
    .sort((left, right) => {
      if (left.sortYear !== right.sortYear) {
        return right.sortYear - left.sortYear
      }
      return right.yearKey.localeCompare(left.yearKey)
    })
}

export function Sidebar({
  state,
  modelLabel,
  sessionPid,
  runtimeState,
  onOpenPanel,
  onStartSession,
  onStopSession,
  onResumeSession,
  onForkSession,
  onSelectSession,
}: SidebarProps) {
  const ApprovalIcon = approvalIcons[state.approvalPreset]
  const connectedMcps = state.mcpServers.filter(
    (server) => server.status === "connected",
  )
  const totalTools = state.mcpServers.reduce(
    (sum, server) => sum + server.tools.length,
    0,
  )
  const isRunning = runtimeState === "running" || runtimeState === "starting"

  const groupedSessions = useMemo(() => buildSessionGroups(state.sessions), [state.sessions])
  const [collapsedYears, setCollapsedYears] = useState<Set<string>>(() => new Set())
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set())

  const allYearKeys = useMemo(
    () => groupedSessions.map((entry) => entry.yearKey),
    [groupedSessions],
  )
  const allDayTokens = useMemo(
    () =>
      groupedSessions.flatMap((year) =>
        year.days.map((day) => `${year.yearKey}/${day.dayKey}`),
      ),
    [groupedSessions],
  )

  const anyExpandedYear = allYearKeys.some((key) => !collapsedYears.has(key))
  const anyExpandedDay = allDayTokens.some((token) => !collapsedDays.has(token))
  const collapseAllLabel = anyExpandedYear || anyExpandedDay ? "Collapse all" : "Expand all"

  const toggleYearCollapse = (yearKey: string) => {
    setCollapsedYears((previous) => {
      const next = new Set(previous)
      if (next.has(yearKey)) {
        next.delete(yearKey)
      } else {
        next.add(yearKey)
      }
      return next
    })
  }

  const toggleDayCollapse = (dayToken: string) => {
    setCollapsedDays((previous) => {
      const next = new Set(previous)
      if (next.has(dayToken)) {
        next.delete(dayToken)
      } else {
        next.add(dayToken)
      }
      return next
    })
  }

  const toggleCollapseAll = () => {
    const shouldCollapseAll = anyExpandedYear || anyExpandedDay
    if (shouldCollapseAll) {
      setCollapsedYears(new Set(allYearKeys))
      setCollapsedDays(new Set(allDayTokens))
      return
    }

    setCollapsedYears(new Set())
    setCollapsedDays(new Set())
  }

  return (
    <div className="w-64 h-full max-h-full min-h-0 bg-sidebar border-r border-panel-border flex flex-col shrink-0 overflow-hidden">
      <div className="p-4 border-b border-panel-border shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg bg-terminal-green/10 border border-terminal-green/20 flex items-center justify-center">
            <Bot className="w-5 h-5 text-terminal-green" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-terminal-fg">Alicia Agent</h2>
            <p className="text-xs text-muted-foreground">{modelLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            <span>PID {sessionPid ?? "-"}</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-terminal-gold" />
            <span className="capitalize">{runtimeState}</span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {!isRunning ? (
            <button
              onClick={onStartSession}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs bg-terminal-green/15 text-terminal-green hover:bg-terminal-green/25"
            >
              <Power className="w-3 h-3" />
              Start
            </button>
          ) : (
            <button
              onClick={onStopSession}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs bg-terminal-red/15 text-terminal-red hover:bg-terminal-red/25"
            >
              <Power className="w-3 h-3" />
              Stop
            </button>
          )}
        </div>
      </div>

      <div className="p-3 border-b border-panel-border flex flex-col gap-1 shrink-0">
        <button
          onClick={() => onOpenPanel("model")}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-left w-full transition-colors hover:bg-[#b9bcc01c] group"
        >
          <Cpu className="w-3.5 h-3.5 text-terminal-blue" />
          <div className="flex-1 min-w-0">
            <span className="text-xs text-muted-foreground">Model</span>
          </div>
          <span className="text-[10px] text-terminal-fg/70 font-mono">{modelLabel}</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
        </button>

        <button
          onClick={() => onOpenPanel("permissions")}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-left w-full transition-colors hover:bg-[#b9bcc01c] group"
        >
          <ApprovalIcon
            className={`w-3.5 h-3.5 ${approvalColors[state.approvalPreset]}`}
          />
          <div className="flex-1 min-w-0">
            <span className="text-xs text-muted-foreground">Permissions</span>
          </div>
          <span className={`text-[10px] ${approvalColors[state.approvalPreset]}`}>
            {APPROVAL_PRESETS[state.approvalPreset].label}
          </span>
          <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
        </button>

        <button
          onClick={() => onOpenPanel("mcp")}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-left w-full transition-colors hover:bg-[#b9bcc01c] group"
        >
          <PlugZap className="w-3.5 h-3.5 text-terminal-purple" />
          <div className="flex-1 min-w-0">
            <span className="text-xs text-muted-foreground">MCP</span>
          </div>
          <span className="text-[10px] text-terminal-fg/70">
            {connectedMcps.length}/{state.mcpServers.length}
          </span>
          <span className="text-[10px] text-muted-foreground/40">({totalTools} tools)</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="p-3 min-h-0 flex-1 flex flex-col">
          <div className="flex items-center justify-between px-1 mb-2 shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Sessions
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggleCollapseAll}
                className="p-0.5 rounded hover:bg-[#b9bcc01c] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                title={collapseAllLabel}
              >
                <ChevronsUpDown className="w-3 h-3" />
              </button>
              <button
                onClick={onResumeSession}
                className="p-0.5 rounded hover:bg-[#b9bcc01c] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                title="Resume session"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <button
                onClick={onForkSession}
                className="p-0.5 rounded hover:bg-[#b9bcc01c] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                title="Fork session"
              >
                <GitFork className="w-3 h-3" />
              </button>
              <button
                onClick={onStartSession}
                className="p-0.5 rounded hover:bg-[#b9bcc01c] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                title="New session"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <div className="flex flex-col gap-1">
              {groupedSessions.length === 0 && (
                <div className="px-2 py-2 text-[11px] text-muted-foreground/55 border border-panel-border rounded bg-background/20">
                  No sessions yet.
                </div>
              )}

              {groupedSessions.map((yearGroup) => {
                const yearCollapsed = collapsedYears.has(yearGroup.yearKey)
                const yearSessionCount = yearGroup.days.reduce(
                  (sum, day) => sum + day.sessions.length,
                  0,
                )

                return (
                  <div key={yearGroup.yearKey} className="rounded border border-panel-border/40">
                    <button
                      onClick={() => toggleYearCollapse(yearGroup.yearKey)}
                      className="w-full flex items-center gap-1 px-2 py-1.5 text-[10px] text-muted-foreground/80 hover:bg-[#b9bcc01c]"
                    >
                      {yearCollapsed ? (
                        <ChevronRight className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                      <span className="font-semibold tracking-wide uppercase">
                        {yearGroup.yearLabel}
                      </span>
                      <span className="ml-auto text-muted-foreground/50">{yearSessionCount}</span>
                    </button>

                    {!yearCollapsed && (
                      <div className="px-1 pb-1">
                        {yearGroup.days.map((dayGroup) => {
                          const dayToken = `${yearGroup.yearKey}/${dayGroup.dayKey}`
                          const dayCollapsed = collapsedDays.has(dayToken)

                          return (
                            <div key={dayToken} className="mb-1">
                              <button
                                onClick={() => toggleDayCollapse(dayToken)}
                                className="w-full flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground/65 hover:bg-[#b9bcc01c] rounded"
                              >
                                {dayCollapsed ? (
                                  <ChevronRight className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                                <span>{dayGroup.dayLabel}</span>
                                <span className="ml-auto text-muted-foreground/45">
                                  {dayGroup.sessions.length}
                                </span>
                              </button>

                              {!dayCollapsed && (
                                <div className="flex flex-col gap-0.5 mt-0.5">
                                  {dayGroup.sessions.map((session) => (
                                    <button
                                      key={session.id}
                                      onClick={() => onSelectSession(session.id)}
                                      className={`flex items-center gap-2 px-2 py-1.5 rounded text-left w-full transition-colors ${
                                        session.active
                                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                          : "text-muted-foreground hover:bg-[#b9bcc01c] hover:text-foreground"
                                      }`}
                                    >
                                      <div
                                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                          session.active
                                            ? "bg-terminal-green"
                                            : "bg-muted-foreground/30"
                                        }`}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs truncate">{session.name}</p>
                                      </div>
                                      <span className="text-[10px] text-muted-foreground/60 shrink-0">
                                        {session.time}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-panel-border shrink-0">
          <div className="flex items-center gap-2 px-1 mb-2">
            <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Changes
            </span>
            <span className="ml-auto text-[10px] bg-terminal-blue/20 text-terminal-blue px-1.5 py-0.5 rounded">
              {state.fileChanges.length}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {state.fileChanges.map((file) => (
              <div
                key={file.name}
                className="flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-[#b9bcc01c] transition-colors cursor-pointer"
              >
                <span className={`text-[10px] font-bold w-3 ${statusColor[file.status]}`}>
                  {statusLabel[file.status]}
                </span>
                <span className="text-muted-foreground truncate">{file.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-panel-border shrink-0">
          <div className="flex items-center gap-2 px-1 mb-2">
            <FolderTree className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Project
            </span>
          </div>
          <div className="flex flex-col gap-1.5 px-2 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <GitBranch className="w-3 h-3" />
              <span>main</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Layers className="w-3 h-3" />
              <span>Rust + Next + Tauri</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>Runtime: {runtimeState}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-panel-border shrink-0">
        <button className="flex items-center gap-2 px-2 py-1.5 w-full rounded text-xs text-muted-foreground hover:bg-[#b9bcc01c] hover:text-foreground transition-colors">
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
          <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/60">
            ,
          </kbd>
        </button>
      </div>
    </div>
  )
}



