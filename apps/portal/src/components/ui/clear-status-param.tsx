'use client'

import { useEffect } from 'react'

/**
 * UX-09b — strip the one-shot notice params (status, ar) from the URL after render. The
 * server renders the success/error banner from ?status=… (and ?ar=… for the four-eyes
 * initiator link); leaving them in the address bar means a refresh or re-share re-shows a
 * stale banner. This runs after hydration and history.replaceState()s them away — the
 * already-rendered banner stays, but the URL is clean. Cursor/pagination params are kept.
 */
export function ClearStatusParam() {
  useEffect(() => {
    const url = new URL(window.location.href)
    let changed = false
    for (const k of ['status', 'ar']) {
      if (url.searchParams.has(k)) {
        url.searchParams.delete(k)
        changed = true
      }
    }
    if (changed) {
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }, [])
  return null
}
