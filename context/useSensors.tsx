'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SensorId, SensorSeries, SeriesPoint } from '@/lib/dashboardData'
import { isApiConfigured } from '@/lib/api/config'
import { fetchEvents } from '@/lib/api/events'
import { fetchLatestSeries, fetchRangeRaw } from '@/lib/api/telemetry'
import { connectLiveTelemetry, type SensorPoint, type FusionData } from '@/lib/api/realtime'
import { refreshAccessToken } from '@/lib/api/auth'
import { isPushConfigured, onForegroundPush } from '@/lib/api/push'

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
  /** Fusion fields from the most recent live reading — used to react to tier transitions. */
  lastFusion: FusionData | null
  notifications: SensorEvent[]
  unreadCount: number
  markAllRead: () => void
  toasts: SensorToast[]
  dismissToast: (id: string) => void
  pushToast: (title: string, message: string) => void
}

const STORAGE_KEY = 'preventa.notifications.v2'
const MAX_EVENTS = 50
const MAX_TOASTS = 3
const TOAST_LIFETIME_MS = 6000
const EVENT_POLL_MS = 5000
const BACKFILL_POLL_MS = 30_000

const SensorsContext = createContext<SensorsContextType | undefined>(undefined)

function loadStoredEvents(): SensorEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SensorEvent[]
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    /* ignore corrupted storage */
  }
  return []
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
  const [series, setSeries] = useState<SensorSeries[]>([])
  const [lastFusion, setLastFusion] = useState<FusionData | null>(null)
  const [notifications, setNotifications] = useState<SensorEvent[]>(loadStoredEvents)
  const [toasts, setToasts] = useState<SensorToast[]>([])

  const seenEventsRef = useRef<Set<string>>(new Set())
  const eventsSeededRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const wsReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const buffersRef = useRef<Record<SensorId, SeriesPoint[]>>({
    mq7: [],
    dht22: [],
    acs712: [],
    humidity: [],
  })

  const MAX_BUFFER = 2000

  function pushPoint(id: SensorId, point: SeriesPoint) {
    const buf = buffersRef.current[id]
    if (!buf) return
    buf.push(point)
    if (buf.length > MAX_BUFFER) buf.shift()
  }

  function rebuildSeries() {
    const out: SensorSeries[] = []
    for (const id of Object.keys(buffersRef.current) as SensorId[]) {
      out.push({ id, points: [...buffersRef.current[id]] })
    }
    setSeries(out)
  }

  useEffect(() => {
    if (!isApiConfigured()) return

    let cancelled = false

    async function connectWS() {
      const token = localStorage.getItem('preventa.token')
      if (!token) return

      const ws = connectLiveTelemetry(
        token,
        (points: SensorPoint, fusion: FusionData) => {
          if (cancelled) return
          pushPoint('mq7', points.mq7)
          pushPoint('dht22', points.dht22)
          pushPoint('acs712', points.acs712)
          pushPoint('humidity', points.humidity)
          setLastFusion(fusion)
          rebuildSeries()
        },
        (code) => {
          if (cancelled) return
          if (code === 4401) {
            void refreshAccessToken().then((newToken) => {
              if (newToken && !cancelled) connectWS()
            })
          } else {
            scheduleReconnect()
          }
        }
      )
      wsRef.current = ws
    }

    function scheduleReconnect() {
      if (wsReconnectTimeoutRef.current) clearTimeout(wsReconnectTimeoutRef.current)
      wsReconnectTimeoutRef.current = setTimeout(() => {
        if (!cancelled) connectWS()
      }, 3000)
    }

    connectWS()

    async function backfill() {
      if (cancelled) return
      try {
        const latest = await fetchLatestSeries()
        if (cancelled) return
        const wsOpen = typeof WebSocket !== 'undefined' && wsRef.current?.readyState === WebSocket.OPEN
        let changed = false
        for (const s of latest) {
          if (!s.points.length) continue
          if (wsOpen && buffersRef.current[s.id].length) continue
          buffersRef.current[s.id] = [...s.points].slice(-MAX_BUFFER)
          changed = true
        }
        if (changed) rebuildSeries()
      } catch {
        /* keep local buffer */
      }
    }

    void backfill()
    const backfillId = setInterval(backfill, BACKFILL_POLL_MS)

    // One-time LIVE seed: fill the buffers with the backend's last hour so the
    // dashboard's LIVE chart opens with a full span. Everything after this comes
    // purely from the WebSocket stream — this is the only time-based fetch for LIVE.
    async function seedHour() {
      try {
        const hour = await fetchRangeRaw('1H')
        if (cancelled) return
        let changed = false
        for (const s of hour) {
          if (!s.points.length) continue
          const buf = buffersRef.current[s.id]
          const lastLiveT = buf.length ? buf[buf.length - 1].t ?? 0 : 0
          // Keep any live WS points newer than the seed's tail (race: WS may
          // have delivered readings while the fetch was in flight).
          const fresh = buf.filter((p) => typeof p.t === 'number' && p.t > lastLiveT)
          // Seed is ascending; append preserved live tail so order is maintained.
          const merged = [...s.points.filter((p) => typeof p.t === 'number' && (!lastLiveT || p.t <= lastLiveT)), ...fresh]
          if (merged.length) {
            buffersRef.current[s.id] = merged.slice(-MAX_BUFFER)
            changed = true
          }
        }
        if (changed) rebuildSeries()
      } catch {
        /* seed is best-effort — live stream continues regardless */
      }
    }

    void seedHour()

    return () => {
      cancelled = true
      if (wsRef.current) wsRef.current.close()
      if (wsReconnectTimeoutRef.current) clearTimeout(wsReconnectTimeoutRef.current)
      clearInterval(backfillId)
    }
  }, [])

  useEffect(() => {
    if (!isApiConfigured()) return
    let cancelled = false

    const poll = async () => {
      try {
        const events = await fetchEvents(MAX_EVENTS)
        if (cancelled || !events.length) return

        if (!eventsSeededRef.current) {
          eventsSeededRef.current = true
          events.forEach((e) => seenEventsRef.current.add(e.id))
          setNotifications((prev) => {
            const known = new Set(prev.map((n) => n.id))
            const fresh = events.filter((e) => !known.has(e.id))
            return fresh.length ? [...fresh, ...prev].slice(0, MAX_EVENTS) : prev
          })
          return
        }

        const fresh = events.filter((e) => !seenEventsRef.current.has(e.id))
        if (!fresh.length) return
        fresh.forEach((e) => seenEventsRef.current.add(e.id))
        setNotifications((prev) => [...fresh, ...prev].slice(0, MAX_EVENTS))
        setToasts((prev) =>
          [...fresh.map((e) => ({ id: e.id, level: e.level, title: e.title, message: e.message })), ...prev].slice(0, MAX_TOASTS),
        )
        fresh.forEach((e) => tryBrowserNotify(e.title, e.message))
      } catch {
        /* keep local history if the events fetch fails */
      }
    }

    void poll()
    const id = setInterval(poll, EVENT_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications))
    } catch {
      /* ignore storage failures */
    }
  }, [notifications])

  // Foreground Firebase push (Phase 8): render incoming FCM messages through the same
  // toast + browser-notification pipeline. Only active after the owner enables push.
  useEffect(() => {
    if (!isApiConfigured()) return
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    void (async () => {
      if (!isPushConfigured()) return
      unsubscribe = await onForegroundPush((alert: PushAlert) => {
        if (cancelled) return
        setToasts((prev) =>
          [
            {
              id: `push-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
              level: alert.level ?? 'WARNING',
              title: alert.title,
              message: alert.body,
            },
            ...prev,
          ].slice(0, MAX_TOASTS),
        )
        tryBrowserNotify(alert.title, alert.body)
      })
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

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
    () => ({ series, lastFusion, notifications, unreadCount, markAllRead, toasts, dismissToast, pushToast }),
    [series, lastFusion, notifications, unreadCount, markAllRead, toasts, dismissToast, pushToast],
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