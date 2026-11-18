'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import LogMonthModal from '@/components/LogMonthModal'
import LogDetailModal from '@/components/LogDetailModal'
import { useHydrated } from '@/lib/useHydrated'
import { useSensors } from '@/context/useSensors'
import type { LogEntry, MonthGroup } from '@/lib/logReport'
import { groupByMonth, daySummary, daysInMonth, firstWeekday, monthActivity } from '@/lib/logReport'
import { fetchLogs } from '@/lib/api/reports'
import { isApiConfigured } from '@/lib/api/config'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const SKELETON_MONTHS = Array.from({ length: 12 }, (_, i) => i)
const SKELETON_DAY_CELLS = Array.from({ length: 35 }, (_, i) => i)

/** Minimum spacing between auto refreshes (focus/reconnect/tier transitions). */
const REFRESH_DEBOUNCE_MS = 3000

export default function LogConsole() {
  const hydrated = useHydrated()
  const { lastFusion } = useSensors()
  const [selectedMonth, setSelectedMonth] = useState<MonthGroup | null>(null)
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [yearKeys, setYearKeys] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const lastTierRef = useRef<number | null>(null)
  const lastRefreshRef = useRef(0)

  const months = useMemo(() => groupByMonth(logs, yearKeys), [logs, yearKeys])

  useEffect(() => {
    if (!hydrated || !isApiConfigured()) return
    let cancelled = false
    lastRefreshRef.current = Date.now()
    setLoading(true)
    setError(null)

    fetchLogs()
      .then((data) => {
        if (cancelled) return
        setLogs(data)
        setYearKeys(Array.from(new Set(data.map((l) => Number(l.timestamp.slice(0, 4))))).sort((a, b) => b - a))
        setError(null)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load event history — check your connection and retry.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [hydrated, reloadToken])

  // Refresh on screen focus and after reconnect.
  useEffect(() => {
    if (!hydrated || !isApiConfigured()) return
    const bump = () => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - lastRefreshRef.current < REFRESH_DEBOUNCE_MS) return
      lastRefreshRef.current = Date.now()
      setReloadToken((t) => t + 1)
    }
    window.addEventListener('focus', bump)
    document.addEventListener('visibilitychange', bump)
    window.addEventListener('online', bump)
    return () => {
      window.removeEventListener('focus', bump)
      document.removeEventListener('visibilitychange', bump)
      window.removeEventListener('online', bump)
    }
  }, [hydrated])

  // Refresh when active-device readings indicate a tier transition (crossing Tier 3).
  useEffect(() => {
    if (!hydrated || !isApiConfigured()) return
    const tier = lastFusion?.finalTier ?? null
    const prev = lastTierRef.current
    lastTierRef.current = tier
    if (prev === null || tier === null) return
    const crossed = (prev < 3 && tier >= 3) || (prev >= 3 && tier < 3)
    if (!crossed) return
    if (Date.now() - lastRefreshRef.current < REFRESH_DEBOUNCE_MS) return
    lastRefreshRef.current = Date.now()
    setReloadToken((t) => t + 1)
  }, [lastFusion, hydrated])

  const [today, setToday] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setToday(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedLog) setSelectedLog(null)
        else if (selectedMonth) setSelectedMonth(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedLog, selectedMonth])

  const openMonth = (month: MonthGroup) => {
    setSelectedLog(null)
    setSelectedMonth(month)
  }

  const showSkeleton = loading && months.length === 0 && !error

  return (
    <main className="relative">
      <div className="flex flex-col items-start mb-4 gap-1">
        <h1 className="font-bold text-2xl">Report Logs</h1>
        <p className="text-sm text-gray-400">Logs event archive by month. select a month to view its logs.</p>
        {loading && <span className="text-xs font-semibold text-amber-400">Loading live logs...</span>}
      </div>

      {error && (
        <div className="panel-card p-4 mb-5 flex flex-wrap items-center justify-between gap-3 border border-red-400/25 bg-red-400/10">
          <p className="text-xs font-semibold text-(--red-indicator)">{error}</p>
          <button onClick={() => setReloadToken((t) => t + 1)} className="btn-outline btn-sm">
            RETRY
          </button>
        </div>
      )}
      {hydrated && !loading && !error && months.length === 0 && (
        <div className="panel-card p-8 text-center text-sm text-gray-400">
          No report logs recorded yet.
        </div>
      )}
      {showSkeleton ? (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 sm:gap-5 auto-rows-fr lg:min-h-[calc(100vh-9rem)]"
          role="status"
          aria-label="Loading report logs"
        >
          {SKELETON_MONTHS.map((i) => (
            <div
              key={i}
              aria-hidden="true"
              className="bg-white/5 rounded-xl border-2 border-white/10 p-4 sm:p-5 flex flex-col gap-2 sm:gap-3 min-h-44 sm:min-h-48"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex flex-col gap-1.5">
                  <div className="skeleton-shine h-4 sm:h-5 w-20 rounded bg-white/10" />
                  <div className="skeleton-shine h-3 w-10 rounded bg-white/10" />
                </div>
                <div className="skeleton-shine h-6 w-16 rounded-full bg-white/10 shrink-0" />
              </div>
              <div className="flex-1 flex flex-col justify-start">
                <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mb-1">
                  {WEEKDAYS.map((_, wi) => (
                    <div key={wi} className="skeleton-shine h-2.5 w-2.5 sm:w-3 rounded bg-white/10 mx-auto" />
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                  {SKELETON_DAY_CELLS.map((di) => (
                    <div key={di} className="skeleton-shine h-6 sm:h-7 rounded-full bg-white/10" />
                  ))}
                </div>
              </div>
              <div className="mt-auto pt-1 flex items-center justify-between gap-2 border-t border-white/10">
                <div className="skeleton-shine h-3 w-24 rounded bg-white/10" />
                <div className="skeleton-shine h-3.5 w-3.5 rounded bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 sm:gap-5 auto-rows-fr lg:min-h-[calc(100vh-9rem)]">
          {months.map((m) => {
            const hasLogs = m.logs.length > 0
            const activity = monthActivity(m.logs)
            const monthIndex = Number(m.key.slice(5, 7)) - 1
            const totalDays = daysInMonth(m.year, monthIndex)
            const leadCells = firstWeekday(m.year, monthIndex)
            return (
              <button
                key={m.key}
                onClick={() => openMonth(m)}
                className={'bg-white/5 rounded-xl border-2 p-4 sm:p-5 flex flex-col gap-2 sm:gap-3 text-left transition-all duration-200 cursor-pointer min-h-44 sm:min-h-48 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ember-start)/40 ' + (hasLogs ? 'border-(--secondary-color) hover:shadow-lg hover:-translate-y-0.5' : 'border-white/10 opacity-60 hover:opacity-90')}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-bold text-base lg:text-lg leading-tight truncate">{m.name}</h2>
                    <p className="text-xs text-gray-400 font-semibold">{m.year}</p>
                  </div>
                  {hasLogs ? (
                    <span className="bg-ember text-white text-[10px] font-extrabold px-2 py-1 rounded-full whitespace-nowrap shrink-0">{m.logs.length} EVENTS</span>
                  ) : (
                    <span className="text-[10px] font-extrabold text-gray-500 px-2 py-1 rounded-full border border-white/15 whitespace-nowrap shrink-0">NO EVENTS</span>
                  )}
                </div>
                <div className="flex-1 flex flex-col justify-start">
                  <div className="grid grid-cols-7 gap-0.5 sm:gap-1 text-center mb-1">
                    {WEEKDAYS.map((w, i) => (
                      <span key={i} className="text-[9px] sm:text-[10px] font-extrabold text-gray-400">{w}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                    {Array.from({ length: leadCells }).map((_, i) => (
                      <span key={'blank-' + i} />
                    ))}
                    {Array.from({ length: totalDays }).map((_, i) => {
                      const d = i + 1
                      const active = activity[d]
                      const isToday = hydrated && today.getFullYear() === m.year && monthIndex === today.getMonth() && d === today.getDate()
                      return (
                        <span key={d} className={'flex flex-col items-center justify-center h-6 sm:h-7 rounded-full text-[11px] sm:text-xs ' + (active ? 'bg-(--secondary-color)/20 font-bold text-(--secondary-color)' : isToday ? 'bg-white/10 font-bold text-gray-100 ring-1 ring-(--secondary-color)/60' : 'text-gray-500')}>
                          {d}
                          <span className={'w-1 h-1 rounded-full ' + (active ? 'bg-(--secondary-color)' : 'opacity-0')} />
                        </span>
                      )
                    })}
                  </div>
                </div>
                <div className="mt-auto pt-1 flex items-center justify-between gap-2 border-t border-white/10">
                  <p className={'text-xs truncate ' + (hasLogs ? 'text-gray-400' : 'text-gray-500')}>{hasLogs ? daySummary(m.logs) : 'No events recorded'}</p>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--secondary-color)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </button>
            )
          })}
        </div>
      )}
      {selectedMonth && (
        <LogMonthModal
          monthName={selectedMonth.name}
          year={selectedMonth.year}
          logs={selectedMonth.logs}
          onClose={() => setSelectedMonth(null)}
          onSelectLog={setSelectedLog}
        />
      )}
      {selectedLog && selectedMonth && (
        <LogDetailModal
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </main>
  )
}
