'use client'

import { useEffect, useState } from 'react'
import { API_BASE_URL, isApiConfigured } from '@/lib/api/config'

type Status = 'checking' | 'online' | 'offline'

/**
 * Unauthenticated API-reachability indicator for the login page (rendered
 * below the login button). Pings the API base URL with a raw fetch (no JWT,
 * no auth retries): any HTTP response — even 401/403 — means the backend is
 * reachable (green); a network error or timeout means it's not (red).
 * Re-probed every 10s.
 */
export default function SystemStatus() {
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    let cancelled = false

    const probe = async () => {
      if (!isApiConfigured()) {
        if (!cancelled) setStatus('offline')
        return
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      try {
        const res = await fetch(`${API_BASE_URL}/`, {
          method: 'HEAD',
          cache: 'no-store',
          signal: controller.signal,
        })
        // Any well-formed HTTP response proves reachability, regardless of status code.
        if (!cancelled) setStatus('online')
        void res
      } catch {
        if (!cancelled) setStatus('offline')
      } finally {
        clearTimeout(timeout)
      }
    }

    // Same deferred-start pattern as other client calls: never inside the
    // synchronous effect body (react-hooks purity rule).
    const first = setTimeout(probe, 0)
    const id = setInterval(probe, 10_000)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])

  // Signal colors on the dark login surface: green ⇔ backend reachable,
  // red ⇔ unreachable, neutral slate while the first probe is in flight.
  const color =
    status === 'online'
      ? 'bg-(--green-indicator)'
      : status === 'offline'
        ? 'bg-(--red-indicator)'
        : 'bg-gray-500'
  const label = status === 'online' ? 'ONLINE' : status === 'offline' ? 'OFFLINE' : 'CHECKING'
  const textColor =
    status === 'online'
      ? 'text-(--green-indicator)'
      : status === 'offline'
        ? 'text-(--red-indicator)'
        : 'text-gray-400'
  const title =
    status === 'online'
      ? 'PREVENTA system is up'
      : status === 'offline'
        ? 'PREVENTA system is down'
        : 'Checking system status…'

  return (
    <div
      title={title}
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 select-none"
    >
      <p className="text-xs font-medium text-gray-300">System Status: </p>
      <span aria-hidden="true" className="relative flex h-2 w-2">
        {status === 'online' && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-(--green-indicator) opacity-75 animate-ping" />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
      </span>
      <span className={`text-xs font-extrabold tracking-widest ${textColor}`}>
        {label}
      </span>
    </div>
  )
}
