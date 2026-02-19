import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react"
import {
  APPROVAL_PRESETS,
  type AliciaState,
  type ApprovalPreset,
  type ReasoningEffort,
} from "@/lib/alicia-types"
import {
  isRuntimeCommandUnavailable,
  mapThreadTurnsToMessages,
  type ApprovalRequestState,
  type Message,
  type RuntimeState,
  type TurnDiffState,
  type TurnPlanState,
} from "@/lib/alicia-runtime-helpers"
import {
  codexBridgeStop,
  codexConfigSet,
  codexThreadFork,
  codexThreadOpen,
  codexThreadRead,
  codexTurnRun,
  runCodexCommand,
  sendCodexInput,
  type CodexInputItem,
  type CodexModel,
  type CodexThreadRecord,
  type RuntimeCodexConfig,
} from "@/lib/tauri-bridge"

interface UseAliciaActionsParams {
  addMessage: (type: Message["type"], content: string) => void
  ensureBridgeSession: (forceNew?: boolean) => Promise<boolean>
  pendingImages: string[]
  pendingMentions: string[]
  setPendingImages: Dispatch<SetStateAction<string[]>>
  setPendingMentions: Dispatch<SetStateAction<string[]>>
  setMessages: Dispatch<SetStateAction<Message[]>>
  setPendingApprovals: Dispatch<SetStateAction<ApprovalRequestState[]>>
  setTurnDiff: Dispatch<SetStateAction<TurnDiffState | null>>
  setTurnPlan: Dispatch<SetStateAction<TurnPlanState | null>>
  setIsThinking: Dispatch<SetStateAction<boolean>>
  threadIdRef: MutableRefObject<string | null>
  openModelPanel: (notifyOnError?: boolean) => Promise<void>
  openSessionPanel: (mode: "resume" | "fork" | "list") => void
  refreshMcpServers: () => Promise<void>
  refreshThreadList: (options?: {
    activeThreadId?: string | null
    notifyOnError?: boolean
  }) => Promise<CodexThreadRecord[]>
  setAliciaState: Dispatch<SetStateAction<AliciaState>>
  setRuntime: Dispatch<SetStateAction<RuntimeState>>
  runtimeConfigRef: MutableRefObject<RuntimeCodexConfig | null>
  availableModels: CodexModel[]
}

export function useAliciaActions({
  addMessage,
  ensureBridgeSession,
  pendingImages,
  pendingMentions,
  setPendingImages,
  setPendingMentions,
  setMessages,
  setPendingApprovals,
  setTurnDiff,
  setTurnPlan,
  setIsThinking,
  threadIdRef,
  openModelPanel,
  openSessionPanel,
  refreshMcpServers,
  refreshThreadList,
  setAliciaState,
  setRuntime,
  runtimeConfigRef,
  availableModels,
}: UseAliciaActionsParams) {
  const [sessionActionPending, setSessionActionPending] = useState<{
    sessionId: string
    action: "resume" | "fork" | "switch"
  } | null>(null)
  const handleSubmit = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text && pendingMentions.length === 0 && pendingImages.length === 0) {
        return
      }

      const preview = [text, pendingMentions.join(" "), pendingImages.join(" ")]
        .filter(Boolean)
        .join("\n")
      addMessage("user", preview)

      if (!(await ensureBridgeSession(false))) {
        return
      }

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
        if (result.threadId) {
          threadIdRef.current = result.threadId
        }
        setPendingImages([])
        setPendingMentions([])
      } catch (error) {
        setIsThinking(false)
        addMessage("system", `[turn] failed: ${String(error)}`)
      }
    },
    [
      addMessage,
      ensureBridgeSession,
      pendingImages,
      pendingMentions,
      setPendingImages,
      setPendingMentions,
      setIsThinking,
      threadIdRef,
    ],
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
        openSessionPanel("resume")
        return
      }
      if (command === "/fork") {
        openSessionPanel("fork")
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
        setRuntime((prev) => ({
          ...prev,
          state: "idle",
          sessionId: null,
          pid: null,
        }))
        return
      }
      await handleSubmit(command)
    },
    [
      addMessage,
      ensureBridgeSession,
      handleSubmit,
      openModelPanel,
      openSessionPanel,
      refreshMcpServers,
      setAliciaState,
      setRuntime,
      threadIdRef,
    ],
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
    [addMessage, availableModels, runtimeConfigRef, setAliciaState],
  )

  const handlePermissionSelect = useCallback(
    (preset: ApprovalPreset) => {
      const current = runtimeConfigRef.current
      if (!current) return
      const selected = APPROVAL_PRESETS[preset]
      const nextConfig: RuntimeCodexConfig = {
        ...current,
        approvalPreset: preset,
        approvalPolicy: preset === "full-access" ? "never" : "on-request",
        sandbox: selected.sandboxMode,
        profile:
          preset === "read-only"
            ? "read_only"
            : preset === "full-access"
              ? "full_access"
              : "read_write_with_approval",
      }
      runtimeConfigRef.current = nextConfig
      setAliciaState((prev) => ({
        ...prev,
        approvalPreset: preset,
        sandboxMode: selected.sandboxMode,
        activePanel: null,
      }))
      void codexConfigSet(nextConfig)
    },
    [runtimeConfigRef, setAliciaState],
  )

  const handleSessionSelect = useCallback(
    async (sessionId: string, action: "resume" | "fork" | "switch") => {
      const selectedThreadId = sessionId.trim()
      if (!selectedThreadId || sessionActionPending) {
        return
      }

      setSessionActionPending({ sessionId: selectedThreadId, action })
      let historyMessages: Message[] = []
      let historyError: string | null = null

      try {
        if (!(await ensureBridgeSession(false))) {
          return
        }

        if (action === "fork") {
          let nextThreadId: string | null = null

          try {
            const forked = await codexThreadFork({
              threadId: selectedThreadId,
              persistExtendedHistory: false,
            })
            nextThreadId =
              (typeof forked.thread?.id === "string" && forked.thread.id.trim()) ||
              (typeof forked.threadId === "string" && forked.threadId.trim()) ||
              null
          } catch (error) {
            if (!isRuntimeCommandUnavailable(error)) {
              throw error
            }

            await runCodexCommand(["fork", selectedThreadId])
            const refreshed = await refreshThreadList({ notifyOnError: false })
            nextThreadId = refreshed[0]?.id ?? null
          }

          if (nextThreadId) {
            const opened = await codexThreadOpen(nextThreadId)
            threadIdRef.current = opened.threadId || nextThreadId
          } else {
            threadIdRef.current = null
          }
        } else {
          const opened = await codexThreadOpen(selectedThreadId)
          threadIdRef.current = opened.threadId || selectedThreadId
        }

        const threadToRead = threadIdRef.current ?? selectedThreadId
        if (threadToRead) {
          try {
            const history = await codexThreadRead({
              threadId: threadToRead,
              includeTurns: true,
            })
            const turns = Array.isArray(history.thread.turns)
              ? history.thread.turns
              : []
            historyMessages = mapThreadTurnsToMessages(turns)
          } catch (error) {
            const message = String(error ?? "")
            const includeTurnsUnavailable = message.includes(
              "includeTurns is unavailable before first user message",
            )
            if (
              !includeTurnsUnavailable &&
              !isRuntimeCommandUnavailable(error)
            ) {
              historyError = `[session] history sync failed: ${message}`
            }
          }
        }

        setMessages(historyMessages)
        setIsThinking(false)
        setPendingApprovals([])
        setTurnDiff(null)
        setTurnPlan(null)
        setAliciaState((prev) => ({ ...prev, activePanel: null }))
        void refreshThreadList({
          activeThreadId: threadIdRef.current,
          notifyOnError: false,
        })

        if (historyError) {
          addMessage("system", historyError)
        }
      } catch (error) {
        addMessage("system", `[session] ${action} failed: ${String(error)}`)
      } finally {
        setSessionActionPending(null)
      }
    },
    [
      addMessage,
      ensureBridgeSession,
      refreshThreadList,
      sessionActionPending,
      setAliciaState,
      setIsThinking,
      setMessages,
      setPendingApprovals,
      setTurnDiff,
      setTurnPlan,
      threadIdRef,
    ],
  )

  return {
    handleSubmit,
    handleSlashCommand,
    handleModelSelect,
    handlePermissionSelect,
    handleSessionSelect,
    sessionActionPending,
  }
}

