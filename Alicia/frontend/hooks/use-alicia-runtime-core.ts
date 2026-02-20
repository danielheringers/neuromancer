import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react"

import { type AliciaState, type McpServer } from "@/lib/alicia-types"
import {
  isRuntimeCommandUnavailable,
  isRuntimeMethodSupported,
  mapThreadRecordsToSessions,
  markRuntimeMethodUnsupported,
  parseMcpListOutput,
  relativeNowLabel,
  writeModelsCache,
  type Message,
  type RuntimeState,
  type TerminalTab,
} from "@/lib/alicia-runtime-helpers"
import {
  codexAppList,
  codexAccountRateLimitsRead,
  codexAccountRead,
  codexBridgeStart,
  codexBridgeStop,
  codexModelsList,
  codexMcpList,
  codexThreadList,
  runCodexCommand,
  terminalCreate,
  terminalKill,
  terminalResize,
  type CodexModel,
  type CodexThreadRecord,
  type RuntimeMethod,
} from "@/lib/tauri-bridge"

interface UseAliciaRuntimeCoreParams {
  addMessage: (type: Message["type"], content: string) => void
  runtime: RuntimeState
  setRuntime: Dispatch<SetStateAction<RuntimeState>>
  aliciaState: AliciaState
  setAliciaState: Dispatch<SetStateAction<AliciaState>>
  availableModels: CodexModel[]
  setAvailableModels: Dispatch<SetStateAction<CodexModel[]>>
  modelsLoading: boolean
  setModelsLoading: Dispatch<SetStateAction<boolean>>
  setModelsError: Dispatch<SetStateAction<string | null>>
  setModelsCachedAt: Dispatch<SetStateAction<number | null>>
  setModelsFromCache: Dispatch<SetStateAction<boolean>>
  threadIdRef: MutableRefObject<string | null>
  seenEventSeqRef: MutableRefObject<Set<number>>
  streamedAgentTextRef: MutableRefObject<Map<string, string>>
  terminalBuffersRef: MutableRefObject<Map<number, string>>
  xtermRef: MutableRefObject<import("xterm").Terminal | null>
  setTerminalTabs: Dispatch<SetStateAction<TerminalTab[]>>
  setActiveTerminalId: Dispatch<SetStateAction<number | null>>
}

interface RefreshThreadListOptions {
  activeThreadId?: string | null
  notifyOnError?: boolean
}

interface RefreshMcpServersOptions {
  throwOnError?: boolean
}

interface RefreshAppsAndAuthOptions {
  throwOnError?: boolean
  forceRefetch?: boolean
  refreshToken?: boolean
}

function normalizeAccountMode(value: unknown): AliciaState["account"]["authMode"] {
  if (
    value === "none" ||
    value === "api_key" ||
    value === "chatgpt" ||
    value === "chatgpt_auth_tokens" ||
    value === "unknown"
  ) {
    return value
  }
  return "unknown"
}

export function useAliciaRuntimeCore({
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
}: UseAliciaRuntimeCoreParams) {
  const setActiveSessionEntry = useCallback(
    (sessionId: number, model?: string, threadId?: string | null) => {
      setAliciaState((previous) => {
        const normalizedThreadId =
          typeof threadId === "string" && threadId.trim().length > 0
            ? threadId.trim()
            : null
        const id = normalizedThreadId ?? `session-${sessionId}`
        const existing = previous.sessions.find((session) => session.id === id)
        return {
          ...previous,
          sessions: [
            {
              id,
              threadId: normalizedThreadId ?? existing?.threadId,
              name: existing?.name ?? `Session ${sessionId}`,
              time: relativeNowLabel(),
              active: true,
              messageCount: existing?.messageCount ?? 0,
              model: existing?.model ?? model ?? previous.model,
              createdAt: existing?.createdAt ?? null,
              updatedAt: existing?.updatedAt ?? null,
              sourceKind: existing?.sourceKind ?? null,
              cwd: existing?.cwd,
            },
            ...previous.sessions
              .filter((session) => session.id !== id)
              .map((session) => ({ ...session, active: false })),
          ].slice(0, 50),
        }
      })
    },
    [setAliciaState],
  )

  const supportsRuntimeMethod = useCallback(
    (method: RuntimeMethod): boolean =>
      isRuntimeMethodSupported(aliciaState.runtimeCapabilities, method),
    [aliciaState.runtimeCapabilities],
  )

  const markUnsupportedRuntimeMethod = useCallback(
    (method: RuntimeMethod) => {
      setAliciaState((previous) => {
        const nextCapabilities = markRuntimeMethodUnsupported(
          previous.runtimeCapabilities,
          method,
        )
        if (nextCapabilities === previous.runtimeCapabilities) {
          return previous
        }
        return {
          ...previous,
          runtimeCapabilities: nextCapabilities,
        }
      })
    },
    [setAliciaState],
  )

  const refreshThreadList = useCallback(
    async (
      options: RefreshThreadListOptions = {},
    ): Promise<CodexThreadRecord[]> => {
      if (!runtime.connected) {
        return []
      }

      if (!supportsRuntimeMethod("thread.list")) {
        return []
      }

      try {
        const response = await codexThreadList({
          cursor: null,
          limit: 50,
          sortKey: "updated_at",
          archived: false,
        })

        const records = Array.isArray(response.data) ? response.data : []
        const activeThreadId =
          typeof options.activeThreadId === "string" &&
          options.activeThreadId.trim().length > 0
            ? options.activeThreadId.trim()
            : threadIdRef.current

        const sessions = mapThreadRecordsToSessions(records, {
          activeThreadId,
          fallbackModel: aliciaState.model,
        })

        setAliciaState((previous) => ({
          ...previous,
          sessions: sessions.slice(0, 50),
        }))

        return records
      } catch (error) {
        if (isRuntimeCommandUnavailable(error)) {
          markUnsupportedRuntimeMethod("thread.list")
        } else if (options.notifyOnError) {
          addMessage("system", `[threads] refresh failed: ${String(error)}`)
        }
        return []
      }
    },
    [
      addMessage,
      aliciaState.model,
      markUnsupportedRuntimeMethod,
      runtime.connected,
      setAliciaState,
      supportsRuntimeMethod,
      threadIdRef,
    ],
  )

  const refreshMcpServers = useCallback(
    async (
      options: RefreshMcpServersOptions = {},
    ): Promise<McpServer[]> => {
      let lastError: unknown = null
      let shouldUseCliFallback = !supportsRuntimeMethod("mcp.list")

      if (!shouldUseCliFallback) {
        try {
          const result = await codexMcpList()
          const parsed = Array.isArray(result.data) ? result.data : []
          setAliciaState((previous) => ({ ...previous, mcpServers: parsed }))
          return parsed
        } catch (error) {
          if (isRuntimeCommandUnavailable(error)) {
            markUnsupportedRuntimeMethod("mcp.list")
            shouldUseCliFallback = true
          } else {
            lastError = error
          }
        }
      }

      if (shouldUseCliFallback) {
        try {
          const result = await runCodexCommand(["mcp", "list", "--json"])
          const parsed = parseMcpListOutput(result.stdout)
          setAliciaState((previous) => ({ ...previous, mcpServers: parsed }))
          return parsed
        } catch (error) {
          lastError = error
        }
      }

      if (options.throwOnError) {
        throw lastError ?? new Error("failed to refresh MCP server list")
      }

      return []
    },
    [markUnsupportedRuntimeMethod, setAliciaState, supportsRuntimeMethod],
  )

  const refreshAppsAndAuth = useCallback(
    async (options: RefreshAppsAndAuthOptions = {}) => {
      if (!runtime.connected) {
        if (options.throwOnError) {
          throw new Error("runtime disconnected; cannot refresh apps/auth")
        }
        return null
      }

      let lastError: unknown = null
      let apps = aliciaState.apps
      let account = aliciaState.account
      let rateLimits = aliciaState.rateLimits
      let rateLimitsByLimitId = aliciaState.rateLimitsByLimitId

      if (supportsRuntimeMethod("app.list")) {
        try {
          const appsResponse = await codexAppList({
            cursor: null,
            limit: 100,
            threadId: threadIdRef.current,
            forceRefetch: Boolean(options.forceRefetch),
          })
          apps = Array.isArray(appsResponse.data) ? appsResponse.data : []
        } catch (error) {
          if (isRuntimeCommandUnavailable(error)) {
            markUnsupportedRuntimeMethod("app.list")
            apps = []
          } else {
            lastError = error
          }
        }
      } else {
        apps = []
      }

      if (supportsRuntimeMethod("account.read")) {
        try {
          const accountResponse = await codexAccountRead({
            refreshToken: Boolean(options.refreshToken),
          })
          const authMode = normalizeAccountMode(accountResponse.authMode)

          const profile = accountResponse.account
            ? {
              type: normalizeAccountMode(accountResponse.account.accountType),
              email: accountResponse.account.email ?? null,
              planType: accountResponse.account.planType ?? null,
            }
            : null

          account = {
            authMode,
            requiresOpenaiAuth: Boolean(accountResponse.requiresOpenaiAuth),
            account:
              profile && profile.type !== "none"
                ? {
                  type:
                    profile.type === "api_key" ||
                      profile.type === "chatgpt" ||
                      profile.type === "chatgpt_auth_tokens" ||
                      profile.type === "unknown"
                      ? profile.type
                      : "unknown",
                  email: profile.email,
                  planType: profile.planType,
                }
                : null,
          }
        } catch (error) {
          if (isRuntimeCommandUnavailable(error)) {
            markUnsupportedRuntimeMethod("account.read")
          } else {
            lastError = lastError ?? error
          }
        }
      }

      if (supportsRuntimeMethod("account.rate_limits.read")) {
        try {
          const rateLimitsResponse = await codexAccountRateLimitsRead()
          rateLimits = rateLimitsResponse.rateLimits ?? null
          rateLimitsByLimitId = rateLimitsResponse.rateLimitsByLimitId ?? {}
        } catch (error) {
          if (isRuntimeCommandUnavailable(error)) {
            markUnsupportedRuntimeMethod("account.rate_limits.read")
            rateLimits = null
            rateLimitsByLimitId = {}
          } else {
            lastError = lastError ?? error
          }
        }
      } else {
        rateLimits = null
        rateLimitsByLimitId = {}
      }

      setAliciaState((previous) => ({
        ...previous,
        apps,
        account,
        rateLimits,
        rateLimitsByLimitId,
      }))

      if (lastError && options.throwOnError) {
        throw lastError
      }

      if (lastError) {
        return null
      }

      return {
        apps,
        account,
        rateLimits,
        rateLimitsByLimitId,
      }
    },
    [
      aliciaState.account,
      aliciaState.apps,
      aliciaState.rateLimits,
      aliciaState.rateLimitsByLimitId,
      markUnsupportedRuntimeMethod,
      runtime.connected,
      setAliciaState,
      supportsRuntimeMethod,
      threadIdRef,
    ],
  )

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
            addMessage(
              "system",
              `[models] live refresh failed, using cached catalog: ${message}`,
            )
          } else {
            addMessage("system", `[models] failed: ${message}`)
          }
        }
        return availableModels
      } finally {
        setModelsLoading(false)
      }
    },
    [
      addMessage,
      availableModels,
      runtime.connected,
      setAvailableModels,
      setModelsCachedAt,
      setModelsError,
      setModelsFromCache,
      setModelsLoading,
    ],
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
    [availableModels.length, modelsLoading, refreshModelsCatalog, setAliciaState],
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
          setRuntime((prev) => ({
            ...prev,
            state: "idle",
            sessionId: null,
            pid: null,
          }))
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
    [
      addMessage,
      aliciaState.model,
      runtime.connected,
      runtime.sessionId,
      seenEventSeqRef,
      setActiveSessionEntry,
      setRuntime,
      streamedAgentTextRef,
      threadIdRef,
    ],
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
    [
      addMessage,
      runtime.connected,
      setActiveTerminalId,
      setTerminalTabs,
      terminalBuffersRef,
      xtermRef,
    ],
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
    [setActiveTerminalId, setTerminalTabs, terminalBuffersRef],
  )

  const currentModelLabel = useMemo(() => {
    const current = availableModels.find((model) => model.id === aliciaState.model)
    if (current) {
      return current.displayName
    }
    if (aliciaState.model === "default") {
      return (
        availableModels.find((model) => model.isDefault)?.displayName ||
        "Codex Default"
      )
    }
    return aliciaState.model
  }, [aliciaState.model, availableModels])

  return {
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
  }
}









