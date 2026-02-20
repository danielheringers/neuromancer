"use client"

import { useMemo, useState } from "react"
import {
  X,
  Server,
  PlugZap,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitBranch,
  Terminal as TerminalIcon,
  Globe,
  Database,
  Search,
  Wrench,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  KeyRound,
  LogOut,
  Info,
  AlertTriangle,
  ListChecks,
} from "lucide-react"

import { type McpServer } from "@/lib/alicia-types"
import { codexMcpLogin, codexMcpReload, runCodexCommand } from "@/lib/tauri-bridge"

interface McpPanelProps {
  servers: McpServer[]
  onClose: () => void
  onRefresh: (options?: { throwOnError?: boolean }) => Promise<unknown>
}

type AddTransport = "stdio" | "streamable-http"

interface AddServerDraft {
  name: string
  transport: AddTransport
  command: string
  env: string
  url: string
  bearerTokenEnvVar: string
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
  disconnected: { dot: "bg-muted-foreground/50", text: "text-muted-foreground/60" },
  error: { dot: "bg-terminal-red", text: "text-terminal-red" },
  connecting: { dot: "bg-terminal-gold animate-pulse", text: "text-terminal-gold" },
}

const initialAddDraft: AddServerDraft = {
  name: "",
  transport: "stdio",
  command: "",
  env: "",
  url: "",
  bearerTokenEnvVar: "",
}

function parseCommandArgs(raw: string): string[] {
  const matches = raw.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) ?? []
  return matches
    .map((part) => part.replace(/^"|"$/g, "").replace(/^'|'$/g, ""))
    .filter((part) => part.trim().length > 0)
}

function parseEnvPairs(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function commandFailureMessage(result: {
  success: boolean
  status: number
  stderr: string
  stdout: string
}) {
  if (result.success) {
    return ""
  }

  const stderr = result.stderr.trim()
  const stdout = result.stdout.trim()
  return stderr || stdout || `command exited with status ${result.status}`
}

function authBadgeLabel(server: McpServer): string {
  const authStatus = server.authStatus ?? "unsupported"
  if (authStatus === "not_logged_in") {
    return "oauth required"
  }
  if (authStatus === "oauth") {
    return "oauth"
  }
  if (authStatus === "bearer_token") {
    return "bearer"
  }
  return "no auth"
}

function canLogin(server: McpServer): boolean {
  return server.transport === "streamable-http" && server.authStatus === "not_logged_in"
}

function canLogout(server: McpServer): boolean {
  return (
    server.transport === "streamable-http" &&
    (server.authStatus === "oauth" || server.authStatus === "bearer_token")
  )
}

interface ServerRowProps {
  server: McpServer
  details?: string
  isBusy: boolean
  isReconnecting: boolean
  onGet: (server: McpServer) => void
  onRemove: (server: McpServer) => void
  onReconnect: (server: McpServer) => void
  onLogin: (server: McpServer) => void
  onLogout: (server: McpServer) => void
}

function ServerRow({
  server,
  details,
  isBusy,
  isReconnecting,
  onGet,
  onRemove,
  onReconnect,
  onLogin,
  onLogout,
}: ServerRowProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = serverIcons[server.id] || Server
  const effectiveStatus = isReconnecting ? "connecting" : server.status
  const status = statusConfig[effectiveStatus]

  return (
    <div className="border border-panel-border rounded-lg overflow-hidden bg-background/20">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center w-full px-3 py-2.5 text-left hover:bg-[#ffffff06] transition-colors gap-3"
      >
        <Icon className={`w-4 h-4 ${status.text} shrink-0`} />

        <span className="text-sm text-terminal-fg font-medium truncate">{server.name}</span>

        <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0">
          {server.transport}
        </span>

        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded border border-panel-border text-muted-foreground/60">
          {authBadgeLabel(server)}
        </span>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={`text-xs tabular-nums ${status.text}`}>{server.tools.length} tools</span>
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} />
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-panel-border">
          {!!server.statusReason && (
            <div className="px-3 pt-2">
              <div className="inline-flex items-center gap-1 text-[10px] text-terminal-gold/80">
                <Info className="w-3 h-3" />
                {server.statusReason}
              </div>
            </div>
          )}

          <div className="px-3 pt-2 pb-2.5">
            <div className="flex items-center gap-1.5 mb-2">
              <Wrench className="w-3 h-3 text-muted-foreground/40" />
              <span className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">
                Tools ({server.tools.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {server.tools.length === 0 ? (
                <span className="text-[10px] text-muted-foreground/40">No tools reported</span>
              ) : (
                server.tools.map((tool) => (
                  <span
                    key={tool}
                    className="inline-flex text-[11px] leading-tight px-1.5 py-0.5 rounded border border-panel-border bg-panel-bg text-terminal-fg/60 font-mono whitespace-nowrap"
                  >
                    {tool}
                  </span>
                ))
              )}
            </div>
          </div>

          {details && (
            <div className="px-3 pb-2">
              <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">
                Config Snapshot
              </div>
              <pre className="max-h-40 overflow-auto rounded border border-panel-border bg-background/50 p-2 text-[10px] text-terminal-fg/70 whitespace-pre-wrap break-all">
                {details}
              </pre>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-panel-border bg-background/20">
            <button
              disabled={isBusy}
              onClick={() => onGet(server)}
              className="flex items-center gap-1 text-[10px] text-terminal-cyan/80 hover:text-terminal-cyan disabled:opacity-40 transition-colors"
            >
              <ListChecks className="w-3 h-3" />
              Get
            </button>

            {canLogin(server) && (
              <button
                disabled={isBusy}
                onClick={() => onLogin(server)}
                className="flex items-center gap-1 text-[10px] text-terminal-blue/80 hover:text-terminal-blue disabled:opacity-40 transition-colors"
              >
                <KeyRound className="w-3 h-3" />
                Login
              </button>
            )}

            {canLogout(server) && (
              <button
                disabled={isBusy}
                onClick={() => onLogout(server)}
                className="flex items-center gap-1 text-[10px] text-terminal-gold/80 hover:text-terminal-gold disabled:opacity-40 transition-colors"
              >
                <LogOut className="w-3 h-3" />
                Logout
              </button>
            )}

            <button
              disabled={isBusy}
              onClick={() => onReconnect(server)}
              className="flex items-center gap-1 text-[10px] text-terminal-blue/80 hover:text-terminal-blue disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isReconnecting ? "animate-spin" : ""}`} />
              Reconnect
            </button>

            <button
              disabled={isBusy}
              onClick={() => onRemove(server)}
              className="flex items-center gap-1 text-[10px] text-terminal-red/80 hover:text-terminal-red disabled:opacity-40 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Remove
            </button>

            {server.url && (
              <span className="ml-auto text-[10px] text-muted-foreground/30 font-mono truncate max-w-[220px]">
                {server.url}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function McpPanel({ servers, onClose, onRefresh }: McpPanelProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [panelInfo, setPanelInfo] = useState<string | null>(null)
  const [detailsByName, setDetailsByName] = useState<Record<string, string>>({})
  const [reconnectingNames, setReconnectingNames] = useState<string[]>([])
  const [addExpanded, setAddExpanded] = useState(false)
  const [addDraft, setAddDraft] = useState<AddServerDraft>(initialAddDraft)

  const connectedCount = useMemo(
    () => servers.filter((server) => server.status === "connected").length,
    [servers],
  )
  const totalTools = useMemo(
    () => servers.reduce((sum, server) => sum + server.tools.length, 0),
    [servers],
  )

  const setReconnectFlag = (name: string, active: boolean) => {
    setReconnectingNames((previous) => {
      const exists = previous.includes(name)
      if (active && !exists) {
        return [...previous, name]
      }
      if (!active && exists) {
        return previous.filter((entry) => entry !== name)
      }
      return previous
    })
  }

  const runWithBusy = async (
    key: string,
    operation: () => Promise<string | null>,
  ) => {
    setBusyKey(key)
    setPanelError(null)
    setPanelInfo(null)
    try {
      const message = await operation()
      if (message) {
        setPanelInfo(message)
      }
    } catch (error) {
      setPanelError(String(error))
    } finally {
      setBusyKey(null)
    }
  }

  const refreshAfterConfigMutation = async () => {
    await codexMcpReload()
    await onRefresh({ throwOnError: true })
  }

  const handleReloadAll = () => {
    void runWithBusy("reload", async () => {
      const result = await codexMcpReload()
      await onRefresh({ throwOnError: true })
      return `MCP config reloaded in ${result.elapsedMs}ms`
    })
  }

  const handleGetServer = (server: McpServer) => {
    void runWithBusy(`get:${server.name}`, async () => {
      const result = await runCodexCommand(["mcp", "get", server.name, "--json"])
      const failure = commandFailureMessage(result)
      if (failure) {
        throw new Error(`[mcp:get] ${failure}`)
      }

      const pretty = result.stdout.trim()
      setDetailsByName((previous) => ({
        ...previous,
        [server.name]: pretty || "{}",
      }))
      return `Loaded config for ${server.name}`
    })
  }

  const handleRemoveServer = (server: McpServer) => {
    void runWithBusy(`remove:${server.name}`, async () => {
      const result = await runCodexCommand(["mcp", "remove", server.name])
      const failure = commandFailureMessage(result)
      if (failure) {
        throw new Error(`[mcp:remove] ${failure}`)
      }

      await refreshAfterConfigMutation()
      setDetailsByName((previous) => {
        if (!(server.name in previous)) {
          return previous
        }
        const copy = { ...previous }
        delete copy[server.name]
        return copy
      })
      return `Removed MCP server ${server.name}`
    })
  }

  const handleReconnectServer = (server: McpServer) => {
    void runWithBusy(`reconnect:${server.name}`, async () => {
      setReconnectFlag(server.name, true)
      try {
        await codexMcpReload()
        await onRefresh({ throwOnError: true })
      } finally {
        setReconnectFlag(server.name, false)
      }
      return `Reconnect requested for ${server.name}`
    })
  }

  const handleLoginServer = (server: McpServer) => {
    void runWithBusy(`login:${server.name}`, async () => {
      setReconnectFlag(server.name, true)
      try {
        const login = await codexMcpLogin({ name: server.name })
        await onRefresh({ throwOnError: false })

        window.setTimeout(() => {
          void onRefresh({ throwOnError: false })
          setReconnectFlag(server.name, false)
        }, 3500)

        if (login.authorizationUrl) {
          return `OAuth login started for ${server.name}: ${login.authorizationUrl}`
        }

        return `OAuth login started for ${server.name}`
      } catch (error) {
        setReconnectFlag(server.name, false)
        throw error
      }
    })
  }

  const handleLogoutServer = (server: McpServer) => {
    void runWithBusy(`logout:${server.name}`, async () => {
      const result = await runCodexCommand(["mcp", "logout", server.name])
      const failure = commandFailureMessage(result)
      if (failure) {
        throw new Error(`[mcp:logout] ${failure}`)
      }

      await refreshAfterConfigMutation()
      return `Logged out from ${server.name}`
    })
  }

  const handleAddServer = () => {
    void runWithBusy("add", async () => {
      const name = addDraft.name.trim()
      if (!name) {
        throw new Error("[mcp:add] server name is required")
      }

      const args = ["mcp", "add", name]

      if (addDraft.transport === "streamable-http") {
        const url = addDraft.url.trim()
        if (!url) {
          throw new Error("[mcp:add] URL is required for streamable-http")
        }

        args.push("--url", url)
        const bearerEnv = addDraft.bearerTokenEnvVar.trim()
        if (bearerEnv) {
          args.push("--bearer-token-env-var", bearerEnv)
        }
      } else {
        const commandParts = parseCommandArgs(addDraft.command)
        if (commandParts.length === 0) {
          throw new Error("[mcp:add] command is required for stdio transport")
        }

        const envPairs = parseEnvPairs(addDraft.env)
        for (const envPair of envPairs) {
          if (!envPair.includes("=")) {
            throw new Error(`[mcp:add] invalid env pair: ${envPair}`)
          }
          args.push("--env", envPair)
        }

        args.push("--", ...commandParts)
      }

      const result = await runCodexCommand(args)
      const failure = commandFailureMessage(result)
      if (failure) {
        throw new Error(`[mcp:add] ${failure}`)
      }

      await refreshAfterConfigMutation()
      setAddDraft(initialAddDraft)
      setAddExpanded(false)
      return `Added MCP server ${name}`
    })
  }

  const isPanelBusy = busyKey !== null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl border border-panel-border rounded-lg bg-panel-bg shadow-2xl flex flex-col max-h-[82vh]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <PlugZap className="w-4 h-4 text-terminal-green shrink-0" />
            <span className="text-sm font-semibold text-terminal-fg">/mcp</span>
            <span className="text-[10px] text-muted-foreground/50 ml-1 truncate">
              {connectedCount}/{servers.length} MCP, {totalTools} tools
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReloadAll}
              disabled={isPanelBusy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-panel-border text-xs text-terminal-blue hover:text-terminal-blue/80 disabled:opacity-40"
            >
              {busyKey === "reload" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Reload
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#ffffff08] text-muted-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(panelError || panelInfo) && (
          <div className="px-3 pt-3 shrink-0 space-y-2">
            {panelError && (
              <div className="px-2.5 py-2 rounded border border-terminal-red/30 bg-terminal-red/10 text-[11px] text-terminal-red/90 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{panelError}</span>
              </div>
            )}
            {panelInfo && !panelError && (
              <div className="px-2.5 py-2 rounded border border-terminal-green/25 bg-terminal-green/10 text-[11px] text-terminal-green/90 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>{panelInfo}</span>
              </div>
            )}
          </div>
        )}

        <div className="overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
          {servers.map((server, index) => (
            <ServerRow
              key={`${server.id}-${index}`}
              server={server}
              details={detailsByName[server.name]}
              isBusy={isPanelBusy}
              isReconnecting={reconnectingNames.includes(server.name)}
              onGet={handleGetServer}
              onRemove={handleRemoveServer}
              onReconnect={handleReconnectServer}
              onLogin={handleLoginServer}
              onLogout={handleLogoutServer}
            />
          ))}
          {servers.length === 0 && (
            <div className="text-xs text-muted-foreground/60 px-1 py-4 text-center border border-dashed border-panel-border rounded">
              No MCP servers available
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-panel-border shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setAddExpanded((prev) => !prev)}
              disabled={isPanelBusy}
              className="flex items-center gap-1.5 text-xs text-terminal-green hover:text-terminal-green/80 disabled:opacity-40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Server
            </button>
            <div className="text-[10px] text-muted-foreground/40">
              CLI: <span className="text-terminal-fg/50 font-mono">codex mcp ...</span>
            </div>
          </div>

          {addExpanded && (
            <div className="border border-panel-border rounded-md p-2.5 bg-background/30 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  value={addDraft.name}
                  onChange={(event) =>
                    setAddDraft((previous) => ({ ...previous, name: event.target.value }))
                  }
                  placeholder="server name"
                  className="px-2 py-1.5 text-xs rounded bg-background border border-panel-border text-terminal-fg"
                />
                <select
                  value={addDraft.transport}
                  onChange={(event) =>
                    setAddDraft((previous) => ({
                      ...previous,
                      transport: event.target.value as AddTransport,
                    }))
                  }
                  className="px-2 py-1.5 text-xs rounded bg-background border border-panel-border text-terminal-fg"
                >
                  <option value="stdio">stdio</option>
                  <option value="streamable-http">streamable-http</option>
                </select>
                <button
                  onClick={handleAddServer}
                  disabled={isPanelBusy}
                  className="px-2 py-1.5 text-xs rounded border border-terminal-green/30 text-terminal-green hover:text-terminal-green/80 disabled:opacity-40"
                >
                  {busyKey === "add" ? "Adding..." : "Add"}
                </button>
              </div>

              {addDraft.transport === "stdio" ? (
                <>
                  <input
                    value={addDraft.command}
                    onChange={(event) =>
                      setAddDraft((previous) => ({ ...previous, command: event.target.value }))
                    }
                    placeholder="command (e.g. npx @playwright/mcp@latest)"
                    className="w-full px-2 py-1.5 text-xs rounded bg-background border border-panel-border text-terminal-fg"
                  />
                  <input
                    value={addDraft.env}
                    onChange={(event) =>
                      setAddDraft((previous) => ({ ...previous, env: event.target.value }))
                    }
                    placeholder="env pairs separated by comma (KEY=VALUE,KEY2=VALUE2)"
                    className="w-full px-2 py-1.5 text-xs rounded bg-background border border-panel-border text-terminal-fg"
                  />
                </>
              ) : (
                <>
                  <input
                    value={addDraft.url}
                    onChange={(event) =>
                      setAddDraft((previous) => ({ ...previous, url: event.target.value }))
                    }
                    placeholder="https://..."
                    className="w-full px-2 py-1.5 text-xs rounded bg-background border border-panel-border text-terminal-fg"
                  />
                  <input
                    value={addDraft.bearerTokenEnvVar}
                    onChange={(event) =>
                      setAddDraft((previous) => ({
                        ...previous,
                        bearerTokenEnvVar: event.target.value,
                      }))
                    }
                    placeholder="Bearer token env var (optional)"
                    className="w-full px-2 py-1.5 text-xs rounded bg-background border border-panel-border text-terminal-fg"
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
