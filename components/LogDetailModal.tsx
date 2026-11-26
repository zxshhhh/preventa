'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { lockScroll } from '@/lib/scrollLock'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { useOnline } from '@/lib/useOnline'
import type {
  LogEntry,
  CaptureEntry,
  ReadingEntry,
} from '@/lib/logReport'
import {
  formatTime,
  formatFullDate,
} from '@/lib/logReport'
import {
  fetchDeviceCode,
  fetchEventReadings,
  fetchCaptures,
  findCapturesNearEvent,
  findEventReading,
  fetchCaptureBlob,
  fetchLogs,
  eventReadingsCacheKey,
  capturesCacheKey,
} from '@/lib/api/reports'
import { peekCache } from '@/lib/api/cache'
import { peekBlob } from '@/lib/api/blobCache'
import { formatNumber } from '@/lib/dashboardData'
import EventTimeline from '@/components/EventTimeline'
import { EVENT_RECOVERY_MS, findTriggerReading, sortEventReadings } from '@/lib/eventEvidence'
import { SkeletonBlock } from '@/components/ui/Skeleton'

interface Props {
  log: LogEntry
  onClose: () => void
}

type LoadState = 'loading' | 'ready' | 'missing' | 'error' | 'offline'

function DetailItem({
  label,
  value,
  numeric = false,
}: {
  label: string
  value: string
  numeric?: boolean
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/5 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd
        className={
          'mt-1 wrap-break-words text-sm font-semibold text-gray-100 ' +
          (numeric ? 'tnum' : '')
        }
      >
        {value}
      </dd>
    </div>
  )
}

function SeverityBadge({ tier, label }: { tier: number; label: string }) {
  const dot =
    tier >= 4
      ? 'bg-(--red-indicator)'
      : tier > 0
        ? 'bg-(--amber-indicator)'
        : 'bg-white/60'

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/25">
      <span className={'h-2 w-2 shrink-0 rounded-full ' + dot} aria-hidden="true" />
      {tier > 0 ? `${label} · Tier ${tier}` : label}
    </span>
  )
}

function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">
        {title}
      </h3>
      {meta && <span className="text-xs text-gray-400">{meta}</span>}
    </div>
  )
}

const READING_FIELDS = [
  { label: 'GAS', unit: 'PPM', keys: ['smooth_ppm', 'gas', 'ppm', 'mq7'] },
  {
    label: 'TEMP',
    unit: '°C',
    keys: ['smooth_temperature', 'temperature', 'temp'],
  },
  { label: 'HUMIDITY', unit: '%', keys: ['smooth_humidity', 'humidity'] },
  { label: 'CURRENT', unit: 'A', keys: ['smooth_current'] },
] as const

function closestEventReading(
  ordered: ReadingEntry[],
  eventStart: string,
): ReadingEntry | null {
  return findTriggerReading(ordered, eventStart) ?? findEventReading(ordered, eventStart)
}

function readingValue(
  values: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = values[key]

    if (
      (typeof value === 'number' || typeof value === 'string') &&
      value !== '' &&
      Number.isFinite(Number(value))
    ) {
      return formatNumber(Number(value), 1)
    }
  }

  return 'Unavailable'
}

function EventReadingCard({ reading }: { reading: ReadingEntry }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-300">
          Recorded{' '}
          <span className="tnum">
            {reading.timestamp
              ? formatTime(reading.timestamp)
              : 'time unavailable'}
          </span>
        </p>
        <p className="text-xs text-gray-400">Closest to event start</p>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {READING_FIELDS.map((field) => (
          <div key={field.label} className="min-w-0 rounded-lg bg-black/20 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {field.label}
            </dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-1">
              <span className="tnum text-base font-bold text-gray-100 sm:text-lg">
                {readingValue(reading.values, field.keys)}
              </span>
              <span className="text-xs text-gray-400">{field.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function ReadingSkeleton() {
  return (
    <div
      className="rounded-xl border border-white/10 bg-white/5 p-4"
      role="status"
      aria-label="Loading sensor reading"
    >
      <div className="skeleton-shine mb-3 h-3 w-32 rounded bg-white/10" />
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg bg-black/20 p-3">
            <div className="skeleton-shine h-3 w-16 rounded bg-white/10" />
            <div className="skeleton-shine mt-2 h-5 w-20 rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  )
}

function CaptureSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-xl border border-white/10 bg-neutral-900"
      role="status"
      aria-label="Searching for camera snapshots"
    >
      <div className="skeleton-shine aspect-video bg-white/5" />
      <div className="p-3">
        <div className="skeleton-shine h-3 w-24 rounded bg-white/10" />
      </div>
    </div>
  )
}

function CaptureImage({
  capture,
  index,
}: {
  capture: CaptureEntry
  index: number
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    // Blob bytes may already be cached in memory (or IndexedDB from a previous
    // visit); an object URL must still be created for this mount.
    const cached = peekBlob(capture.id)

    const load = async () => {
      try {
        // Yield once so a cache hit doesn't call setState in the effect body.
        await Promise.resolve()
        const blob = cached ?? await fetchCaptureBlob(capture.id)
        if (cancelled) return

        if (!objectUrl) {
          objectUrl = URL.createObjectURL(blob)
          setImageUrl(objectUrl)
        }
        setState('ready')
      } catch {
        if (!cancelled) {
          setState('error')
        }
      }
    }

    void load()

    return () => {
      cancelled = true

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [capture.id])

  const time = formatTime(capture.timestamp)
  const classification = capture.classification || 'Unclassified'
  const confidence =
    capture.confidence !== null && Number.isFinite(Number(capture.confidence))
      ? ` · ${Number(capture.confidence).toFixed(1)}% fire confidence`
      : ''

  return (
    <figure className="overflow-hidden rounded-xl border border-white/10">
      <div className="relative flex aspect-video items-center justify-center">
        {state === 'loading' && (
          <div role="status" aria-label="Loading capture image" className="h-full w-full overflow-hidden">
            <SkeletonBlock className="aspect-video h-full w-full rounded-xl" />
          </div>
        )}

        {state === 'error' && (
          <p role="alert" className="px-4 text-center text-xs text-gray-300">
            Could not load this capture image.
          </p>
        )}

        {state === 'ready' && imageUrl && (
          <Image
            src={imageUrl}
            alt={`Camera snapshot near the event at ${time}. ${classification}${confidence}`}
            fill
            unoptimized
            loading={index === 0 ? 'eager' : 'lazy'}
            decoding="async"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <figcaption className="p-3 backdrop-blur-lg bg-transparent text-center">
        <p className="tnum text-xs text-gray-300">{time}</p>
        <p className="mt-1 text-xs text-gray-300">{classification}{confidence}</p>
      </figcaption>
    </figure>
  )
}

function EventEvidence({
  log,
  deviceCode,
  deviceState,
  onEventUpdate,
}: {
  log: LogEntry
  deviceCode: string | null
  deviceState: LoadState
  onEventUpdate: (event: LogEntry) => void
}) {
  const readingsKey = deviceCode
    ? eventReadingsCacheKey(deviceCode, log.timestamp, log.endTime)
    : null
  const capturesKey = deviceCode ? capturesCacheKey(deviceCode) : null
  const cachedReadings = readingsKey ? peekCache<ReadingEntry[]>(readingsKey) : undefined
  const cachedCaptures = capturesKey ? peekCache<CaptureEntry[]>(capturesKey) : undefined
  const initialReadings = cachedReadings ? sortEventReadings(cachedReadings) : []
  const initialCaptures = cachedCaptures
    ? findCapturesNearEvent(cachedCaptures, log.timestamp, log.endTime)
    : []

  const [captures, setCaptures] = useState<CaptureEntry[]>(initialCaptures)
  const [reading, setReading] = useState<ReadingEntry | null>(
    () => closestEventReading(initialReadings, log.timestamp),
  )
  const [readings, setReadings] = useState<ReadingEntry[]>(initialReadings)
  const [refreshError, setRefreshError] = useState(false)
  const [captureState, setCaptureState] = useState<LoadState>(
    cachedCaptures ? (initialCaptures.length > 0 ? 'ready' : 'missing') : 'loading',
  )
  const [readingState, setReadingState] = useState<LoadState>(
    cachedReadings ? (reading ? 'ready' : 'missing') : 'loading',
  )
  const online = useOnline()

  // The parent replaces LogEntry objects when the log list refreshes, so the
  // effect below is keyed on primitive event fields rather than object identity.
  const eventRef = useRef(log)
  useEffect(() => {
    eventRef.current = log
  })
  const onEventUpdateRef = useRef(onEventUpdate)
  useEffect(() => {
    onEventUpdateRef.current = onEventUpdate
  }, [onEventUpdate])

  useEffect(() => {
    let cancelled = false
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let currentEvent = eventRef.current
    let loadedReadings = false
    let loadedCaptures = false

    const applyReadings = (rows: ReadingEntry[]) => {
      const ordered = sortEventReadings(rows)
      const closest = closestEventReading(ordered, currentEvent.timestamp)
      setReadings(ordered)
      setReading(closest)
      setReadingState(closest ? 'ready' : 'missing')
    }

    const applyCaptures = (rows: CaptureEntry[]) => {
      const nearby = findCapturesNearEvent(
        rows,
        currentEvent.timestamp,
        currentEvent.endTime,
      )
      setCaptures(nearby)
      setCaptureState(nearby.length > 0 ? 'ready' : 'missing')
    }

    // Deferred into an async function so cache-hit setState calls aren't
    // synchronous in the effect body.
    const load = async (refresh = false) => {
      await Promise.resolve()
      let eventRefreshFailed = false
      if (!deviceCode) {
        if (deviceState === 'error') {
          setCaptureState('error')
          setReadingState('error')
        } else if (deviceState === 'missing') {
          setCaptureState('missing')
          setReadingState('missing')
        }

        return
      }

      const rKey = eventReadingsCacheKey(deviceCode, currentEvent.timestamp, currentEvent.endTime)
      const cKey = capturesCacheKey(deviceCode)

      // Seed synchronously from the cache so re-opening an event shows saved
      // evidence immediately, with no skeleton and no request.
      if (!loadedReadings) {
        const cached = peekCache<ReadingEntry[]>(rKey)
        if (cached) {
          applyReadings(cached)
          loadedReadings = true
        }
      }
      if (!loadedCaptures) {
        const cached = peekCache<CaptureEntry[]>(cKey)
        if (cached) {
          applyCaptures(cached)
          loadedCaptures = true
        }
      }

      if (!online) {
        setReadingState((prev) => (prev === 'ready' || prev === 'missing' ? prev : 'offline'))
        setCaptureState((prev) => (prev === 'ready' || prev === 'missing' ? prev : 'offline'))
        return
      }

      if (refresh && currentEvent.eventStatus === 'active') {
        try {
          const events = await fetchLogs({ deviceId: deviceCode }, { fresh: true })
          const updated = events.find((event) => event.eventId === currentEvent.eventId)
          if (cancelled) return
          if (updated) {
            const changed = updated.eventStatus !== currentEvent.eventStatus ||
              updated.peakTier !== currentEvent.peakTier || updated.endTime !== currentEvent.endTime ||
              updated.peakFireType !== currentEvent.peakFireType
            currentEvent = updated
            if (changed) onEventUpdateRef.current(updated)
          }
        } catch {
          eventRefreshFailed = true
        }
      }
      if (cancelled) return
      const [readingResult, captureResult] = await Promise.allSettled([
        fetchEventReadings(deviceCode, currentEvent.timestamp, currentEvent.endTime, { fresh: refresh }),
        fetchCaptures(deviceCode, { fresh: refresh }),
      ])

      if (cancelled) return

      if (readingResult.status === 'fulfilled') {
        applyReadings(readingResult.value)
        loadedReadings = true
      } else if (!loadedReadings) {
        setReadingState('error')
      }

      if (captureResult.status === 'fulfilled') {
        applyCaptures(captureResult.value)
        loadedCaptures = true
      } else if (!loadedCaptures) {
        setCaptureState('error')
      }

      if (refresh) setRefreshError(eventRefreshFailed || readingResult.status === 'rejected' || captureResult.status === 'rejected')
      if (currentEvent.eventStatus === 'active' ||
          (currentEvent.endTime && Date.now() < Date.parse(currentEvent.endTime) + EVENT_RECOVERY_MS)) {
        refreshTimer = setTimeout(() => { void load(true) }, 10_000)
      }
    }

    void load()

    return () => {
      cancelled = true
      clearTimeout(refreshTimer)
    }
  }, [deviceCode, deviceState, log.timestamp, log.endTime, log.eventStatus, log.eventId, online])

  return (
    <>
      <section className="mt-6">
        <SectionHeading
          title="Why the device alerted"
          meta={!online ? 'OFFLINE' : log.eventStatus === 'active' ? 'Refreshing every 10 s' : undefined}
        />
        {refreshError && <p role="status" className="mb-3 text-sm text-(--amber-indicator)">Refresh failed. The last loaded evidence remains visible.</p>}
        {readingState === 'loading' && <ReadingSkeleton />}
        {readingState === 'error' && (
          <p role="alert" className="text-sm text-(--red-indicator)">
            Could not load the sensor reading for this event.
          </p>
        )}
        {readingState === 'offline' && (
          <p role="status" className="text-sm text-(--amber-indicator)">
            Offline. Event readings need a connection. Saved evidence stays visible where available.
          </p>
        )}
        {readingState === 'missing' && (
          <p role="status" className="text-sm text-gray-400">
            No sensor reading was recorded for this event.
          </p>
        )}
        {readingState === 'ready' && reading && (
          <>
            <EventTimeline key={log.eventId ?? log.timestamp} readings={readings} captures={captures} log={log} />
            <details className="mt-4">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold text-gray-300">Values nearest the event start</summary>
              <EventReadingCard reading={reading} />
            </details>
          </>
        )}
      </section>

      <section className="mt-6">
        <SectionHeading
          title="Camera snapshots"
          meta={
            captureState === 'ready' ? `${captures.length} found` : undefined
          }
        />
        {captureState === 'loading' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CaptureSkeleton />
          </div>
        )}
        {captureState === 'error' && (
          <p role="alert" className="text-sm text-(--red-indicator) text-center">
            Could not retrieve camera snapshots for this device.
          </p>
        )}
        {captureState === 'offline' && (
          <p role="status" className="text-sm text-(--amber-indicator) text-center">
            Offline. Camera snapshots will return when you reconnect.
          </p>
        )}
        {captureState === 'missing' && (
          <p role="status" className="text-sm text-gray-400 text-center">
            No camera snapshots were found near this event.
          </p>
        )}
        {captureState === 'ready' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {captures.map((capture, index) => (
              <CaptureImage
                key={capture.id}
                capture={capture}
                index={index}
              />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

export default function LogDetailModal({ log, onClose }: Props) {
  const [refreshedEvent, setCurrentEvent] = useState<LogEntry | null>(null)
  const currentEvent = refreshedEvent && refreshedEvent.eventId === log.eventId &&
    refreshedEvent.timestamp === log.timestamp ? refreshedEvent : log
  const cachedDeviceCode = log.deviceId
    ? peekCache<string>(`device-code:${log.deviceId}`)
    : undefined
  const [deviceCode, setDeviceCode] = useState<string | null>(cachedDeviceCode ?? null)
  const [deviceState, setDeviceState] = useState<LoadState>(
    cachedDeviceCode ? 'ready' : log.deviceId ? 'loading' : 'missing',
  )

  const panelRef = useRef<HTMLDivElement>(null)

  useFocusTrap(panelRef, true, onClose)

  useEffect(() => lockScroll(), [])

  useEffect(() => {
    let cancelled = false

    // Deferred into an async function so the reset setState calls aren't synchronous in the effect body.
    const load = async () => {
      if (!log.deviceId) {
        setDeviceState('missing')
        return
      }

      try {
        const code = await fetchDeviceCode(log.deviceId as number)

        if (!cancelled) {
          setDeviceCode(code)
          setDeviceState('ready')
        }
      } catch {
        if (!cancelled) {
          setDeviceState('error')
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [log.deviceId])

  const tier = currentEvent.peakTier ?? 0
  const tierLabel =
    ['Normal', 'Advisory', 'Caution', 'Warning', 'Danger', 'Emergency'][tier] ?? 'Unclassified'

  return (
    <div className="fixed inset-0 z-60 flex items-end justify-center lg:items-center">
      <div
        className="fixed inset-0"
        aria-hidden="true"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-detail-title"
        aria-describedby="event-detail-meta"
        tabIndex={-1}
        className="relative z-10 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-(--surface-solid) shadow-2xl lg:max-h-[80vh] lg:w-190 lg:max-w-4xl lg:rounded-2xl"
      >
        <header className="bg-ember ember-grid shrink-0 px-5 py-4 text-(--on-ember)">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SeverityBadge tier={tier} label={tierLabel} />
              <h2
                id="event-detail-title"
                className="mt-2 truncate text-base font-bold leading-tight sm:text-lg"
              >
                {formatFullDate(log.timestamp)}
              </h2>
              <p
                id="event-detail-meta"
                className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-(--on-ember-80)"
              >
                <span className="tnum">{formatTime(log.timestamp)}</span>
                {deviceCode && (
                  <span className="rounded-full bg-black/15 px-2 py-0.5 tnum">
                    {deviceCode}
                  </span>
                )}
              </p>
            </div>

            <button
              onClick={onClose}
              className="btn-icon-light flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/30 text-xl leading-none text-white hover:bg-black/40 focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Close event details"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <DetailItem
              label="Severity"
              value={tier > 0 ? `Tier ${tier} (${tierLabel})` : 'Unavailable'}
            />
            <DetailItem label="Device fire classification" value={currentEvent.peakFireType || 'Unavailable'} />
            <DetailItem
              label="Duration"
              value={
                currentEvent.durationSeconds !== undefined &&
                currentEvent.durationSeconds !== null
                  ? `${currentEvent.durationSeconds}s`
                  : 'Unavailable'
              }
              numeric
            />
            <DetailItem label="Status" value={currentEvent.eventStatus || 'Unavailable'} />
            <DetailItem
              label="Start time"
              value={formatTime(log.timestamp)}
              numeric
            />
            <DetailItem
              label="End time"
              value={
                currentEvent.endTime ? formatTime(currentEvent.endTime) : 'Currently active'
              }
              numeric
            />
          </dl>

          <EventEvidence
            key={currentEvent.eventId ?? currentEvent.timestamp}
            log={currentEvent}
            deviceCode={deviceCode}
            deviceState={deviceState}
            onEventUpdate={setCurrentEvent}
          />
        </div>

        <div
          className="min-h-4 w-full shrink-0 bg-ember"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        />
      </div>
    </div>
  )
}
