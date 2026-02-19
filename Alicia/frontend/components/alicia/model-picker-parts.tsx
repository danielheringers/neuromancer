import { Check, ChevronRight, Cpu, Loader2, RefreshCw, Sparkles, X } from "lucide-react"

import { type ReasoningEffort } from "@/lib/alicia-types"
import { type CodexModel } from "@/lib/tauri-bridge"

const effortLabels: Record<ReasoningEffort, { label: string; color: string; description: string }> = {
  none: { label: "None", color: "text-muted-foreground", description: "No reasoning chain" },
  minimal: { label: "Minimal", color: "text-muted-foreground", description: "Shortest reasoning" },
  low: { label: "Low", color: "text-terminal-blue", description: "Brief reasoning" },
  medium: { label: "Medium", color: "text-terminal-gold", description: "Balanced reasoning" },
  high: { label: "High", color: "text-terminal-green", description: "Detailed reasoning" },
  xhigh: { label: "X-High", color: "text-terminal-pink", description: "Maximum reasoning depth" },
}

export function effortMeta(effort: ReasoningEffort, description: string) {
  const base = effortLabels[effort]
  return {
    label: base?.label || effort,
    color: base?.color || "text-terminal-fg",
    description: description?.trim() || base?.description || "",
  }
}

export function formatCacheStatusLabel(cachedAt?: number | null) {
  if (!cachedAt) {
    return null
  }
  const seconds = Math.max(0, Math.floor((Date.now() - cachedAt) / 1000))
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface HeaderProps {
  step: "model" | "effort"
  selectedModel: CodexModel | null
  onClose: () => void
}

export function ModelPickerHeader({ step, selectedModel, onClose }: HeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
      <div className="flex items-center gap-2">
        <Cpu className="w-4 h-4 text-terminal-green" />
        <span className="text-sm font-semibold text-terminal-fg">
          {step === "model" ? "/models" : "/models > reasoning"}
        </span>
        {step === "effort" && selectedModel && (
          <span className="text-xs text-terminal-blue px-1.5 py-0.5 bg-terminal-blue/10 rounded">
            {selectedModel.displayName}
          </span>
        )}
      </div>
      <button onClick={onClose} className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

interface FallbackProps {
  loading: boolean
  error: string | null
  onRetry: () => void
}

export function ModelPickerFallback({ loading, error, onRetry }: FallbackProps) {
  if (loading) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-terminal-green" />
          Loading models from Codex runtime...
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <div className="text-xs text-muted-foreground">
        {error || "No models available from Codex runtime."}
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-panel-border text-xs text-terminal-fg hover:bg-[#b9bcc01c] transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Retry
      </button>
    </div>
  )
}

interface CatalogStatusProps {
  loading: boolean
  stale?: boolean
  error: string | null
  cacheStatusLabel: string | null
  onRetry: () => void
}

export function ModelCatalogStatus({
  loading,
  stale,
  error,
  cacheStatusLabel,
  onRetry,
}: CatalogStatusProps) {
  if (!loading && !stale && !error && !cacheStatusLabel) {
    return null
  }

  return (
    <div className="mb-2 rounded border border-panel-border bg-background/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">
      {loading ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin text-terminal-green" />
          Refreshing model catalog...
        </span>
      ) : (
        <span>
          {stale ? "Using cached catalog" : "Catalog synced"}
          {cacheStatusLabel ? ` • updated ${cacheStatusLabel}` : ""}
        </span>
      )}
      {error && (
        <div className="mt-1 inline-flex items-center gap-2">
          <span className="text-terminal-gold/90 truncate">{error}</span>
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded border border-panel-border px-1.5 py-0.5 text-[10px] text-terminal-fg hover:bg-[#b9bcc01c] transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

interface ModelStepProps {
  models: CodexModel[]
  selectedModel: CodexModel | null
  currentModel: string
  onSelectModel: (model: CodexModel) => void
}

export function ModelStep({ models, selectedModel, currentModel, onSelectModel }: ModelStepProps) {
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles className="w-3 h-3 text-muted-foreground/60" />
        <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
          Available models in Codex
        </span>
      </div>
      {models.map((model) => (
        <button
          key={model.id}
          onClick={() => onSelectModel(model)}
          className={`flex items-center justify-between w-full px-3 py-2.5 rounded text-left transition-colors ${
            model.id === selectedModel?.id
              ? "bg-terminal-green/10 border border-terminal-green/20"
              : "hover:bg-[#b9bcc01c] border border-transparent"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-terminal-fg truncate">{model.displayName}</span>
            {model.isDefault && (
              <span className="text-[11px] leading-none uppercase tracking-normal text-terminal-green bg-terminal-green/10 border border-terminal-green/20 px-0.5 py-0.5 rounded">
                default
              </span>
            )}
            {model.supportsPersonality && (
              <span className="text-[11px] leading-none uppercase tracking-normal text-terminal-purple bg-terminal-purple/10 border border-terminal-purple/20 px-0.5 py-0.5 rounded">
                personality
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {model.id === currentModel && <Check className="w-3.5 h-3.5 text-terminal-green" />}
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30" />
          </div>
        </button>
      ))}
      <div className="px-3 py-2 text-[10px] text-muted-foreground/40">
        {models.length} model{models.length === 1 ? "" : "s"} available
      </div>
    </>
  )
}

interface EffortStepProps {
  selectedModel: CodexModel | null
  currentEffort: ReasoningEffort
  currentModel: string
  onSelectEffort: (effort: ReasoningEffort) => void
  onBack: () => void
}

export function EffortStep({
  selectedModel,
  currentEffort,
  currentModel,
  onSelectEffort,
  onBack,
}: EffortStepProps) {
  return (
    <>
      <div className="px-3 py-2">
        <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Reasoning Effort</span>
      </div>

      {(selectedModel?.supportedReasoningEfforts || []).map((option) => {
        const effort = option.reasoningEffort
        const meta = effortMeta(effort, option.description)
        return (
          <button
            key={effort}
            onClick={() => onSelectEffort(effort)}
            className={`flex items-center justify-between w-full px-3 py-2.5 rounded text-left transition-colors ${
              effort === currentEffort && selectedModel?.id === currentModel
                ? "bg-terminal-green/10 border border-terminal-green/20"
                : "hover:bg-[#b9bcc01c] border border-transparent"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${meta.color} bg-current`} />
              <div>
                <span className={`text-sm ${meta.color}`}>{meta.label}</span>
                <p className="text-[10px] text-muted-foreground/50">{meta.description}</p>
              </div>
            </div>
            {effort === currentEffort && selectedModel?.id === currentModel && (
              <Check className="w-3.5 h-3.5 text-terminal-green" />
            )}
          </button>
        )
      })}

      {selectedModel && selectedModel.supportedReasoningEfforts.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          This model has no reasoning options available.
        </div>
      )}

      <button
        onClick={onBack}
        className="mt-2 flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-terminal-fg transition-colors"
      >
        <ChevronRight className="w-3 h-3 rotate-180" />
        Back to models
      </button>
    </>
  )
}

export function ModelPickerFooter() {
  return (
    <div className="px-4 py-2.5 border-t border-panel-border bg-background/30">
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground/40">
        <span>
          <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/50">Esc</kbd>
          {" close"}
        </span>
        <span>
          <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/50">Enter</kbd>
          {" select"}
        </span>
      </div>
    </div>
  )
}
