import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react"

import { type AliciaState } from "@/lib/alicia-types"
import {
  parseMcpListOutput,
  relativeNowLabel,
  writeModelsCache,
  type Message,
  type RuntimeState,
  type TerminalTab,
} from "@/lib/alicia-runtime-helpers"
import {
  codexBridgeStart,
  codexBridgeStop,
  codexModelsList,
  codexMcpList,
  runCodexCommand,
  terminalCreate,
  terminalKill,
  terminalResize,
  type CodexModel,
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
    (sessionId: number, model?: string) => {
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
    },
    [setAliciaState],
  )

  const refreshMcpServers = useCallback(async () => {
    try {
      const result = await codexMcpList()
      setAliciaState((previous) => ({ ...previous, mcpServers: result.data }))
      return
    } catch {
      // fall back to CLI output parsing when bridge listing is unavailable
    }

    try {
      const result = await runCodexCommand(["mcp", "list"])
      const parsed = parseMcpListOutput(result.stdout)
      setAliciaState((previous) => ({ ...previous, mcpServers: parsed }))
    } catch {
      // best effort
    }
  }, [setAliciaState])

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
    [addMessage, runtime.connected, setActiveTerminalId, setTerminalTabs, terminalBuffersRef, xtermRef],
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
      return availableModels.find((model) => model.isDefault)?.displayName || "Codex Default"
    }
    return aliciaState.model
  }, [aliciaState.model, availableModels])

  return {
    setActiveSessionEntry,
    refreshMcpServers,
    refreshModelsCatalog,
    openModelPanel,
    ensureBridgeSession,
    createTerminalTab,
    closeTerminalTab,
    currentModelLabel,
  }
}
