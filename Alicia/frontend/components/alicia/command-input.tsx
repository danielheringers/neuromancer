"use client"

import { ArrowUp, Paperclip, ImagePlus, AtSign, X } from "lucide-react"
import { useState, useRef, useEffect, useCallback } from "react"
import { CommandPalette } from "./command-palette"

interface CommandInputProps {
  onSubmit: (value: string) => Promise<void> | void
  onSlashCommand: (command: string) => Promise<void> | void
  onAttachImage?: () => Promise<void> | void
  onAttachMention?: () => Promise<void> | void
  onRemoveImage?: (index: number) => void
  onRemoveMention?: (index: number) => void
  pendingImages?: string[]
  pendingMentions?: string[]
  disabled?: boolean
}

function fileLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const segments = normalized.split("/").filter(Boolean)
  return segments.at(-1) ?? path
}

export function CommandInput({
  onSubmit,
  onSlashCommand,
  onAttachImage,
  onAttachMention,
  onRemoveImage,
  onRemoveMention,
  pendingImages = [],
  pendingMentions = [],
  disabled,
}: CommandInputProps) {
  const [value, setValue] = useState("")
  const [showPalette, setShowPalette] = useState(false)
  const [paletteFilter, setPaletteFilter] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [value])

  useEffect(() => {
    if (value.startsWith("/")) {
      setShowPalette(true)
      setPaletteFilter(value)
    } else {
      setShowPalette(false)
      setPaletteFilter("")
    }
  }, [value])

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || disabled) {
      return
    }

    const hasText = value.trim().length > 0
    const hasAttachments = pendingImages.length > 0 || pendingMentions.length > 0

    if (!hasText && !hasAttachments) {
      return
    }

    setIsSubmitting(true)

    try {
      if (value.startsWith("/")) {
        await onSlashCommand(value.trim())
      } else {
        await onSubmit(value.trim())
      }
      setValue("")
      setShowPalette(false)
    } finally {
      setIsSubmitting(false)
    }
  }, [
    disabled,
    isSubmitting,
    onSlashCommand,
    onSubmit,
    pendingImages.length,
    pendingMentions.length,
    value,
  ])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !showPalette) {
      e.preventDefault()
      void handleSubmit()
    }

    if (e.key === "Escape" && showPalette) {
      setShowPalette(false)
      setValue("")
    }
  }

  const handleCommandSelect = (command: string) => {
    setShowPalette(false)
    setValue("")
    void onSlashCommand(command)
  }

  const getPalettePosition = () => {
    if (!containerRef.current) {
      return { bottom: 80, left: 16 }
    }

    const rect = containerRef.current.getBoundingClientRect()
    return {
      bottom: window.innerHeight - rect.top + 8,
      left: rect.left,
    }
  }

  const isDisabled = Boolean(disabled || isSubmitting)

  return (
    <div ref={containerRef} className="border-t border-panel-border bg-panel-bg p-3 shrink-0">
      {showPalette && (
        <CommandPalette
          filter={paletteFilter}
          onSelect={handleCommandSelect}
          onClose={() => {
            setShowPalette(false)
            setValue("")
          }}
          position={getPalettePosition()}
        />
      )}

      {(pendingImages.length > 0 || pendingMentions.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {pendingMentions.map((path, index) => (
            <span
              key={`mention-${path}-${index}`}
              className="inline-flex items-center gap-1 rounded border border-terminal-blue/30 bg-terminal-blue/10 px-2 py-1 text-[10px] text-terminal-blue"
            >
              <AtSign className="h-3 w-3" />
              {fileLabel(path)}
              {onRemoveMention && (
                <button onClick={() => onRemoveMention(index)} className="hover:text-terminal-fg">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}

          {pendingImages.map((path, index) => (
            <span
              key={`image-${path}-${index}`}
              className="inline-flex items-center gap-1 rounded border border-terminal-purple/30 bg-terminal-purple/10 px-2 py-1 text-[10px] text-terminal-purple"
            >
              <ImagePlus className="h-3 w-3" />
              {fileLabel(path)}
              {onRemoveImage && (
                <button onClick={() => onRemoveImage(index)} className="hover:text-terminal-fg">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-lg border border-panel-border bg-terminal-bg px-3 py-2 focus-within:border-terminal-green/30 transition-colors">
        <div className="flex items-center gap-1 py-1">
          <span className="text-terminal-green text-sm font-bold select-none">{">"}</span>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Alicia anything... or type / for commands"
          disabled={isDisabled}
          rows={1}
          className="flex-1 bg-transparent text-sm text-terminal-fg placeholder:text-muted-foreground/40 outline-none resize-none min-h-[24px] max-h-[200px] py-1 disabled:opacity-50"
        />

        <div className="flex items-center gap-1 py-1">
          <button
            onClick={() => void onAttachMention?.()}
            className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            title="Attach file"
            disabled={isDisabled}
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <button
            onClick={() => void onAttachImage?.()}
            className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            title="Attach image"
            disabled={isDisabled}
          >
            <ImagePlus className="w-4 h-4" />
          </button>

          <button
            onClick={() => void onAttachMention?.()}
            className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            title="Mention file or symbol"
            disabled={isDisabled}
          >
            <AtSign className="w-4 h-4" />
          </button>

          <button
            onClick={() => void handleSubmit()}
            disabled={isDisabled || (!value.trim() && pendingImages.length === 0 && pendingMentions.length === 0)}
            className="p-1 rounded bg-terminal-green/20 text-terminal-green hover:bg-terminal-green/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors ml-1"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2 px-1">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/40">
          <span>
            <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/50">Enter</kbd>
            {" send"}
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/50">Shift+Enter</kbd>
            {" newline"}
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/50">/</kbd>
            {" commands"}
          </span>
        </div>

        <div className="text-[10px] text-muted-foreground/30">{value.length > 0 && `${value.length} chars`}</div>
      </div>
    </div>
  )
}
