"use client"

import { Bot, User, Check, FileEdit, Search, Terminal, Copy, CheckCheck, FileCode2 } from "lucide-react"
import { useMemo, useState } from "react"
import { parseAgentSpawnerPayload } from "@/lib/agent-spawner-events"
import { parseAgentDiffMarkdownSegments, type DiffFileView } from "@/lib/alicia-runtime-helpers"
import { AgentSpawner } from "./agent-spawner"
import { DiffViewer } from "./diff-viewer"
import { StatusSnapshotCard, parseStatusSnapshot } from "./status-snapshot-card"

type MessageType = "user" | "agent" | "system" | "tool"

interface ToolCall {
  name: string
  status: "running" | "done" | "error"
  detail?: string
}

interface CodeBlock {
  language: string
  filename?: string
  content: string
}

interface TerminalMessageProps {
  type: MessageType
  content: string
  timestamp?: string
  toolCalls?: ToolCall[]
  codeBlocks?: CodeBlock[]
  thinking?: boolean
  resolvedDiff?: {
    title?: string
    emptyMessage?: string
    files: DiffFileView[]
  } | null
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
    >
      {copied ? <CheckCheck className="w-3.5 h-3.5 text-terminal-green" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

function SyntaxHighlight({ code }: { code: string }) {
  const lines = code.split("\n")

  return (
    <div className="text-xs leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span className="text-muted-foreground/40 select-none w-8 text-right pr-3 shrink-0">
            {i + 1}
          </span>
          <span className="text-terminal-fg">
            {line.split(/(\b(?:pub|fn|let|mut|use|mod|struct|impl|enum|if|else|for|while|return|async|await|const|type|interface|export|import|from|class|def|self)\b|"[^"]*"|'[^']*'|\b\d+\.?\d*\b|\/\/.*$|#.*$)/).map((part, j) => {
              if (/^(pub|fn|let|mut|use|mod|struct|impl|enum|if|else|for|while|return|async|await|const|type|interface|export|import|from|class|def|self)$/.test(part)) {
                return <span key={j} className="text-terminal-blue">{part}</span>
              }
              if (/^"[^"]*"$/.test(part) || /^'[^']*'$/.test(part)) {
                return <span key={j} className="text-terminal-gold">{part}</span>
              }
              if (/^\d+\.?\d*$/.test(part)) {
                return <span key={j} className="text-terminal-pink">{part}</span>
              }
              if (/^\/\//.test(part) || /^#/.test(part)) {
                return <span key={j} className="text-terminal-comment italic">{part}</span>
              }
              return <span key={j}>{part}</span>
            })}
          </span>
        </div>
      ))}
    </div>
  )
}

function ToolCallIndicator({ tool }: { tool: ToolCall }) {
  const iconMap: Record<string, typeof Search> = {
    search: Search,
    edit: FileEdit,
    run: Terminal,
  }

  const Icon = Object.entries(iconMap).find(([key]) =>
    tool.name.toLowerCase().includes(key)
  )?.[1] || Terminal

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-background/50 border border-panel-border text-xs">
      <Icon className="w-3.5 h-3.5 text-terminal-purple" />
      <span className="text-muted-foreground">{tool.name}</span>
      {tool.detail && (
        <span className="text-muted-foreground/50 truncate max-w-48">{tool.detail}</span>
      )}
      <span className="ml-auto">
        {tool.status === "running" ? (
          <span className="flex items-center gap-1 text-terminal-gold">
            <span className="typing-dot w-1 h-1 rounded-full bg-terminal-gold inline-block" />
            <span className="typing-dot w-1 h-1 rounded-full bg-terminal-gold inline-block" />
            <span className="typing-dot w-1 h-1 rounded-full bg-terminal-gold inline-block" />
          </span>
        ) : tool.status === "done" ? (
          <Check className="w-3.5 h-3.5 text-terminal-green" />
        ) : (
          <span className="text-terminal-red">fail</span>
        )}
      </span>
    </div>
  )
}

export function TerminalMessage({
  type,
  content,
  timestamp,
  toolCalls,
  codeBlocks,
  thinking,
  resolvedDiff,
}: TerminalMessageProps) {
  const statusSnapshot = type === "system" ? parseStatusSnapshot(content) : null
  const agentSpawnerPayload =
    type === "system" ? parseAgentSpawnerPayload(content) : null
  const parsedAgentSegments = useMemo(
    () => (type === "agent" && !resolvedDiff ? parseAgentDiffMarkdownSegments(content) : null),
    [type, content, resolvedDiff],
  )
  return (
    <div className={`group flex gap-3 px-5 py-3 ${type === "user" ? "bg-line-highlight/50" : ""} hover:bg-line-highlight/30 transition-colors`}>
      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        {type === "user" ? (
          <div className="w-6 h-6 rounded bg-terminal-blue/15 border border-terminal-blue/20 flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-terminal-blue" />
          </div>
        ) : type === "system" ? (
          <div className="w-6 h-6 rounded bg-terminal-purple/15 border border-terminal-purple/20 flex items-center justify-center">
            <Terminal className="w-3.5 h-3.5 text-terminal-purple" />
          </div>
        ) : (
          <div className="w-6 h-6 rounded bg-terminal-green/15 border border-terminal-green/20 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-terminal-green" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold ${
            type === "user"
              ? "text-terminal-blue"
              : type === "system"
              ? "text-terminal-purple"
              : "text-terminal-green"
          }`}>
            {type === "user" ? "you" : type === "system" ? "system" : "alicia"}
          </span>
          {timestamp && (
            <span className="text-[10px] text-muted-foreground/40">{timestamp}</span>
          )}
        </div>

        {thinking ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Thinking</span>
            <span className="flex items-center gap-0.5">
              <span className="typing-dot w-1 h-1 rounded-full bg-terminal-green inline-block" />
              <span className="typing-dot w-1 h-1 rounded-full bg-terminal-green inline-block" />
              <span className="typing-dot w-1 h-1 rounded-full bg-terminal-green inline-block" />
            </span>
          </div>
        ) : (
          <>
            {statusSnapshot ? (
              <StatusSnapshotCard snapshot={statusSnapshot} timestamp={timestamp} />
            ) : agentSpawnerPayload ? (
              <AgentSpawner
                agents={agentSpawnerPayload.agents}
                waiting={agentSpawnerPayload.waiting}
                timestamp={timestamp}
              />
            ) : resolvedDiff ? (
              <div className="space-y-2">
                {resolvedDiff.title && (
                  <div className="text-sm text-terminal-fg/90 leading-relaxed">
                    {resolvedDiff.title}
                  </div>
                )}
                {resolvedDiff.files.length > 0 ? (
                  resolvedDiff.files.map((file, index) => (
                    <DiffViewer
                      key={`${file.filename}-${index}`}
                      filename={file.filename}
                      lines={file.lines}
                    />
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground leading-relaxed">
                    {resolvedDiff.emptyMessage ?? "No diff available right now."}
                  </div>
                )}
              </div>
            ) : parsedAgentSegments ? (
              <div className="text-sm text-terminal-fg/90 leading-relaxed">
                {parsedAgentSegments.map((segment, index) =>
                  segment.kind === "text" ? (
                    <span key={`text-${index}`} className="whitespace-pre-wrap">
                      {segment.content}
                    </span>
                  ) : (
                    <div key={`diff-${index}`}>
                      {segment.files.map((file, fileIndex) => (
                        <DiffViewer
                          key={`${file.filename}-${index}-${fileIndex}`}
                          filename={file.filename}
                          lines={file.lines}
                        />
                      ))}
                    </div>
                  ),
                )}
              </div>
            ) : (
              <div className="text-sm text-terminal-fg/90 leading-relaxed whitespace-pre-wrap">
                {content}
              </div>
            )}

            {/* Tool Calls */}
            {toolCalls && toolCalls.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-3">
                {toolCalls.map((tool, i) => (
                  <ToolCallIndicator key={i} tool={tool} />
                ))}
              </div>
            )}

            {/* Code Blocks */}
            {codeBlocks && codeBlocks.length > 0 && (
              <div className="flex flex-col gap-3 mt-3">
                {codeBlocks.map((block, i) => (
                  <div key={i} className="rounded-md border border-panel-border overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-panel-bg border-b border-panel-border">
                      <div className="flex items-center gap-2">
                        <FileCode2 className="w-3 h-3 text-muted-foreground/50" />
                        {block.filename && (
                          <span className="text-xs text-terminal-cyan">{block.filename}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground/40 uppercase">{block.language}</span>
                      </div>
                      <CopyButton text={block.content} />
                    </div>
                    <div className="p-3 bg-terminal-bg overflow-x-auto">
                      <SyntaxHighlight code={block.content} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function FileCode2Icon(props: React.SVGProps<SVGSVGElement>) {
  return <FileCode2 {...props} />
}







