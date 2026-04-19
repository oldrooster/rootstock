import { createContext, useCallback, useContext, useRef, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType) => void
  removeToast: (id: number) => void
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
})

let _nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    clearTimeout(timers.current[id])
    delete timers.current[id]
  }, [])

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = _nextId++
    setToasts(prev => [...prev, { id, message, type }])
    timers.current[id] = setTimeout(() => removeToast(id), 5000)
  }, [removeToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

// ---------------------------------------------------------------------------
// Toast container — rendered once at the app level
// ---------------------------------------------------------------------------

const COLORS: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: '#0f1f18', border: '#34d399', icon: '✓' },
  error:   { bg: '#1f0f0f', border: '#f87171', icon: '✕' },
  warning: { bg: '#1f1a0f', border: '#fbbf24', icon: '!' },
  info:    { bg: '#0f1020', border: '#7c9ef8', icon: 'i' },
}

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div style={{
      position: 'fixed',
      top: '1rem',
      right: '1rem',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      maxWidth: '360px',
      width: '90vw',
    }}>
      {toasts.map(toast => {
        const c = COLORS[toast.type]
        return (
          <div
            key={toast.id}
            style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.6rem',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              animation: 'slideIn 0.2s ease',
            }}
          >
            <span style={{ color: c.border, fontWeight: 700, flexShrink: 0, fontSize: '0.9rem' }}>
              {c.icon}
            </span>
            <span style={{ color: '#e0e0e0', fontSize: '0.88rem', flex: 1 }}>{toast.message}</span>
            <button
              onClick={() => onRemove(toast.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8890a0',
                cursor: 'pointer',
                fontSize: '0.85rem',
                padding: 0,
                flexShrink: 0,
              }}
            >✕</button>
          </div>
        )
      })}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
