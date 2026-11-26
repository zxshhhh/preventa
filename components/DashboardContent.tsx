'use client'

import { useEffect, useMemo, useState } from 'react'
import type { TrendRange, RangeWindow } from '@/lib/dashboardData'
import { RANGE_MS, bucketWindow, hasRealData } from '@/lib/dashboardData'
import { isApiConfigured } from '@/lib/api/config'
import { CACHE_TAGS, CACHE_TTL } from '@/lib/api/cache'
import { useCachedQuery } from '@/lib/api/useCachedQuery'
import { fetchRangeRaw, type RangeSnapshot } from '@/lib/api/telemetry'
import { useSensors } from '@/context/useSensors'
import DashboardHeader from '@/components/DashboardHeader'
import RecentReportLog from '@/components/RecentReportLog'
import DashboardSensorCards from '@/components/DashboardSensorCards'

const RANGE_REFRESH_MS = 60_000
/** Quantize the clock so 5 s ticks don't shift every bucket in four charts. */
const WINDOW_STEP_MS = 30_000
const quantizeWindowEnd = (ts: number) => Math.floor(ts / WINDOW_STEP_MS) * WINDOW_STEP_MS

export default function DashboardContent() {
  const { series, liveSavedAt, liveSeeding } = useSensors()
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

  // Historical ranges come from the in-memory API cache; the hook re-runs the
  // cached fetch on the existing 60 s cadence and re-renders when it refreshes.
  const { data: remoteSnapshot, progress: rangeProgress, savedAt: savedRangeAt } = useCachedQuery<RangeSnapshot>(
    range === '1H' ? null : `range:${range}`,
    () => fetchRangeRaw(range),
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
    () => series.map((s) => ({ id: s.id, points: bucketWindow(s.points, '1H', liveWindow, { pending: liveSeeding }) })),
    [series, liveWindow, liveSeeding],
  )

  const displayWindow = useMemo<RangeWindow | null>(() => {
    if (range === '1H') return liveWindow
    const end = bucketNow
    return { start: end - RANGE_MS[range], end }
  }, [range, liveWindow, bucketNow])

  const chartSeries = useMemo(() => {
    if (range === '1H') return liveChart

    // The first fetched page is rendered immediately; the rest of the window
    // stays marked as pending until the final, cached snapshot arrives.
    const base = rangeProgress ?? remoteSnapshot
    if (!base || !displayWindow) return []
    const pending = rangeProgress !== null
    return base.series.map((s) => {
      const live = series.find((l) => l.id === s.id)?.points ?? []
      const merged = [...s.points, ...live].filter(
        (p) => typeof p.t === 'number' && p.t >= displayWindow.start && p.t <= displayWindow.end,
      )
      // Merge cached raw readings with live WS readings inside the sliding
      // fixed-duration window so 24H/7D/30D follow current time between polls.
      return {
        id: s.id,
        points: bucketWindow(merged, range, displayWindow, { pending }),
      }
    })
  }, [rangeProgress, remoteSnapshot, range, series, liveChart, displayWindow])

  const chartWindow: RangeWindow | null = displayWindow
  const chartEmpty = chartSeries.length > 0 && chartSeries.every((s) => !hasRealData(s.points))
  const chartResolved = range === '1H' ? chartSeries.length > 0 : remoteSnapshot !== null

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader />
      <RecentReportLog />
      <DashboardSensorCards
        chartSeries={chartSeries}
        range={range}
        onRangeChange={setRange}
        cachedAt={range === '1H' ? liveSavedAt : savedRangeAt}
        window={chartWindow}
        empty={chartResolved && chartEmpty}
        pending={range === '1H' ? liveSeeding : rangeProgress !== null}
      />
    </div>
  )
}
