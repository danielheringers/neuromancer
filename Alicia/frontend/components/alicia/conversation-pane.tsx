import { type RefObject } from "react"
import { CommandInput } from "@/components/alicia/command-input"
import { TerminalMessage } from "@/components/alicia/terminal-message"
import { type Message, type RuntimeState } from "@/lib/alicia-runtime-helpers"

interface ConversationPaneProps {
  currentModelLabel: string
  reasoningEffort: string
  messages: Message[]
  isThinking: boolean
  pendingImages: string[]
  pendingMentions: string[]
  runtimeState: RuntimeState["state"]
  scrollRef: RefObject<HTMLDivElement | null>
  onSubmit: (value: string) => Promise<void>
  onSlashCommand: (command: string) => Promise<void>
  onAttachImage: () => Promise<void>
  onAttachMention: () => Promise<void>
  onRemoveImage: (index: number) => void
  onRemoveMention: (index: number) => void
}

export function ConversationPane({
  currentModelLabel,
  reasoningEffort,
  messages,
  isThinking,
  pendingImages,
  pendingMentions,
  runtimeState,
  scrollRef,
  onSubmit,
  onSlashCommand,
  onAttachImage,
  onAttachMention,
  onRemoveImage,
  onRemoveMention,
}: ConversationPaneProps) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-panel-border text-xs text-muted-foreground">
        Structured conversation | model {currentModelLabel} [{reasoningEffort}]
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
        onSubmit={onSubmit}
        onSlashCommand={onSlashCommand}
        onAttachImage={onAttachImage}
        onAttachMention={onAttachMention}
        onRemoveImage={onRemoveImage}
        onRemoveMention={onRemoveMention}
        pendingImages={pendingImages}
        pendingMentions={pendingMentions}
        disabled={runtimeState === "starting" || runtimeState === "stopping"}
      />
    </div>
  )
}


