'use client'

import { useEffect, useRef } from 'react'
import { lockScroll } from '@/lib/scrollLock'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { useSensors, type SensorEvent } from '@/context/useSensors'
import { SENSORS, levelFor, formatNumber, type SensorId, type StatusLevel } from '@/lib/dashboardData'

const LEVEL_DOT: Record<string, string> = {
  WARNING: 'var(--amber-indicator)',
  CRITICAL: 'var(--red-indicator)',
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function EventRow({ event }: { event: SensorEvent }) {
  return (
    <div className={'p-3 flex items-start gap-3 hover:bg-white/5 transition-colors ' + (event.read ? '' : 'bg-(--secondary-color)/10')}>
      <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: LEVEL_DOT[event.level] }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-100">{event.title}</p>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{event.message}</p>
        <p className="text-xs text-gray-500 mt-1 tnum">{formatTime(event.timestamp)}</p>
      </div>
      {event.level === 'CRITICAL' && (
        <span className="text-xs font-extrabold px-2 py-0.5 rounded-full text-(--red-indicator) bg-(--red-indicator)/15 whitespace-nowrap">
          CRITICAL
        </span>
      )}
    </div>
  )
}

interface Props {
  show: boolean
  onClose: () => void
}

export default function NotificationModal({ show, onClose }: Props) {
  const { series, notifications, markAllRead } = useSensors()
  const panelRef = useRef<HTMLDivElement | null>(null)

  useFocusTrap(panelRef, show, onClose)

  useEffect(() => {
    if (!show) return
    markAllRead()
    return lockScroll()
  }, [show, markAllRead])

  if (!show) return null

  const activeCrossings: Array<{ id: string; level: StatusLevel; title: string; detail: string }> = (Object.keys(
    SENSORS,
  ) as SensorId[]).flatMap((id) => {
    const cfg = SENSORS[id]
    const point = series.find((s) => s.id === id)?.points.at(-1)
    if (!point) return []
    const status = levelFor(cfg, point.value)
    if (status.level === 'NOMINAL') return []
    return [
      {
        id,
        level: status.level,
        title: cfg.name,
        detail: `${formatNumber(point.value, cfg.decimals)} ${cfg.unit} — ${status.label}`,
      },
    ]
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-start">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-title"
        tabIndex={-1}
        className="relative z-10 w-full max-h-[70vh] lg:fixed lg:bottom-4 lg:left-25 lg:w-[50vh] lg:max-h-[60vh] bg-(--surface-solid) rounded-t-xl lg:rounded-lg flex flex-col drop-shadow-2xl shadow-xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <h2 id="notifications-title" className="font-bold text-base text-gray-100 tracking-tight">
            NOTIFICATIONS
          </h2>
          <button
            onClick={onClose}
            aria-label="Close notifications"
            className="btn-icon-light flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl leading-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 overscroll-contain">
          {activeCrossings.length > 0 && (
            <div className="p-3 border-b border-white/10">
              <p className="text-xs font-extrabold tracking-wide text-gray-500 mb-2">LIVE</p>
              <div className="flex flex-col gap-2">
                {activeCrossings.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs">
                    <span aria-hidden="true" className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: LEVEL_DOT[a.level] }} />
                      <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: LEVEL_DOT[a.level] }} />
                    </span>
                    <span className="font-bold text-gray-100">{a.title}</span>
                    <span className="text-gray-400 tnum">{a.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between p-3 pb-1">
            <p className="text-xs font-extrabold tracking-wide text-gray-500">EVENT LOG</p>
            {notifications.length > 0 && (
              <span className="text-xs font-bold text-gray-500">{notifications.length} recorded</span>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-gray-500">
              No push notifications received yet. Fire alerts will appear here when delivered to this browser.
            </p>
          ) : (
            <div className="divide-y divide-white/10">
              {notifications.map((n) => (
                <EventRow key={n.id} event={n} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
