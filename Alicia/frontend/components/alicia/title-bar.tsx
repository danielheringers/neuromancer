"use client"

import { Circle } from "lucide-react"

interface TitleBarProps {
  connected: boolean
  workspace: string
  version?: string
}

export function TitleBar({ connected, workspace, version = "v0.1.0-alpha" }: TitleBarProps) {
  return (
    <div className="flex items-center justify-between h-10 bg-panel-bg border-b border-panel-border px-4 select-none shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-terminal-green font-bold text-sm tracking-wide">ALICIA</span>
          <span className="text-muted-foreground text-xs">{version}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-background/50">
          <Circle
            className={`w-2 h-2 ${connected ? "fill-terminal-green text-terminal-green status-pulse" : "fill-terminal-red text-terminal-red"}`}
          />
          <span className="text-terminal-fg/70">{connected ? "Connected" : "Disconnected"}</span>
        </div>
        <span className="text-muted-foreground/50">|</span>
        <span>{workspace}</span>
      </div>
    </div>
  )
}
