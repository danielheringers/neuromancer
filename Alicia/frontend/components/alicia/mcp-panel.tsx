"use client"

import { useState } from "react"
import {
  X, Server, PlugZap, ChevronDown, ChevronRight,
  FolderOpen, GitBranch, Terminal as TerminalIcon, Globe, Database, Search, Wrench, Plus, Trash2, RefreshCw,
} from "lucide-react"
import { type McpServer } from "@/lib/alicia-types"

interface McpPanelProps {
  servers: McpServer[]
  onClose: () => void
}

const serverIcons: Record<string, typeof Server> = {
  filesystem: FolderOpen,
  git: GitBranch,
  shell: TerminalIcon,
  browser: Globe,
  database: Database,
  search: Search,
}

const statusConfig = {
  connected: { dot: "bg-terminal-green", text: "text-terminal-green" },
  disconnected: { dot: "bg-muted-foreground/50", text: "text-muted-foreground/50" },
  error: { dot: "bg-terminal-red", text: "text-terminal-red" },
  connecting: { dot: "bg-terminal-gold animate-pulse", text: "text-terminal-gold" },
}

function ServerRow({ server }: { server: McpServer }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = serverIcons[server.id] || Server
  const status = statusConfig[server.status]

  return (
    <div className="border border-panel-border rounded-lg overflow-hidden bg-background/20">
      {/* Server header - clickable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center w-full px-3 py-2.5 text-left hover:bg-[#ffffff06] transition-colors gap-3"
      >
        <Icon className={`w-4 h-4 ${status.text} shrink-0`} />

        <span className="text-sm text-terminal-fg font-medium truncate">{server.name}</span>

        <span className="text-[10px] text-muted-foreground/30 font-mono shrink-0">{server.transport}</span>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={`text-xs tabular-nums ${status.text}`}>
            {server.tools.length} tools
          </span>
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} />
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-panel-border">
          {/* Tools section */}
          <div className="px-3 pt-2 pb-2.5">
            <div className="flex items-center gap-1.5 mb-2">
              <Wrench className="w-3 h-3 text-muted-foreground/40" />
              <span className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">
                Tools ({server.tools.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {server.tools.map(tool => (
                <span
                  key={tool}
                  className="inline-flex text-[11px] leading-tight px-1.5 py-0.5 rounded border border-panel-border bg-panel-bg text-terminal-fg/60 font-mono whitespace-nowrap"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 px-3 py-2 border-t border-panel-border bg-background/20">
            <button className="flex items-center gap-1 text-[10px] text-terminal-red/80 hover:text-terminal-red transition-colors">
              <Trash2 className="w-3 h-3" />
              Remove
            </button>
            <button className="flex items-center gap-1 text-[10px] text-terminal-blue/80 hover:text-terminal-blue transition-colors">
              <RefreshCw className="w-3 h-3" />
              Reconnect
            </button>
            {server.url && (
              <span className="ml-auto text-[10px] text-muted-foreground/30 font-mono truncate max-w-[200px]">
                {server.url}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function McpPanel({ servers, onClose }: McpPanelProps) {
  const connectedCount = servers.filter(s => s.status === "connected").length
  const totalTools = servers.reduce((sum, s) => sum + s.tools.length, 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg border border-panel-border rounded-lg bg-panel-bg shadow-2xl flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border shrink-0">
          <div className="flex items-center gap-2">
            <PlugZap className="w-4 h-4 text-terminal-green" />
            <span className="text-sm font-semibold text-terminal-fg">/mcp</span>
            <span className="text-[10px] text-muted-foreground/50 ml-1">
              {connectedCount}/{servers.length} MCP, {totalTools} tools
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#ffffff08] text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable server list */}
        <div className="overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
          {servers.map(server => (
            <ServerRow key={server.id} server={server} />
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-panel-border shrink-0">
          <div className="flex items-center justify-between">
            <button className="flex items-center gap-1.5 text-xs text-terminal-green hover:text-terminal-green/80 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Add Server
            </button>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground/40">
              <span>
                CLI: <span className="text-terminal-fg/50 font-mono">codex mcp list</span>
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
