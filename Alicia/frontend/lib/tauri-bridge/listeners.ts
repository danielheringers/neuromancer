import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type {
  CodexRuntimeEvent,
  CodexRuntimeTimelineEvent,
  CodexStructuredEventPayload,
  LifecycleEventPayload,
  StreamEventPayload,
  TerminalDataPayload,
  TerminalExitPayload,
  TerminalRuntimeEvent,
} from '@/lib/tauri-bridge/types'

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function normalizeStreamPayload(payload: unknown): StreamEventPayload {
  const source = (payload ?? {}) as Record<string, unknown>
  return {
    sessionId: asNumber(source.sessionId ?? source.session_id) ?? 0,
    chunk: String(source.chunk ?? ''),
  }
}

function normalizeLifecyclePayload(payload: unknown): LifecycleEventPayload {
  const source = (payload ?? {}) as Record<string, unknown>
  const status = String(source.status ?? 'error') as LifecycleEventPayload['status']
  return {
    status,
    sessionId: asNumber(source.sessionId ?? source.session_id),
    pid: asNumber(source.pid),
    exitCode: asNumber(source.exitCode ?? source.exit_code),
    message: source.message == null ? null : String(source.message),
  }
}

function normalizeTimelineEventEnvelope(payload: unknown): CodexRuntimeTimelineEvent {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      type: '__invalid__',
      reason: 'invalid-envelope',
      raw: payload,
    }
  }

  const source = payload as Record<string, unknown>
  const rawType = source.type
  if (typeof rawType !== 'string' || rawType.trim().length === 0) {
    return {
      type: '__invalid__',
      reason: 'missing-type',
      raw: payload,
    }
  }

  return {
    ...source,
    type: rawType.trim(),
  } as CodexRuntimeTimelineEvent
}

function normalizeStructuredEventPayload(payload: unknown): CodexStructuredEventPayload {
  const source = (payload ?? {}) as Record<string, unknown>
  return {
    sessionId: asNumber(source.sessionId ?? source.session_id) ?? 0,
    seq: asNumber(source.seq) ?? 0,
    event: normalizeTimelineEventEnvelope(source.event),
  }
}

function normalizeTerminalDataPayload(payload: unknown): TerminalDataPayload {
  const source = (payload ?? {}) as Record<string, unknown>
  return {
    terminalId: asNumber(source.terminalId ?? source.terminal_id) ?? 0,
    seq: asNumber(source.seq) ?? 0,
    chunk: String(source.chunk ?? ''),
  }
}

function normalizeTerminalExitPayload(payload: unknown): TerminalExitPayload {
  const source = (payload ?? {}) as Record<string, unknown>
  return {
    terminalId: asNumber(source.terminalId ?? source.terminal_id) ?? 0,
    seq: asNumber(source.seq) ?? 0,
    exitCode: asNumber(source.exitCode ?? source.exit_code),
  }
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return '__TAURI_INTERNALS__' in window
}

export async function listenToCodexEvents(
  onEvent: (event: CodexRuntimeEvent) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined
  }

  const unlistenFns: UnlistenFn[] = await Promise.all([
    listen('codex://stdout', (event) => {
      onEvent({ type: 'stdout', payload: normalizeStreamPayload(event.payload) })
    }),
    listen('codex://stderr', (event) => {
      onEvent({ type: 'stderr', payload: normalizeStreamPayload(event.payload) })
    }),
    listen('codex://lifecycle', (event) => {
      onEvent({ type: 'lifecycle', payload: normalizeLifecyclePayload(event.payload) })
    }),
    listen('codex://event', (event) => {
      onEvent({ type: 'event', payload: normalizeStructuredEventPayload(event.payload) })
    }),
  ])

  return () => {
    for (const unlisten of unlistenFns) {
      unlisten()
    }
  }
}

export async function listenToTerminalEvents(
  onEvent: (event: TerminalRuntimeEvent) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined
  }

  const unlistenFns: UnlistenFn[] = await Promise.all([
    listen('terminal://data', (event) => {
      onEvent({ type: 'data', payload: normalizeTerminalDataPayload(event.payload) })
    }),
    listen('terminal://exit', (event) => {
      onEvent({ type: 'exit', payload: normalizeTerminalExitPayload(event.payload) })
    }),
  ])

  return () => {
    for (const unlisten of unlistenFns) {
      unlisten()
    }
  }
}
