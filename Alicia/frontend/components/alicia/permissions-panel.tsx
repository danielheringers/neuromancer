"use client"

import { X, Shield, ShieldCheck, ShieldOff, Check, AlertTriangle } from "lucide-react"
import { APPROVAL_PRESETS, type ApprovalPreset, type SandboxMode } from "@/lib/alicia-types"

interface PermissionsPanelProps {
  currentPreset: ApprovalPreset
  currentSandbox: SandboxMode
  onSelect: (preset: ApprovalPreset) => void
  onClose: () => void
}

const presetIcons: Record<ApprovalPreset, typeof Shield> = {
  "read-only": ShieldCheck,
  "auto": Shield,
  "full-access": ShieldOff,
}

const presetColors: Record<ApprovalPreset, string> = {
  "read-only": "terminal-blue",
  "auto": "terminal-green",
  "full-access": "terminal-red",
}

export function PermissionsPanel({ currentPreset, currentSandbox, onSelect, onClose }: PermissionsPanelProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg border border-panel-border rounded-lg bg-panel-bg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-terminal-green" />
            <span className="text-sm font-semibold text-terminal-fg">/permissions</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Presets */}
        <div className="p-3 flex flex-col gap-2">
          {(Object.keys(APPROVAL_PRESETS) as ApprovalPreset[]).map(key => {
            const preset = APPROVAL_PRESETS[key]
            const Icon = presetIcons[key]
            const color = presetColors[key]
            const isActive = key === currentPreset

            return (
              <button
                key={key}
                onClick={() => { onSelect(key); onClose() }}
                className={`flex items-start gap-3 w-full p-3 rounded-lg text-left transition-colors border ${
                  isActive
                    ? `bg-${color}/10 border-${color}/20`
                    : "hover:bg-[#b9bcc01c] border-transparent"
                }`}
                style={isActive ? {
                  backgroundColor: `color-mix(in srgb, var(--${color}) 10%, transparent)`,
                  borderColor: `color-mix(in srgb, var(--${color}) 20%, transparent)`,
                } : {}}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5`}
                  style={{ backgroundColor: `color-mix(in srgb, var(--${color}) 15%, transparent)` }}
                >
                  <Icon className="w-4 h-4" style={{ color: `var(--${color})` }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-terminal-fg">{preset.label}</span>
                    {isActive && <Check className="w-3.5 h-3.5 text-terminal-green" />}
                    {key === "full-access" && (
                      <span className="flex items-center gap-1 text-[10px] text-terminal-red bg-terminal-red/10 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Dangerous
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{preset.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground/60">
                    <span>approval: <span className="text-terminal-fg/70">{preset.approvalPolicy}</span></span>
                    <span>sandbox: <span className="text-terminal-fg/70">{preset.sandboxMode}</span></span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Current status */}
        <div className="px-4 py-2.5 border-t border-panel-border bg-background/30">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground/50">
            <span>Current sandbox: <span className="text-terminal-fg/60">{currentSandbox}</span></span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-background/50 border border-panel-border text-muted-foreground/50">Esc</kbd>
              {" close"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
