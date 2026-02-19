"use client"

import { X, Check, Clock, MessageSquare, GitFork, RotateCcw, Plus, Cpu } from "lucide-react"
import { type Session } from "@/lib/alicia-types"

interface SessionPickerProps {
  sessions: Session[]
  mode: "resume" | "fork" | "list"
  onSelect: (sessionId: string, action: "resume" | "fork" | "switch") => void
  onNewSession: () => void
  onClose: () => void
}

export function SessionPicker({ sessions, mode, onSelect, onNewSession, onClose }: SessionPickerProps) {
  const title = mode === "resume" ? "/resume" : mode === "fork" ? "/fork" : "Sessions"
  const description = mode === "resume"
    ? "Resume a previous session"
    : mode === "fork"
    ? "Fork a session into a new conversation"
    : "Manage your sessions"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md border border-panel-border rounded-lg bg-panel-bg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
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
            <span className="text-[10px] text-muted-foreground/50 mt-0.5 ml-6">{description}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Session list */}
        <div className="max-h-80 overflow-y-auto p-2">
          {sessions.map(session => (
            <button
              key={session.id}
              onClick={() => onSelect(session.id, mode === "list" ? "switch" : mode)}
              className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg text-left transition-colors ${
                session.active
                  ? "bg-terminal-green/5 border border-terminal-green/15"
                  : "hover:bg-[#b9bcc01c] border border-transparent"
              }`}
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${session.active ? "bg-terminal-green" : "bg-muted-foreground/20"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-terminal-fg truncate">{session.name}</span>
                  {session.active && (
                    <span className="text-[10px] text-terminal-green bg-terminal-green/10 px-1 py-0.5 rounded">active</span>
                  )}
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
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-panel-border bg-background/30">
          <div className="flex items-center justify-between">
            <button
              onClick={() => { onNewSession(); onClose() }}
              className="flex items-center gap-1.5 text-xs text-terminal-green hover:text-terminal-green/80 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Session
            </button>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground/40">
              <span>CLI: <span className="text-terminal-fg/50 font-mono">codex {mode === "fork" ? "fork" : "resume"}</span></span>
              <span>
                <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/50">Esc</kbd>
                {" close"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
