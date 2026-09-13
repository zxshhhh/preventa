'use client'

import { useEffect } from 'react'
import { lockScroll } from '@/lib/scrollLock'
import { useSensors, type SensorEvent } from '@/context/useSensors'
import { SENSORS, HUMIDITY_CONFIG, levelFor, formatValue, humidityFromTemp, type SensorId, type StatusLevel } from '@/lib/dashboardData'

const LEVEL_DOT: Record<string, string> = {
  WARNING: '#FBBF24',
  CRITICAL: '#F87171',
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
      <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: LEVEL_DOT[event.level] }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-100">{event.title}</p>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{event.message}</p>
        <p className="text-xs text-gray-500 mt-1 font-mono">{formatTime(event.timestamp)}</p>
      </div>
      {event.level === 'CRITICAL' && (
        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full text-(--red-indicator) bg-(--red-indicator)/15 whitespace-nowrap">
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

  useEffect(() => {
    markAllRead()
    return lockScroll()
  }, [markAllRead])

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
        detail: `${formatValue(point.value, cfg.decimals)} ${cfg.unit} — ${status.label}`,
      },
    ]
  })

  const humidityPoint = series.find((s) => s.id === 'dht22')?.points.at(-1)
  if (humidityPoint) {
    const hValue = humidityFromTemp(humidityPoint.value)
    const hStatus = levelFor(HUMIDITY_CONFIG, hValue)
    if (hStatus.level !== 'NOMINAL') {
      activeCrossings.push({
        id: 'dht22-humidity',
        level: hStatus.level,
        title: 'Humidity',
        detail: `${formatValue(hValue, HUMIDITY_CONFIG.decimals)} ${HUMIDITY_CONFIG.unit} — ${hStatus.label}`,
      })
    }
  }

  const renderBody = (mobile: boolean) => (
    <>
      <div className="overflow-y-auto flex-1">
        {activeCrossings.length > 0 && (
          <div className="p-3 border-b border-white/10">
            <p className="text-[10px] font-extrabold tracking-wide text-gray-500 mb-2">LIVE</p>
            <div className="flex flex-col gap-2">
              {activeCrossings.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: LEVEL_DOT[a.level] }} />
                    <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: LEVEL_DOT[a.level] }} />
                  </span>
                  <span className="font-bold text-gray-100">{a.title}</span>
                  <span className="text-gray-400 font-mono">{a.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-3 pb-1">
          <p className="text-[10px] font-extrabold tracking-wide text-gray-500">EVENT LOG</p>
          {notifications.length > 0 && (
            <span className="text-[10px] font-bold text-gray-500">{notifications.length} recorded</span>
          )}
        </div>

        {notifications.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-gray-500">
            No sensor events recorded yet. Threshold crossings will appear here.
          </p>
        ) : (
          <div className="divide-y divide-white/10">
            {notifications.map((n) => (
              <EventRow key={n.id} event={n} />
            ))}
          </div>
        )}
      </div>
      <div className="p-3 text-center border-t border-white/10 shrink-0">
        <button className="btn-ghost btn-sm">{mobile ? 'View all history' : ''}</button>
      </div>
    </>
  )

  const header = (
    <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
      <h2 className="font-bold text-base text-gray-100 tracking-tight">NOTIFICATIONS</h2>
      <div className="flex items-center gap-3">
        <button onClick={markAllRead} className="btn-ghost btn-sm">Mark all read</button>
        <button onClick={onClose} className="btn-icon text-lg leading-none">&times;</button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-start">
      <div className="fixed inset-0" onClick={onClose} />
      <div className="lg:hidden relative z-10 w-full max-h-[70vh] bg-(--surface-solid) rounded-t-xl flex flex-col drop-shadow-2xl">
        {header}
        {renderBody(true)}
      </div>
      <div className={'hidden lg:flex fixed bottom-4 w-380px max-h-[60vh] bg-(--surface-solid) drop-shadow-2xl rounded-lg shadow-xl flex-col left-25'}>
        {header}
        {renderBody(false)}
      </div>
    </div>
  )
}