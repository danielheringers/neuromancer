"use client"

import { useEffect, useState } from "react"
import {
  GitBranch,
  Clock,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Link2,
  FileCode2,
  Hourglass,
} from "lucide-react"

import {
  type SpawnedAgent,
  type WaitingInfo,
} from "@/lib/agent-spawner-events"

interface AgentSpawnerProps {
  agents: SpawnedAgent[]
  waiting?: WaitingInfo
  timestamp?: string
}

function truncateId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id
}

function StatusBadge({ status }: { status: SpawnedAgent["status"] }) {
  const config = {
    "pending init": {
      color: "text-terminal-gold bg-terminal-gold/10 border-terminal-gold/20",
      icon: Hourglass,
      label: "pending init",
    },
    running: {
      color: "text-terminal-blue bg-terminal-blue/10 border-terminal-blue/20",
      icon: Loader2,
      label: "running",
    },
    done: {
      color: "text-terminal-green bg-terminal-green/10 border-terminal-green/20",
      icon: CheckCircle2,
      label: "done",
    },
    error: {
      color: "text-terminal-red bg-terminal-red/10 border-terminal-red/20",
      icon: AlertCircle,
      label: "error",
    },
  }

  const c = config[status]
  const Icon = c.icon

  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium ${c.color}`}>
      <Icon className={`h-2.5 w-2.5 ${status === "running" ? "animate-spin" : ""}`} />
      {c.label}
    </span>
  )
}

function AgentCard({ agent, index }: { agent: SpawnedAgent; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const [animatedProgress, setAnimatedProgress] = useState(0)

  useEffect(() => {
    if (agent.progress !== undefined) {
      const timer = window.setTimeout(() => setAnimatedProgress(agent.progress ?? 0), 100)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [agent.progress])

  return (
    <div className="overflow-hidden rounded border border-panel-border bg-terminal-bg/60">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-line-highlight/30"
      >
        <div className="flex items-center gap-1.5 text-terminal-green">
          <Cpu className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold">Agent {index + 1}</span>
        </div>

        <StatusBadge status={agent.status} />

        {agent.elapsed && (
          <span className="ml-auto mr-2 flex items-center gap-1 text-[9px] text-muted-foreground/50">
            <Clock className="h-2.5 w-2.5" />
            {agent.elapsed}
          </span>
        )}

        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/40" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
        )}
      </button>

      {agent.status === "running" && agent.progress !== undefined && (
        <div className="h-[2px] bg-panel-border">
          <div
            className="h-full bg-terminal-blue transition-all duration-700 ease-out"
            style={{ width: `${animatedProgress}%` }}
          />
        </div>
      )}

      {expanded && (
        <div className="space-y-2 border-t border-panel-border/50 px-3 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div className="flex items-center gap-1.5">
              <Link2 className="h-2.5 w-2.5 text-muted-foreground/40" />
              <span className="text-[9px] text-muted-foreground/50">call</span>
              <span className="font-mono text-[9px] text-terminal-cyan">{truncateId(agent.callId)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Cpu className="h-2.5 w-2.5 text-muted-foreground/40" />
              <span className="text-[9px] text-muted-foreground/50">agent</span>
              <span className="font-mono text-[9px] text-terminal-purple">{truncateId(agent.agentId)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">prompt</span>
            <p className="rounded border border-panel-border/30 bg-background/40 px-2 py-1.5 text-[10px] leading-relaxed text-terminal-fg/80">
              {agent.prompt || "(no prompt)"}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">ownership</span>
            <div className="flex items-start gap-1.5">
              <FileCode2 className="mt-0.5 h-2.5 w-2.5 shrink-0 text-terminal-gold" />
              <p className="break-all text-[10px] leading-relaxed text-terminal-gold/80">
                {agent.ownership}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function AgentSpawner({ agents, waiting, timestamp }: AgentSpawnerProps) {
  return (
    <div className="max-w-2xl overflow-hidden rounded-lg border border-terminal-green/15 bg-panel-bg/50">
      <div className="flex items-center justify-between border-b border-panel-border/50 bg-terminal-green/[0.03] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <GitBranch className="h-3.5 w-3.5 text-terminal-green" />
            <span className="text-[11px] font-semibold text-terminal-green">
              Multi-Agent Spawn
            </span>
          </div>
          <span className="rounded border border-panel-border/30 bg-background/30 px-1.5 py-0.5 text-[9px] text-muted-foreground/40">
            {agents.length} agent{agents.length !== 1 ? "s" : ""}
          </span>
        </div>
        {timestamp && <span className="text-[9px] text-muted-foreground/40">{timestamp}</span>}
      </div>

      <div className="space-y-1.5 p-2">
        {agents.map((agent, index) => (
          <AgentCard
            key={`${agent.callId}-${agent.agentId}-${index}`}
            agent={agent}
            index={index}
          />
        ))}
      </div>

      {waiting && (
        <div className="mx-2 mb-2 rounded border border-terminal-gold/15 bg-terminal-gold/[0.03] px-3 py-2">
          <div className="mb-1.5 flex items-center gap-2">
            <Hourglass className="h-3 w-3 animate-pulse text-terminal-gold" />
            <span className="text-[10px] font-medium text-terminal-gold">Waiting for agents</span>
          </div>
          <div className="ml-5 flex items-center gap-1.5">
            <Link2 className="h-2.5 w-2.5 text-muted-foreground/40" />
            <span className="text-[9px] text-muted-foreground/50">call</span>
            <span className="font-mono text-[9px] text-terminal-cyan">
              {truncateId(waiting.callId)}
            </span>
          </div>
          <div className="ml-5 mt-1 flex items-start gap-1.5">
            <Cpu className="mt-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
            <span className="text-[9px] text-muted-foreground/50">receivers</span>
            <div className="flex flex-wrap gap-1">
              {waiting.receivers.map((receiver) => (
                <span
                  key={receiver}
                  className="rounded border border-terminal-purple/15 bg-terminal-purple/10 px-1 py-0.5 font-mono text-[9px] text-terminal-purple"
                >
                  {truncateId(receiver)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
