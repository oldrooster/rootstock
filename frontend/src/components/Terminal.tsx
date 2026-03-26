import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  wsPath: string
  title: string
  onClose: () => void
}

export default function Terminal({ wsPath, title, onClose }: TerminalProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!termRef.current) return

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0f0f1a',
        foreground: '#e0e0e0',
        cursor: '#7c9ef8',
        selectionBackground: 'rgba(124, 158, 248, 0.3)',
      },
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(termRef.current)
    fitAddon.fit()
    xtermRef.current = xterm

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}${wsPath}`)
    wsRef.current = ws

    ws.onopen = () => {
      const dims = fitAddon.proposeDimensions()
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
      }
    }

    ws.onmessage = (event) => {
      xterm.write(event.data)
    }

    ws.onclose = () => {
      xterm.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n')
    }

    ws.onerror = () => {
      xterm.write('\r\n\x1b[31mWebSocket error.\x1b[0m\r\n')
    }

    xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    const handleResize = () => {
      fitAddon.fit()
      const dims = fitAddon.proposeDimensions()
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
      }
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(termRef.current)

    xterm.focus()

    return () => {
      resizeObserver.disconnect()
      ws.close()
      xterm.dispose()
    }
  }, [wsPath])

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.5rem 1rem',
        background: '#1a1a2e',
        borderBottom: '1px solid #2a2a3e',
      }}>
        <span style={{ color: '#e0e0e0', fontSize: '0.9rem', fontWeight: 600 }}>
          SSH: {title}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: '1px solid #2a2a3e',
            color: '#b0b8d0',
            borderRadius: '4px',
            padding: '0.25rem 0.75rem',
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Close
        </button>
      </div>
      <div
        ref={termRef}
        style={{ flex: 1, padding: '4px' }}
      />
    </div>
  )
}
