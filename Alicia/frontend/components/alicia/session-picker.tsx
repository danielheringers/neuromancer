"use client"

import {
  X,
  Clock,
  MessageSquare,
  GitFork,
  RotateCcw,
  Plus,
  Cpu,
  Loader2,
} from "lucide-react"
import { useMemo } from "react"
import { type Session } from "@/lib/alicia-types"

interface SessionPickerProps {
  sessions: Session[]
  mode: "resume" | "fork" | "list"
  loading?: boolean
  busyAction?: {
    sessionId: string
    action: "resume" | "fork" | "switch"
  } | null
  onSelect: (sessionId: string, action: "resume" | "fork" | "switch") => void
  onNewSession: () => void
  onClose: () => void
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

export function SessionPicker({
  sessions,
  mode,
  loading = false,
  busyAction = null,
  onSelect,
  onNewSession,
  onClose,
}: SessionPickerProps) {
  const title = mode === "resume" ? "/resume" : mode === "fork" ? "/fork" : "Sessions"
  const description =
    mode === "resume"
      ? "Select a thread from runtime history"
      : mode === "fork"
        ? "Fork a thread into a new runtime conversation"
        : "Browse runtime thread history"

  const runtimeLabel =
    mode === "fork" ? "thread.list + thread.fork" : "thread.list + thread.open"

  const disableSelection = loading || busyAction !== null
  const groupedSessions = useMemo(() => buildSessionGroups(sessions), [sessions])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-panel-border rounded-lg bg-panel-bg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              {mode === "resume" ? (
                <RotateCcw className="w-4 h-4 text-terminal-green" />
              ) : mode === "fork" ? (
                <GitFork className="w-4 h-4 text-terminal-purple" />
              ) : (
                <MessageSquare className="w-4 h-4 text-terminal-blue" />
              )}
              <span className="text-sm font-semibold text-terminal-fg">{title}</span>
            </div>
            <span className="text-[10px] text-muted-foreground/50 mt-0.5 ml-6">
              {description}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {loading && (
            <div className="mb-2 flex items-center gap-2 rounded border border-panel-border bg-background/30 px-2 py-1.5 text-[11px] text-muted-foreground/70">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-terminal-blue" />
              Syncing runtime thread history...
            </div>
          )}

          {sessions.length === 0 ? (
            <div className="px-3 py-5 text-xs text-muted-foreground/60 text-center border border-panel-border rounded-lg bg-background/20">
              {loading
                ? "Loading runtime thread records..."
                : "No runtime thread records found."}
            </div>
          ) : (
            groupedSessions.map((yearGroup) => (
              <div key={yearGroup.yearKey} className="mb-3">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-terminal-fg/70">
                  {yearGroup.yearLabel}
                </div>
                {yearGroup.days.map((dayGroup) => (
                  <div key={`${yearGroup.yearKey}-${dayGroup.dayKey}`} className="mb-2">
                    <div className="px-2 py-1 text-[10px] text-muted-foreground/55">
                      {dayGroup.dayLabel}
                    </div>
                    {dayGroup.sessions.map((session) => {
                      const sessionThreadId = (session.threadId ?? session.id).trim()
                      const isBusy =
                        busyAction !== null &&
                        (busyAction.sessionId === session.id ||
                          busyAction.sessionId === sessionThreadId)

                      return (
                        <button
                          key={session.id}
                          onClick={() =>
                            onSelect(session.id, mode === "list" ? "switch" : mode)
                          }
                          disabled={disableSelection}
                          className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg text-left transition-colors disabled:cursor-wait disabled:opacity-70 ${
                            session.active
                              ? "bg-terminal-green/5 border border-terminal-green/15"
                              : "hover:bg-[#b9bcc01c] border border-transparent"
                          }`}
                        >
                          <div
                            className={`w-2 h-2 rounded-full shrink-0 ${session.active ? "bg-terminal-green" : "bg-muted-foreground/20"}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-terminal-fg truncate">{session.name}</span>
                              {session.active && (
                                <span className="text-[10px] text-terminal-green bg-terminal-green/10 px-1 py-0.5 rounded">
                                  active
                                </span>
                              )}
                              {isBusy && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-terminal-blue bg-terminal-blue/10 px-1 py-0.5 rounded">
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                  processing
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-[10px] text-muted-foreground/45 truncate font-mono">
                              {sessionThreadId}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/50">
                              <span className="flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" />
                                {session.time}
                              </span>
                              <span className="flex items-center gap-1">
                                <MessageSquare className="w-2.5 h-2.5" />
                                {session.messageCount} messages
                              </span>
                              <span className="flex items-center gap-1">
                                <Cpu className="w-2.5 h-2.5" />
                                {session.model}
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0">
                            {mode === "resume" && (
                              <RotateCcw className="w-3.5 h-3.5 text-muted-foreground/30" />
                            )}
                            {mode === "fork" && (
                              <GitFork className="w-3.5 h-3.5 text-muted-foreground/30" />
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-panel-border bg-background/30">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                onNewSession()
                onClose()
              }}
              disabled={disableSelection}
              className="flex items-center gap-1.5 text-xs text-terminal-green hover:text-terminal-green/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Session
            </button>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground/40">
              <span>
                Runtime:{" "}
                <span className="text-terminal-fg/50 font-mono">{runtimeLabel}</span>
              </span>
              <span>
                <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/50">
                  Esc
                </kbd>
                {" close"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
