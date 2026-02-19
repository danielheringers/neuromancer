"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, Plus, TerminalSquare, X } from "lucide-react"
import { TitleBar } from "@/components/alicia/title-bar"
import { Sidebar } from "@/components/alicia/sidebar"
import { TerminalMessage } from "@/components/alicia/terminal-message"
import { CommandInput } from "@/components/alicia/command-input"
import { StatusBar } from "@/components/alicia/status-bar"
import { ModelPicker } from "@/components/alicia/model-picker"
import { PermissionsPanel } from "@/components/alicia/permissions-panel"
import { McpPanel } from "@/components/alicia/mcp-panel"
import { SessionPicker } from "@/components/alicia/session-picker"
import {
  type AliciaState,
  type ApprovalPreset,
  type McpServer,
  type ReasoningEffort,
  APPROVAL_PRESETS,
} from "@/lib/alicia-types"
import {
  codexBridgeStart,
  codexBridgeStop,
  codexConfigSet,
  codexHelpSnapshot,
  codexModelsList,
  codexRuntimeStatus,
  codexWaitForMcpStartup,
  codexTurnRun,
  isTauriRuntime,
  listenToCodexEvents,
  listenToTerminalEvents,
  loadCodexDefaultConfig,
  pickImageFile,
  pickMentionFile,
  runCodexCommand,
  sendCodexInput,
  terminalCreate,
  terminalKill,
  terminalResize,
  terminalWrite,
  type CodexInputItem,
  type CodexModel,
  type CodexRuntimeEvent,
  type RuntimeCodexConfig,
  type TerminalRuntimeEvent,
} from "@/lib/tauri-bridge"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

interface Message {
  id: number
  type: "user" | "agent" | "system"
  content: string
  timestamp: string
}

interface RuntimeState {
  connected: boolean
  state: "idle" | "starting" | "running" | "stopping" | "error"
  sessionId: number | null
  pid: number | null
  workspace: string
}

interface TerminalTab {
  id: number
  title: string
  alive: boolean
}

const INITIAL_ALICIA_STATE: AliciaState = {
  model: "default",
  reasoningEffort: "medium",
  approvalPreset: "auto",
  sandboxMode: "read-only",
  mcpServers: [],
  sessions: [],
  fileChanges: [],
  activePanel: null,
}

const MODELS_CACHE_KEY = "alicia.codex.models.catalog.v1"
const AUTO_TERMINAL_BOOT_KEY = "__alicia_auto_terminal_boot_done__"

interface ModelsCachePayload {
  cachedAt: number
  data: CodexModel[]
}

function readModelsCache(): ModelsCachePayload | null {
  if (typeof window === "undefined") {
    return null
  }
  try {
    const raw = window.localStorage.getItem(MODELS_CACHE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as { cachedAt?: unknown; data?: unknown }
    if (typeof parsed.cachedAt !== "number" || !Number.isFinite(parsed.cachedAt)) {
      return null
    }
    if (!Array.isArray(parsed.data)) {
      return null
    }
    return { cachedAt: parsed.cachedAt, data: parsed.data as CodexModel[] }
  } catch {
    return null
  }
}

function writeModelsCache(payload: ModelsCachePayload): void {
  if (typeof window === "undefined") {
    return
  }
  try {
    window.localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // best effort
  }
}

function wasAutoTerminalBootDone(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  const scopedWindow = window as unknown as Record<string, unknown>
  return scopedWindow[AUTO_TERMINAL_BOOT_KEY] === true
}

function markAutoTerminalBootDone(done: boolean): void {
  if (typeof window === "undefined") {
    return
  }
  const scopedWindow = window as unknown as Record<string, unknown>
  scopedWindow[AUTO_TERMINAL_BOOT_KEY] = done
}

function timestampNow(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function relativeNowLabel(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })
}

function parseMcpListOutput(output: string): McpServer[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const name = line.split(/\s+/)[0]
      let status: McpServer["status"] = "disconnected"
      if (/(connected|online|ready|ok)/i.test(line)) {
        status = "connected"
      } else if (/(error|failed|offline)/i.test(line)) {
        status = "error"
      }
      return {
        id: name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
        name,
        status,
        transport: /sse/i.test(line) ? "sse" : "stdio",
        tools: [],
      }
    })
}

function normalizeConfig(config: RuntimeCodexConfig) {
  return {
    model: config.model.trim() || "default",
    reasoningEffort: (["none", "minimal", "low", "medium", "high", "xhigh"].includes(config.reasoning)
      ? config.reasoning
      : "medium") as ReasoningEffort,
    approvalPreset:
      config.approvalPreset === "read-only" ||
      config.approvalPreset === "auto" ||
      config.approvalPreset === "full-access"
        ? config.approvalPreset
        : config.sandbox === "read-only"
          ? "read-only"
          : config.sandbox === "danger-full-access" && config.approvalPolicy === "never"
            ? "full-access"
            : "auto",
    sandboxMode:
      config.sandbox === "read-only" ||
      config.sandbox === "workspace-write" ||
      config.sandbox === "danger-full-access"
        ? config.sandbox
        : "read-only",
  }
}

function formatStructuredItem(item: Record<string, unknown>): string | null {
  const itemType = String(item.type ?? "")
  if (itemType === "agent_message") {
    const text = String(item.text ?? "")
    return text.trim() ? text : null
  }
  if (itemType === "command_execution") {
    const command = String(item.command ?? "command")
    const status = String(item.status ?? "in_progress")
    const output = String(item.aggregated_output ?? "")
    return `[command:${status}] ${command}${output ? `\n${output}` : ""}`
  }
  if (itemType === "mcp_tool_call") {
    return `[mcp:${String(item.status ?? "in_progress")}] ${String(item.tool ?? "tool")}`
  }
  if (itemType === "file_change") {
    return "[file_change] changes applied"
  }
  if (itemType === "reasoning") {
    return `[reasoning]\n${String(item.text ?? "")}`
  }
  if (itemType === "error") {
    return `[error] ${String(item.message ?? "unknown")}`
  }
  return null
}

function itemIdentity(item: Record<string, unknown>): string | null {
  if (typeof item.id === "string" && item.id.trim().length > 0) {
    return item.id
  }
  if (typeof item.id === "number" && Number.isFinite(item.id)) {
    return String(item.id)
  }
  return null
}

function mergeTerminalBuffer(previous: string, chunk: string): string {
  const next = `${previous}${chunk}`
  const max = 400_000
  return next.length <= max ? next : next.slice(next.length - max)
}

export default function AliciaTerminal() {
  const [initializing, setInitializing] = useState(true)
  const [initializingStatus, setInitializingStatus] = useState("Initializing Alicia runtime...")
  const [messages, setMessages] = useState<Message[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [pendingMentions, setPendingMentions] = useState<string[]>([])
  const [sessionPickerMode, setSessionPickerMode] = useState<"resume" | "fork" | "list">("list")
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<number | null>(null)
  const [aliciaState, setAliciaState] = useState<AliciaState>(INITIAL_ALICIA_STATE)
  const [availableModels, setAvailableModels] = useState<CodexModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsCachedAt, setModelsCachedAt] = useState<number | null>(null)
  const [modelsFromCache, setModelsFromCache] = useState(false)
  const [runtime, setRuntime] = useState<RuntimeState>({
    connected: isTauriRuntime(),
    state: "idle",
    sessionId: null,
    pid: null,
    workspace: ".",
  })

  const idRef = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const terminalContainerRef = useRef<HTMLDivElement>(null)
  const codexUnlistenRef = useRef<(() => void) | null>(null)
  const terminalUnlistenRef = useRef<(() => void) | null>(null)
  const runtimeConfigRef = useRef<RuntimeCodexConfig | null>(null)
  const threadIdRef = useRef<string | null>(null)
  const terminalBuffersRef = useRef<Map<number, string>>(new Map())
  const activeTerminalRef = useRef<number | null>(null)
  const xtermRef = useRef<import("xterm").Terminal | null>(null)
  const fitAddonRef = useRef<import("xterm-addon-fit").FitAddon | null>(null)
  const seenEventSeqRef = useRef<Set<number>>(new Set())
  const streamedAgentTextRef = useRef<Map<string, string>>(new Map())
  const bootstrappedRef = useRef(false)
  const autoTerminalCreatedRef = useRef(false)

  useEffect(() => {
    activeTerminalRef.current = activeTerminalId
  }, [activeTerminalId])

  useEffect(() => {
    const cached = readModelsCache()
    if (!cached || cached.data.length === 0) {
      return
    }
    setAvailableModels(cached.data)
    setModelsCachedAt(cached.cachedAt)
    setModelsFromCache(true)
  }, [])

  const nextMessageId = useCallback(() => {
    idRef.current += 1
    return idRef.current
  }, [])

  const addMessage = useCallback(
    (type: Message["type"], content: string) => {
      if (!content.trim()) {
        return
      }
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          type,
          content,
          timestamp: timestampNow(),
        },
      ])
    },
    [nextMessageId],
  )

  const setActiveSessionEntry = useCallback((sessionId: number, model?: string) => {
    setAliciaState((previous) => {
      const id = `session-${sessionId}`
      const existing = previous.sessions.find((session) => session.id === id)
      return {
        ...previous,
        sessions: [
          {
            id,
            name: existing?.name ?? `Session ${sessionId}`,
            time: relativeNowLabel(),
            active: true,
            messageCount: existing?.messageCount ?? 0,
            model: existing?.model ?? model ?? previous.model,
          },
          ...previous.sessions
            .filter((session) => session.id !== id)
            .map((session) => ({ ...session, active: false })),
        ].slice(0, 20),
      }
    })
  }, [])

  const refreshMcpServers = useCallback(async () => {
    try {
      const result = await runCodexCommand(["mcp", "list"])
      const parsed = parseMcpListOutput(result.stdout)
      setAliciaState((previous) => ({ ...previous, mcpServers: parsed }))
    } catch {
      // best effort
    }
  }, [])

  const refreshModelsCatalog = useCallback(
    async (notifyOnError = false): Promise<CodexModel[]> => {
      if (!runtime.connected) {
        const message = "runtime disconnected; cannot list models"
        setModelsError(message)
        setModelsFromCache(availableModels.length > 0)
        if (notifyOnError) {
          addMessage("system", `[models] ${message}`)
        }
        return availableModels
      }

      setModelsLoading(true)
      setModelsError(null)
      try {
        const response = await codexModelsList()
        const models = response.data ?? []
        setAvailableModels(models)
        const cachedAt = Date.now()
        setModelsCachedAt(cachedAt)
        setModelsFromCache(false)
        writeModelsCache({ cachedAt, data: models })
        if (models.length === 0) {
          const message = "codex returned no available models"
          setModelsError(message)
          if (notifyOnError) {
            addMessage("system", `[models] ${message}`)
          }
        }
        return models
      } catch (error) {
        const message = String(error)
        setModelsError(message)
        setModelsFromCache(availableModels.length > 0)
        if (notifyOnError) {
          if (availableModels.length > 0) {
            addMessage("system", `[models] live refresh failed, using cached catalog: ${message}`)
          } else {
            addMessage("system", `[models] failed: ${message}`)
          }
        }
        return availableModels
      } finally {
        setModelsLoading(false)
      }
    },
    [addMessage, availableModels, runtime.connected],
  )

  const openModelPanel = useCallback(
    async (notifyOnError = false) => {
      setAliciaState((prev) => ({ ...prev, activePanel: "model" }))
      if (modelsLoading) {
        return
      }
      if (availableModels.length > 0) {
        void refreshModelsCatalog(false)
        return
      }
      await refreshModelsCatalog(notifyOnError)
    },
    [availableModels.length, modelsLoading, refreshModelsCatalog],
  )

  const ensureBridgeSession = useCallback(
    async (forceNew = false): Promise<boolean> => {
      if (!runtime.connected) {
        return false
      }
      try {
        if (forceNew && runtime.sessionId != null) {
          await codexBridgeStop()
          threadIdRef.current = null
          seenEventSeqRef.current.clear()
          streamedAgentTextRef.current.clear()
          setRuntime((prev) => ({ ...prev, state: "idle", sessionId: null, pid: null }))
        }
        if (!forceNew && runtime.sessionId != null) {
          return true
        }
        setRuntime((prev) => ({ ...prev, state: "starting" }))
        const started = await codexBridgeStart()
        setRuntime((prev) => ({
          ...prev,
          state: "running",
          sessionId: started.sessionId,
          pid: started.pid,
        }))
        setActiveSessionEntry(started.sessionId, aliciaState.model)
        addMessage("system", `[session] started #${started.sessionId}`)
        return true
      } catch (error) {
        setRuntime((prev) => ({ ...prev, state: "error" }))
        addMessage("system", `[session] failed to start: ${String(error)}`)
        return false
      }
    },
    [addMessage, aliciaState.model, runtime.connected, runtime.sessionId, setActiveSessionEntry],
  )

  const createTerminalTab = useCallback(
    async (cwd?: string): Promise<boolean> => {
      if (!runtime.connected) {
        return false
      }
      try {
        const created = await terminalCreate({ cwd })
        terminalBuffersRef.current.set(created.terminalId, "")
        setTerminalTabs((prev) => [
          ...prev,
          { id: created.terminalId, title: `Terminal ${created.terminalId}`, alive: true },
        ])
        setActiveTerminalId(created.terminalId)

        const xterm = xtermRef.current
        if (xterm) {
          void terminalResize(created.terminalId, xterm.cols, xterm.rows)
          xterm.focus()
        }
        return true
      } catch (error) {
        addMessage("system", `[terminal] failed to start: ${String(error)}`)
        return false
      }
    },
    [addMessage, runtime.connected],
  )

  const closeTerminalTab = useCallback(
    async (terminalId: number) => {
      try {
        await terminalKill(terminalId)
      } catch {
        // best effort
      }
      terminalBuffersRef.current.delete(terminalId)
      setTerminalTabs((prev) => {
        const filtered = prev.filter((tab) => tab.id !== terminalId)
        setActiveTerminalId((current) => {
          if (current !== terminalId) {
            return current
          }
          return filtered[0]?.id ?? null
        })
        return filtered
      })
    },
    [],
  )

  const handleCodexEvent = useCallback(
    (event: CodexRuntimeEvent) => {
      if (event.type === "lifecycle") {
        if (event.payload.status === "error") {
          setRuntime((prev) => ({ ...prev, state: "error" }))
          setIsThinking(false)
          streamedAgentTextRef.current.clear()
          addMessage("system", event.payload.message ?? "runtime error")
        }
        if (event.payload.status === "stopped") {
          setRuntime((prev) => ({ ...prev, state: "idle", sessionId: null, pid: null }))
          setIsThinking(false)
          streamedAgentTextRef.current.clear()
        }
        return
      }

      if (event.type === "stdout" && event.payload.chunk.trim()) {
        addMessage("system", event.payload.chunk)
        return
      }

      if (event.type === "stderr" && event.payload.chunk.trim()) {
        addMessage("system", event.payload.chunk)
        return
      }

      if (event.type !== "event") {
        return
      }

      const payload = event.payload.event
      const seq = event.payload.seq
      if (seq > 0) {
        const seen = seenEventSeqRef.current
        if (seen.has(seq)) {
          return
        }
        seen.add(seq)
        if (seen.size > 8_000) {
          const first = seen.values().next().value
          if (first !== undefined) {
            seen.delete(first)
          }
        }
      }

      const eventType = String(payload.type ?? "")
      if (eventType === "thread.started") {
        const codexThreadId = String(payload.thread_id ?? "")
        addMessage("system", `[thread] started ${codexThreadId}`)
        return
      }
      if (eventType === "turn.started") {
        setIsThinking(true)
        return
      }
      if (eventType === "turn.completed") {
        setIsThinking(false)
        streamedAgentTextRef.current.clear()
        return
      }
      if (eventType === "turn.failed") {
        setIsThinking(false)
        streamedAgentTextRef.current.clear()
        const error = payload.error as Record<string, unknown> | undefined
        addMessage("system", `[turn failed] ${String(error?.message ?? "unknown")}`)
        return
      }
      if (eventType === "item.started" || eventType === "item.updated" || eventType === "item.completed") {
        const item = (payload.item ?? {}) as Record<string, unknown>
        const itemType = String(item.type ?? "")
        const key = itemIdentity(item)

        if (itemType === "agent_message") {
          if (eventType === "item.updated") {
            const text = String(item.text ?? "")
            if (key && text.length > 0) {
              streamedAgentTextRef.current.set(key, text)
            }
            return
          }

          if (eventType === "item.completed") {
            const completedText = String(item.text ?? "")
            const bufferedText = key ? streamedAgentTextRef.current.get(key) ?? "" : ""
            if (key) {
              streamedAgentTextRef.current.delete(key)
            }
            const finalText = completedText.trim().length > 0 ? completedText : bufferedText
            if (finalText.trim().length > 0) {
              addMessage("agent", finalText)
            }
          }
          return
        }

        if (eventType !== "item.completed") {
          return
        }

        const content = formatStructuredItem(item)
        if (content) {
          addMessage("system", content)
        }
      }
    },
    [addMessage],
  )

  const handleTerminalEvent = useCallback(
    (event: TerminalRuntimeEvent) => {
      if (event.type === "data") {
        const { terminalId, chunk } = event.payload
        const previous = terminalBuffersRef.current.get(terminalId) ?? ""
        terminalBuffersRef.current.set(terminalId, mergeTerminalBuffer(previous, chunk))
        if (activeTerminalRef.current === terminalId && xtermRef.current) {
          xtermRef.current.write(chunk)
        }
        return
      }
      setTerminalTabs((prev) =>
        prev.map((tab) => (tab.id === event.payload.terminalId ? { ...tab, alive: false } : tab)),
      )
    },
    [],
  )

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isThinking])

  useEffect(() => {
    if (initializing) {
      return
    }

    const container = terminalContainerRef.current
    if (!container) {
      return
    }
    let disposed = false
    let cleanup: (() => void) | undefined

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("xterm"),
        import("xterm-addon-fit"),
      ])
      if (disposed) {
        return
      }

      const xterm = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 13,
        scrollback: 5000,
        theme: {
          background: "#1e1f22",
          foreground: "#c5cfd9",
          cursor: "#39CC9B",
        },
      })
      const fitAddon = new FitAddon()
      xterm.loadAddon(fitAddon)
      xterm.open(container)
      fitAddon.fit()
      xterm.focus()
      xtermRef.current = xterm
      fitAddonRef.current = fitAddon

      const currentActiveTerminalId = activeTerminalRef.current
      if (currentActiveTerminalId != null) {
        const buffered = terminalBuffersRef.current.get(currentActiveTerminalId) ?? ""
        if (buffered) {
          xterm.write(buffered)
        }
        if (xterm.cols > 0 && xterm.rows > 0) {
          void terminalResize(currentActiveTerminalId, xterm.cols, xterm.rows)
        }
      }

      const dataDisposable = xterm.onData((data) => {
        const terminalId = activeTerminalRef.current
        if (terminalId == null) return
        void terminalWrite(terminalId, data)
      })

      const focusTerminal = () => {
        xterm.focus()
      }
      container.addEventListener("mousedown", focusTerminal)

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit()
        const terminalId = activeTerminalRef.current
        if (terminalId != null && xterm.cols > 0 && xterm.rows > 0) {
          void terminalResize(terminalId, xterm.cols, xterm.rows)
        }
      })
      resizeObserver.observe(container)

      cleanup = () => {
        container.removeEventListener("mousedown", focusTerminal)
        resizeObserver.disconnect()
        dataDisposable.dispose()
        xterm.dispose()
        xtermRef.current = null
        fitAddonRef.current = null
      }
    })()

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [initializing])

  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm) return
    xterm.reset()
    if (activeTerminalId != null) {
      const text = terminalBuffersRef.current.get(activeTerminalId) ?? ""
      if (text) xterm.write(text)
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
      }
      xterm.focus()
      if (xterm.cols > 0 && xterm.rows > 0) {
        void terminalResize(activeTerminalId, xterm.cols, xterm.rows)
      }
    }
  }, [activeTerminalId])

  useEffect(() => {
    if (bootstrappedRef.current) {
      return
    }
    bootstrappedRef.current = true

    let mounted = true
    const bootstrap = async () => {
      setInitializingStatus("Initializing Alicia runtime...")
      if (!isTauriRuntime()) {
        setRuntime((prev) => ({ ...prev, connected: false }))
        addMessage("system", "Alicia running in web mode. Launch with Tauri for full runtime.")
        setInitializing(false)
        return
      }

      setInitializingStatus("Connecting runtime bridge...")
      codexUnlistenRef.current = await listenToCodexEvents(handleCodexEvent)
      terminalUnlistenRef.current = await listenToTerminalEvents(handleTerminalEvent)

      try {
        const config = await loadCodexDefaultConfig()
        runtimeConfigRef.current = config
        const normalized = normalizeConfig(config)
        if (mounted) {
          setAliciaState((prev) => ({ ...prev, ...normalized }))
        }
      } catch {
        // best effort
      }

      const status = await codexRuntimeStatus()
      if (!mounted) return
      runtimeConfigRef.current = status.runtimeConfig
      setRuntime((prev) => ({
        ...prev,
        connected: true,
        state: status.sessionId != null ? "running" : "idle",
        sessionId: status.sessionId ?? null,
        pid: status.pid ?? null,
        workspace: status.workspace,
      }))

      let hasActiveSession = status.sessionId != null
      if (status.sessionId != null) {
        setActiveSessionEntry(status.sessionId, normalizeConfig(status.runtimeConfig).model)
      } else {
        setInitializingStatus("Starting Codex session...")
        hasActiveSession = await ensureBridgeSession(false)
      }

      if (hasActiveSession) {
        setInitializingStatus("Loading MCP servers...")
        try {
          const warmup = await codexWaitForMcpStartup()
          if (warmup.totalReady > 0) {
            addMessage(
              "system",
              `[mcp] startup complete: ${warmup.totalReady} server(s) ready in ${warmup.elapsedMs}ms`,
            )
          } else {
            addMessage("system", "[mcp] startup complete: no active MCP servers")
          }
        } catch (error) {
          addMessage("system", `[mcp] startup check failed: ${String(error)}`)
        }
      }

      setInitializingStatus("Syncing runtime metadata...")
      void codexHelpSnapshot()
      await refreshModelsCatalog(false)
      await refreshMcpServers()
      // Startup terminal must be idempotent: exactly one automatic tab.
      if (!autoTerminalCreatedRef.current && !wasAutoTerminalBootDone()) {
        const created = await createTerminalTab(status.workspace)
        if (created) {
          autoTerminalCreatedRef.current = true
          markAutoTerminalBootDone(true)
        }
      }
      if (!mounted) return
      setInitializing(false)
    }

    void bootstrap()
    return () => {
      mounted = false
      codexUnlistenRef.current?.()
      terminalUnlistenRef.current?.()
    }
  }, [])

  const handleSubmit = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text && pendingMentions.length === 0 && pendingImages.length === 0) return

      const preview = [text, pendingMentions.join(" "), pendingImages.join(" ")]
        .filter(Boolean)
        .join("\n")
      addMessage("user", preview)

      if (!(await ensureBridgeSession(false))) return

      const inputItems: CodexInputItem[] = []
      if (text) inputItems.push({ type: "text", text })
      pendingMentions.forEach((path) => inputItems.push({ type: "mention", path }))
      pendingImages.forEach((path) => inputItems.push({ type: "local_image", path }))
      if (inputItems.length === 0) inputItems.push({ type: "text", text: "" })

      setIsThinking(true)
      try {
        const result = await codexTurnRun({
          threadId: threadIdRef.current ?? undefined,
          inputItems,
        })
        if (result.threadId) threadIdRef.current = result.threadId
        setPendingImages([])
        setPendingMentions([])
      } catch (error) {
        setIsThinking(false)
        addMessage("system", `[turn] failed: ${String(error)}`)
      }
    },
    [addMessage, ensureBridgeSession, pendingImages, pendingMentions],
  )

  const handleSlashCommand = useCallback(
    async (command: string) => {
      if (command === "/model" || command === "/models") {
        await openModelPanel(true)
        return
      }
      if (command === "/permissions" || command === "/approvals") {
        setAliciaState((prev) => ({ ...prev, activePanel: "permissions" }))
        return
      }
      if (command === "/mcp") {
        setAliciaState((prev) => ({ ...prev, activePanel: "mcp" }))
        await refreshMcpServers()
        return
      }
      if (command === "/resume") {
        setSessionPickerMode("resume")
        setAliciaState((prev) => ({ ...prev, activePanel: "sessions" }))
        return
      }
      if (command === "/fork") {
        setSessionPickerMode("fork")
        setAliciaState((prev) => ({ ...prev, activePanel: "sessions" }))
        return
      }
      if (command === "/new") {
        threadIdRef.current = null
        await ensureBridgeSession(true)
        return
      }
      if (command === "/status") {
        if (!(await ensureBridgeSession(false))) {
          return
        }
        try {
          await sendCodexInput("/status")
        } catch (error) {
          addMessage("system", `[status] failed: ${String(error)}`)
        }
        return
      }
      if (command === "/quit" || command === "/exit") {
        await codexBridgeStop()
        setRuntime((prev) => ({ ...prev, state: "idle", sessionId: null, pid: null }))
        return
      }
      await handleSubmit(command)
    },
    [ensureBridgeSession, handleSubmit, openModelPanel, refreshMcpServers],
  )

  const handleModelSelect = useCallback(
    (modelId: string, effort: ReasoningEffort) => {
      const current = runtimeConfigRef.current
      if (!current) {
        addMessage("system", "[model] runtime config not loaded")
        return
      }

      const selectedModel = availableModels.find((model) => model.id === modelId)
      let nextEffort = effort
      if (selectedModel) {
        const supported = selectedModel.supportedReasoningEfforts.some(
          (option) => option.reasoningEffort === effort,
        )
        if (!supported) {
          const fallback =
            selectedModel.defaultReasoningEffort ||
            selectedModel.supportedReasoningEfforts[0]?.reasoningEffort ||
            "medium"
          nextEffort = fallback
          addMessage(
            "system",
            `[model] reasoning adjusted to ${fallback} for ${selectedModel.displayName}`,
          )
        }
      }

      const nextConfig: RuntimeCodexConfig = {
        ...current,
        model: modelId,
        reasoning: nextEffort,
      }
      runtimeConfigRef.current = nextConfig
      setAliciaState((prev) => ({
        ...prev,
        model: modelId,
        reasoningEffort: nextEffort,
        activePanel: null,
      }))
      void codexConfigSet(nextConfig).catch((error) => {
        addMessage("system", `[model] failed to persist: ${String(error)}`)
      })
    },
    [addMessage, availableModels],
  )

  const handlePermissionSelect = useCallback((preset: ApprovalPreset) => {
    const current = runtimeConfigRef.current
    if (!current) return
    const selected = APPROVAL_PRESETS[preset]
    const nextConfig: RuntimeCodexConfig = {
      ...current,
      approvalPreset: preset,
      approvalPolicy: preset === "full-access" ? "never" : "on-request",
      sandbox: selected.sandboxMode,
      profile:
        preset === "read-only" ? "read_only" : preset === "full-access" ? "full_access" : "read_write_with_approval",
    }
    runtimeConfigRef.current = nextConfig
    setAliciaState((prev) => ({
      ...prev,
      approvalPreset: preset,
      sandboxMode: selected.sandboxMode,
      activePanel: null,
    }))
    void codexConfigSet(nextConfig)
  }, [])

  const handleSessionSelect = useCallback(async (_sessionId: string, action: "resume" | "fork" | "switch") => {
    if (action === "fork") {
      await runCodexCommand(["fork", "--last"])
    } else {
      await runCodexCommand(["resume", "--last"])
    }
    setAliciaState((prev) => ({ ...prev, activePanel: null }))
  }, [])

  const currentModelLabel = useMemo(
    () => {
      const current = availableModels.find((model) => model.id === aliciaState.model)
      if (current) {
        return current.displayName
      }
      if (aliciaState.model === "default") {
        return availableModels.find((model) => model.isDefault)?.displayName || "Codex Default"
      }
      return aliciaState.model
    },
    [aliciaState.model, availableModels],
  )

  if (initializing) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-terminal-fg/80 text-sm">
          <Bot className="w-4 h-4 text-terminal-green spin-slow" />
          {initializingStatus}
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
      <TitleBar connected={runtime.connected} workspace={runtime.workspace} />
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        <ResizablePanel defaultSize={20} minSize={14} maxSize={28}>
          <Sidebar
            state={aliciaState}
            modelLabel={currentModelLabel}
            sessionPid={runtime.pid}
            runtimeState={runtime.state}
            onOpenPanel={(panel) => {
              if (panel === "model") {
                void openModelPanel(true)
                return
              }
              if (panel === "sessions") setSessionPickerMode("list")
              setAliciaState((prev) => ({ ...prev, activePanel: panel }))
            }}
            onStartSession={() => {
              threadIdRef.current = null
              void ensureBridgeSession(true)
            }}
            onStopSession={() => {
              void codexBridgeStop()
              setRuntime((prev) => ({ ...prev, state: "idle", sessionId: null, pid: null }))
            }}
            onResumeSession={() => {
              setSessionPickerMode("resume")
              setAliciaState((prev) => ({ ...prev, activePanel: "sessions" }))
            }}
            onForkSession={() => {
              setSessionPickerMode("fork")
              setAliciaState((prev) => ({ ...prev, activePanel: "sessions" }))
            }}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={80} minSize={60}>
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel defaultSize={62} minSize={40}>
              <div className="h-full flex flex-col min-h-0">
                <div className="px-4 py-2 border-b border-panel-border text-xs text-muted-foreground">
                  Structured conversation | model {currentModelLabel} [{aliciaState.reasoningEffort}]
                </div>
                <div ref={scrollRef} className="flex-1 overflow-y-auto">
                  {messages.map((message) => (
                    <TerminalMessage
                      key={message.id}
                      type={message.type}
                      content={message.content}
                      timestamp={message.timestamp}
                    />
                  ))}
                  {isThinking && <TerminalMessage type="agent" content="" thinking />}
                </div>
                <CommandInput
                  onSubmit={handleSubmit}
                  onSlashCommand={handleSlashCommand}
                  onAttachImage={async () => {
                    const picked = await pickImageFile()
                    if (picked) setPendingImages((prev) => [...prev, picked])
                  }}
                  onAttachMention={async () => {
                    const picked = await pickMentionFile()
                    if (picked) setPendingMentions((prev) => [...prev, picked])
                  }}
                  onRemoveImage={(index) => {
                    setPendingImages((prev) => prev.filter((_, i) => i !== index))
                  }}
                  onRemoveMention={(index) => {
                    setPendingMentions((prev) => prev.filter((_, i) => i !== index))
                  }}
                  pendingImages={pendingImages}
                  pendingMentions={pendingMentions}
                  disabled={runtime.state === "starting" || runtime.state === "stopping"}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={38} minSize={20}>
              <div className="h-full flex flex-col border-t border-panel-border bg-terminal-bg">
                <div className="h-9 border-b border-panel-border px-2 flex items-center gap-1 overflow-x-auto">
                  <div className="inline-flex items-center gap-1 text-[10px] text-muted-foreground px-2">
                    <TerminalSquare className="w-3.5 h-3.5 text-terminal-blue" />
                    Terminal
                  </div>
                  {terminalTabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTerminalId(tab.id)}
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                        tab.id === activeTerminalId
                          ? "border-terminal-blue/40 bg-terminal-blue/10 text-terminal-fg"
                          : "border-transparent text-muted-foreground hover:bg-panel-bg"
                      }`}
                    >
                      <span>{tab.title}</span>
                      {!tab.alive && <span className="text-terminal-red">exit</span>}
                      <span
                        className="ml-1 hover:text-terminal-red"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          void closeTerminalTab(tab.id)
                        }}
                      >
                        <X className="w-3 h-3" />
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      void createTerminalTab(runtime.workspace)
                    }}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-panel-border text-muted-foreground hover:bg-panel-bg"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New terminal
                  </button>
                </div>
                <div className="px-3 py-1 text-[10px] text-muted-foreground/70 border-b border-panel-border/70">
                  Click inside the terminal pane to run local shell commands.
                </div>
                <div className="flex-1 min-h-0 p-2">
                  <div
                    ref={terminalContainerRef}
                    className="h-full w-full rounded border border-panel-border bg-terminal-bg"
                  />
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
      <StatusBar
        state={aliciaState}
        modelLabel={currentModelLabel}
        runtime={{
          connected: runtime.connected,
          state: runtime.state,
          sessionId: runtime.sessionId,
        }}
        onOpenPanel={(panel) => {
          if (panel === "model") {
            void openModelPanel(true)
            return
          }
          if (panel === "sessions") setSessionPickerMode("list")
          setAliciaState((prev) => ({ ...prev, activePanel: panel }))
        }}
      />
      {aliciaState.activePanel === "model" && (
        <ModelPicker
          currentModel={aliciaState.model}
          currentEffort={aliciaState.reasoningEffort}
          models={availableModels}
          loading={modelsLoading}
          error={modelsError}
          cachedAt={modelsCachedAt}
          stale={modelsFromCache}
          onRetry={() => {
            void refreshModelsCatalog(true)
          }}
          onSelect={handleModelSelect}
          onClose={() => setAliciaState((prev) => ({ ...prev, activePanel: null }))}
        />
      )}
      {aliciaState.activePanel === "permissions" && (
        <PermissionsPanel
          currentPreset={aliciaState.approvalPreset}
          currentSandbox={aliciaState.sandboxMode}
          onSelect={handlePermissionSelect}
          onClose={() => setAliciaState((prev) => ({ ...prev, activePanel: null }))}
        />
      )}
      {aliciaState.activePanel === "mcp" && (
        <McpPanel
          servers={aliciaState.mcpServers}
          onClose={() => setAliciaState((prev) => ({ ...prev, activePanel: null }))}
        />
      )}
      {aliciaState.activePanel === "sessions" && (
        <SessionPicker
          sessions={aliciaState.sessions}
          mode={sessionPickerMode}
          onSelect={handleSessionSelect}
          onNewSession={() => {
            threadIdRef.current = null
            void ensureBridgeSession(true)
          }}
          onClose={() => setAliciaState((prev) => ({ ...prev, activePanel: null }))}
        />
      )}
    </div>
  )
}





