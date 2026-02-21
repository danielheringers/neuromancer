import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react"
import {
  APPROVAL_PRESETS,
  getSlashCommandDefinition,
  resolveSlashCommandSupport,
  type AliciaState,
  type ApprovalPreset,
  type ReasoningEffort,
} from "@/lib/alicia-types"
import {
  isRuntimeCommandUnavailable,
  isRuntimeMethodSupported,
  encodeDiffSystemMessage,
  mapThreadTurnsToMessages,
  markRuntimeMethodUnsupported,
  type ApprovalRequestState,
  type MessageChannel,
  type Message,
  type RuntimeState,
  type TurnDiffState,
  type TurnPlanState,
  type UserInputRequestState,
} from "@/lib/alicia-runtime-helpers"
import {
  codexAccountLogout,
  codexBridgeStop,
  codexConfigGet,
  codexConfigSet,
  codexReviewStart,
  codexThreadArchive,
  codexThreadCompactStart,
  codexThreadFork,
  codexThreadOpen,
  codexThreadRead,
  codexThreadRollback,
  codexThreadUnarchive,
  codexTurnRun,
  runCodexCommand,
  sendCodexInput,
  type CodexInputItem,
  type CodexModel,
  type CodexThreadRecord,
  type ReviewDelivery,
  type ReviewTarget,
  type RuntimeCodexConfig,
  type RuntimeMethod,
} from "@/lib/tauri-bridge"

interface UseAliciaActionsParams {
  addMessage: (
    type: Message["type"],
    content: string,
    channel?: MessageChannel,
  ) => void
  aliciaState: AliciaState
  ensureBridgeSession: (forceNew?: boolean) => Promise<boolean>
  pendingImages: string[]
  pendingMentions: string[]
  setPendingImages: Dispatch<SetStateAction<string[]>>
  setPendingMentions: Dispatch<SetStateAction<string[]>>
  setMessages: Dispatch<SetStateAction<Message[]>>
  setPendingApprovals: Dispatch<SetStateAction<ApprovalRequestState[]>>
  setPendingUserInput: Dispatch<SetStateAction<UserInputRequestState | null>>
  setTurnDiff: Dispatch<SetStateAction<TurnDiffState | null>>
  setTurnPlan: Dispatch<SetStateAction<TurnPlanState | null>>
  turnDiff: TurnDiffState | null
  setIsThinking: Dispatch<SetStateAction<boolean>>
  threadIdRef: MutableRefObject<string | null>
  openModelPanel: (notifyOnError?: boolean) => Promise<void>
  openSessionPanel: (mode: "resume" | "fork" | "list") => void
  refreshMcpServers: (options?: { throwOnError?: boolean }) => Promise<unknown>
  refreshAppsAndAuth: (options?: {
    throwOnError?: boolean
    forceRefetch?: boolean
    refreshToken?: boolean
  }) => Promise<unknown>
  refreshThreadList: (options?: {
    activeThreadId?: string | null
    notifyOnError?: boolean
  }) => Promise<CodexThreadRecord[]>
  setAliciaState: Dispatch<SetStateAction<AliciaState>>
  setRuntime: Dispatch<SetStateAction<RuntimeState>>
  runtimeConfigRef: MutableRefObject<RuntimeCodexConfig | null>
  availableModels: CodexModel[]
  reviewRoutingRef: MutableRefObject<boolean>
  refreshWorkspaceChanges: () => Promise<void>
}

interface ParsedSlashCommand {
  name: string
  args: string
}

function parseSlashCommandInput(input: string): ParsedSlashCommand {
  const trimmed = input.trim()
  const [name = "", ...rest] = trimmed.split(/\s+/)
  return {
    name: name.toLowerCase(),
    args: rest.join(" ").trim(),
  }
}

interface ParsedReviewSlash {
  target: ReviewTarget
  delivery?: ReviewDelivery | null
}

function parseReviewSlashArgs(argsRaw: string): ParsedReviewSlash {
  const tokens = argsRaw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  let delivery: ReviewDelivery | null | undefined
  const normalizedTokens: string[] = []

  for (const token of tokens) {
    const lowered = token.toLowerCase()
    if (lowered === "--detached") {
      delivery = "detached"
      continue
    }
    if (lowered === "--inline") {
      delivery = "inline"
      continue
    }
    normalizedTokens.push(token)
  }

  const args = normalizedTokens.join(" ").trim()
  if (!args) {
    return {
      target: { type: "uncommittedChanges" },
      delivery,
    }
  }

  const mode = normalizedTokens[0]?.toLowerCase() ?? ""
  const rest = normalizedTokens.slice(1)

  if (mode === "uncommitted" || mode === "changes" || mode === "diff") {
    return {
      target: { type: "uncommittedChanges" },
      delivery,
    }
  }

  if (mode === "base" || mode === "branch") {
    const branch = rest[0]?.trim() ?? ""
    if (!branch) {
      throw new Error("usage: /review base <branch>")
    }
    return {
      target: { type: "baseBranch", branch },
      delivery,
    }
  }

  if (mode === "commit") {
    const sha = rest[0]?.trim() ?? ""
    if (!sha) {
      throw new Error("usage: /review commit <sha> [title]")
    }
    const title = rest.slice(1).join(" ").trim()
    return {
      target: {
        type: "commit",
        sha,
        title: title.length > 0 ? title : null,
      },
      delivery,
    }
  }

  if (mode === "custom") {
    const instructions = rest.join(" ").trim()
    if (!instructions) {
      throw new Error("usage: /review custom <instructions>")
    }
    return {
      target: { type: "custom", instructions },
      delivery,
    }
  }

  return {
    target: { type: "custom", instructions: args },
    delivery,
  }
}

export function useAliciaActions({
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
}: UseAliciaActionsParams) {
  const [sessionActionPending, setSessionActionPending] = useState<{
    sessionId: string
    action: "resume" | "fork" | "switch"
  } | null>(null)

  const supportsRuntimeMethod = useCallback(
    (method: RuntimeMethod): boolean =>
      isRuntimeMethodSupported(aliciaState.runtimeCapabilities, method),
    [aliciaState.runtimeCapabilities],
  )

  const markUnsupportedRuntimeMethod = useCallback(
    (method: RuntimeMethod) => {
      setAliciaState((prev) => ({
        ...prev,
        runtimeCapabilities: markRuntimeMethodUnsupported(
          prev.runtimeCapabilities,
          method,
        ),
      }))
    },
    [setAliciaState],
  )
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
      const { name, args } = parseSlashCommandInput(command)
      const normalizedName = name.trim().toLowerCase()
      const slashDefinition = getSlashCommandDefinition(normalizedName)

      if (!slashDefinition) {
        const rawCommand = command.trim().split(/\s+/)[0] ?? command.trim()
        addMessage(
          "system",
          "[slash] unsupported command: " +
            (rawCommand || normalizedName || command.trim()),
        )
        return
      }

      const slashSupport = resolveSlashCommandSupport(
        slashDefinition,
        aliciaState.runtimeCapabilities,
      )

      if (slashSupport === "planned") {
        addMessage(
          "system",
          "[slash] " + slashDefinition.command + " is planned and not available yet",
        )
        return
      }

      if (slashSupport === "unsupported") {
        addMessage(
          "system",
          "[slash] " +
            slashDefinition.command +
            " is not supported by current runtime capabilities",
        )
        return
      }

      if (normalizedName === "/model" || normalizedName === "/models") {
        await openModelPanel(true)
        return
      }
      if (normalizedName === "/permissions" || normalizedName === "/approvals") {
        try {
          const config = await codexConfigGet()
          runtimeConfigRef.current = config
        } catch {
          // best effort: panel can still open using local config snapshot
        }
        setAliciaState((prev) => ({ ...prev, activePanel: "permissions" }))
        return
      }
      if (normalizedName === "/mcp") {
        setAliciaState((prev) => ({ ...prev, activePanel: "mcp" }))
        await refreshMcpServers()
        return
      }
      if (normalizedName === "/apps") {
        setAliciaState((prev) => ({ ...prev, activePanel: "apps" }))
        await refreshAppsAndAuth({ throwOnError: false })
        return
      }
      if (normalizedName === "/resume") {
        openSessionPanel("resume")
        return
      }
      if (normalizedName === "/fork") {
        openSessionPanel("fork")
        return
      }
      if (normalizedName === "/new") {
        threadIdRef.current = null
        await ensureBridgeSession(true)
        return
      }
      if (normalizedName === "/diff") {
        addMessage(
          "system",
          encodeDiffSystemMessage({
            version: 2,
            title: "Current turn diff",
            threadId: turnDiff?.threadId,
            turnId: turnDiff?.turnId,
            emptyMessage:
              "No diff available yet. Execute a turn with file changes and run /diff again.",
          }),
        )
        return
      }

      if (normalizedName === "/status") {
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
      if (normalizedName === "/review") {
        setAliciaState((prev) => ({ ...prev, activePanel: "review" }))
        await refreshWorkspaceChanges()

        if (!(await ensureBridgeSession(false))) {
          return
        }

        reviewRoutingRef.current = false

        let parsedReview: ParsedReviewSlash
        try {
          parsedReview = parseReviewSlashArgs(args)
        } catch (error) {
          addMessage("system", `[review] ${String(error)}`, "review")
          return
        }

        if (!supportsRuntimeMethod("review.start")) {
          addMessage(
            "system",
            "[slash] /review is not supported by current runtime (missing review.start)",
            "review",
          )
          return
        }

        reviewRoutingRef.current = true
        setIsThinking(true)
        try {
          const started = await codexReviewStart({
            threadId: threadIdRef.current ?? undefined,
            target: parsedReview.target,
            delivery: parsedReview.delivery ?? undefined,
          })

          const nextThreadId =
            (typeof started.reviewThreadId === "string" &&
              started.reviewThreadId.trim()) ||
            (typeof started.threadId === "string" && started.threadId.trim()) ||
            threadIdRef.current

          if (nextThreadId) {
            threadIdRef.current = nextThreadId
          }

          void refreshThreadList({
            activeThreadId: threadIdRef.current,
            notifyOnError: false,
          })
        } catch (error) {
          setIsThinking(false)
          reviewRoutingRef.current = false
          if (isRuntimeCommandUnavailable(error)) {
            markUnsupportedRuntimeMethod("review.start")
            addMessage(
              "system",
              "[slash] /review is not supported by current runtime (missing review.start)",
              "review",
            )
            return
          }
          addMessage("system", `[review] failed: ${String(error)}`, "review")
        } finally {
          await refreshWorkspaceChanges()
        }
        return
      }
      if (normalizedName === "/agent") {
        if (!(await ensureBridgeSession(false))) {
          return
        }

        const normalizedArgs = args.trim()
        const argTokens = normalizedArgs
          .split(/\s+/)
          .map((token) => token.trim())
          .filter((token) => token.length > 0)
        const subcommand = argTokens[0]?.toLowerCase() ?? ""

        const resolveTargetThreadId = (candidate?: string): string => {
          const explicit = (candidate ?? "").trim()
          if (explicit.length > 0) {
            return explicit
          }
          return threadIdRef.current?.trim() ?? ""
        }

        if (subcommand === "resume") {
          openSessionPanel("resume")
          return
        }
        if (subcommand === "fork") {
          openSessionPanel("fork")
          return
        }
        if (subcommand === "list") {
          openSessionPanel("list")
          return
        }

        if (subcommand === "archive") {
          const targetThreadId = resolveTargetThreadId(argTokens[1])
          if (!targetThreadId) {
            addMessage("system", "[agent] usage: /agent archive <thread-id>")
            return
          }

          if (!supportsRuntimeMethod("thread.archive")) {
            addMessage("system", "[agent] thread.archive not supported by runtime")
            return
          }

          try {
            await codexThreadArchive({ threadId: targetThreadId })
            if ((threadIdRef.current?.trim() ?? "") === targetThreadId) {
              threadIdRef.current = null
            }
            await refreshThreadList({
              activeThreadId: threadIdRef.current,
              notifyOnError: false,
            })
            addMessage("system", `[agent] archived thread ${targetThreadId}`)
          } catch (error) {
            if (isRuntimeCommandUnavailable(error)) {
              markUnsupportedRuntimeMethod("thread.archive")
              addMessage("system", "[agent] thread.archive not supported by runtime")
            } else {
              addMessage("system", `[agent] archive failed: ${String(error)}`)
            }
          }
          return
        }

        if (subcommand === "unarchive") {
          const targetThreadId = resolveTargetThreadId(argTokens[1])
          if (!targetThreadId) {
            addMessage("system", "[agent] usage: /agent unarchive <thread-id>")
            return
          }

          if (!supportsRuntimeMethod("thread.unarchive")) {
            addMessage("system", "[agent] thread.unarchive not supported by runtime")
            return
          }

          try {
            const unarchived = await codexThreadUnarchive({ threadId: targetThreadId })
            const nextThreadId =
              (typeof unarchived.thread?.codexThreadId === "string" &&
                unarchived.thread.codexThreadId.trim()) ||
              (typeof unarchived.thread?.id === "string" && unarchived.thread.id.trim()) ||
              targetThreadId
            threadIdRef.current = nextThreadId
            await refreshThreadList({
              activeThreadId: threadIdRef.current,
              notifyOnError: false,
            })
            addMessage("system", `[agent] unarchived thread ${nextThreadId}`)
          } catch (error) {
            if (isRuntimeCommandUnavailable(error)) {
              markUnsupportedRuntimeMethod("thread.unarchive")
              addMessage("system", "[agent] thread.unarchive not supported by runtime")
            } else {
              addMessage("system", `[agent] unarchive failed: ${String(error)}`)
            }
          }
          return
        }

        if (subcommand === "compact") {
          const targetThreadId = resolveTargetThreadId(argTokens[1])
          if (!targetThreadId) {
            addMessage("system", "[agent] usage: /agent compact <thread-id>")
            return
          }

          if (!supportsRuntimeMethod("thread.compact.start")) {
            addMessage("system", "[agent] thread.compact.start not supported by runtime")
            return
          }

          try {
            await codexThreadCompactStart({ threadId: targetThreadId })
            addMessage("system", `[agent] compact started for thread ${targetThreadId}`)
          } catch (error) {
            if (isRuntimeCommandUnavailable(error)) {
              markUnsupportedRuntimeMethod("thread.compact.start")
              addMessage("system", "[agent] thread.compact.start not supported by runtime")
            } else {
              addMessage("system", `[agent] compact failed: ${String(error)}`)
            }
          }
          return
        }

        if (subcommand === "rollback") {
          const rawTurns = argTokens[1] ?? ""
          const parsedTurns = Number(rawTurns)
          if (!Number.isInteger(parsedTurns) || parsedTurns <= 0) {
            addMessage("system", "[agent] usage: /agent rollback <num-turns> [thread-id]")
            return
          }

          const targetThreadId = resolveTargetThreadId(argTokens[2])
          if (!targetThreadId) {
            addMessage("system", "[agent] usage: /agent rollback <num-turns> <thread-id>")
            return
          }

          if (!supportsRuntimeMethod("thread.rollback")) {
            addMessage("system", "[agent] thread.rollback not supported by runtime")
            return
          }

          try {
            const rolledBack = await codexThreadRollback({
              threadId: targetThreadId,
              numTurns: parsedTurns,
            })
            const nextThreadId =
              (typeof rolledBack.thread?.codexThreadId === "string" &&
                rolledBack.thread.codexThreadId.trim()) ||
              (typeof rolledBack.thread?.id === "string" && rolledBack.thread.id.trim()) ||
              targetThreadId
            threadIdRef.current = nextThreadId
            await refreshThreadList({
              activeThreadId: threadIdRef.current,
              notifyOnError: false,
            })
            addMessage(
              "system",
              `[agent] rolled back ${parsedTurns} turn(s) on thread ${nextThreadId}`,
            )
          } catch (error) {
            if (isRuntimeCommandUnavailable(error)) {
              markUnsupportedRuntimeMethod("thread.rollback")
              addMessage("system", "[agent] thread.rollback not supported by runtime")
            } else {
              addMessage("system", `[agent] rollback failed: ${String(error)}`)
            }
          }
          return
        }

        const records = await refreshThreadList({
          activeThreadId: threadIdRef.current,
          notifyOnError: false,
        })

        const activeThreadId = threadIdRef.current?.trim() ?? ""
        const activeRecord = records.find((record) => {
          const recordId = typeof record.id === "string" ? record.id.trim() : ""
          const codexThreadId =
            typeof record.codexThreadId === "string"
              ? record.codexThreadId.trim()
              : ""
          return (
            activeThreadId.length > 0 &&
            (recordId === activeThreadId || codexThreadId === activeThreadId)
          )
        })

        const activeLabel =
          activeRecord &&
            typeof activeRecord.preview === "string" &&
            activeRecord.preview.trim().length > 0
            ? `${activeThreadId || activeRecord.id} - ${activeRecord.preview.trim()}`
            : activeThreadId || activeRecord?.id || "none"

        addMessage("system", `[agent] active=${activeLabel} total=${records.length}`)
        return
      }
      if (normalizedName === "/logout") {
        if (!(await ensureBridgeSession(false))) {
          return
        }

        const logoutViaCli = async () => {
          try {
            const result = await runCodexCommand(["logout"])
            if (!result.success) {
              const failure = result.stderr.trim() || result.stdout.trim() || "logout failed"
              throw new Error(failure)
            }
            addMessage("system", "[account] logged out via CLI")
          } catch (fallbackError) {
            addMessage("system", `[account] logout failed: ${String(fallbackError)}`)
          }
        }

        if (!supportsRuntimeMethod("account.logout")) {
          await logoutViaCli()
          return
        }

        try {
          await codexAccountLogout()
          await refreshAppsAndAuth({ throwOnError: false, refreshToken: false })
          addMessage("system", "[account] logged out")
        } catch (error) {
          if (!isRuntimeCommandUnavailable(error)) {
            addMessage("system", `[account] logout failed: ${String(error)}`)
            return
          }

          markUnsupportedRuntimeMethod("account.logout")
          await logoutViaCli()
        }
        return
      }
      if (normalizedName === "/quit" || normalizedName === "/exit") {
        await codexBridgeStop()
        setRuntime((prev) => ({
          ...prev,
          state: "idle",
          sessionId: null,
          pid: null,
        }))
        return
      }
      addMessage("system", "[slash] unsupported command: " + slashDefinition.command)
    },
    [
      addMessage,
      aliciaState.runtimeCapabilities,
      ensureBridgeSession,
      markUnsupportedRuntimeMethod,
      openModelPanel,
      openSessionPanel,
      refreshMcpServers,
      refreshAppsAndAuth,
      refreshThreadList,
      setAliciaState,
      setIsThinking,
      setRuntime,
      supportsRuntimeMethod,
      threadIdRef,
      turnDiff,
      reviewRoutingRef,
      refreshWorkspaceChanges,
      runtimeConfigRef,
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

          if (supportsRuntimeMethod("thread.fork")) {
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

              markUnsupportedRuntimeMethod("thread.fork")
              await runCodexCommand(["fork", selectedThreadId])
              const refreshed = await refreshThreadList({ notifyOnError: false })
              nextThreadId = refreshed[0]?.id ?? null
            }
          } else {
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
            if (includeTurnsUnavailable) {
              // ignore empty history before first user turn
            } else if (isRuntimeCommandUnavailable(error)) {
              markUnsupportedRuntimeMethod("thread.read")
            } else {
              historyError = `[session] history sync failed: ${message}`
            }
          }
        }

        setMessages(historyMessages)
        reviewRoutingRef.current = false
        setIsThinking(false)
        setPendingApprovals([])
        setPendingUserInput(null)
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
      markUnsupportedRuntimeMethod,
      refreshThreadList,
      sessionActionPending,
      setAliciaState,
      setIsThinking,
      setMessages,
      setPendingApprovals,
      setPendingUserInput,
      setTurnDiff,
      setTurnPlan,
      supportsRuntimeMethod,
      threadIdRef,
      reviewRoutingRef,
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

