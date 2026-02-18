"use client"

import { Circle, Minus, Square, X } from "lucide-react"

export function TitleBar() {
  return (
    <div className="flex items-center justify-between h-10 bg-panel-bg border-b border-panel-border px-4 select-none shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button className="group w-3 h-3 rounded-full bg-terminal-red/80 hover:bg-terminal-red flex items-center justify-center transition-colors">
            <X className="w-2 h-2 text-terminal-red/0 group-hover:text-[#1a1a1a] transition-colors" />
          </button>
          <button className="group w-3 h-3 rounded-full bg-terminal-gold/80 hover:bg-terminal-gold flex items-center justify-center transition-colors">
            <Minus className="w-2 h-2 text-terminal-gold/0 group-hover:text-[#1a1a1a] transition-colors" />
          </button>
          <button className="group w-3 h-3 rounded-full bg-terminal-green/80 hover:bg-terminal-green flex items-center justify-center transition-colors">
            <Square className="w-1.5 h-1.5 text-terminal-green/0 group-hover:text-[#1a1a1a] transition-colors" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-terminal-green font-bold text-sm tracking-wide">ALICIA</span>
          <span className="text-muted-foreground text-xs">v0.1.0-alpha</span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-background/50">
          <Circle className="w-2 h-2 fill-terminal-green text-terminal-green status-pulse" />
          <span className="text-terminal-fg/70">Connected</span>
        </div>
        <span className="text-muted-foreground/50">|</span>
        <span>{'~/projects/my-app'}</span>
      </div>
    </div>
  )
}
