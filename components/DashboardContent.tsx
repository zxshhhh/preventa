'use client'

import { useEffect, useMemo, useState } from 'react'
import type { TrendRange, RangeWindow } from '@/lib/dashboardData'
import { RANGE_MS, bucketWindow, hasRealData } from '@/lib/dashboardData'
import { isApiConfigured } from '@/lib/api/config'
import { CACHE_TAGS, CACHE_TTL } from '@/lib/api/cache'
import { useCachedQuery } from '@/lib/api/useCachedQuery'
import { fetchRangeRaw, isHistoryRange, type RangeSnapshot } from '@/lib/api/telemetry'
import { useSensors } from '@/context/useSensors'
import { useDevices } from '@/context/useDevice'
import DashboardHeader from '@/components/DashboardHeader'
import RecentReportLog from '@/components/RecentReportLog'
import DashboardSensorCards from '@/components/DashboardSensorCards'

const RANGE_REFRESH_MS = 60_000
/** Quantize the clock so 5 s ticks don't shift every bucket in four charts. */
const WINDOW_STEP_MS = 30_000
const quantizeWindowEnd = (ts: number) => Math.floor(ts / WINDOW_STEP_MS) * WINDOW_STEP_MS

export default function DashboardContent() {
  const { series, seriesByDevice, liveSavedAt, liveSavedAtByDevice, liveSeeding, liveReady } = useSensors()
  const { selected, isAllDevices } = useDevices()
  // `null` is the aggregate view; a concrete board narrows every tab and card.
  const activeDeviceId = isAllDevices || !selected ? null : selected.id
  const activeSeries = useMemo(
    () => (activeDeviceId === null ? series : seriesByDevice[activeDeviceId] ?? []),
    [activeDeviceId, series, seriesByDevice],
  )
  const activeSavedAt = activeDeviceId === null ? liveSavedAt : liveSavedAtByDevice[activeDeviceId] ?? null
  const [range, setRange] = useState<TrendRange>('1H')
  const [now, setNow] = useState(0)

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const t = setTimeout(tick, 0)
    const id = setInterval(tick, 5000)
    return () => {
      clearTimeout(t)
      clearInterval(id)
    }
  }, [])

  const bucketNow = now > 0 ? quantizeWindowEnd(now) : 0
  const liveWindow = useMemo<RangeWindow>(() => {
    const end = bucketNow
    return { start: end - RANGE_MS['1H'], end }
  }, [bucketNow])

  // Historical ranges come from the in-memory API cache. The 60 s poll is a
  // no-op for 7D/30D until local midnight has passed (fetchRangeRaw handles it).
  const rangeCacheKey = `range:${range}:device:${activeDeviceId ?? 'all'}`
  const { data: remoteSnapshot, progress: rangeProgress, savedAt: savedRangeAt } = useCachedQuery<RangeSnapshot>(
    range === '1H' ? null : rangeCacheKey,
    (fresh) => fetchRangeRaw(range, { fresh, deviceId: activeDeviceId ?? undefined }),
    {
      ...CACHE_TTL.ranges,
      tags: [CACHE_TAGS.ranges],
      enabled: range !== '1H' && isApiConfigured(),
      pollMs: RANGE_REFRESH_MS,
    },
  )

  // LIVE is a fixed 1-hour window over the real-time WS buffer. Missing buckets
  // are explicit gaps (no carry-fill/stretching).
  const liveChart = useMemo(
    () => activeSeries.map((s) => ({ id: s.id, points: bucketWindow(s.points, '1H', liveWindow, { pending: liveSeeding }) })),
    [activeSeries, liveWindow, liveSeeding],
  )

  // 7D/30D are complete calendar days, so their window comes from the saved
  // snapshot and does not slide between rollovers. Today's readings stay in
  // LIVE/24H. 24H keeps the original sliding fixed-duration window.
  const activeSnapshot = useMemo(() => {
    if (rangeProgress?.range === range) return rangeProgress
    if (remoteSnapshot?.range === range) return remoteSnapshot
    return null
  }, [rangeProgress, remoteSnapshot, range])

  const displayWindow = useMemo<RangeWindow | null>(() => {
    if (range === '1H') return liveWindow
    if (isHistoryRange(range) && activeSnapshot) return activeSnapshot.window
    const end = bucketNow
    return { start: end - RANGE_MS[range], end }
  }, [range, liveWindow, bucketNow, activeSnapshot])

  const chartSeries = useMemo(() => {
    if (range === '1H') return liveChart

    // The first fetched page is rendered immediately; the rest of the window
    // stays marked as pending until the final, cached snapshot arrives.
    const base = rangeProgress ?? remoteSnapshot
    if (!base || !displayWindow) return []
    const pending = rangeProgress !== null
    return base.series.map((s) => {
      const live = activeSeries.find((l) => l.id === s.id)?.points ?? []
      const merged = [...s.points, ...live].filter(
        (p) => typeof p.t === 'number' && p.t >= displayWindow.start && p.t <= displayWindow.end,
      )
      // Merge cached readings with live WS readings inside the active window.
      // For 7D/30D the window ends at midnight, so today's live points are
      // filtered out; 24H continues to follow current time.
      return {
        id: s.id,
        points: bucketWindow(merged, range, displayWindow, { pending }),
      }
    })
  }, [rangeProgress, remoteSnapshot, range, activeSeries, liveChart, displayWindow])

  const chartWindow: RangeWindow | null = displayWindow
  // LIVE resolves once its one-time seed has settled, even if it found nothing —
  // an empty buffer is "no data", never an endless loading state.
  const chartResolved = range === '1H' ? liveReady && !liveSeeding : remoteSnapshot !== null
  const chartEmpty = range === '1H'
    ? chartResolved && activeSeries.every((s) => !hasRealData(s.points))
    : chartSeries.length > 0 && chartSeries.every((s) => !hasRealData(s.points))
  const initialLoadPending = chartSeries.length === 0 && (range !== '1H' || !liveReady)

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader />
      <RecentReportLog />
      <DashboardSensorCards
        chartSeries={chartSeries}
        range={range}
        onRangeChange={setRange}
        cachedAt={
          range === '1H'
            ? activeSavedAt
            : isHistoryRange(range)
              ? (remoteSnapshot?.range === range ? remoteSnapshot.coverageEnd ?? savedRangeAt : savedRangeAt)
              : savedRangeAt
        }
        window={chartWindow}
        empty={chartResolved && chartEmpty}
        pending={range === '1H' ? liveSeeding : rangeProgress !== null}
        loading={initialLoadPending}
      />
    </div>
  )
}
