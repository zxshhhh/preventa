'use client'

import { useMemo, useEffect, useState } from 'react'
import LogMonthModal from '@/components/LogMonthModal'
import LogDetailModal from '@/components/LogDetailModal'
import { useHydrated } from '@/lib/useHydrated'
import type { LogEntry, MonthGroup } from '@/lib/logReport'
import { rawLogs, groupByMonth, daySummary, daysInMonth, firstWeekday, monthActivity } from '@/lib/logReport'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export default function LogConsole() {
  const hydrated = useHydrated()
  const [selectedMonth, setSelectedMonth] = useState<MonthGroup | null>(null)
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)

  const months = useMemo(() => groupByMonth(rawLogs), [])
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

  return (
    <main className="relative">
      <div className="flex flex-col items-start mb-6 gap-1">
        <h1 className="font-bold text-2xl">Report Logs</h1>
        <p className="text-sm text-gray-400">Logs event archive by month — select a month to view its logs.</p>
      </div>
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