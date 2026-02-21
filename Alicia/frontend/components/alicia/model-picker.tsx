"use client"

import { useMemo, useState } from "react"

import { type ReasoningEffort } from "@/lib/alicia-types"
import { type CodexModel } from "@/lib/tauri-bridge"

import {
  formatCacheStatusLabel,
  ModelCatalogStatus,
  EffortStep,
  ModelPickerFallback,
  ModelPickerFooter,
  ModelPickerHeader,
  ModelStep,
} from "@/components/alicia/model-picker-parts"

interface ModelPickerProps {
  currentModel: string
  currentEffort: ReasoningEffort
  models: CodexModel[]
  loading: boolean
  error: string | null
  cachedAt?: number | null
  stale?: boolean
  onRetry: () => void
  onSelect: (modelId: string, effort: ReasoningEffort) => void
  onClose: () => void
}

export function ModelPicker({
  currentModel,
  currentEffort,
  models,
  loading,
  error,
  cachedAt,
  stale,
  onRetry,
  onSelect,
  onClose,
}: ModelPickerProps) {
  const [step, setStep] = useState<"model" | "effort">("model")
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)

  const selectedModel = useMemo(() => {
    if (selectedModelId) {
      const exact = models.find((model) => model.id === selectedModelId)
      if (exact) return exact
    }
    return (
      models.find((model) => model.id === currentModel) ||
      models.find((model) => model.isDefault) ||
      models[0] ||
      null
    )
  }, [currentModel, models, selectedModelId])

  const handleModelSelect = (model: CodexModel) => {
    setSelectedModelId(model.id)
    setStep("effort")
  }

  const handleEffortSelect = (effort: ReasoningEffort) => {
    if (selectedModel) {
      onSelect(selectedModel.id, effort)
    }
    onClose()
  }

  const hasCatalog = models.length > 0
  const showOnlyLoading = loading && !hasCatalog
  const showOnlyError = !loading && !hasCatalog
  const cacheStatusLabel = useMemo(() => formatCacheStatusLabel(cachedAt), [cachedAt])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md border border-panel-border rounded-lg bg-panel-bg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <ModelPickerHeader step={step} selectedModel={selectedModel} onClose={onClose} />

        <div className="max-h-80 overflow-y-auto">
          {showOnlyLoading || showOnlyError ? (
            <ModelPickerFallback loading={showOnlyLoading} error={error} onRetry={onRetry} />
          ) : (
            <div className="p-2">
              <ModelCatalogStatus
                loading={loading}
                stale={stale}
                error={error}
                cacheStatusLabel={cacheStatusLabel}
                onRetry={onRetry}
              />

              {step === "model" ? (
                <ModelStep
                  models={models}
                  selectedModel={selectedModel}
                  currentModel={currentModel}
                  onSelectModel={handleModelSelect}
                />
              ) : (
                <EffortStep
                  selectedModel={selectedModel}
                  currentEffort={currentEffort}
                  currentModel={currentModel}
                  onSelectEffort={handleEffortSelect}
                  onBack={() => setStep("model")}
                />
              )}
            </div>
          )}
        </div>

        <ModelPickerFooter />
      </div>
    </div>
  )
}
