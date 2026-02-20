"use client"

import { useMemo, useState } from "react"
import {
  X,
  AppWindow,
  Shield,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Loader2,
  LogOut,
  KeyRound,
  Globe,
  ExternalLink,
  AlertTriangle,
  Info,
  Gauge,
  Clock,
} from "lucide-react"

import {
  type AccountRateLimitSnapshot,
  type AccountRateLimitWindow,
  type AccountState,
  type ConnectedApp,
} from "@/lib/alicia-types"
import { codexAccountLoginStart, codexAccountLogout } from "@/lib/tauri-bridge"

interface AppsPanelProps {
  apps: ConnectedApp[]
  account: AccountState
  rateLimits: AccountRateLimitSnapshot | null
  rateLimitsByLimitId: Record<string, AccountRateLimitSnapshot>
  onClose: () => void
  onRefresh: (options?: {
    throwOnError?: boolean
    forceRefetch?: boolean
    refreshToken?: boolean
  }) => Promise<unknown>
}

function authModeLabel(mode: AccountState["authMode"]): string {
  if (mode === "api_key") return "API key"
  if (mode === "chatgpt") return "ChatGPT"
  if (mode === "chatgpt_auth_tokens") return "External tokens"
  if (mode === "none") return "Logged out"
  return "Unknown"
}

function authModeColor(mode: AccountState["authMode"]): string {
  if (mode === "chatgpt" || mode === "api_key" || mode === "chatgpt_auth_tokens") {
    return "text-terminal-green"
  }
  if (mode === "none") {
    return "text-terminal-gold"
  }
  return "text-muted-foreground"
}

function windowLabel(window: AccountRateLimitWindow | null | undefined): string {
  if (!window) {
    return "n/a"
  }

  const mins = window.windowDurationMins ?? 0
  if (mins === 300) {
    return "5h"
  }
  if (mins === 10080) {
    return "week"
  }
  if (mins > 0) {
    return `${mins}m`
  }
  return "window"
}

function resetLabel(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) {
    return "n/a"
  }

  const now = Math.floor(Date.now() / 1000)
  const remaining = Math.max(0, epochSeconds - now)
  if (remaining <= 0) {
    return "now"
  }

  const hours = Math.floor(remaining / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function UsageBar({ usedPercent }: { usedPercent: number }) {
  const clamped = Math.max(0, Math.min(100, usedPercent))
  const color = clamped < 55
    ? "bg-terminal-green"
    : clamped < 80
      ? "bg-terminal-gold"
      : "bg-terminal-red"

  return (
    <div className="h-1.5 w-full rounded bg-background/70 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function AppsPanel({
  apps,
  account,
  rateLimits,
  rateLimitsByLimitId,
  onClose,
  onRefresh,
}: AppsPanelProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [panelInfo, setPanelInfo] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState("")

  const rateLimitEntries = useMemo(() => {
    const byId = Object.values(rateLimitsByLimitId)
    if (byId.length > 0) {
      return byId
    }
    return rateLimits ? [rateLimits] : []
  }, [rateLimits, rateLimitsByLimitId])

  const runBusy = async (
    key: string,
    operation: () => Promise<string | null>,
  ) => {
    setBusyKey(key)
    setPanelError(null)
    setPanelInfo(null)

    try {
      const message = await operation()
      if (message) {
        setPanelInfo(message)
      }
    } catch (error) {
      setPanelError(String(error))
    } finally {
      setBusyKey(null)
    }
  }

  const handleRefresh = (forceRefetch = false) => {
    void runBusy(forceRefetch ? "refresh-force" : "refresh", async () => {
      await onRefresh({
        throwOnError: true,
        forceRefetch,
        refreshToken: false,
      })
      return forceRefetch ? "Apps/auth force-refetched" : "Apps/auth refreshed"
    })
  }

  const handleChatgptLogin = () => {
    void runBusy("login-chatgpt", async () => {
      const result = await codexAccountLoginStart({ type: "chatgpt" })
      await onRefresh({ throwOnError: false, refreshToken: true })
      if (result.authUrl) {
        return `ChatGPT login started: ${result.authUrl}`
      }
      return "ChatGPT login started"
    })
  }

  const handleApiKeyLogin = () => {
    void runBusy("login-apikey", async () => {
      const trimmed = apiKey.trim()
      if (!trimmed) {
        throw new Error("API key is required")
      }

      await codexAccountLoginStart({ type: "apiKey", apiKey: trimmed })
      setApiKey("")
      await onRefresh({ throwOnError: false, refreshToken: false })
      return "API key login applied"
    })
  }

  const handleLogout = () => {
    void runBusy("logout", async () => {
      await codexAccountLogout()
      await onRefresh({ throwOnError: false, refreshToken: false })
      return "Logged out"
    })
  }

  const isBusy = busyKey !== null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl border border-panel-border rounded-lg bg-panel-bg shadow-2xl flex flex-col max-h-[84vh]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AppWindow className="w-4 h-4 text-terminal-green shrink-0" />
            <span className="text-sm font-semibold text-terminal-fg">/apps</span>
            <span className="text-[10px] text-muted-foreground/50 ml-1 truncate">
              {apps.length} app(s)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleRefresh(false)}
              disabled={isBusy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-panel-border text-xs text-terminal-blue hover:text-terminal-blue/80 disabled:opacity-40"
            >
              {busyKey === "refresh" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Refresh
            </button>
            <button
              onClick={() => handleRefresh(true)}
              disabled={isBusy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-panel-border text-xs text-terminal-gold hover:text-terminal-gold/80 disabled:opacity-40"
            >
              {busyKey === "refresh-force" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Force
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#ffffff08] text-muted-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(panelError || panelInfo) && (
          <div className="px-3 pt-3 shrink-0 space-y-2">
            {panelError && (
              <div className="px-2.5 py-2 rounded border border-terminal-red/30 bg-terminal-red/10 text-[11px] text-terminal-red/90 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{panelError}</span>
              </div>
            )}
            {panelInfo && !panelError && (
              <div className="px-2.5 py-2 rounded border border-terminal-green/25 bg-terminal-green/10 text-[11px] text-terminal-green/90 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>{panelInfo}</span>
              </div>
            )}
          </div>
        )}

        <div className="overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
          <section className="border border-panel-border rounded-md p-3 bg-background/20 space-y-2">
            <div className="flex items-center gap-2">
              {account.authMode === "none" ? (
                <ShieldAlert className="w-4 h-4 text-terminal-gold" />
              ) : account.authMode === "unknown" ? (
                <Shield className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-terminal-green" />
              )}
              <span className="text-xs font-semibold text-terminal-fg uppercase tracking-wider">
                Account
              </span>
              <span className={`text-[11px] ml-auto ${authModeColor(account.authMode)}`}>
                {authModeLabel(account.authMode)}
              </span>
            </div>

            <div className="text-xs text-muted-foreground/80">
              requiresOpenAIAuth: {account.requiresOpenaiAuth ? "yes" : "no"}
            </div>

            {account.account?.email && (
              <div className="text-xs text-terminal-cyan">{account.account.email}</div>
            )}
            {account.account?.planType && (
              <div className="text-xs text-terminal-purple">plan: {account.account.planType}</div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={handleChatgptLogin}
                disabled={isBusy}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-terminal-blue/30 text-xs text-terminal-blue hover:text-terminal-blue/80 disabled:opacity-40"
              >
                {busyKey === "login-chatgpt" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Globe className="w-3 h-3" />
                )}
                Login ChatGPT
              </button>

              <button
                onClick={handleLogout}
                disabled={isBusy}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-terminal-red/30 text-xs text-terminal-red hover:text-terminal-red/80 disabled:opacity-40"
              >
                {busyKey === "logout" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <LogOut className="w-3 h-3" />
                )}
                Logout
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                type="password"
                placeholder="sk-..."
                className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded bg-background border border-panel-border text-terminal-fg"
              />
              <button
                onClick={handleApiKeyLogin}
                disabled={isBusy}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-terminal-green/30 text-xs text-terminal-green hover:text-terminal-green/80 disabled:opacity-40"
              >
                {busyKey === "login-apikey" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <KeyRound className="w-3 h-3" />
                )}
                Use API key
              </button>
            </div>
          </section>

          <section className="border border-panel-border rounded-md p-3 bg-background/20">
            <div className="flex items-center gap-2 mb-2">
              <Gauge className="w-4 h-4 text-terminal-gold" />
              <span className="text-xs font-semibold text-terminal-fg uppercase tracking-wider">
                Rate limits
              </span>
            </div>

            {rateLimitEntries.length === 0 ? (
              <div className="text-xs text-muted-foreground/60">No rate limit data</div>
            ) : (
              <div className="space-y-2">
                {rateLimitEntries.map((snapshot, index) => (
                  <div
                    key={`${snapshot.limitId ?? "limit"}-${index}`}
                    className="border border-panel-border/60 rounded p-2"
                  >
                    <div className="text-[11px] text-terminal-fg mb-1">
                      {snapshot.limitName ?? snapshot.limitId ?? "default"}
                    </div>

                    {[snapshot.primary, snapshot.secondary]
                      .filter((window): window is AccountRateLimitWindow => Boolean(window))
                      .map((window) => (
                        <div key={`${windowLabel(window)}-${window.resetsAt ?? 0}`} className="mb-2 last:mb-0">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground/70 mb-1">
                            <span>{windowLabel(window)}</span>
                            <span className="tabular-nums">used {window.usedPercent}%</span>
                          </div>
                          <UsageBar usedPercent={window.usedPercent} />
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50 mt-1">
                            <Clock className="w-2.5 h-2.5" />
                            resets in {resetLabel(window.resetsAt)}
                          </div>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="border border-panel-border rounded-md p-3 bg-background/20">
            <div className="flex items-center gap-2 mb-2">
              <AppWindow className="w-4 h-4 text-terminal-purple" />
              <span className="text-xs font-semibold text-terminal-fg uppercase tracking-wider">
                Apps
              </span>
            </div>

            {apps.length === 0 ? (
              <div className="text-xs text-muted-foreground/60">No apps available</div>
            ) : (
              <div className="space-y-1.5">
                {apps.map((app) => (
                  <div
                    key={app.id}
                    className="border border-panel-border/60 rounded px-2 py-1.5 flex items-center gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-terminal-fg truncate">{app.name}</div>
                      {app.description && (
                        <div className="text-[10px] text-muted-foreground/60 truncate">
                          {app.description}
                        </div>
                      )}
                    </div>

                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        app.isAccessible
                          ? "text-terminal-green border-terminal-green/25"
                          : "text-muted-foreground/60 border-panel-border"
                      }`}
                    >
                      {app.isAccessible ? "accessible" : "blocked"}
                    </span>

                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        app.isEnabled
                          ? "text-terminal-blue border-terminal-blue/25"
                          : "text-muted-foreground/60 border-panel-border"
                      }`}
                    >
                      {app.isEnabled ? "enabled" : "disabled"}
                    </span>

                    {app.installUrl && (
                      <a
                        href={app.installUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-terminal-cyan/80 hover:text-terminal-cyan"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
