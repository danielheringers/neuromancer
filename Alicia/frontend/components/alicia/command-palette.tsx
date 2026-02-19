"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import {
  Cpu, Shield, PlugZap, MessageSquare, GitFork, RotateCcw, FileText,
  Sparkles, Search, Bug, Settings, LogOut, Plus, Code, Eye, Users,
  Terminal as TerminalIcon, Wrench, Zap, X as XIcon, Trash2, Send,
} from "lucide-react"
import { SLASH_COMMANDS, type SlashCommand } from "@/lib/alicia-types"

interface CommandPaletteProps {
  filter: string
  onSelect: (command: string) => void
  onClose: () => void
  position: { bottom: number; left: number }
}

const categoryLabels: Record<SlashCommand["category"], string> = {
  model: "Model & Config",
  config: "Configuration",
  session: "Session",
  agent: "Agent Actions",
  debug: "Debug & Status",
  system: "System",
}

const categoryOrder: SlashCommand["category"][] = ["model", "config", "session", "agent", "debug", "system"]

const commandIcons: Record<string, typeof Cpu> = {
  "/model": Cpu,
  "/models": Cpu,
  "/approvals": Shield,
  "/permissions": Shield,
  "/sandbox-add-read-dir": Settings,
  "/personality": Sparkles,
  "/experimental": Zap,
  "/statusline": Eye,
  "/new": Plus,
  "/resume": RotateCcw,
  "/fork": GitFork,
  "/rename": FileText,
  "/compact": Trash2,
  "/plan": FileText,
  "/collab": Users,
  "/agent": Wrench,
  "/diff": Code,
  "/review": Eye,
  "/mention": Search,
  "/skills": Sparkles,
  "/init": TerminalIcon,
  "/mcp": PlugZap,
  "/status": Bug,
  "/debug-config": Bug,
  "/ps": TerminalIcon,
  "/apps": Settings,
  "/clean": Trash2,
  "/feedback": Send,
  "/logout": LogOut,
  "/quit": XIcon,
  "/exit": XIcon,
}

export function CommandPalette({ filter, onSelect, onClose, position }: CommandPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().replace("/", "")
    if (!q) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter(
      cmd => cmd.command.toLowerCase().includes(q) || cmd.label.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q)
    )
  }, [filter])

  const grouped = useMemo(() => {
    const groups: Record<string, SlashCommand[]> = {}
    for (const cmd of filtered) {
      ;(groups[cmd.category] ??= []).push(cmd)
    }
    return categoryOrder.filter(c => groups[c]).map(c => ({ category: c, commands: groups[c]! }))
  }, [filtered])

  // Flat list for keyboard nav
  const flatCommands = useMemo(() => grouped.flatMap(g => g.commands), [grouped])

  useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, flatCommands.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === "Enter" && flatCommands[selectedIndex]) {
        e.preventDefault()
        onSelect(flatCommands[selectedIndex].command)
      } else if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [flatCommands, selectedIndex, onSelect, onClose])

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (flatCommands.length === 0) return null

  let globalIndex = 0

  return (
    <div
      className="fixed z-50 w-80 max-h-72 border border-panel-border rounded-lg bg-panel-bg shadow-2xl overflow-hidden flex flex-col"
      style={{ bottom: position.bottom, left: position.left }}
    >
      <div ref={listRef} className="flex-1 overflow-y-auto p-1.5">
        {grouped.map(group => (
          <div key={group.category}>
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                {categoryLabels[group.category]}
              </span>
            </div>
            {group.commands.map(cmd => {
              const idx = globalIndex++
              const Icon = commandIcons[cmd.command] || TerminalIcon
              return (
                <button
                  key={cmd.command}
                  data-index={idx}
                  onClick={() => onSelect(cmd.command)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded text-left transition-colors ${
                    idx === selectedIndex
                      ? "bg-selection text-terminal-fg"
                      : "text-muted-foreground hover:bg-[#b9bcc01c]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0 text-terminal-purple" />
                  <span className="text-xs font-mono text-terminal-green">{cmd.command}</span>
                  <span className="text-[11px] text-muted-foreground/60 truncate flex-1">{cmd.description}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5 border-t border-panel-border bg-background/30 flex items-center gap-3 text-[10px] text-muted-foreground/40">
        <span>{flatCommands.length} commands</span>
        <span className="ml-auto flex items-center gap-2">
          <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border">{"↑↓"}</kbd>
          navigate
          <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border">Enter</kbd>
          select
        </span>
      </div>
    </div>
  )
}
