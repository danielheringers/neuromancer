"use client"

import { ArrowUp, Paperclip, Slash } from "lucide-react"
import { useState, useRef, useEffect } from "react"

interface CommandInputProps {
  onSubmit: (value: string) => void
  disabled?: boolean
}

export function CommandInput({ onSubmit, disabled }: CommandInputProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [value])

  const handleSubmit = () => {
    if (value.trim() && !disabled) {
      onSubmit(value.trim())
      setValue("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="border-t border-panel-border bg-panel-bg p-3 shrink-0">
      <div className="flex items-end gap-2 rounded-lg border border-panel-border bg-terminal-bg px-3 py-2 focus-within:border-terminal-green/30 transition-colors">
        <div className="flex items-center gap-1 py-1">
          <span className="text-terminal-green text-sm font-bold select-none">{'>'}</span>
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Alicia anything..."
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-sm text-terminal-fg placeholder:text-muted-foreground/40 outline-none resize-none min-h-[24px] max-h-[200px] py-1 disabled:opacity-50"
        />
        <div className="flex items-center gap-1 py-1">
          <button className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <Paperclip className="w-4 h-4" />
          </button>
          <button className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <Slash className="w-4 h-4" />
          </button>
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
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
            {' send'}
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/50">Shift+Enter</kbd>
            {' newline'}
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/50">/</kbd>
            {' commands'}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/30">
          {value.length > 0 && `${value.length} chars`}
        </div>
      </div>
    </div>
  )
}
