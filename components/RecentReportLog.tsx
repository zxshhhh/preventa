'use client'

import { useEffect, useMemo, useState } from 'react'
import { useHydrated } from '@/lib/useHydrated'
import { useOnline } from '@/lib/useOnline'
import { isApiConfigured } from '@/lib/api/config'
import { CACHE_TAGS, CACHE_TTL, peekCache } from '@/lib/api/cache'
import { useCachedQuery } from '@/lib/api/useCachedQuery'
import {
  fetchLogs,
  fetchDeviceCode,
  fetchEventReadings,
  findEventReading,
  eventReadingsCacheKey,
  LOGS_CACHE_KEY,
} from '@/lib/api/reports'
import { formatTime } from '@/lib/logReport'
import { formatNumber } from '@/lib/dashboardData'
import type { LogEntry, ReadingEntry } from '@/lib/logReport'

const MAX_REPORTS = 3
const SKELETON_REPORTS = [0, 1, 2] as const
const EMPTY_LOGS: LogEntry[] = []

const TIER_BADGE: Record<number, { badge: string; label: string }> = {
  1: { badge: 'bg-(--green-indicator)/15 text-(--green-indicator)', label: 'Normal' },
  2: { badge: 'bg-(--secondary-color)/15 text-(--secondary-color)', label: 'Mild' },
  3: { badge: 'bg-amber-400/15 text-amber-400', label: 'Warning' },
  4: { badge: 'bg-(--red-indicator)/15 text-(--red-indicator)', label: 'Severe' },
}

const READING_FIELDS = [
  { label: 'Gas', unit: 'PPM', keys: ['smooth_ppm', 'gas', 'ppm', 'mq7'] },
  { label: 'Temp', unit: '°C', keys: ['smooth_temperature', 'temperature', 'temp'] },
  { label: 'Humidity', unit: '%', keys: ['smooth_humidity', 'humidity'] },
] as const

type ReadingLoadState = 'loading' | 'ready' | 'missing' | 'error' | 'offline'

interface ReportReading {
  state: ReadingLoadState
  reading: ReadingEntry | null
}

function formatDate(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function reportKey(log: LogEntry): string {
  return log.eventId != null ? String(log.eventId) : `${log.timestamp}:${log.deviceId ?? 'na'}`
}

/** Reuse readings already saved by this screen or the report-log detail modal. */
function cachedReportReading(log: LogEntry): ReportReading | null {
  if (log.deviceId == null) return { state: 'missing', reading: null }
  const code = peekCache<string>(`device-code:${log.deviceId}`)
  if (!code) return null
  const readings = peekCache<ReadingEntry[]>(
    eventReadingsCacheKey(code, log.timestamp, log.endTime),
  )
  if (!readings) return null
  const closest = findEventReading(readings, log.timestamp)
  return { state: closest ? 'ready' : 'missing', reading: closest }
}

function readingDisplayValue(values: Record<string, unknown>, keys: readonly string[]): string {
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

function TierBadge({ tier }: { tier: number }) {
  const cfg = TIER_BADGE[tier] ?? TIER_BADGE[1]
  return (
    <span className={`text-xs font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap ${cfg.badge}`}>
      {cfg.label} (Tier {tier})
    </span>
  )
}

function ReportCard({ log, reading }: { log: LogEntry; reading: ReportReading | undefined }) {
  const hydrated = useHydrated()
  const tier = log.peakTier ?? 1
  const r = reading ?? { state: 'loading' as const, reading: null }

  return (
    <div className="border border-white/10 rounded-xl p-3 sm:p-4 flex flex-col gap-3 bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-100 tnum">
            {hydrated ? formatTime(log.timestamp) : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {hydrated ? formatDate(log.timestamp) : <span className="text-gray-500">—</span>}
          </p>
        </div>
        <TierBadge tier={tier} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {READING_FIELDS.map((field) => {
          let value = '—'
          if (r.state === 'ready' && r.reading) {
            value = readingDisplayValue(r.reading.values, field.keys)
          } else if (r.state === 'loading') {
            value = '…'
          }

          return (
            <div key={field.label} className="min-w-0 rounded-lg bg-black/20 p-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {field.label}
              </p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-1">
                <span className="tnum text-sm font-bold text-gray-100">{value}</span>
                <span className="text-xs text-gray-400">{field.unit}</span>
              </p>
            </div>
          )
        })}
      </div>

      {r.state === 'error' && (
        <p className="text-xs text-(--red-indicator)">Sensor readings unavailable.</p>
      )}
      {r.state === 'offline' && (
        <p className="text-xs text-(--amber-indicator)">Readings need a connection.</p>
      )}
    </div>
  )
}

function ReportCardSkeleton() {
  return (
    <div className="border border-white/10 rounded-xl p-3 sm:p-4 flex flex-col gap-3 bg-white/5" aria-hidden="true">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex flex-col gap-1.5">
          <div className="skeleton-shine h-4 w-16 rounded bg-white/10" />
          <div className="skeleton-shine h-3 w-24 rounded bg-white/10" />
        </div>
        <div className="skeleton-shine h-6 w-28 rounded-full bg-white/10 shrink-0" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {READING_FIELDS.map((field) => (
          <div key={field.label} className="min-w-0 rounded-lg bg-black/20 p-2.5">
            <div className="skeleton-shine h-2.5 w-10 rounded bg-white/10" />
            <div className="skeleton-shine mt-2 h-4 w-14 rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RecentReportLog() {
  const hydrated = useHydrated()
  const online = useOnline()
  const [reportReadings, setReportReadings] = useState<Record<string, ReportReading>>({})
  const [readingsLoading, setReadingsLoading] = useState(false)

  // Shares the same cached log payload as the report-logs screen; no second
  // all-pages /events/ request when both are mounted. The raw fetcher keeps one
  // cache entry so refresh() always reaches the server.
  const { data: cachedLogs, refreshing } = useCachedQuery<LogEntry[]>(
    LOGS_CACHE_KEY,
    () => fetchLogs(undefined, { raw: true }),
    {
      ...CACHE_TTL.logs,
      persist: true,
      tags: [CACHE_TAGS.logs],
      storageTransform: (logs) => logs.slice(0, 200),
      enabled: hydrated && isApiConfigured(),
    },
  )
  const logs = cachedLogs ?? EMPTY_LOGS
  const reports = useMemo(
    () => [...logs]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, MAX_REPORTS),
    [logs],
  )
  const loading = (refreshing || readingsLoading) && reports.length === 0

  useEffect(() => {
    if (!hydrated || !isApiConfigured()) return
    let cancelled = false

    const load = async () => {
      // Yield once so a cache hit doesn't call setState in the effect body.
      await Promise.resolve()
      setReadingsLoading(true)
      try {
        if (!reports.length) {
          setReportReadings({})
          return
        }

        // Seed from readings cached by this screen or the detail modal so a
        // mounted activity page never shows "…" for an already-seen report.
        const initial: Record<string, ReportReading> = {}
        for (const log of reports) {
          initial[reportKey(log)] = cachedReportReading(log) ?? {
            state: online ? 'loading' : 'offline',
            reading: null,
          }
        }
        setReportReadings(initial)

        // Offline the saved snapshot is the truth; nothing can be fetched.
        if (!online) return

        await Promise.allSettled(
          reports.map(async (log) => {
            const key = reportKey(log)

            if (log.deviceId == null) return

            try {
              const code = await fetchDeviceCode(log.deviceId)
              const readings = await fetchEventReadings(code, log.timestamp, log.endTime)
              if (cancelled) return

              const closest = findEventReading(readings, log.timestamp)
              setReportReadings((prev) => ({
                ...prev,
                [key]: { state: closest ? 'ready' : 'missing', reading: closest },
              }))
            } catch {
              if (!cancelled) {
                setReportReadings((prev) => ({ ...prev, [key]: { state: 'error', reading: null } }))
              }
            }
          }),
        )
      } catch {
        /* keep the last known reports if a reading fetch fails */
      } finally {
        if (!cancelled) setReadingsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [hydrated, reports, online])

  return (
    <section className="panel-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm text-gray-100">Recent Report Log</h2>
        <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-(--secondary-color)/10 text-(--secondary-color)">
          {reports.length}/{MAX_REPORTS}
        </span>
      </div>
      {loading ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading recent reports">
          {SKELETON_REPORTS.map((i) => (
            <ReportCardSkeleton key={i} />
          ))}
        </div>
      ) : reports.length ? (
        <div className="flex flex-col gap-3">
          {reports.map((log) => (
            <ReportCard key={reportKey(log)} log={log} reading={reportReadings[reportKey(log)]} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No reports yet.</p>
      )}
    </section>
  )
}