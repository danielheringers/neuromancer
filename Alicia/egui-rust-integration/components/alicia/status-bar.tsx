"use client"

import { GitBranch, CircleDot, Cpu, Timer, Shield } from "lucide-react"

export function StatusBar() {
  return (
    <div className="flex items-center justify-between h-6 bg-panel-bg border-t border-panel-border px-3 text-[10px] text-muted-foreground select-none shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <GitBranch className="w-3 h-3" />
          <span>main</span>
        </div>
        <div className="flex items-center gap-1">
          <CircleDot className="w-3 h-3 text-terminal-green" />
          <span>0 errors</span>
        </div>
        <div className="flex items-center gap-1 text-terminal-gold">
          <span>2 warnings</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Shield className="w-3 h-3" />
          <span>Sandbox</span>
        </div>
        <div className="flex items-center gap-1">
          <Cpu className="w-3 h-3" />
          <span>gpt-4o-mini</span>
        </div>
        <div className="flex items-center gap-1">
          <Timer className="w-3 h-3" />
          <span>Latency: 142ms</span>
        </div>
        <span>UTF-8</span>
        <span>Rust</span>
      </div>
    </div>
  )
}
