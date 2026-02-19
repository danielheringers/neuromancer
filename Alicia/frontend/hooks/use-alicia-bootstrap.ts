import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react"

import { type AliciaState } from "@/lib/alicia-types"
import {
  markAutoTerminalBootDone,
  normalizeConfig,
  wasAutoTerminalBootDone,
  type Message,
  type RuntimeState,
} from "@/lib/alicia-runtime-helpers"
import {
  codexHelpSnapshot,
  codexRuntimeStatus,
  codexWaitForMcpStartup,
  isTauriRuntime,
  listenToCodexEvents,
  listenToTerminalEvents,
  loadCodexDefaultConfig,
  type CodexModel,
  type CodexRuntimeEvent,
  type CodexThreadRecord,
  type RuntimeCodexConfig,
  type TerminalRuntimeEvent,
} from "@/lib/tauri-bridge"

interface UseAliciaBootstrapParams {
  bootstrappedRef: MutableRefObject<boolean>
  autoTerminalCreatedRef: MutableRefObject<boolean>
  codexUnlistenRef: MutableRefObject<(() => void) | null>
  terminalUnlistenRef: MutableRefObject<(() => void) | null>
  runtimeConfigRef: MutableRefObject<RuntimeCodexConfig | null>
  handleCodexEvent: (event: CodexRuntimeEvent) => void
  handleTerminalEvent: (event: TerminalRuntimeEvent) => void
  addMessage: (type: Message["type"], content: string) => void
  setRuntime: Dispatch<SetStateAction<RuntimeState>>
  setAliciaState: Dispatch<SetStateAction<AliciaState>>
  setInitializingStatus: Dispatch<SetStateAction<string>>
  setInitializing: Dispatch<SetStateAction<boolean>>
  setActiveSessionEntry: (
    sessionId: number,
    model?: string,
    threadId?: string | null,
  ) => void
  ensureBridgeSession: (forceNew?: boolean) => Promise<boolean>
  refreshModelsCatalog: (notifyOnError?: boolean) => Promise<CodexModel[]>
  refreshThreadList: (options?: {
    activeThreadId?: string | null
    notifyOnError?: boolean
  }) => Promise<CodexThreadRecord[]>
  refreshMcpServers: () => Promise<void>
  createTerminalTab: (cwd?: string) => Promise<boolean>
  onBootLog?: (message: string) => void
}

export function useAliciaBootstrap({
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
  createTerminalTab,
  onBootLog,
}: UseAliciaBootstrapParams) {
  const reportBoot = (message: string) => {
    onBootLog?.(message)
  }

  const setBootStatus = (message: string) => {
    setInitializingStatus(message)
    reportBoot(message)
  }

  useEffect(() => {
    if (bootstrappedRef.current) {
      return
    }
    bootstrappedRef.current = true

    let mounted = true
    const bootstrap = async () => {
      try {
        setBootStatus("Initializing Alicia runtime...")
        if (!isTauriRuntime()) {
          setRuntime((prev) => ({ ...prev, connected: false }))
          addMessage(
            "system",
            "Alicia running in web mode. Launch with Tauri for full runtime.",
          )
          reportBoot("Running in web mode; Tauri runtime unavailable")
          return
        }

        setBootStatus("Connecting runtime bridge...")
        codexUnlistenRef.current = await listenToCodexEvents(handleCodexEvent)
        terminalUnlistenRef.current = await listenToTerminalEvents(handleTerminalEvent)
        reportBoot("Runtime event listeners attached")

        try {
          const config = await loadCodexDefaultConfig()
          runtimeConfigRef.current = config
          const normalized = normalizeConfig(config)
          if (mounted) {
            setAliciaState((prev) => ({ ...prev, ...normalized }))
          }
          reportBoot("Loaded default Codex config")
        } catch {
          reportBoot("Default Codex config unavailable; using in-memory defaults")
        }

        setBootStatus("Reading runtime status...")
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
        reportBoot(`Runtime connected (session: ${status.sessionId ?? "none"})`)

        let hasActiveSession = status.sessionId != null
        if (status.sessionId != null) {
          setActiveSessionEntry(
            status.sessionId,
            normalizeConfig(status.runtimeConfig).model,
          )
        } else {
          setBootStatus("Starting Codex session...")
          hasActiveSession = await ensureBridgeSession(false)
        }

        if (hasActiveSession) {
          setBootStatus("Loading session history...")
          await refreshThreadList({ notifyOnError: false })
          reportBoot("Thread list synchronized")

          setBootStatus("Loading MCP servers...")
          try {
            const warmup = await codexWaitForMcpStartup()
            if (warmup.totalReady > 0) {
              addMessage(
                "system",
                `[mcp] startup complete: ${warmup.totalReady} server(s) ready in ${warmup.elapsedMs}ms`,
              )
              reportBoot(
                `MCP startup complete: ${warmup.totalReady} server(s) ready in ${warmup.elapsedMs}ms`,
              )
            } else {
              addMessage("system", "[mcp] startup complete: no active MCP servers")
              reportBoot("MCP startup complete: no active servers")
            }
          } catch (error) {
            addMessage("system", `[mcp] startup check failed: ${String(error)}`)
            reportBoot(`MCP startup check failed: ${String(error)}`)
          }
        }

        setBootStatus("Syncing runtime metadata...")
        void codexHelpSnapshot()
        await refreshModelsCatalog(false)
        await refreshMcpServers()
        reportBoot("Runtime metadata synchronized")

        // Startup terminal must be idempotent: exactly one automatic tab.
        if (!autoTerminalCreatedRef.current && !wasAutoTerminalBootDone()) {
          const created = await createTerminalTab(status.workspace)
          if (created) {
            autoTerminalCreatedRef.current = true
            markAutoTerminalBootDone(true)
            reportBoot("Startup terminal initialized")
          }
        }
      } catch (error) {
        const message = String(error)
        addMessage("system", `[bootstrap] failed: ${message}`)
        reportBoot(`Bootstrap failed: ${message}`)
      } finally {
        if (mounted) {
          setInitializing(false)
        }
      }
    }

    void bootstrap()
    return () => {
      mounted = false
      codexUnlistenRef.current?.()
      terminalUnlistenRef.current?.()
    }
    // Bootstrap must run once; dependency churn can trigger cleanup mid-flight and freeze loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}