'use client'

import { useHydrated } from '@/lib/useHydrated'
import { useOnline } from '@/lib/useOnline'

/**
 * Single app-wide explanation that the data on screen is a saved snapshot.
 * Read-only controls are disabled by their owning screens via `useOnline()`.
 */
export default function OfflineBanner() {
  const hydrated = useHydrated()
  const online = useOnline()

  if (!hydrated || online) return null

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-(--amber-indicator)/30 bg-(--amber-indicator)/10 px-3 py-2 text-xs"
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-(--amber-indicator) shrink-0" />
      <span className="font-bold tracking-wide text-(--amber-indicator)">OFFLINE</span>
      <span className="text-gray-300">Showing last saved data. Changes are unavailable until you reconnect.</span>
    </div>
  )
}
