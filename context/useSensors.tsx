'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SensorId, SensorSeries, StatusLevel, SensorConfig, ReportLog } from '@/lib/dashboardData'
import {
  SENSORS,
  HUMIDITY_CONFIG,
  formatValue,
  generateSeries,
  humidityFromTemp,
  levelFor,
  snapshotReadings,
  tickSeries,
} from '@/lib/dashboardData'

export type EventLevel = 'WARNING' | 'CRITICAL'
export type ToastLevel = EventLevel | 'SUCCESS'

export interface SensorEvent {
  id: string
  sensorId: SensorId
  level: EventLevel
  value: number
  unit: string
  title: string
  message: string
  timestamp: number
  read: boolean
}

export interface SensorToast {
  id: string
  level: ToastLevel
  title: string
  message: string
}

interface SensorsContextType {
  series: SensorSeries[]
  notifications: SensorEvent[]
  unreadCount: number
  markAllRead: () => void
  toasts: SensorToast[]
  dismissToast: (id: string) => void
  pushToast: (title: string, message: string) => void
  reports: ReportLog[]
}

const STORAGE_KEY = 'preventa.notifications'
const MAX_EVENTS = 50
const MAX_TOASTS = 3
const MAX_REPORTS = 3
const TOAST_LIFETIME_MS = 6000
const BASE_DATE = new Date(2026, 11, 1, 12, 0, 0)

const SensorsContext = createContext<SensorsContextType | undefined>(undefined)

function buildEvent(
  sensorId: SensorId,
  level: EventLevel,
  value: number,
  timestamp: number,
  read = false,
  cfg: SensorConfig = SENSORS[sensorId],
): SensorEvent {
  const valueStr = formatValue(value, cfg.decimals)
  return {
    id: `${sensorId}-${level}-${timestamp}-${Math.round(Math.random() * 1e5)}`,
    sensorId,
    level,
    value,
    unit: cfg.unit,
    title: `${cfg.name} ${level === 'CRITICAL' ? 'Critical Alert' : 'Warning'}`,
    message: `${cfg.name} at ${valueStr} ${cfg.unit} — ${level.toLowerCase()} threshold ${cfg.thresholdWarning} ${cfg.unit} exceeded`,
    timestamp,
    read,
  }
}

function seedEvents(): SensorEvent[] {
  const now = Date.now()
  const M = 60_000
  const mk = (sensorId: SensorId, level: EventLevel, value: number, minutesAgo: number): SensorEvent => {
    const e = buildEvent(sensorId, level, value, now - minutesAgo * M)
    return { ...e, id: `seed-${sensorId}`, read: true }
  }
  return [mk('dht22', 'WARNING', 48, 26), mk('mq7', 'CRITICAL', 118, 58), mk('acs712', 'WARNING', 7.2, 95)]
    .concat([{ ...buildEvent('dht22', 'WARNING', 72, now - 40 * M, true, HUMIDITY_CONFIG), id: 'seed-humidity' }])
}

function seedReports(): ReportLog[] {
  const now = Date.now()
  const M = 60_000
  const H = 3_600_000
  const cfgFor = (label: string) =>
    label === HUMIDITY_CONFIG.name ? HUMIDITY_CONFIG : (Object.values(SENSORS).find((c) => c.name === label) as SensorConfig)
  const mk = (timestamp: number, values: Record<string, number>): ReportLog => {
    const readings = Object.entries(values).map(([label, value]) => {
      const cfg = cfgFor(label)
      return { label, value, unit: cfg.unit, decimals: cfg.decimals, level: levelFor(cfg, value).level }
    })
    return { id: `seed-report-${timestamp}`, timestamp, readings }
  }
  return [
    mk(now - 5 * M, { 'Gas Concentration': 118, Temperature: 48.2, Humidity: 65, 'Power Usage': 6.5 }),
    mk(now - 38 * M, { 'Gas Concentration': 62, Temperature: 39.5, Humidity: 42, 'Power Usage': 7.4 }),
    mk(now - 2 * H, { 'Gas Concentration': 45, Temperature: 26.1, Humidity: 38, 'Power Usage': 4.2 }),
  ]
}

function tryBrowserNotify(title: string, body: string) {
  if (typeof window === 'undefined') return

  const Notify = window.Notification

  async function viaServiceWorker() {
    if (!('serviceWorker' in navigator)) return
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, { body })
      }
    } catch {
      /* SW unsupported in this context — toasts already visible */
    }
  }

  if (!Notify || typeof Notify !== 'function') {
    void viaServiceWorker()
    return
  }

  const show = () => {
    try {
      new Notify(title, { body })
    } catch {
      void viaServiceWorker()
    }
  }

  try {
    if (Notify.permission === 'granted') {
      show()
    } else if (Notify.permission === 'default' && typeof Notify.requestPermission === 'function') {
      void Notify.requestPermission().then((perm) => {
        if (perm === 'granted') show()
      })
    }
  } catch {
    void viaServiceWorker()
  }
}

export function SensorProvider({ children }: { children: ReactNode }) {
  const [series, setSeries] = useState<SensorSeries[]>(() => generateSeries(BASE_DATE))
  const [notifications, setNotifications] = useState<SensorEvent[]>(() => {
    if (typeof window === 'undefined') return seedEvents()
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as SensorEvent[]
        if (Array.isArray(parsed) && parsed.length) return parsed
      }
    } catch {
      /* ignore corrupted storage */
    }
    return seedEvents()
  })
  const [toasts, setToasts] = useState<SensorToast[]>([])
  const [reports, setReports] = useState<ReportLog[]>(() => seedReports())

  const processedRef = useRef<SensorSeries[] | null>(null)
  const prevStatusRef = useRef<Partial<Record<SensorId, StatusLevel>>>({})
  const prevHumidityRef = useRef<StatusLevel | undefined>(undefined)

  useEffect(() => {
    const id = setInterval(() => setSeries((prev) => tickSeries(prev)), 2000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (processedRef.current === series) return
    processedRef.current = series

    const fresh: SensorEvent[] = []
    const now = Date.now()
    ;(Object.keys(SENSORS) as SensorId[]).forEach((id) => {
      const cfg = SENSORS[id]
      const point = series.find((s) => s.id === id)?.points.at(-1)
      if (!point) return
      const status = levelFor(cfg, point.value).level
      const before = prevStatusRef.current[id]
      const escalated =
        before === undefined ||
        (before === 'NOMINAL' && status !== 'NOMINAL') ||
        (before === 'WARNING' && status === 'CRITICAL')
      if (status !== 'NOMINAL' && escalated) {
        fresh.push(buildEvent(id, status === 'CRITICAL' ? 'CRITICAL' : 'WARNING', point.value, now))
      }
      prevStatusRef.current[id] = status

      if (id === 'dht22') {
        const hValue = humidityFromTemp(point.value)
        const hStatus = levelFor(HUMIDITY_CONFIG, hValue).level
        const hBefore = prevHumidityRef.current
        const hEscalated =
          hBefore === undefined ||
          (hBefore === 'NOMINAL' && hStatus !== 'NOMINAL') ||
          (hBefore === 'WARNING' && hStatus === 'CRITICAL')
        if (hStatus !== 'NOMINAL' && hEscalated) {
          fresh.push(buildEvent('dht22', hStatus === 'CRITICAL' ? 'CRITICAL' : 'WARNING', hValue, now, false, HUMIDITY_CONFIG))
        }
        prevHumidityRef.current = hStatus
      }
    })

    if (fresh.length) {
      setNotifications((prev) => [...fresh, ...prev].slice(0, MAX_EVENTS))
      setToasts((prev) =>
        [...fresh.map((e) => ({ id: e.id, level: e.level, title: e.title, message: e.message })), ...prev].slice(0, MAX_TOASTS),
      )
      setReports((prev) =>
        [{ id: `report-${now}-${Math.round(Math.random() * 1e5)}`, timestamp: now, readings: snapshotReadings(series) }, ...prev].slice(0, MAX_REPORTS),
      )
      fresh.forEach((e) => tryBrowserNotify(e.title, e.message))
    }
  }, [series])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications))
    } catch {
      /* ignore storage failures */
    }
  }, [notifications])

  const markAllRead = useCallback(() => setNotifications((prev) => prev.map((n) => ({ ...n, read: true }))), [])

  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])

  const pushToast = useCallback((title: string, message: string) => {
    setToasts((prev) =>
      [
        { id: `toast-${Date.now()}-${Math.round(Math.random() * 1e5)}`, level: 'SUCCESS' as ToastLevel, title, message },
        ...prev,
      ].slice(0, MAX_TOASTS),
    )
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  useEffect(() => {
    if (!toasts.length) return
    const timers = toasts.map((t) => setTimeout(() => dismissToast(t.id), TOAST_LIFETIME_MS))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismissToast])

  const value = useMemo(
    () => ({ series, notifications, unreadCount, markAllRead, toasts, dismissToast, pushToast, reports }),
    [series, notifications, unreadCount, markAllRead, toasts, dismissToast, pushToast, reports],
  )

  return (
    <SensorsContext.Provider value={value}>
      {children}
      <div className="flex fixed bottom-5 left-5 right-5 sm:left-auto z-70 max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`${t.level === 'SUCCESS' ? 'flex' : 'hidden lg:flex'} items-start gap-3 rounded-xl bg-(--surface-solid) text-white ring-1 ring-white/10 px-4 py-3 shadow-2xl`}>
            <span
              className="mt-1 h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: t.level === 'SUCCESS' ? '#34D399' : t.level === 'CRITICAL' ? '#F87171' : '#FBBF24' }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">{t.title}</p>
              <p className="text-xs text-gray-300 mt-0.5 leading-relaxed">{t.message}</p>
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-gray-400 hover:text-white text-lg leading-none cursor-pointer"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </SensorsContext.Provider>
  )
}

export function useSensors() {
  const context = useContext(SensorsContext)
  if (!context) {
    throw new Error('useSensors must be used within a SensorProvider')
  }
  return context
}