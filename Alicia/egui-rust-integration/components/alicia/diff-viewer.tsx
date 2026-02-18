"use client"

import { Check, X } from "lucide-react"

interface DiffLine {
  type: "add" | "remove" | "context"
  content: string
  lineNumber: number
}

interface DiffViewerProps {
  filename: string
  lines: DiffLine[]
  onApprove?: () => void
  onReject?: () => void
}

export function DiffViewer({ filename, lines, onApprove, onReject }: DiffViewerProps) {
  return (
    <div className="rounded-md border border-panel-border overflow-hidden my-2">
      <div className="flex items-center justify-between px-3 py-1.5 bg-panel-bg border-b border-panel-border">
        <div className="flex items-center gap-2">
          <span className="text-xs text-terminal-cyan">{filename}</span>
          <span className="text-[10px] text-muted-foreground/40">
            +{lines.filter(l => l.type === "add").length}
            {" / "}
            -{lines.filter(l => l.type === "remove").length}
          </span>
        </div>
        {(onApprove || onReject) && (
          <div className="flex items-center gap-1">
            <button
              onClick={onApprove}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-terminal-green/10 text-terminal-green hover:bg-terminal-green/20 border border-terminal-green/20 transition-colors"
            >
              <Check className="w-3 h-3" />
              Apply
            </button>
            <button
              onClick={onReject}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-terminal-red/10 text-terminal-red hover:bg-terminal-red/20 border border-terminal-red/20 transition-colors"
            >
              <X className="w-3 h-3" />
              Reject
            </button>
          </div>
        )}
      </div>
      <div className="bg-terminal-bg overflow-x-auto text-xs font-mono">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`flex px-3 py-px ${
              line.type === "add"
                ? "bg-terminal-green/10"
                : line.type === "remove"
                ? "bg-terminal-red/10"
                : ""
            }`}
          >
            <span className="text-muted-foreground/30 select-none w-8 text-right pr-3 shrink-0">
              {line.lineNumber}
            </span>
            <span
              className={`select-none w-4 shrink-0 ${
                line.type === "add"
                  ? "text-terminal-green"
                  : line.type === "remove"
                  ? "text-terminal-red"
                  : "text-transparent"
              }`}
            >
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
            </span>
            <span
              className={
                line.type === "add"
                  ? "text-terminal-green/90"
                  : line.type === "remove"
                  ? "text-terminal-red/80"
                  : "text-terminal-fg/60"
              }
            >
              {line.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
