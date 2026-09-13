'use client'

import { useEffect } from 'react'
import { lockScroll } from '@/lib/scrollLock'
import type { LogEntry } from '@/lib/logReport'
import { formatTime, formatFullDate, statusClass } from '@/lib/logReport'

interface Props {
  monthName: string
  year: number
  logs: LogEntry[]
  onClose: () => void
  onSelectLog: (log: LogEntry) => void
}

export default function LogMonthModal({ monthName, year, logs, onClose, onSelectLog }: Props) {
  useEffect(() => lockScroll(), [])

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      <div className="fixed inset-0" onClick={onClose} />
      <div className="relative z-10 w-full lg:w-180 max-w-3xl max-h-[80vh] lg:max-h-[75vh] bg-(--surface-solid) rounded-t-xl lg:rounded-xl drop-shadow-2xl flex flex-col overflow-hidden">
        <div className="bg-ember text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-lg leading-tight">{monthName} {year}</h2>
            <p className="text-xs opacity-80 mt-0.5">{logs.length} {logs.length === 1 ? 'EVENT' : 'EVENTS'}</p>
          </div>
          <button onClick={onClose} className="btn-icon-light text-2xl leading-none">&times;</button>
        </div>

        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--info-indicator)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4l3 8 4-16 3 8h4" />
            </svg>
            <p className="text-gray-400 font-bold">No events yet for {monthName} {year}</p>
            <p className="text-xs text-gray-500">Log events will appear here once recorded.</p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 divide-y divide-white/10">
            {logs.map((log, i) => (
              <button
                key={i}
                onClick={() => onSelectLog(log)}
                className="w-full px-5 py-3.5 flex items-center justify-between gap-4 text-left cursor-pointer hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:bg-white/10"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-100">{formatFullDate(log.timestamp)}</p>
                  <p className="text-xs font-mono text-gray-400 mt-0.5">{formatTime(log.timestamp)}</p>
                </div>
                <span className={'shrink-0 text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ' + statusClass(log.status)}>
                  {log.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}