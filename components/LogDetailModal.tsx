'use client'

import { useEffect, useRef, useState } from 'react'
import { lockScroll } from '@/lib/scrollLock'
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
  fetchCaptureImage,
} from '@/lib/api/reports'
import { formatNumber } from '@/lib/dashboardData'

interface Props {
  log: LogEntry
  onClose: () => void
}

type LoadState = 'loading' | 'ready' | 'missing' | 'error'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
          'mt-1 break-words text-sm font-semibold text-gray-100 ' +
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
    label: 'TEMPERATURE',
    unit: '°C',
    keys: ['smooth_temperature', 'temperature', 'temp'],
  },
  { label: 'HUMIDITY', unit: '%', keys: ['smooth_humidity', 'humidity'] },
] as const

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

  return '—'
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

      <dl className="grid grid-cols-3 gap-2 sm:gap-3">
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

    const load = async () => {
      try {
        const url = await fetchCaptureImage(capture.id)

        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }

        objectUrl = url
        setImageUrl(url)
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
    capture.confidence !== null
      ? `, ${(capture.confidence * 100).toFixed(1)}% confidence`
      : ''

  return (
    <figure className="overflow-hidden rounded-xl border border-white/10">
      <div className="relative flex aspect-video items-center justify-center">
        {state === 'loading' && (
          <p role="status" className="text-xs text-gray-300">
            Loading image…
          </p>
        )}

        {state === 'error' && (
          <p role="alert" className="px-4 text-center text-xs text-gray-300">
            Could not load this capture image.
          </p>
        )}

        {state === 'ready' && imageUrl && (
          <img
            src={imageUrl}
            alt={`Camera snapshot near the event at ${time} — ${classification}${confidence}`}
            loading={index === 0 ? 'eager' : 'lazy'}
            decoding="async"
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <figcaption className="p-3 backdrop-blur-lg bg-transparent text-center">
        <p className="tnum text-xs text-gray-300">{time}</p>
      </figcaption>
    </figure>
  )
}

function EventEvidence({
  log,
  deviceCode,
  deviceState,
}: {
  log: LogEntry
  deviceCode: string | null
  deviceState: LoadState
}) {
  const [captures, setCaptures] = useState<CaptureEntry[]>([])
  const [reading, setReading] = useState<ReadingEntry | null>(null)
  const [captureState, setCaptureState] = useState<LoadState>('loading')
  const [readingState, setReadingState] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false

    setCaptures([])
    setReading(null)
    setCaptureState('loading')
    setReadingState('loading')

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

    const load = async () => {
      const [readingResult, captureResult] = await Promise.allSettled([
        fetchEventReadings(deviceCode, log.timestamp, log.endTime),
        fetchCaptures(deviceCode),
      ])

      if (cancelled) return

      if (readingResult.status === 'fulfilled') {
        const closest = findEventReading(readingResult.value, log.timestamp)
        setReading(closest)
        setReadingState(closest ? 'ready' : 'missing')
      } else {
        setReadingState('error')
      }

      if (captureResult.status === 'fulfilled') {
        const nearby = findCapturesNearEvent(
          captureResult.value,
          log.timestamp,
          log.endTime,
        )
        setCaptures(nearby)
        setCaptureState(nearby.length > 0 ? 'ready' : 'missing')
      } else {
        setCaptureState('error')
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [deviceCode, deviceState, log.timestamp, log.endTime])

  return (
    <>
      <section className="mt-6">
        <SectionHeading title="Sensor reading" />
        {readingState === 'loading' && <ReadingSkeleton />}
        {readingState === 'error' && (
          <p role="alert" className="text-sm text-(--red-indicator)">
            Could not load the sensor reading for this event.
          </p>
        )}
        {readingState === 'missing' && (
          <p role="status" className="text-sm text-gray-400">
            No sensor reading was recorded for this event.
          </p>
        )}
        {readingState === 'ready' && reading && (
          <EventReadingCard reading={reading} />
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
  const [deviceCode, setDeviceCode] = useState<string | null>(null)
  const [deviceState, setDeviceState] = useState<LoadState>('loading')

  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => lockScroll(), [])

  useEffect(() => {
    let cancelled = false

    setDeviceCode(null)
    setDeviceState('loading')

    if (!log.deviceId) {
      setDeviceState('missing')
      return
    }

    void (async () => {
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
    })()

    return () => {
      cancelled = true
    }
  }, [log.deviceId])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current

    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel) return

      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)

      if (focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    panel?.addEventListener('keydown', onKeyDown)

    return () => {
      panel?.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  const tier = log.peakTier ?? 0
  const tierLabel =
    tier >= 4
      ? 'Severe'
      : tier === 3
        ? 'Warning'
        : tier === 2
          ? 'Mild'
          : tier === 1
            ? 'Normal'
            : 'Unclassified'

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
        className="relative z-10 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-(--surface-solid) shadow-2xl outline-none lg:max-h-[80vh] lg:w-190 lg:max-w-4xl lg:rounded-2xl"
      >
        <header className="bg-ember shrink-0 px-5 py-4 text-(--bg-color)">
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
                className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-black/75"
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
              ref={closeRef}
              onClick={onClose}
              className="btn-icon-light flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/30 text-xl leading-none text-white hover:bg-black/40 focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Close event details"
            >
              &times;
            </button>
          </div>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <DetailItem
              label="Severity"
              value={tier > 0 ? `Tier ${tier} (${tierLabel})` : '—'}
            />
            <DetailItem label="Fire type" value={log.peakFireType || '—'} />
            <DetailItem
              label="Duration"
              value={
                log.durationSeconds !== undefined &&
                log.durationSeconds !== null
                  ? `${log.durationSeconds}s`
                  : '—'
              }
              numeric
            />
            <DetailItem label="Status" value={log.eventStatus || '—'} />
            <DetailItem
              label="Start time"
              value={formatTime(log.timestamp)}
              numeric
            />
            <DetailItem
              label="End time"
              value={
                log.endTime ? formatTime(log.endTime) : 'Currently active'
              }
              numeric
            />
          </dl>

          <EventEvidence
            log={log}
            deviceCode={deviceCode}
            deviceState={deviceState}
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
