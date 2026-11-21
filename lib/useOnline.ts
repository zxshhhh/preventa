'use client'

import { useEffect, useState } from 'react'

/**
 * Browser connectivity as a React value. Starts `true` on the server and the
 * first client render (matching the prerendered HTML), then follows the real
 * navigator state and online/offline events.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}

/** Short, locale-formatted timestamp used by the offline/stale-data labels. */
export function formatSavedAt(savedAt: number | null | undefined): string {
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return ''
  return new Date(savedAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
