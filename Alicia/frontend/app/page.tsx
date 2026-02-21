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
import { ReviewMode } from "@/components/alicia/review-mode"
import { TerminalPane } from "@/components/alicia/terminal-pane"
import { type AliciaState } from "@/lib/alicia-types"
import {
  codexApprovalRespond,
  codexBridgeStop,
  codexUserInputRespond,
  isTauriRuntime,
  pickImageFile,
  pickMentionFile,
  gitCommitApprovedReview,
  codexWorkspaceChanges,
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
  type DiffFileView,
  type Message,
  type MessageChannel,
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
  const [reviewMessages, setReviewMessages] = useState<Message[]>([])
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
  const reviewMessagesBySessionRef = useRef<Map<string, Message[]>>(new Map())
  const activeReviewSessionKeyRef = useRef<string | null>(null)
  const terminalBuffersRef = useRef<Map<number, string>>(new Map())
  const activeTerminalRef = useRef<number | null>(null)
  const xtermRef = useRef<import("xterm").Terminal | null>(null)
  const fitAddonRef = useRef<import("xterm-addon-fit").FitAddon | null>(null)
  const seenEventSeqRef = useRef<Set<number>>(new Set())
  const streamedAgentTextRef = useRef<Map<string, string>>(new Map())
  const bootstrappedRef = useRef(false)
  const autoTerminalCreatedRef = useRef(false)
  const reviewRoutingRef = useRef(false)
  const turnDiffFilesRef = useRef<DiffFileView[]>([])

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
    (
      type: Message["type"],
      content: string,
      channel: MessageChannel = "chat",
    ) => {
      if (!content.trim()) {
        return
      }

      const timestamp = timestampNow()
      const setTargetMessages = channel === "review" ? setReviewMessages : setMessages

      setTargetMessages((prev) => {
        if (type !== "system" || prev.length === 0) {
          return [
            ...prev,
            {
              id: nextMessageId(),
              channel,
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
              channel,
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
              channel,
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
  const activeSessionId = useMemo(
    () => aliciaState.sessions.find((session) => session.active)?.id ?? null,
    [aliciaState.sessions],
  )
  const activeReviewSessionKey = activeSessionId ?? threadIdRef.current ?? "__sessionless__"

  useEffect(() => {
    if (activeReviewSessionKeyRef.current === null) {
      activeReviewSessionKeyRef.current = activeReviewSessionKey
      const initialMessages =
        reviewMessagesBySessionRef.current.get(activeReviewSessionKey) ?? []
      setReviewMessages(initialMessages)
      return
    }

    if (activeReviewSessionKeyRef.current === activeReviewSessionKey) {
      return
    }

    const previousKey = activeReviewSessionKeyRef.current
    if (previousKey) {
      reviewMessagesBySessionRef.current.set(previousKey, reviewMessages)
    }

    activeReviewSessionKeyRef.current = activeReviewSessionKey
    const nextMessages =
      reviewMessagesBySessionRef.current.get(activeReviewSessionKey) ?? []
    setReviewMessages(nextMessages)
  }, [activeReviewSessionKey, reviewMessages])

  useEffect(() => {
    reviewMessagesBySessionRef.current.set(activeReviewSessionKey, reviewMessages)
  }, [activeReviewSessionKey, reviewMessages])

  const refreshWorkspaceChanges = useCallback(async () => {
    const normalizeStatus = (value: unknown): AliciaState["fileChanges"][number]["status"] => {
      const status = String(value ?? "").trim().toLowerCase()
      if (status === "added" || status === "a" || status === "new") return "added"
      if (status === "deleted" || status === "d" || status === "removed" || status === "missing") {
        return "deleted"
      }
      if (status === "renamed" || status === "r") return "renamed"
      if (status === "copied" || status === "c") return "copied"
      if (status === "untracked" || status === "??") return "untracked"
      if (status === "unmerged" || status === "u" || status === "uu") return "unmerged"
      return "modified"
    }

    try {
      const response = await codexWorkspaceChanges()
      const filesSource = Array.isArray((response as { files?: unknown[] }).files)
        ? (response as { files: unknown[] }).files
        : []

      const fileChanges = filesSource
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null
          }

          const record = entry as Record<string, unknown>
          const name =
            (typeof record.path === "string" && record.path.trim()) ||
            (typeof record.name === "string" && record.name.trim()) ||
            ""

          if (!name) {
            return null
          }

          const fromPath =
            typeof record.fromPath === "string" && record.fromPath.trim()
              ? record.fromPath.trim()
              : undefined

          if (fromPath) {
            return {
              name,
              status: normalizeStatus(record.status),
              fromPath,
            }
          }

          return {
            name,
            status: normalizeStatus(record.status),
          }
        })
        .filter(
          (entry): entry is AliciaState["fileChanges"][number] => entry !== null,
        )

      setAliciaState((previous) => ({
        ...previous,
        fileChanges,
      }))
      return
    } catch {
      const fallback = mapDiffFilesToFileChanges(turnDiffFilesRef.current)
      setAliciaState((previous) => ({
        ...previous,
        fileChanges: fallback,
      }))
    }
  }, [])

  useEffect(() => {
    turnDiffFilesRef.current = turnDiffFiles
    void refreshWorkspaceChanges()
  }, [turnDiffFiles, refreshWorkspaceChanges])

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
        reviewRoutingRef,
        onRefreshWorkspaceChanges: () => {
          void refreshWorkspaceChanges()
        },
      }),
    [addMessage, refreshWorkspaceChanges],
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
    reviewRoutingRef,
    refreshWorkspaceChanges,
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
  const handleCommitApprovedReview = useCallback(
    async (payload: {
      approvedPaths: string[]
      message: string
      comments: Record<string, string>
    }) => {
      const approvedPaths = payload.approvedPaths
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)

      if (approvedPaths.length === 0) {
        addMessage("system", "[review] no approved files selected for commit", "review")
        return
      }

      const changeByPath = new Map(
        aliciaState.fileChanges.map((entry) => [entry.name, entry]),
      )
      const workspaceConflicts = aliciaState.fileChanges
        .filter((entry) => entry.status === "unmerged")
        .map((entry) => entry.name)
      if (workspaceConflicts.length > 0) {
        addMessage(
          "system",
          `[review] resolve conflicts before commit: ${workspaceConflicts.join(", ")}`,
          "review",
        )
        return
      }

      const expandedPaths = Array.from(
        new Set(
          approvedPaths.flatMap((path) => {
            const change = changeByPath.get(path)
            if (
              change &&
              (change.status === "renamed" || change.status === "copied") &&
              typeof change.fromPath === "string" &&
              change.fromPath.trim().length > 0
            ) {
              return [path, change.fromPath.trim()]
            }
            return [path]
          }),
        ),
      )

      const commitMessage = payload.message.trim()
      if (!commitMessage) {
        addMessage("system", "[review] commit message is required", "review")
        return
      }

      const reviewNotes = approvedPaths
        .map((path) => {
          const note = payload.comments[path]?.trim()
          return note ? `${path}: ${note}` : null
        })
        .filter((entry): entry is string => Boolean(entry))
      const activeSessionCwd =
        aliciaState.sessions.find((session) => session.active)?.cwd?.trim() || null

      try {
        const response = await gitCommitApprovedReview({
          paths: expandedPaths,
          message: commitMessage,
          cwd: activeSessionCwd ?? undefined,
        })

        if (!response.success) {
          const addError = response.add.stderr.trim()
          const commitError = response.commit.stderr.trim()
          const failure = addError || commitError || "git add/commit failed"
          throw new Error(failure)
        }

        addMessage(
          "system",
          `[review] committed ${approvedPaths.length} approved file(s): ${approvedPaths.join(", ")}`,
          "review",
        )
        if (reviewNotes.length > 0) {
          addMessage("system", `[review] notes\n${reviewNotes.join("\n")}`, "review")
        }
      } catch (error) {
        addMessage("system", `[review] commit failed: ${String(error)}`, "review")
      } finally {
        await refreshWorkspaceChanges()
      }
    },
    [addMessage, aliciaState.fileChanges, aliciaState.sessions, refreshWorkspaceChanges],
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
              reviewRoutingRef.current = false
              setMessages([])
              setPendingApprovals([])
              setPendingUserInput(null)
              setTurnDiff(null)
              setTurnPlan(null)
              void ensureBridgeSession(true)
              void refreshWorkspaceChanges()
            }}
            onStopSession={() => {
              void codexBridgeStop()
              reviewRoutingRef.current = false
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
            onStartReview={() => {
              setAliciaState((prev) => ({ ...prev, activePanel: "review" }))
              void refreshWorkspaceChanges()
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
      {aliciaState.activePanel === "review" && (
        <ReviewMode
          fileChanges={aliciaState.fileChanges}
          turnDiffFiles={turnDiffFiles}
          pendingApprovals={pendingApprovals}
          reviewMessages={reviewMessages}
          isReviewThinking={isThinking && reviewRoutingRef.current}
          onRunReview={() => {
            void refreshWorkspaceChanges()
            void handleSlashCommand("/review")
          }}
          onCommitApproved={handleCommitApprovedReview}
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
            reviewRoutingRef.current = false
            setMessages([])
            setPendingApprovals([])
            setPendingUserInput(null)
            setTurnDiff(null)
            setTurnPlan(null)
            void ensureBridgeSession(true)
            void refreshWorkspaceChanges()
          }}
          onClose={() => setAliciaState((prev) => ({ ...prev, activePanel: null }))}
        />
      )}
    </div>
  )
}




