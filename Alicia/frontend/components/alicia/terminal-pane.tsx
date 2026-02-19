import { type RefObject } from "react"
import { Plus, TerminalSquare, X } from "lucide-react"
import { type TerminalTab } from "@/lib/alicia-runtime-helpers"

interface TerminalPaneProps {
  tabs: TerminalTab[]
  activeTerminalId: number | null
  terminalContainerRef: RefObject<HTMLDivElement | null>
  onSelectTab: (id: number) => void
  onCloseTab: (id: number) => void
  onCreateTab: () => void
}

export function TerminalPane({
  tabs,
  activeTerminalId,
  terminalContainerRef,
  onSelectTab,
  onCloseTab,
  onCreateTab,
}: TerminalPaneProps) {
  return (
    <div className="h-full flex flex-col border-t border-panel-border bg-terminal-bg">
      <div className="h-9 border-b border-panel-border px-2 flex items-center gap-1 overflow-x-auto">
        <div className="inline-flex items-center gap-1 text-[10px] text-muted-foreground px-2">
          <TerminalSquare className="w-3.5 h-3.5 text-terminal-blue" />
          Terminal
        </div>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
              tab.id === activeTerminalId
                ? "border-terminal-blue/40 bg-terminal-blue/10 text-terminal-fg"
                : "border-transparent text-muted-foreground hover:bg-panel-bg"
            }`}
          >
            <span>{tab.title}</span>
            {!tab.alive && <span className="text-terminal-red">exit</span>}
            <span
              className="ml-1 hover:text-terminal-red"
              onClick={(ev) => {
                ev.stopPropagation()
                onCloseTab(tab.id)
              }}
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        ))}
        <button
          onClick={onCreateTab}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-panel-border text-muted-foreground hover:bg-panel-bg"
        >
          <Plus className="w-3.5 h-3.5" />
          New terminal
        </button>
      </div>
      <div className="px-3 py-1 text-[10px] text-muted-foreground/70 border-b border-panel-border/70">
        Click inside the terminal pane to run local shell commands.
      </div>
      <div className="flex-1 min-h-0 p-2">
        <div
          ref={terminalContainerRef}
          className="h-full w-full rounded border border-panel-border bg-terminal-bg"
        />
      </div>
    </div>
  )
}
