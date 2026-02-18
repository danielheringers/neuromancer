"use client"

import { useEffect, useState, useCallback } from "react"

interface BootLogEntry {
  text: string
  type: "info" | "success" | "warn" | "error" | "header" | "dim" | "loading"
  indent?: number
  delay: number
}

const bootSequence: BootLogEntry[] = [
  { text: "", type: "dim", delay: 200 },
  { text: "     _    _     ___ ____ ___    _    ", type: "header", delay: 0 },
  { text: "    / \\  | |   |_ _/ ___|_ _|  / \\   ", type: "header", delay: 0 },
  { text: "   / _ \\ | |    | | |    | |  / _ \\  ", type: "header", delay: 0 },
  { text: "  / ___ \\| |___ | | |___ | | / ___ \\ ", type: "header", delay: 0 },
  { text: " /_/   \\_\\_____|___\\____|___/_/   \\_\\", type: "header", delay: 0 },
  { text: "", type: "dim", delay: 50 },
  { text: "  v0.1.0-alpha  |  AI Terminal Agent", type: "dim", delay: 300 },
  { text: "", type: "dim", delay: 100 },
  { text: "[boot] Initializing Alicia runtime...", type: "info", delay: 400 },
  { text: "[boot] Loading configuration from ~/.alicia/config.toml", type: "info", delay: 250 },
  { text: "[config] sandbox_mode = true", type: "dim", indent: 1, delay: 100 },
  { text: "[config] auto_approve  = false", type: "dim", indent: 1, delay: 80 },
  { text: "[config] model         = gpt-4o-mini", type: "dim", indent: 1, delay: 80 },
  { text: "[config] max_tokens    = 16384", type: "dim", indent: 1, delay: 80 },
  { text: "[boot] Configuration loaded", type: "success", delay: 300 },
  { text: "", type: "dim", delay: 100 },
  { text: "[core] Setting up workspace...", type: "info", delay: 350 },
  { text: "[core] Working directory: ~/projects/my-app", type: "dim", indent: 1, delay: 150 },
  { text: "[core] Git branch: main (3 uncommitted changes)", type: "dim", indent: 1, delay: 200 },
  { text: "[core] Indexing project files... 847 files scanned", type: "dim", indent: 1, delay: 600 },
  { text: "[core] Workspace ready", type: "success", delay: 200 },
  { text: "", type: "dim", delay: 100 },
  { text: "[mcp] Discovering MCP servers...", type: "info", delay: 400 },
  { text: "[mcp] Connecting to filesystem (stdio)...", type: "loading", indent: 1, delay: 500 },
  { text: "[mcp] filesystem          connected  (14 tools)", type: "success", indent: 1, delay: 0 },
  { text: "[mcp] Connecting to git (stdio)...", type: "loading", indent: 1, delay: 400 },
  { text: "[mcp] git                 connected  (8 tools)", type: "success", indent: 1, delay: 0 },
  { text: "[mcp] Connecting to shell (stdio)...", type: "loading", indent: 1, delay: 350 },
  { text: "[mcp] shell               connected  (3 tools)", type: "success", indent: 1, delay: 0 },
  { text: "[mcp] Connecting to browser (sse)...", type: "loading", indent: 1, delay: 700 },
  { text: "[mcp] browser             connected  (6 tools)", type: "success", indent: 1, delay: 0 },
  { text: "[mcp] Connecting to database (stdio)...", type: "loading", indent: 1, delay: 450 },
  { text: "[mcp] database            connected  (5 tools)", type: "success", indent: 1, delay: 0 },
  { text: "[mcp] Connecting to search (sse)...", type: "loading", indent: 1, delay: 600 },
  { text: "[mcp] search              connected  (4 tools)", type: "success", indent: 1, delay: 0 },
  { text: "[mcp] 6/6 servers connected, 40 tools available", type: "success", delay: 300 },
  { text: "", type: "dim", delay: 100 },
  { text: "[auth] Validating API credentials...", type: "info", delay: 500 },
  { text: "[auth] OpenAI API key verified (org: alicia-dev)", type: "success", indent: 1, delay: 300 },
  { text: "[auth] Token budget: 1,200,000 remaining", type: "dim", indent: 1, delay: 150 },
  { text: "", type: "dim", delay: 100 },
  { text: "[sandbox] Initializing sandboxed environment...", type: "info", delay: 400 },
  { text: "[sandbox] Permissions: read, write, execute (scoped)", type: "dim", indent: 1, delay: 200 },
  { text: "[sandbox] Network: outbound allowed (rate limited)", type: "dim", indent: 1, delay: 150 },
  { text: "[sandbox] Sandbox active", type: "success", delay: 300 },
  { text: "", type: "dim", delay: 100 },
  { text: "[system] All systems operational", type: "success", delay: 200 },
  { text: "[system] Alicia is ready. Awaiting instructions...", type: "success", delay: 400 },
]

function getTextColor(type: BootLogEntry["type"]) {
  switch (type) {
    case "header": return "text-terminal-green"
    case "success": return "text-terminal-green"
    case "info": return "text-terminal-blue"
    case "warn": return "text-terminal-gold"
    case "error": return "text-terminal-red"
    case "loading": return "text-terminal-gold"
    case "dim": return "text-muted-foreground/70"
  }
}

function BootLine({ entry, isLatestLoading }: { entry: BootLogEntry & { resolved?: boolean }, isLatestLoading: boolean }) {
  const indent = entry.indent ? "  ".repeat(entry.indent) : ""
  const colorClass = entry.resolved ? "text-terminal-green" : getTextColor(entry.type)

  const displayText = entry.resolved
    ? entry.text.replace("Connecting to", "").replace("(stdio)...", "").replace("(sse)...", "").trim()
    : entry.text

  return (
    <div className={`${colorClass} leading-relaxed whitespace-pre`}>
      {indent}
      {entry.type === "loading" && isLatestLoading && !entry.resolved ? (
        <>
          {entry.text}
          <span className="inline-flex ml-0">
            <span className="typing-dot">.</span>
            <span className="typing-dot">.</span>
            <span className="typing-dot">.</span>
          </span>
        </>
      ) : entry.resolved ? (
        displayText
      ) : (
        entry.text
      )}
    </div>
  )
}

interface BootScreenProps {
  onComplete: () => void
}

export function BootScreen({ onComplete }: BootScreenProps) {
  const [visibleLines, setVisibleLines] = useState<(BootLogEntry & { resolved?: boolean })[]>([])
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<"booting" | "complete">("booting")

  const runBoot = useCallback(async () => {
    let currentLines: (BootLogEntry & { resolved?: boolean })[] = []

    for (let i = 0; i < bootSequence.length; i++) {
      const entry = bootSequence[i]

      if (entry.delay > 0) {
        await new Promise(r => setTimeout(r, entry.delay))
      }

      // If this is a "loading" type, show it then wait, then replace with its success line
      if (entry.type === "loading") {
        currentLines = [...currentLines, { ...entry }]
        setVisibleLines([...currentLines])
        setProgress(Math.round(((i + 1) / bootSequence.length) * 100))

        // The next entry should be the success result
        const nextEntry = bootSequence[i + 1]
        if (nextEntry && nextEntry.type === "success" && nextEntry.indent) {
          await new Promise(r => setTimeout(r, entry.delay))
          // Replace loading line with success
          currentLines[currentLines.length - 1] = { ...nextEntry, resolved: true }
          setVisibleLines([...currentLines])
          i++ // skip the next entry since we consumed it
        }
      } else {
        currentLines = [...currentLines, entry]
        setVisibleLines([...currentLines])
      }

      setProgress(Math.round(((i + 1) / bootSequence.length) * 100))
    }

    setPhase("complete")
    await new Promise(r => setTimeout(r, 800))
    onComplete()
  }, [onComplete])

  useEffect(() => {
    runBoot()
  }, [runBoot])

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
      {/* Top bar - minimal */}
      <div className="h-9 flex items-center px-4 bg-panel-bg border-b border-panel-border shrink-0">
        <div className="flex items-center gap-1.5 mr-4">
          <div className="w-2.5 h-2.5 rounded-full bg-terminal-red/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-terminal-gold/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-terminal-green/70" />
        </div>
        <span className="text-xs text-muted-foreground/60">alicia -- initializing</span>
      </div>

      {/* Boot content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 font-mono text-[13px]">
          {visibleLines.map((entry, i) => (
            <BootLine
              key={i}
              entry={entry}
              isLatestLoading={
                entry.type === "loading" &&
                !entry.resolved &&
                i === visibleLines.length - 1
              }
            />
          ))}

          {/* Blinking cursor at end */}
          {phase === "booting" && (
            <span className="inline-block w-2 h-4 bg-terminal-green/80 cursor-blink mt-1" />
          )}
        </div>

        {/* Progress bar at bottom */}
        <div className="px-6 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              {phase === "complete" ? "Initialization complete" : "Initializing systems"}
            </span>
            <span className="text-[10px] text-terminal-green tabular-nums">{progress}%</span>
          </div>
          <div className="h-1 bg-panel-bg rounded-full overflow-hidden border border-panel-border">
            <div
              className="h-full bg-terminal-green transition-all duration-300 ease-out rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-3 text-[10px] text-muted-foreground/40">
            <span>PID 42891</span>
            <span>mem: 128MB allocated</span>
            <span>rust v1.82.0</span>
          </div>
        </div>
      </div>
    </div>
  )
}
