'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SensorId, SensorSeries, SeriesPoint } from '@/lib/dashboardData'
import { isApiConfigured } from '@/lib/api/config'
import { fetchLatestSeries, fetchRangeRaw, type RangeSnapshot } from '@/lib/api/telemetry'
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
  /** All boards, for the aggregate view. */
  series: SensorSeries[]
  /** Latest live series for each numeric hardware device id seen on the stream. */
  seriesByDevice: Record<number, SensorSeries[]>
  /** Fusion fields from the most recent live reading — used to react to tier transitions. */
  lastFusion: FusionData | null
  /** Dashboard-to-backend live socket state; does not imply the device is transmitting. */
  liveStatus: LiveStatus
  /** Time of the newest reading delivered over the WebSocket (all boards). */
  lastWsReadingAt: number | null
  /** Newest WS reading time per hardware device id. */
  lastReadingAtByDevice: Record<number, number>
  /** Timestamp of the newest reading currently shown (live or restored from disk). */
  liveSavedAt: number | null
  /** Saved-at timestamps per hardware device id. */
  liveSavedAtByDevice: Record<number, number>
  /** True while the one-time 1H seed is still delivering paged readings. */
  liveSeeding: boolean
  /** True once the one-time 1H seed has settled (with or without readings). */
  liveReady: boolean
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
const LIVE_SNAPSHOT_KEY = 'preventa.live-snapshot.v2'
const LEGACY_LIVE_SNAPSHOT_KEY = 'preventa.live-snapshot.v1'
const LIVE_SNAPSHOT_WRITE_MS = 5000
const MAX_EVENTS = 50
const MAX_TOASTS = 3
const TOAST_LIFETIME_MS = 6000
const BACKFILL_POLL_MS = 30_000
const SENSOR_IDS: SensorId[] = ['mq7', 'dht22', 'acs712', 'humidity']
const MAX_BUFFER = 2000
const MAX_DEVICES = 32

interface LiveSnapshot {
  savedAt: number
  fusion: FusionData | null
  points: Array<{ id: SensorId; point: SeriesPoint }>
}

interface SavedLiveSnapshots {
  all: LiveSnapshot | null
  devices: Record<number, LiveSnapshot>
}

type SensorBuffers = Record<SensorId, SeriesPoint[]>
interface LiveBuffers {
  all: SensorBuffers
  devices: Map<number, SensorBuffers>
}

const SensorsContext = createContext<SensorsContextType | undefined>(undefined)

function emptyBuffers(): SensorBuffers {
  return { mq7: [], dht22: [], acs712: [], humidity: [] }
}

function deviceBuffers(buffers: LiveBuffers, device: number): SensorBuffers {
  let buf = buffers.devices.get(device)
  if (!buf) {
    buf = emptyBuffers()
    // Bound memory if an unexpected stream sends readings for many boards.
    if (buffers.devices.size >= MAX_DEVICES) {
      const oldest = buffers.devices.keys().next().value
      if (typeof oldest === 'number') buffers.devices.delete(oldest)
    }
    buffers.devices.set(device, buf)
  }
  return buf
}

function appendPoint(buf: SensorBuffers, id: SensorId, point: SeriesPoint) {
  const list = buf[id]
  list.push(point)
  if (list.length > MAX_BUFFER) list.shift()
}

function snapshotIsValid(value: unknown): value is LiveSnapshot {
  const s = value as LiveSnapshot | null
  return Boolean(s && Array.isArray(s.points) && Number.isFinite(s.savedAt))
}

function loadLiveSnapshots(): SavedLiveSnapshots {
  const empty: SavedLiveSnapshots = { all: null, devices: {} }
  if (typeof window === 'undefined') return empty
  try {
    const raw = localStorage.getItem(LIVE_SNAPSHOT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedLiveSnapshots>
      const devices: Record<number, LiveSnapshot> = {}
      for (const [key, value] of Object.entries(parsed?.devices ?? {})) {
        const id = Number(key)
        if (Number.isFinite(id) && snapshotIsValid(value)) devices[id] = value
      }
      return {
        all: snapshotIsValid(parsed?.all) ? parsed.all : null,
        devices,
      }
    }
    // Legacy single-board snapshot: treat it as the aggregate tail.
    const legacyRaw = localStorage.getItem(LEGACY_LIVE_SNAPSHOT_KEY)
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw)
      if (snapshotIsValid(parsed)) return { all: parsed, devices: {} }
    }
  } catch {
    /* ignore corrupted storage */
  }
  return empty
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
  const [seriesByDevice, setSeriesByDevice] = useState<Record<number, SensorSeries[]>>({})
  const [lastFusion, setLastFusion] = useState<FusionData | null>(null)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('idle')
  const [lastWsReadingAt, setLastWsReadingAt] = useState<number | null>(null)
  const [lastReadingAtByDevice, setLastReadingAtByDevice] = useState<Record<number, number>>({})
  const [liveSavedAt, setLiveSavedAt] = useState<number | null>(null)
  const [liveSavedAtByDevice, setLiveSavedAtByDevice] = useState<Record<number, number>>({})
  const [liveSeeding, setLiveSeeding] = useState(false)
  const [liveReady, setLiveReady] = useState(false)
  const [notifications, setNotifications] = useState<SensorEvent[]>(loadStoredEvents)
  const [toasts, setToasts] = useState<SensorToast[]>([])

  const seenEventsRef = useRef<Set<string>>(new Set(loadStoredEvents().map((e) => e.id)))
  const wsRef = useRef<WebSocket | null>(null)
  const wsReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const wsGenerationRef = useRef(0)
  const reconnectRef = useRef<() => void>(() => {})
  const lastSnapshotWriteRef = useRef<Record<string, number>>({})
  const wasOfflineRef = useRef(false)
  const online = useOnline()
  const buffersRef = useRef<LiveBuffers>({ all: emptyBuffers(), devices: new Map() })
  const savedSnapshotsRef = useRef<SavedLiveSnapshots>({ all: null, devices: {} })
  const fusionRestoredRef = useRef(false)

  const pushReading = useCallback((device: number, points: SensorPoint) => {
    const buffers = buffersRef.current
    const perDevice = deviceBuffers(buffers, device)
    for (const id of SENSOR_IDS) {
      appendPoint(buffers.all, id, points[id])
      appendPoint(perDevice, id, points[id])
    }
  }, [])

  const rebuildSeries = useCallback(() => {
    const buffers = buffersRef.current
    setSeries(SENSOR_IDS.map((id) => ({ id, points: [...buffers.all[id]] })))
    const byDevice: Record<number, SensorSeries[]> = {}
    for (const [device, buf] of buffers.devices) {
      byDevice[device] = SENSOR_IDS.map((id) => ({ id, points: [...buf[id]] }))
    }
    setSeriesByDevice(byDevice)
  }, [])

  /** Small, newest-reading snapshot that keeps the LIVE cards meaningful offline. */
  function saveLiveSnapshot(device: number | null, points: SensorPoint, fusion: FusionData) {
    const now = Date.now()
    let savedAt = 0
    for (const id of SENSOR_IDS) {
      const t = points[id].t
      if (typeof t === 'number' && t > savedAt) savedAt = t
    }
    const snapshot: LiveSnapshot = {
      savedAt: savedAt || now,
      fusion,
      points: SENSOR_IDS.map((id) => ({ id, point: points[id] })),
    }
    const saved = savedSnapshotsRef.current
    let changed = false

    // Throttle per snapshot, not per reading: one board's payload updates both
    // the aggregate tail and its own board tail, and boards arrive interleaved.
    const write = (key: string) => {
      if (now - (lastSnapshotWriteRef.current[key] ?? 0) < LIVE_SNAPSHOT_WRITE_MS) return
      lastSnapshotWriteRef.current[key] = now
      changed = true
      if (key === 'all') {
        saved.all = snapshot
        setLiveSavedAt(snapshot.savedAt)
      } else {
        const id = Number(key)
        saved.devices[id] = snapshot
        setLiveSavedAtByDevice((prev) => ({ ...prev, [id]: snapshot.savedAt }))
      }
    }

    write('all')
    if (device !== null && Number.isFinite(device)) write(String(device))
    if (!changed) return

    try {
      localStorage.setItem(LIVE_SNAPSHOT_KEY, JSON.stringify(saved))
    } catch {
      /* storage unavailable — live UI still works */
    }
  }

  function restoreSnapshot(target: SensorBuffers, snapshot: LiveSnapshot): boolean {
    let changed = false
    for (const { id, point } of snapshot.points) {
      if (!target[id] || typeof point?.value !== 'number') continue
      target[id] = [point]
      changed = true
    }
    return changed
  }

  // Restore the last live values before the socket/REST work starts. The one-hour
  // seed below keeps any snapshot point newer than the seed's own tail.
  useEffect(() => {
    // Deferred to keep the first client render identical to the prerendered HTML.
    const t = setTimeout(() => {
      const saved = loadLiveSnapshots()
      savedSnapshotsRef.current = saved
      let changed = false
      if (saved.all) {
        changed = restoreSnapshot(buffersRef.current.all, saved.all) || changed
        setLiveSavedAt(saved.all.savedAt)
        if (saved.all.fusion) {
          setLastFusion(saved.all.fusion)
          fusionRestoredRef.current = true
        }
      }
      const savedAtByDevice: Record<number, number> = {}
      for (const [key, snapshot] of Object.entries(saved.devices)) {
        const device = Number(key)
        if (!Number.isFinite(device)) continue
        changed = restoreSnapshot(deviceBuffers(buffersRef.current, device), snapshot) || changed
        savedAtByDevice[device] = snapshot.savedAt
        if (!fusionRestoredRef.current && snapshot.fusion) {
          setLastFusion(snapshot.fusion)
          fusionRestoredRef.current = true
        }
      }
      if (Object.keys(savedAtByDevice).length) setLiveSavedAtByDevice(savedAtByDevice)
      if (changed) rebuildSeries()
    }, 0)
    return () => clearTimeout(t)
  }, [rebuildSeries])

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
        (device: number, points: SensorPoint, fusion: FusionData) => {
          if (cancelled || generation !== wsGenerationRef.current) return
          const at = Date.now()
          setLastWsReadingAt(at)
          if (Number.isFinite(device)) {
            setLastReadingAtByDevice((prev) => ({ ...prev, [device]: at }))
            pushReading(device, points)
          } else {
            // Malformed payloads still keep the aggregate view usable.
            for (const id of SENSOR_IDS) appendPoint(buffersRef.current.all, id, points[id])
          }
          setLastFusion(fusion)
          saveLiveSnapshot(Number.isFinite(device) ? device : null, points, fusion)
          rebuildSeries()
        },
        (code) => {
          if (cancelled || generation !== wsGenerationRef.current || isOffline()) return
          setLiveStatus('reconnecting')
          setLastWsReadingAt(null)
          setLastReadingAtByDevice({})
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
          setLastReadingAtByDevice({})
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

        // The unfiltered REST tail is also the per-device seed: every point
        // carries the numeric device id from the backend payload.
        const grouped = new Map<number, SensorBuffers>()
        for (const s of latest) {
          if (typeof s.id !== 'string') continue
          if (!wsOpen || !buffersRef.current.all[s.id].length) {
            if (s.points.length) {
              buffersRef.current.all[s.id] = [...s.points].slice(-MAX_BUFFER)
              changed = true
            }
          }
          for (const p of s.points) {
            if (typeof p.device !== 'number') continue
            let perDevice = grouped.get(p.device)
            if (!perDevice) {
              perDevice = emptyBuffers()
              grouped.set(p.device, perDevice)
            }
            perDevice[s.id].push(p)
          }
        }
        for (const [device, perDevice] of grouped) {
          const buf = deviceBuffers(buffersRef.current, device)
          for (const id of SENSOR_IDS) {
            const points = perDevice[id]
            if (!points.length || (wsOpen && buf[id].length)) continue
            points.sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
            buf[id] = points.slice(-MAX_BUFFER)
            changed = true
          }
        }
        if (changed) rebuildSeries()
      } catch {
        /* keep local buffer */
      }
    }

    void backfill()
    const backfillId = setInterval(backfill, BACKFILL_POLL_MS)

    // Merge a (possibly partial) 1H snapshot into the live buffers. The same
    // routine handles page progress and the final snapshot, so LIVE paints the
    // first page while the remaining pages are still loading.
    function mergeSeedSnapshot(snapshot: RangeSnapshot): boolean {
      let changed = false
      for (const s of snapshot.series) {
        if (!s.points.length) continue
        const buf = buffersRef.current.all[s.id]
        const seedPoints = s.points.filter((p) => typeof p.t === 'number' && Number.isFinite(p.t))
        const seedLastT = seedPoints.length ? seedPoints[seedPoints.length - 1].t ?? 0 : 0
        // Keep snapshot/live points newer than the seed's tail — this covers
        // both a WS race and a restored snapshot after an offline reload.
        const fresh = buf.filter((p) => typeof p.t === 'number' && (!seedLastT || p.t > seedLastT))
        // Seed is ascending; append preserved live tail so order is maintained.
        const merged = [...seedPoints.filter((p) => typeof p.t === 'number' && (!seedLastT || p.t <= seedLastT)), ...fresh]
        if (merged.length) {
          buffersRef.current.all[s.id] = merged.slice(-MAX_BUFFER)
          changed = true
        }
      }
      return changed
    }

    // One-time LIVE seed: fill the buffers with the backend's last hour so the
    // dashboard's LIVE chart opens with a full span. Everything after this comes
    // purely from the WebSocket stream — this is the only time-based fetch for LIVE.
    // Page batches are coalesced into one frame so several fast pages cannot
    // each rebuild all four series and re-render the dashboard.
    let seedFrame: number | null = null
    function scheduleSeedRebuild() {
      if (seedFrame !== null || cancelled) return
      seedFrame = requestAnimationFrame(() => {
        seedFrame = null
        if (!cancelled) rebuildSeries()
      })
    }

    async function seedHour() {
      try {
        const snapshot = await fetchRangeRaw('1H', {
          onProgress: (partial) => {
            if (cancelled) return
            setLiveSeeding(true)
            if (mergeSeedSnapshot(partial)) scheduleSeedRebuild()
          },
        })
        if (cancelled) return
        if (seedFrame !== null) {
          cancelAnimationFrame(seedFrame)
          seedFrame = null
        }
        if (mergeSeedSnapshot(snapshot)) rebuildSeries()
      } catch {
        /* seed is best-effort — live stream continues regardless */
      } finally {
        if (!cancelled) {
          setLiveSeeding(false)
          // An empty (or failed) seed is a resolved "no data" result, not an
          // endless loading state — LIVE must settle like the history tabs.
          setLiveReady(true)
        }
      }
    }

    void seedHour()

    return () => {
      cancelled = true
      if (seedFrame !== null) cancelAnimationFrame(seedFrame)
      // Invalidate callbacks from this socket before closing it.
      wsGenerationRef.current += 1
      if (wsRef.current) wsRef.current.close()
      if (wsReconnectTimeoutRef.current) clearTimeout(wsReconnectTimeoutRef.current)
      reconnectRef.current = () => {}
      clearInterval(backfillId)
    }
  }, [pushReading, rebuildSeries])

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
      const msg = event.data as {
        source?: string
        kind?: string
        url?: string
        data?: Record<string, string>
        notification?: { title?: string; body?: string }
      } | null
      if (!msg || msg.source !== 'preventa-sw') return
      if (msg.kind === 'navigate' && typeof msg.url === 'string') {
        try {
          const target = new URL(msg.url, window.location.origin)
          if (target.origin === window.location.origin) window.location.assign(target.href)
        } catch {
          /* ignore malformed SW navigation messages */
        }
        return
      }
      if (msg.kind !== 'push') return
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
      seriesByDevice,
      lastFusion,
      liveStatus: effectiveLiveStatus,
      lastWsReadingAt,
      lastReadingAtByDevice,
      liveSavedAt,
      liveSavedAtByDevice,
      liveSeeding,
      liveReady,
      notifications,
      unreadCount,
      markAllRead,
      toasts,
      dismissToast,
      pushToast,
    }),
    [
      series,
      seriesByDevice,
      lastFusion,
      effectiveLiveStatus,
      lastWsReadingAt,
      lastReadingAtByDevice,
      liveSavedAt,
      liveSavedAtByDevice,
      liveSeeding,
      liveReady,
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