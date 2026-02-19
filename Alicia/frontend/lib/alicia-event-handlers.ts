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
  type Message,
  type RuntimeState,
  type TerminalTab,
} from "@/lib/alicia-runtime-helpers"

type AddMessage = (type: Message["type"], content: string) => void

interface CodexEventHandlerDeps {
  addMessage: AddMessage
  setRuntime: Dispatch<SetStateAction<RuntimeState>>
  setIsThinking: Dispatch<SetStateAction<boolean>>
  seenEventSeqRef: MutableRefObject<Set<number>>
  streamedAgentTextRef: MutableRefObject<Map<string, string>>
}

export function createCodexEventHandler({
  addMessage,
  setRuntime,
  setIsThinking,
  seenEventSeqRef,
  streamedAgentTextRef,
}: CodexEventHandlerDeps) {
  return (event: CodexRuntimeEvent) => {
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

      if (eventType !== "item.completed") {
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


