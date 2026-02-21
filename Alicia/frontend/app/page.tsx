"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot } from "lucide-react"
import { TitleBar } from "@/components/alicia/title-bar"
import { Sidebar } from "@/components/alicia/sidebar"
import { ConversationPane } from "@/components/alicia/conversation-pane"
import { StatusBar } from "@/components/alicia/status-bar"
import { ModelPicker } from "@/components/alicia/model-picker"
import { PermissionsPanel } from "@/components/alicia/permissions-panel"
import { McpPanel } from "@/components/alicia/mcp-panel"
import { AppsPanel } from "@/components/alicia/apps-panel"
import { SessionPicker } from "@/components/alicia/session-picker"
import { TerminalPane } from "@/components/alicia/terminal-pane"
import { type AliciaState } from "@/lib/alicia-types"
import {
  codexApprovalRespond,
  codexBridgeStop,
  codexUserInputRespond,
  isTauriRuntime,
  pickImageFile,
  pickMentionFile,
  terminalResize,
  terminalWrite,
  type ApprovalDecision,
  type CodexModel,
  type RuntimeCodexConfig,
} from "@/lib/tauri-bridge"
import {
  INITIAL_ALICIA_STATE,
  mapDiffFilesToFileChanges,
  parseUnifiedDiffFiles,
  type ApprovalRequestState,
  type Message,
  readModelsCache,
  type RuntimeState,
  type TerminalTab,
  timestampNow,
  type TurnDiffState,
  type TurnPlanState,
  type UserInputRequestState,
} from "@/lib/alicia-runtime-helpers"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  createCodexEventHandler,
  createTerminalEventHandler,
} from "@/lib/alicia-event-handlers"
import { useAliciaTerminalRuntime } from "@/hooks/use-alicia-terminal-runtime"
import { useAliciaActions } from "@/hooks/use-alicia-actions"
import { useAliciaBootstrap } from "@/hooks/use-alicia-bootstrap"
import { useAliciaRuntimeCore } from "@/hooks/use-alicia-runtime-core"
import {
  parseReasoningSystemMessage,
  parseUsageSystemMessage,
  type UsageStats,
} from "@/lib/runtime-statusline"
import {
  encodeAgentSpawnerPayload,
  mergeAgentSpawnerPayloads,
  parseAgentSpawnerPayload,
} from "@/lib/agent-spawner-events"

export default function AliciaTerminal() {
  const [initializing, setInitializing] = useState(true)
  const [initializingStatus, setInitializingStatus] = useState(
    "Initializing Alicia runtime...",
  )
  const [bootLogs, setBootLogs] = useState<string[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequestState[]>([])
  const [pendingUserInput, setPendingUserInput] = useState<UserInputRequestState | null>(null)
  const [turnDiff, setTurnDiff] = useState<TurnDiffState | null>(null)
  const [turnPlan, setTurnPlan] = useState<TurnPlanState | null>(null)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [pendingMentions, setPendingMentions] = useState<string[]>([])
  const [sessionPickerMode, setSessionPickerMode] = useState<
    "resume" | "fork" | "list"
  >("list")
  const [sessionsPanelLoading, setSessionsPanelLoading] = useState(false)
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
  const shouldAutoScrollRef = useRef(true)
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

      const timestamp = timestampNow()
      setMessages((prev) => {
        if (type !== "system" || prev.length === 0) {
          return [
            ...prev,
            {
              id: nextMessageId(),
              type,
              content,
              timestamp,
            },
          ]
        }

        const incomingSpawner = parseAgentSpawnerPayload(content)
        const last = prev[prev.length - 1]
        if (!incomingSpawner || last.type !== "system") {
          return [
            ...prev,
            {
              id: nextMessageId(),
              type,
              content,
              timestamp,
            },
          ]
        }

        const previousSpawner = parseAgentSpawnerPayload(last.content)
        if (!previousSpawner) {
          return [
            ...prev,
            {
              id: nextMessageId(),
              type,
              content,
              timestamp,
            },
          ]
        }

        const mergedPayload = mergeAgentSpawnerPayloads(
          previousSpawner,
          incomingSpawner,
        )
        const mergedContent = encodeAgentSpawnerPayload(mergedPayload)

        return [
          ...prev.slice(0, -1),
          {
            ...last,
            content: mergedContent,
            timestamp,
          },
        ]
      })
    },
    [nextMessageId],
  )

  const turnDiffFiles = useMemo(
    () => parseUnifiedDiffFiles(turnDiff?.diff ?? ""),
    [turnDiff],
  )

  useEffect(() => {
    setAliciaState((previous) => ({
      ...previous,
      fileChanges: mapDiffFilesToFileChanges(turnDiffFiles),
    }))
  }, [turnDiffFiles])

  const statusSignals = useMemo(() => {
    let usage: UsageStats | null = null
    let reasoning: string | null = null

    for (const message of messages) {
      if (message.type !== "system") {
        continue
      }

      const parsedUsage = parseUsageSystemMessage(message.content)
      if (parsedUsage) {
        usage = parsedUsage
        continue
      }

      const parsedReasoning = parseReasoningSystemMessage(message.content)
      if (parsedReasoning) {
        reasoning = parsedReasoning
      }
    }

    return { usage, reasoning }
  }, [messages])
  const isNearBottom = useCallback((container: HTMLDivElement) => {
    const thresholdPx = 96
    const remaining =
      container.scrollHeight - container.scrollTop - container.clientHeight
    return remaining <= thresholdPx
  }, [])

  const scrollConversationToBottom = useCallback((force = false) => {
    const container = scrollRef.current
    if (!container) {
      return
    }

    if (!force && !shouldAutoScrollRef.current) {
      return
    }

    container.scrollTop = container.scrollHeight
    shouldAutoScrollRef.current = true
  }, [])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) {
      return
    }

    const syncAutoScroll = () => {
      shouldAutoScrollRef.current = isNearBottom(container)
    }

    scrollConversationToBottom(true)
    syncAutoScroll()
    container.addEventListener("scroll", syncAutoScroll, { passive: true })

    return () => {
      container.removeEventListener("scroll", syncAutoScroll)
    }
  }, [initializing, isNearBottom, scrollConversationToBottom])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      scrollConversationToBottom()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [
    messages,
    isThinking,
    pendingApprovals.length,
    turnDiff?.turnId,
    turnPlan?.turnId,
    scrollConversationToBottom,
  ])

  const appendBootLog = useCallback((message: string) => {
    const now = new Date()
    const stamp = `${String(now.getHours()).padStart(2, "0")}:${String(now
      .getMinutes())
      .padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
    setBootLogs((prev) => [...prev.slice(-19), `${stamp} ${message}`])
  }, [])

  const {
    setActiveSessionEntry,
    refreshThreadList,
    refreshMcpServers,
    refreshAppsAndAuth,
    refreshModelsCatalog,
    openModelPanel,
    ensureBridgeSession,
    createTerminalTab,
    closeTerminalTab,
    currentModelLabel,
  } = useAliciaRuntimeCore({
    addMessage,
    runtime,
    setRuntime,
    aliciaState,
    setAliciaState,
    availableModels,
    setAvailableModels,
    modelsLoading,
    setModelsLoading,
    setModelsError,
    setModelsCachedAt,
    setModelsFromCache,
    threadIdRef,
    seenEventSeqRef,
    streamedAgentTextRef,
    terminalBuffersRef,
    xtermRef,
    setTerminalTabs,
    setActiveTerminalId,
  })

  const openSessionPanel = useCallback(
    (mode: "resume" | "fork" | "list") => {
      setSessionPickerMode(mode)
      setAliciaState((prev) => ({ ...prev, activePanel: "sessions" }))
      setSessionsPanelLoading(true)
      void refreshThreadList({
        activeThreadId: threadIdRef.current,
        notifyOnError: false,
      }).finally(() => {
        setSessionsPanelLoading(false)
      })
    },
    [refreshThreadList],
  )

  const handleCodexEvent = useMemo(
    () =>
      createCodexEventHandler({
        addMessage,
        setRuntime,
        setIsThinking,
        setPendingApprovals,
        setPendingUserInput,
        setTurnDiff,
        setTurnPlan,
        seenEventSeqRef,
        streamedAgentTextRef,
        threadIdRef,
      }),
    [addMessage],
  )

  const handleTerminalEvent = useMemo(
    () =>
      createTerminalEventHandler({
        setTerminalTabs,
        terminalBuffersRef,
        activeTerminalRef,
        xtermRef,
      }),
    [],
  )

  useAliciaBootstrap({
    bootstrappedRef,
    autoTerminalCreatedRef,
    codexUnlistenRef,
    terminalUnlistenRef,
    runtimeConfigRef,
    handleCodexEvent,
    handleTerminalEvent,
    addMessage,
    setRuntime,
    setAliciaState,
    setInitializingStatus,
    setInitializing,
    setActiveSessionEntry,
    ensureBridgeSession,
    refreshModelsCatalog,
    refreshThreadList,
    refreshMcpServers,
    refreshAppsAndAuth,
    createTerminalTab,
    onBootLog: appendBootLog,
  })

  const {
    handleSubmit,
    handleSlashCommand,
    handleModelSelect,
    handlePermissionSelect,
    handleSessionSelect,
    sessionActionPending,
  } = useAliciaActions({
    addMessage,
    aliciaState,
    ensureBridgeSession,
    pendingImages,
    pendingMentions,
    setPendingImages,
    setPendingMentions,
    setMessages,
    setPendingApprovals,
    setPendingUserInput,
    setTurnDiff,
    setTurnPlan,
    turnDiff,
    setIsThinking,
    threadIdRef,
    openModelPanel,
    openSessionPanel,
    refreshMcpServers,
    refreshAppsAndAuth,
    refreshThreadList,
    setAliciaState,
    setRuntime,
    runtimeConfigRef,
    availableModels,
  })

  const handleTerminalResize = useCallback(
    async (terminalId: number, cols: number, rows: number) => {
      try {
        await terminalResize(terminalId, cols, rows)
      } catch {
        // best effort
      }
    },
    [],
  )

  const handleTerminalWrite = useCallback(
    async (terminalId: number, data: string) => {
      try {
        await terminalWrite(terminalId, data)
      } catch {
        // best effort
      }
    },
    [],
  )

  useAliciaTerminalRuntime({
    initializing,
    activeTerminalId,
    activeTerminalRef,
    terminalContainerRef,
    terminalBuffersRef,
    xtermRef,
    fitAddonRef,
    onTerminalResize: handleTerminalResize,
    onTerminalWrite: handleTerminalWrite,
  })

  const handleApprovalDecision = useCallback(
    async (actionId: string, decision: ApprovalDecision) => {
      try {
        await codexApprovalRespond({ actionId, decision })
      } catch (error) {
        addMessage("system", `[approval] failed: ${String(error)}`)
      }
    },
    [addMessage],
  )

  const handleUserInputDecision = useCallback(
    async (response: {
      actionId: string
      decision: "submit" | "cancel"
      answers?: Record<string, { answers: string[] }>
    }) => {
      try {
        await codexUserInputRespond({
          actionId: response.actionId,
          decision: response.decision,
          answers: response.answers,
        })
        setPendingUserInput((previous) => {
          if (!previous || previous.actionId === response.actionId) {
            return null
          }
          return previous
        })
      } catch (error) {
        addMessage("system", `[user input] failed: ${String(error)}`)
      }
    },
    [addMessage],
  )

  if (initializing) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-3xl border border-panel-border bg-panel-bg rounded-md shadow-md">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-panel-border text-terminal-fg/90 text-sm">
            <Bot className="w-4 h-4 text-terminal-green spin-slow" />
            {initializingStatus}
          </div>
          <div className="p-4 font-mono text-xs text-terminal-fg/75 max-h-64 overflow-y-auto">
            {bootLogs.length === 0 ? (
              <div className="text-terminal-fg/45">
                Aguardando logs de inicializacao...
              </div>
            ) : (
              bootLogs.map((line, index) => (
                <div key={`boot-log-${index}`} className="leading-relaxed">
                  {line}
                </div>
              ))
            )}
          </div>
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
              if (panel === "sessions") {
                void openSessionPanel("list")
                return
              }
              if (panel === "apps") {
                setAliciaState((prev) => ({ ...prev, activePanel: "apps" }))
                void refreshAppsAndAuth({ throwOnError: false })
                return
              }
              setAliciaState((prev) => ({ ...prev, activePanel: panel }))
            }}
            onStartSession={() => {
              threadIdRef.current = null
              setPendingApprovals([])
              setPendingUserInput(null)
              setTurnDiff(null)
              setTurnPlan(null)
              void ensureBridgeSession(true)
            }}
            onStopSession={() => {
              void codexBridgeStop()
              setPendingApprovals([])
              setPendingUserInput(null)
              setTurnDiff(null)
              setTurnPlan(null)
              setRuntime((prev) => ({
                ...prev,
                state: "idle",
                sessionId: null,
                pid: null,
              }))
            }}
            onResumeSession={() => {
              void openSessionPanel("resume")
            }}
            onForkSession={() => {
              void openSessionPanel("fork")
            }}
            onSelectSession={(sessionId) => {
              void handleSessionSelect(sessionId, "switch")
            }}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={80} minSize={60}>
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel defaultSize={62} minSize={40}>
              <ConversationPane
                currentModelLabel={currentModelLabel}
                reasoningEffort={aliciaState.reasoningEffort}
                messages={messages}
                isThinking={isThinking}
                pendingImages={pendingImages}
                pendingMentions={pendingMentions}
                runtimeCapabilities={aliciaState.runtimeCapabilities}
                pendingApprovals={pendingApprovals}
                pendingUserInput={pendingUserInput}
                turnDiff={turnDiff}
                turnDiffFiles={turnDiffFiles}
                turnPlan={turnPlan}
                runtimeState={runtime.state}
                scrollRef={scrollRef}
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
                onApprovalDecision={handleApprovalDecision}
                onUserInputDecision={handleUserInputDecision}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={38} minSize={20}>
              <TerminalPane
                tabs={terminalTabs}
                activeTerminalId={activeTerminalId}
                terminalContainerRef={terminalContainerRef}
                onSelectTab={setActiveTerminalId}
                onCloseTab={(id) => {
                  void closeTerminalTab(id)
                }}
                onCreateTab={() => {
                  void createTerminalTab(runtime.workspace)
                }}
              />
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
        usage={statusSignals.usage}
        reasoning={statusSignals.reasoning}
        isThinking={isThinking}
        onOpenPanel={(panel) => {
          if (panel === "model") {
            void openModelPanel(true)
            return
          }
          if (panel === "sessions") {
            void openSessionPanel("list")
            return
          }
          if (panel === "apps") {
            setAliciaState((prev) => ({ ...prev, activePanel: "apps" }))
            void refreshAppsAndAuth({ throwOnError: false })
            return
          }
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
          onRefresh={refreshMcpServers}
          onClose={() => setAliciaState((prev) => ({ ...prev, activePanel: null }))}
        />
      )}
      {aliciaState.activePanel === "apps" && (
        <AppsPanel
          apps={aliciaState.apps}
          account={aliciaState.account}
          rateLimits={aliciaState.rateLimits}
          rateLimitsByLimitId={aliciaState.rateLimitsByLimitId}
          onRefresh={refreshAppsAndAuth}
          onClose={() => setAliciaState((prev) => ({ ...prev, activePanel: null }))}
        />
      )}
      {aliciaState.activePanel === "sessions" && (
        <SessionPicker
          sessions={aliciaState.sessions}
          mode={sessionPickerMode}
          loading={sessionsPanelLoading}
          busyAction={sessionActionPending}
          onSelect={handleSessionSelect}
          onNewSession={() => {
            threadIdRef.current = null
            setPendingApprovals([])
            setPendingUserInput(null)
            setTurnDiff(null)
            setTurnPlan(null)
            void ensureBridgeSession(true)
          }}
          onClose={() => setAliciaState((prev) => ({ ...prev, activePanel: null }))}
        />
      )}
    </div>
  )
}


