"use client"

import { GitBranch, CircleDot, Cpu, Timer, Shield, PlugZap, ShieldCheck, ShieldOff } from "lucide-react"
import { type AliciaState, type ApprovalPreset } from "@/lib/alicia-types"

interface RuntimeStatus {
  connected: boolean
  state: "idle" | "starting" | "running" | "stopping" | "error"
  sessionId: number | null
}

interface StatusBarProps {
  state: AliciaState
  modelLabel: string
  runtime: RuntimeStatus
  onOpenPanel: (panel: AliciaState["activePanel"]) => void
}

const approvalIcons: Record<ApprovalPreset, typeof Shield> = {
  "read-only": ShieldCheck,
  auto: Shield,
  "full-access": ShieldOff,
}

const approvalColors: Record<ApprovalPreset, string> = {
  "read-only": "text-terminal-blue",
  auto: "text-terminal-green",
  "full-access": "text-terminal-red",
}

export function StatusBar({ state, modelLabel, runtime, onOpenPanel }: StatusBarProps) {
  const ApprovalIcon = approvalIcons[state.approvalPreset]
  const connectedMcps = state.mcpServers.filter((server) => server.status === "connected")
  const totalTools = state.mcpServers.reduce((sum, server) => sum + server.tools.length, 0)

  return (
    <div className="flex items-center justify-between h-6 bg-panel-bg border-t border-panel-border px-3 text-[10px] text-muted-foreground select-none shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <GitBranch className="w-3 h-3" />
          <span>main</span>
        </div>
        <div className="flex items-center gap-1">
          <CircleDot className={`w-3 h-3 ${runtime.connected ? "text-terminal-green" : "text-terminal-red"}`} />
          <span>{runtime.connected ? "runtime connected" : "runtime disconnected"}</span>
        </div>
        <div className="flex items-center gap-1 text-terminal-gold">
          <span>session: {runtime.sessionId ?? "none"}</span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onOpenPanel("permissions")}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#b9bcc01c] transition-colors ${approvalColors[state.approvalPreset]}`}
        >
          <ApprovalIcon className="w-3 h-3" />
          <span>{state.sandboxMode}</span>
        </button>

        <span className="text-muted-foreground/20 mx-0.5">|</span>

        <button
          onClick={() => onOpenPanel("mcp")}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#b9bcc01c] transition-colors"
        >
          <PlugZap className="w-3 h-3 text-terminal-purple" />
          <span>{connectedMcps.length} MCP</span>
          <span className="text-muted-foreground/40">({totalTools})</span>
        </button>

        <span className="text-muted-foreground/20 mx-0.5">|</span>

        <button
          onClick={() => onOpenPanel("model")}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#b9bcc01c] transition-colors"
        >
          <Cpu className="w-3 h-3" />
          <span>{modelLabel}</span>
          <span className="text-muted-foreground/40 capitalize">[{state.reasoningEffort}]</span>
        </button>

        <span className="text-muted-foreground/20 mx-0.5">|</span>

        <div className="flex items-center gap-1">
          <Timer className="w-3 h-3" />
          <span>{runtime.state}</span>
        </div>
      </div>
    </div>
  )
}
