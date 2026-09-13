'use client'

import { useEffect, useState } from 'react'
import { useHydrated } from '@/lib/useHydrated'

export default function DashboardHeader() {
  const hydrated = useHydrated()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const dateStr = now
    ? now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : ''
  const timeStr = now ? now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''

  return (
    <div>
      <h1 className="font-bold text-2xl text-gray-100">Activity</h1>
      {hydrated && (
        <div className="mt-1 text-xs text-gray-500 leading-tight">
          <p className="font-bold text-gray-300">{dateStr}</p>
          <p className="font-mono">{timeStr}</p>
        </div>
      )}
    </div>
  )
}