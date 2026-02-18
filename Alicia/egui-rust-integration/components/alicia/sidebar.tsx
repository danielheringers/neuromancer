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
} from "lucide-react"

const sessions = [
  { id: 1, name: "Refactor auth module", time: "2m ago", active: true },
  { id: 2, name: "Fix database migration", time: "15m ago", active: false },
  { id: 3, name: "Add API endpoints", time: "1h ago", active: false },
  { id: 4, name: "Update test suite", time: "3h ago", active: false },
]

const fileChanges = [
  { name: "src/auth/handler.rs", status: "modified" as const },
  { name: "src/db/schema.rs", status: "added" as const },
  { name: "src/api/routes.rs", status: "modified" as const },
  { name: "tests/auth_test.rs", status: "deleted" as const },
]

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

export function Sidebar() {
  return (
    <div className="w-64 bg-sidebar border-r border-panel-border flex flex-col shrink-0 overflow-hidden">
      {/* Agent Info */}
      <div className="p-4 border-b border-panel-border">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg bg-terminal-green/10 border border-terminal-green/20 flex items-center justify-center">
            <Bot className="w-5 h-5 text-terminal-green" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-terminal-fg">Alicia Agent</h2>
            <p className="text-xs text-muted-foreground">gpt-4o-mini</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            <span>1.2k tokens</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-terminal-gold" />
            <span>Fast</span>
          </div>
        </div>
      </div>

      {/* Sessions */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3">
          <div className="flex items-center gap-2 px-1 mb-2">
            <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sessions</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-left w-full transition-colors ${
                  session.active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-[#b9bcc01c] hover:text-foreground"
                }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    session.active ? "bg-terminal-green" : "bg-muted-foreground/30"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate">{session.name}</p>
                </div>
                <span className="text-[10px] text-muted-foreground/60 shrink-0">{session.time}</span>
              </button>
            ))}
          </div>
        </div>

        {/* File Changes */}
        <div className="p-3 border-t border-panel-border">
          <div className="flex items-center gap-2 px-1 mb-2">
            <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Changes</span>
            <span className="ml-auto text-[10px] bg-terminal-blue/20 text-terminal-blue px-1.5 py-0.5 rounded">
              {fileChanges.length}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {fileChanges.map((file) => (
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

        {/* Project Info */}
        <div className="p-3 border-t border-panel-border">
          <div className="flex items-center gap-2 px-1 mb-2">
            <FolderTree className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Project</span>
          </div>
          <div className="flex flex-col gap-1.5 px-2 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <GitBranch className="w-3 h-3" />
              <span>main</span>
              <span className="text-terminal-green text-[10px]">+3</span>
              <span className="text-terminal-red text-[10px]">-1</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Layers className="w-3 h-3" />
              <span>Rust + Cargo</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>Session: 4m 32s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Footer */}
      <div className="p-3 border-t border-panel-border">
        <button className="flex items-center gap-2 px-2 py-1.5 w-full rounded text-xs text-muted-foreground hover:bg-[#b9bcc01c] hover:text-foreground transition-colors">
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
          <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/60">
            {','}
          </kbd>
        </button>
      </div>
    </div>
  )
}
