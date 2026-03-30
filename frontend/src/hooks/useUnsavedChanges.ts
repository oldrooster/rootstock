import { useEffect } from 'react'

/**
 * Prompt the user when navigating away with unsaved changes.
 * Uses beforeunload for browser close/refresh and
 * patches pushState/popstate for in-app SPA navigation.
 */
export function useUnsavedChanges(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return

    // Browser close/refresh
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    // Intercept in-app navigation (pushState)
    const origPushState = history.pushState.bind(history)
    history.pushState = function (...args) {
      const ok = window.confirm('You have unsaved changes. Leave without saving?')
      if (ok) {
        origPushState(...args)
      }
    }

    // Back/forward button
    const onPopState = (e: PopStateEvent) => {
      const ok = window.confirm('You have unsaved changes. Leave without saving?')
      if (!ok) {
        // Push back to current URL to undo the back navigation
        history.pushState = origPushState
        history.pushState(null, '', window.location.href)
        history.pushState = function (...args2) {
          const ok2 = window.confirm('You have unsaved changes. Leave without saving?')
          if (ok2) {
            origPushState(...args2)
          }
        }
      }
    }
    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('popstate', onPopState)
      history.pushState = origPushState
    }
  }, [isDirty])
}
