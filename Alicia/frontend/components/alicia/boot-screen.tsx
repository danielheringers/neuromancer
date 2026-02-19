"use client"

export type BootStepStatus = "pending" | "running" | "success" | "warning" | "error"

export interface BootStep {
  id: string
  label: string
  detail?: string
  status: BootStepStatus
}

function statusColor(status: BootStepStatus): string {
  switch (status) {
    case "success":
      return "text-terminal-green"
    case "running":
      return "text-terminal-blue"
    case "warning":
      return "text-terminal-gold"
    case "error":
      return "text-terminal-red"
    default:
      return "text-muted-foreground/70"
  }
}

function statusSymbol(status: BootStepStatus): string {
  switch (status) {
    case "success":
      return "[ok]"
    case "running":
      return "[..]"
    case "warning":
      return "[! ]"
    case "error":
      return "[xx]"
    default:
      return "[  ]"
  }
}

interface BootScreenProps {
  steps: BootStep[]
}

export function BootScreen({ steps }: BootScreenProps) {
  const completedCount = steps.filter((step) => step.status !== "pending" && step.status !== "running").length
  const progress = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0
  const isComplete = completedCount === steps.length

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
      <div className="h-9 flex items-center px-4 bg-panel-bg border-b border-panel-border shrink-0">
        <div className="flex items-center gap-1.5 mr-4">
          <div className="w-2.5 h-2.5 rounded-full bg-terminal-red/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-terminal-gold/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-terminal-green/70" />
        </div>
        <span className="text-xs text-muted-foreground/60">alicia -- initializing</span>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 font-mono text-[13px]">
          <div className="text-terminal-green leading-relaxed whitespace-pre">     _    _     ___ ____ ___    _    </div>
          <div className="text-terminal-green leading-relaxed whitespace-pre">    / \\  | |   |_ _/ ___|_ _|  / \\   </div>
          <div className="text-terminal-green leading-relaxed whitespace-pre">   / _ \\ | |    | | |    | |  / _ \\  </div>
          <div className="text-terminal-green leading-relaxed whitespace-pre">  / ___ \\| |___ | | |___ | | / ___ \\ </div>
          <div className="text-terminal-green leading-relaxed whitespace-pre"> /_/   \\_\\_____|___\\____|___/_/   \\_\\</div>
          <div className="text-muted-foreground/70 leading-relaxed mt-2 mb-4">  bootstrap codex runtime</div>

          {steps.map((step) => (
            <div key={step.id} className="mb-1">
              <div className={`${statusColor(step.status)} leading-relaxed whitespace-pre`}>
                {statusSymbol(step.status)} {step.label}
                {step.status === "running" && (
                  <span className="inline-flex ml-0">
                    <span className="typing-dot">.</span>
                    <span className="typing-dot">.</span>
                    <span className="typing-dot">.</span>
                  </span>
                )}
              </div>
              {step.detail ? (
                <div className="pl-6 text-muted-foreground/60 leading-relaxed whitespace-pre-wrap">{step.detail}</div>
              ) : null}
            </div>
          ))}

          {!isComplete && (
            <span className="inline-block w-2 h-4 bg-terminal-green/80 cursor-blink mt-1" />
          )}
        </div>

        <div className="px-6 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              {isComplete ? "Initialization complete" : "Bootstrapping codex runtime"}
            </span>
            <span className="text-[10px] text-terminal-green tabular-nums">{progress}%</span>
          </div>
          <div className="h-1 bg-panel-bg rounded-full overflow-hidden border border-panel-border">
            <div
              className="h-full bg-terminal-green transition-all duration-300 ease-out rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-3 text-[10px] text-muted-foreground/40 font-mono">
            <span>steps: {completedCount}/{steps.length}</span>
            <span>{isComplete ? "ready" : "loading"}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
