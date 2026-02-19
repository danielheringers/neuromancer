import { type MutableRefObject, type RefObject, useEffect } from "react"
import type { FitAddon } from "xterm-addon-fit"
import type { Terminal } from "xterm"

interface UseAliciaTerminalRuntimeOptions {
  initializing: boolean
  activeTerminalId: number | null
  activeTerminalRef: MutableRefObject<number | null>
  terminalContainerRef: RefObject<HTMLDivElement | null>
  terminalBuffersRef: MutableRefObject<Map<number, string>>
  xtermRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  onTerminalResize: (terminalId: number, cols: number, rows: number) => Promise<void>
  onTerminalWrite: (terminalId: number, data: string) => Promise<void>
}

export function useAliciaTerminalRuntime({
  initializing,
  activeTerminalId,
  activeTerminalRef,
  terminalContainerRef,
  terminalBuffersRef,
  xtermRef,
  fitAddonRef,
  onTerminalResize,
  onTerminalWrite,
}: UseAliciaTerminalRuntimeOptions) {
  useEffect(() => {
    activeTerminalRef.current = activeTerminalId
  }, [activeTerminalId, activeTerminalRef])

  useEffect(() => {
    if (initializing) {
      return
    }

    const container = terminalContainerRef.current
    if (!container) {
      return
    }
    let disposed = false
    let cleanup: (() => void) | undefined

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("xterm"),
        import("xterm-addon-fit"),
      ])
      if (disposed) {
        return
      }

      const xterm = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 13,
        scrollback: 5000,
        theme: {
          background: "#1e1f22",
          foreground: "#c5cfd9",
          cursor: "#39CC9B",
        },
      })
      const fitAddon = new FitAddon()
      xterm.loadAddon(fitAddon)
      xterm.open(container)
      fitAddon.fit()
      xterm.focus()
      xtermRef.current = xterm
      fitAddonRef.current = fitAddon

      const currentActiveTerminalId = activeTerminalRef.current
      if (currentActiveTerminalId != null) {
        const buffered = terminalBuffersRef.current.get(currentActiveTerminalId) ?? ""
        if (buffered) {
          xterm.write(buffered)
        }
        if (xterm.cols > 0 && xterm.rows > 0) {
          void onTerminalResize(currentActiveTerminalId, xterm.cols, xterm.rows)
        }
      }

      const dataDisposable = xterm.onData((data) => {
        const terminalId = activeTerminalRef.current
        if (terminalId == null) return
        void onTerminalWrite(terminalId, data)
      })

      const focusTerminal = () => {
        xterm.focus()
      }
      container.addEventListener("mousedown", focusTerminal)

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit()
        const terminalId = activeTerminalRef.current
        if (terminalId != null && xterm.cols > 0 && xterm.rows > 0) {
          void onTerminalResize(terminalId, xterm.cols, xterm.rows)
        }
      })
      resizeObserver.observe(container)

      cleanup = () => {
        container.removeEventListener("mousedown", focusTerminal)
        resizeObserver.disconnect()
        dataDisposable.dispose()
        xterm.dispose()
        xtermRef.current = null
        fitAddonRef.current = null
      }
    })()

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [
    initializing,
    activeTerminalRef,
    terminalContainerRef,
    terminalBuffersRef,
    xtermRef,
    fitAddonRef,
    onTerminalResize,
    onTerminalWrite,
  ])

  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm) return
    xterm.reset()
    if (activeTerminalId != null) {
      const text = terminalBuffersRef.current.get(activeTerminalId) ?? ""
      if (text) xterm.write(text)
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
      }
      xterm.focus()
      if (xterm.cols > 0 && xterm.rows > 0) {
        void onTerminalResize(activeTerminalId, xterm.cols, xterm.rows)
      }
    }
  }, [activeTerminalId, fitAddonRef, onTerminalResize, terminalBuffersRef, xtermRef])
}
