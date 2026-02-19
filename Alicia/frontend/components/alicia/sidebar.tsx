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
  RotateCcw,
  GitFork,
  Plus,
  ShieldCheck,
  ShieldOff,
  Power,
} from "lucide-react"
import {
  type AliciaState,
  type ApprovalPreset,
  APPROVAL_PRESETS,
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
}: SidebarProps) {
  const ApprovalIcon = approvalIcons[state.approvalPreset]
  const connectedMcps = state.mcpServers.filter((server) => server.status === "connected")
  const totalTools = state.mcpServers.reduce((sum, server) => sum + server.tools.length, 0)
  const isRunning = runtimeState === "running" || runtimeState === "starting"

  return (
    <div className="w-64 bg-sidebar border-r border-panel-border flex flex-col shrink-0 overflow-hidden">
      <div className="p-4 border-b border-panel-border">
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

      <div className="p-3 border-b border-panel-border flex flex-col gap-1">
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
          <ApprovalIcon className={`w-3.5 h-3.5 ${approvalColors[state.approvalPreset]}`} />
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
          <span className="text-[10px] text-terminal-fg/70">{connectedMcps.length}/{state.mcpServers.length}</span>
          <span className="text-[10px] text-muted-foreground/40">({totalTools} tools)</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-3">
          <div className="flex items-center justify-between px-1 mb-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sessions</span>
            </div>
            <div className="flex items-center gap-1">
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
          <div className="flex flex-col gap-0.5">
            {state.sessions.map((session) => (
              <button
                key={session.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-left w-full transition-colors ${session.active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-[#b9bcc01c] hover:text-foreground"
                  }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${session.active ? "bg-terminal-green" : "bg-muted-foreground/30"
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

        <div className="p-3 border-t border-panel-border">
          <div className="flex items-center gap-2 px-1 mb-2">
            <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Changes</span>
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
                <span className={`text-[10px] font-bold w-3 ${statusColor[file.status]}`}>{statusLabel[file.status]}</span>
                <span className="text-muted-foreground truncate">{file.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-panel-border">
          <div className="flex items-center gap-2 px-1 mb-2">
            <FolderTree className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Project</span>
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

      <div className="p-3 border-t border-panel-border">
        <button className="flex items-center gap-2 px-2 py-1.5 w-full rounded text-xs text-muted-foreground hover:bg-[#b9bcc01c] hover:text-foreground transition-colors">
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
          <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/60">,
          </kbd>
        </button>
      </div>
    </div>
  )
}
