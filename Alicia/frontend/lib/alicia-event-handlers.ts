import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react"

import {
  type CodexRuntimeEvent,
  type TerminalRuntimeEvent,
} from "@/lib/tauri-bridge"
import {
  formatStructuredItem,
  itemIdentity,
  mergeTerminalBuffer,
  normalizePlanStepStatus,
  type ApprovalRequestState,
  type Message,
  type RuntimeState,
  type TerminalTab,
  type TurnDiffState,
  type TurnPlanState,
} from "@/lib/alicia-runtime-helpers"

type AddMessage = (type: Message["type"], content: string) => void

interface CodexEventHandlerDeps {
  addMessage: AddMessage
  setRuntime: Dispatch<SetStateAction<RuntimeState>>
  setIsThinking: Dispatch<SetStateAction<boolean>>
  setPendingApprovals: Dispatch<SetStateAction<ApprovalRequestState[]>>
  setTurnDiff: Dispatch<SetStateAction<TurnDiffState | null>>
  setTurnPlan: Dispatch<SetStateAction<TurnPlanState | null>>
  seenEventSeqRef: MutableRefObject<Set<number>>
  streamedAgentTextRef: MutableRefObject<Map<string, string>>
  threadIdRef: MutableRefObject<string | null>
}

export function createCodexEventHandler({
  addMessage,
  setRuntime,
  setIsThinking,
  setPendingApprovals,
  setTurnDiff,
  setTurnPlan,
  seenEventSeqRef,
  streamedAgentTextRef,
  threadIdRef,
}: CodexEventHandlerDeps) {
  const reportedContractViolations = new Set<string>()

  const reportContractViolation = (key: string, message: string) => {
    if (reportedContractViolations.has(key)) {
      return
    }
    reportedContractViolations.add(key)
    addMessage("system", `[contract] ${message}`)
  }

  return (event: CodexRuntimeEvent) => {
    if (event.type === "lifecycle") {
      if (event.payload.status === "error") {
        setRuntime((prev) => ({ ...prev, state: "error" }))
        setIsThinking(false)
        setPendingApprovals([])
        setTurnDiff(null)
        streamedAgentTextRef.current.clear()
        addMessage("system", event.payload.message ?? "runtime error")
      }
      if (event.payload.status === "stopped") {
        setRuntime((prev) => ({ ...prev, state: "idle", sessionId: null, pid: null }))
        setIsThinking(false)
        setPendingApprovals([])
        setTurnDiff(null)
        setTurnPlan(null)
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

    const rawPayload = event.payload.event
    if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
      reportContractViolation(
        "structured-event-envelope",
        "received runtime event without a valid object envelope",
      )
      return
    }

    const payload = rawPayload as Record<string, unknown>
    const rawEventType = payload.type
    if (typeof rawEventType !== "string" || rawEventType.trim().length === 0) {
      reportContractViolation(
        "structured-event-type",
        "received runtime event without a valid type",
      )
      return
    }

    const eventType = rawEventType.trim()
    if (eventType === "__invalid__") {
      const reason =
        typeof payload.reason === "string" && payload.reason.trim().length > 0
          ? payload.reason.trim()
          : "invalid-envelope"
      reportContractViolation(
        `structured-event-${reason}`,
        `received runtime event with invalid envelope (${reason})`,
      )
      return
    }
    if (eventType === "thread.started") {
      const codexThreadId = String(payload.thread_id ?? "")
      if (codexThreadId.trim().length > 0) {
        threadIdRef.current = codexThreadId
      }
      addMessage("system", `[thread] started ${codexThreadId}`)
      return
    }
    if (eventType === "turn.started") {
      const turnThreadId = String(payload.thread_id ?? "")
      if (turnThreadId.trim().length > 0) {
        threadIdRef.current = turnThreadId
      }
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

    if (eventType === "mcp.oauth_login.completed") {
      const name = String(payload.name ?? "").trim()
      const success = Boolean(payload.success)
      const error =
        typeof payload.error === "string" && payload.error.trim().length > 0
          ? payload.error.trim()
          : null

      if (success) {
        addMessage(
          "system",
          name ? `[mcp] oauth login completed for ${name}` : "[mcp] oauth login completed",
        )
      } else {
        addMessage(
          "system",
          name
            ? `[mcp] oauth login failed for ${name}: ${error ?? "unknown error"}`
            : `[mcp] oauth login failed: ${error ?? "unknown error"}`,
        )
      }
      return
    }

    if (eventType === "thread.token_usage.updated") {
      const usage = payload.token_usage as Record<string, unknown> | undefined
      const total = usage?.total as Record<string, unknown> | undefined
      const input = Number(total?.input_tokens ?? 0)
      const output = Number(total?.output_tokens ?? 0)
      const totalTokens = Number(total?.total_tokens ?? 0)
      if (
        Number.isFinite(input) &&
        Number.isFinite(output) &&
        Number.isFinite(totalTokens) &&
        totalTokens > 0
      ) {
        addMessage(
          "system",
          `[usage] total=${totalTokens} input=${input} output=${output}`,
        )
      }
      return
    }

    if (eventType === "turn.diff.updated") {
      setTurnDiff({
        threadId: String(payload.thread_id ?? ""),
        turnId: String(payload.turn_id ?? ""),
        diff: String(payload.diff ?? ""),
      })
      return
    }

    if (eventType === "turn.plan.updated") {
      const rawPlan = Array.isArray(payload.plan) ? payload.plan : []
      const plan = rawPlan
        .map((entry) => {
          const step = String((entry as Record<string, unknown>)?.step ?? "").trim()
          if (!step) {
            return null
          }
          return {
            step,
            status: normalizePlanStepStatus(
              (entry as Record<string, unknown>)?.status,
            ),
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

      setTurnPlan({
        threadId: String(payload.thread_id ?? ""),
        turnId: String(payload.turn_id ?? ""),
        explanation:
          typeof payload.explanation === "string" && payload.explanation.trim().length > 0
            ? payload.explanation
            : null,
        plan,
      })
      return
    }

    if (eventType === "approval.requested") {
      const nextApproval: ApprovalRequestState = {
        actionId: String(payload.action_id ?? ""),
        kind:
          payload.kind === "file_change" ? "file_change" : "command_execution",
        threadId: String(payload.thread_id ?? ""),
        turnId: String(payload.turn_id ?? ""),
        itemId: String(payload.item_id ?? ""),
        reason: String(payload.reason ?? ""),
        command: String(payload.command ?? ""),
        cwd: String(payload.cwd ?? ""),
        grantRoot: String(payload.grant_root ?? ""),
        commandActions: Array.isArray(payload.command_actions)
          ? payload.command_actions
          : [],
        proposedExecpolicyAmendment: Array.isArray(
          payload.proposed_execpolicy_amendment,
        )
          ? payload.proposed_execpolicy_amendment.map((entry) => String(entry))
          : [],
      }

      if (!nextApproval.actionId) {
        return
      }

      setPendingApprovals((previous) => {
        const existing = previous.findIndex(
          (entry) => entry.actionId === nextApproval.actionId,
        )
        if (existing < 0) {
          return [...previous, nextApproval]
        }

        const copy = [...previous]
        copy[existing] = nextApproval
        return copy
      })
      return
    }

    if (eventType === "approval.resolved") {
      const actionId = String(payload.action_id ?? "")
      if (actionId) {
        setPendingApprovals((previous) =>
          previous.filter((entry) => entry.actionId !== actionId),
        )
      }
      return
    }

    if (
      eventType === "item.started" ||
      eventType === "item.updated" ||
      eventType === "item.completed"
    ) {
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

      const shouldRenderOnStart =
        eventType === "item.started" &&
        (itemType === "entered_review_mode" || itemType === "enteredReviewMode")

      if (eventType !== "item.completed" && !shouldRenderOnStart) {
        return
      }

      const content = formatStructuredItem(item)
      if (content) {
        addMessage("system", content)
      }
    }
  }
}

interface TerminalOutputWriter {
  write: (chunk: string) => void
}

interface TerminalEventHandlerDeps<TWriter extends TerminalOutputWriter> {
  setTerminalTabs: Dispatch<SetStateAction<TerminalTab[]>>
  terminalBuffersRef: MutableRefObject<Map<number, string>>
  activeTerminalRef: MutableRefObject<number | null>
  xtermRef: MutableRefObject<TWriter | null>
}

export function createTerminalEventHandler<TWriter extends TerminalOutputWriter>({
  setTerminalTabs,
  terminalBuffersRef,
  activeTerminalRef,
  xtermRef,
}: TerminalEventHandlerDeps<TWriter>) {
  return (event: TerminalRuntimeEvent) => {
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
      prev.map((tab) =>
        tab.id === event.payload.terminalId ? { ...tab, alive: false } : tab,
      ),
    )
  }
}


