'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SensorId, SensorSeries, SeriesPoint } from '@/lib/dashboardData'
import { isApiConfigured } from '@/lib/api/config'
import { fetchLatestSeries, fetchRangeRaw } from '@/lib/api/telemetry'
import { connectLiveTelemetry, type SensorPoint, type FusionData } from '@/lib/api/realtime'
import { refreshAccessToken } from '@/lib/api/auth'
import { isPushConfigured, onForegroundPush, parsePushAlert, type PushAlert } from '@/lib/api/push'
import { useOnline } from '@/lib/useOnline'

export type EventLevel = 'WARNING' | 'CRITICAL'
export type ToastLevel = EventLevel | 'SUCCESS'

/** Lifecycle of the dashboard's live WebSocket — independent of REST readings. */
export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

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
  /** Dashboard-to-backend live socket state; does not imply the device is transmitting. */
  liveStatus: LiveStatus
  /** Time of the newest reading delivered over the WebSocket (never from REST). */
  lastWsReadingAt: number | null
  /** Timestamp of the newest reading currently shown (live or restored from disk). */
  liveSavedAt: number | null
  notifications: SensorEvent[]
  unreadCount: number
  markAllRead: () => void
  toasts: SensorToast[]
  dismissToast: (id: string) => void
  /** Local (user-action) feedback toast — defaults to the success style so existing callers keep working. */
  pushToast: (title: string, message: string, level?: ToastLevel) => void
}

// Bumped to drop legacy polled /events/ history — modal notifications are push-sourced.
const STORAGE_KEY = 'preventa.notifications.v3'
const LIVE_SNAPSHOT_KEY = 'preventa.live-snapshot.v1'
const LIVE_SNAPSHOT_WRITE_MS = 5000
const MAX_EVENTS = 50
const MAX_TOASTS = 3
const TOAST_LIFETIME_MS = 6000
const BACKFILL_POLL_MS = 30_000

interface LiveSnapshot {
  savedAt: number
  fusion: FusionData | null
  points: Array<{ id: SensorId; point: SeriesPoint }>
}

const SensorsContext = createContext<SensorsContextType | undefined>(undefined)

function loadLiveSnapshot(): LiveSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LIVE_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LiveSnapshot
    if (!parsed || !Array.isArray(parsed.points) || !Number.isFinite(parsed.savedAt)) return null
    return parsed
  } catch {
    return null
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

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
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('idle')
  const [lastWsReadingAt, setLastWsReadingAt] = useState<number | null>(null)
  const [liveSavedAt, setLiveSavedAt] = useState<number | null>(null)
  const [notifications, setNotifications] = useState<SensorEvent[]>(loadStoredEvents)
  const [toasts, setToasts] = useState<SensorToast[]>([])

  const seenEventsRef = useRef<Set<string>>(new Set(loadStoredEvents().map((e) => e.id)))
  const wsRef = useRef<WebSocket | null>(null)
  const wsReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const wsGenerationRef = useRef(0)
  const reconnectRef = useRef<() => void>(() => {})
  const lastSnapshotWriteRef = useRef(0)
  const wasOfflineRef = useRef(false)
  const online = useOnline()
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

  /** Small, newest-reading snapshot that keeps the LIVE cards meaningful offline. */
  function saveLiveSnapshot(points: SensorPoint, fusion: FusionData) {
    const now = Date.now()
    if (now - lastSnapshotWriteRef.current < LIVE_SNAPSHOT_WRITE_MS) return
    lastSnapshotWriteRef.current = now

    let savedAt = 0
    for (const id of ['mq7', 'dht22', 'acs712', 'humidity'] as SensorId[]) {
      const t = points[id].t
      if (typeof t === 'number' && t > savedAt) savedAt = t
    }
    const snapshot: LiveSnapshot = {
      savedAt: savedAt || now,
      fusion,
      points: (['mq7', 'dht22', 'acs712', 'humidity'] as SensorId[]).map((id) => ({ id, point: points[id] })),
    }
    try {
      localStorage.setItem(LIVE_SNAPSHOT_KEY, JSON.stringify(snapshot))
    } catch {
      /* storage unavailable — live UI still works */
    }
    setLiveSavedAt(snapshot.savedAt)
  }

  // Restore the last live values before the socket/REST work starts. The one-hour
  // seed below keeps any snapshot point newer than the seed's own tail.
  useEffect(() => {
    // Deferred to keep the first client render identical to the prerendered HTML.
    const t = setTimeout(() => {
      const snapshot = loadLiveSnapshot()
      if (!snapshot) return
      let changed = false
      for (const { id, point } of snapshot.points) {
        if (!buffersRef.current[id] || typeof point?.value !== 'number') continue
        buffersRef.current[id] = [point]
        changed = true
      }
      if (snapshot.fusion) setLastFusion(snapshot.fusion)
      setLiveSavedAt(snapshot.savedAt)
      if (changed) rebuildSeries()
    }, 0)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!isApiConfigured()) return

    let cancelled = false

    async function connectWS() {
      if (isOffline()) {
        setLiveStatus('offline')
        return
      }
      const token = localStorage.getItem('preventa.token')
      if (!token) {
        setLiveStatus('idle')
        return
      }

      const generation = ++wsGenerationRef.current
      setLiveStatus('connecting')

      const ws = connectLiveTelemetry(
        token,
        (points: SensorPoint, fusion: FusionData) => {
          if (cancelled || generation !== wsGenerationRef.current) return
          setLastWsReadingAt(Date.now())
          pushPoint('mq7', points.mq7)
          pushPoint('dht22', points.dht22)
          pushPoint('acs712', points.acs712)
          pushPoint('humidity', points.humidity)
          setLastFusion(fusion)
          saveLiveSnapshot(points, fusion)
          rebuildSeries()
        },
        (code) => {
          if (cancelled || generation !== wsGenerationRef.current || isOffline()) return
          setLiveStatus('reconnecting')
          setLastWsReadingAt(null)
          if (code === 4401) {
            void refreshAccessToken().then((newToken) => {
              if (generation !== wsGenerationRef.current || cancelled) return
              if (newToken) connectWS()
              else setLiveStatus('idle')
            })
          } else {
            scheduleReconnect()
          }
        },
        () => {
          if (cancelled || generation !== wsGenerationRef.current) return
          // A fresh session must prove itself with a new reading before the
          // dashboard may show a live device again.
          setLastWsReadingAt(null)
          setLiveStatus('connected')
        }
      )
      wsRef.current = ws
    }

    reconnectRef.current = connectWS

    function scheduleReconnect() {
      if (isOffline()) return
      if (wsReconnectTimeoutRef.current) clearTimeout(wsReconnectTimeoutRef.current)
      wsReconnectTimeoutRef.current = setTimeout(() => {
        if (!cancelled) connectWS()
      }, 3000)
    }

    connectWS()

    async function backfill() {
      if (cancelled || isOffline()) return
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
        const snapshot = await fetchRangeRaw('1H')
        if (cancelled) return
        let changed = false
        for (const s of snapshot.series) {
          if (!s.points.length) continue
          const buf = buffersRef.current[s.id]
          const seedPoints = s.points.filter((p) => typeof p.t === 'number' && Number.isFinite(p.t))
          const seedLastT = seedPoints.length ? seedPoints[seedPoints.length - 1].t ?? 0 : 0
          // Keep snapshot/live points newer than the seed's tail — this covers
          // both a WS race and a restored snapshot after an offline reload.
          const fresh = buf.filter((p) => typeof p.t === 'number' && (!seedLastT || p.t > seedLastT))
          // Seed is ascending; append preserved live tail so order is maintained.
          const merged = [...seedPoints.filter((p) => typeof p.t === 'number' && (!seedLastT || p.t <= seedLastT)), ...fresh]
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
      // Invalidate callbacks from this socket before closing it.
      wsGenerationRef.current += 1
      if (wsRef.current) wsRef.current.close()
      if (wsReconnectTimeoutRef.current) clearTimeout(wsReconnectTimeoutRef.current)
      reconnectRef.current = () => {}
      clearInterval(backfillId)
    }
  }, [])

  // Don't retry the socket every 3 s while offline; resume as soon as we reconnect.
  useEffect(() => {
    if (online) {
      // Only on a real offline→online transition — the first render must not
      // open a second socket alongside the main connection effect.
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false
        reconnectRef.current()
      }
      return
    }
    wasOfflineRef.current = true
    // The exposed status is derived from `online`, so no state update is needed
    // here; invalidate this socket so late callbacks cannot restore live state.
    wsGenerationRef.current += 1
    if (wsRef.current) wsRef.current.close()
    wsRef.current = null
    if (wsReconnectTimeoutRef.current) clearTimeout(wsReconnectTimeoutRef.current)
  }, [online])

  // Drop any legacy polled/event-log history left under the old key.
  useEffect(() => {
    try {
      localStorage.removeItem('preventa.notifications.v2')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications))
    } catch {
      /* ignore storage failures */
    }
  }, [notifications])

  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])

  // Hovering or focusing a toast keeps it on screen long enough to read.
  const [toastsPaused, setToastsPaused] = useState(false)

  const pushToast = useCallback((title: string, message: string, level: ToastLevel = 'SUCCESS') => {
    setToasts((prev) =>
      [
        { id: `toast-${Date.now()}-${Math.round(Math.random() * 1e5)}`, level, title, message },
        ...prev,
      ].slice(0, MAX_TOASTS),
    )
  }, [])

  const ingestPushAlert = useCallback(
    (alert: PushAlert, opts: { toast: boolean; browserNotify: boolean }) => {
      const eventId = alert.eventId != null && alert.eventId !== '' ? String(alert.eventId) : null
      const id = eventId ?? `push-${Date.now()}-${Math.round(Math.random() * 1e5)}`
      const level = alert.level ?? 'WARNING'
      const title = alert.title || 'PREVENTA alert'
      const body = alert.body || 'A new fire incident was reported.'

      const isNew = eventId ? !seenEventsRef.current.has(eventId) : true
      if (eventId) seenEventsRef.current.add(eventId)

      if (isNew) {
        // A new incident changes the event history. Ask the log screen to
        // re-fetch when online — never drop the persisted snapshot, which is
        // the only history available when the device is offline.
        if (!isOffline() && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('preventa:logs-changed'))
        }

        const entry: SensorEvent = {
          id,
          sensorId: 'mq7',
          level,
          value: alert.tier ?? 0,
          unit: 'tier',
          title,
          message: body,
          timestamp: alert.timestamp ?? Date.now(),
          read: false,
        }
        setNotifications((prev) => {
          if (prev.some((n) => n.id === entry.id)) return prev
          return [entry, ...prev].slice(0, MAX_EVENTS)
        })
      }

      if (isNew && opts.toast) {
        setToasts((prev) =>
          [{ id: `toast-${id}-${Date.now()}`, level, title, message: body }, ...prev].slice(0, MAX_TOASTS),
        )
      }
      if (isNew && opts.browserNotify) tryBrowserNotify(title, body)
    },
    [],
  )

  // Firebase push → modal notification log. Foreground messages arrive via FCM onMessage;
  // background-received messages are forwarded from the service worker (sw.js).
  useEffect(() => {
    if (!isApiConfigured()) return
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    void (async () => {
      if (!isPushConfigured()) return
      unsubscribe = await onForegroundPush((alert: PushAlert) => {
        if (cancelled) return
        ingestPushAlert(alert, { toast: true, browserNotify: true })
      })
    })()

    const onSwMessage = (event: MessageEvent) => {
      const msg = event.data as { source?: string; kind?: string; data?: Record<string, string>; notification?: { title?: string; body?: string } } | null
      if (!msg || msg.source !== 'preventa-sw' || msg.kind !== 'push') return
      const alert = parsePushAlert(msg.data ?? {}, msg.notification ?? undefined)
      if (!alert) return
      const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
      ingestPushAlert(alert, { toast: visible, browserNotify: false })
    }

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwMessage)
    }

    return () => {
      cancelled = true
      unsubscribe?.()
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage)
      }
    }
  }, [ingestPushAlert])

  const markAllRead = useCallback(() => setNotifications((prev) => prev.map((n) => ({ ...n, read: true }))), [])

  const unreadCount = notifications.filter((n) => !n.read).length

  useEffect(() => {
    if (!toasts.length || toastsPaused) return
    const timers = toasts.map((t) => setTimeout(() => dismissToast(t.id), TOAST_LIFETIME_MS))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismissToast, toastsPaused])

  const effectiveLiveStatus: LiveStatus = online ? liveStatus : 'offline'
  const value = useMemo(
    () => ({
      series,
      lastFusion,
      liveStatus: effectiveLiveStatus,
      lastWsReadingAt,
      liveSavedAt,
      notifications,
      unreadCount,
      markAllRead,
      toasts,
      dismissToast,
      pushToast,
    }),
    [
      series,
      lastFusion,
      effectiveLiveStatus,
      lastWsReadingAt,
      liveSavedAt,
      notifications,
      unreadCount,
      markAllRead,
      toasts,
      dismissToast,
      pushToast,
    ],
  )

  return (
    <SensorsContext.Provider value={value}>
      {children}
      <div
        className="flex fixed bottom-5 left-5 right-5 sm:left-auto z-70 max-w-sm flex-col gap-2"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        onMouseEnter={() => setToastsPaused(true)}
        onMouseLeave={() => setToastsPaused(false)}
        onFocus={() => setToastsPaused(true)}
        onBlur={() => setToastsPaused(false)}
      >
        {toasts.map((t) => (
          <div key={t.id} className={`${t.level === 'SUCCESS' ? 'flex' : 'hidden lg:flex'} items-start gap-3 rounded-xl bg-(--surface-solid) text-white ring-1 ring-white/10 px-4 py-3 shadow-2xl`}>
            <span
              aria-hidden="true"
              className="mt-1 h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: t.level === 'SUCCESS' ? 'var(--green-indicator)' : t.level === 'CRITICAL' ? 'var(--red-indicator)' : 'var(--amber-indicator)' }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">{t.title}</p>
              <p className="text-xs text-gray-300 mt-0.5 leading-relaxed">{t.message}</p>
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label={`Dismiss notification: ${t.title}`}
              className="text-gray-400 hover:text-white text-lg leading-none cursor-pointer"
            >
              <span aria-hidden="true">&times;</span>
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