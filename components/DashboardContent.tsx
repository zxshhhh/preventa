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

export default function DashboardContent() {
  const { series, liveSavedAt } = useSensors()
  const [range, setRange] = useState<TrendRange>('1H')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const liveWindow = useMemo<RangeWindow>(() => {
    const end = now
    return { start: end - RANGE_MS['1H'], end }
  }, [now])

  // Historical ranges come from the in-memory API cache; the hook re-runs the
  // cached fetch on the existing 60 s cadence and re-renders when it refreshes.
  const { data: remoteSnapshot, savedAt: savedRangeAt, refreshing } = useCachedQuery<RangeSnapshot>(
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
    () => series.map((s) => ({ id: s.id, points: bucketWindow(s.points, '1H', liveWindow) })),
    [series, liveWindow],
  )

  const chartSeries = useMemo(() => {
    if (range === '1H') return liveChart

    const base = remoteSnapshot
    if (!base) return []
    return base.series.map((s) => {
      const live = series.find((l) => l.id === s.id)?.points ?? []
      const window: RangeWindow = base.window
      const inWindowLive = live.filter(
        (p) => typeof p.t === 'number' && p.t >= window.start && p.t <= window.end,
      )
      // Merge live readings inside the fixed window so the tail can advance between
      // refreshes; bucketWindow keeps missing buckets as explicit gaps.
      return {
        id: s.id,
        points: bucketWindow([...s.points, ...inWindowLive], range, window),
      }
    })
  }, [remoteSnapshot, range, series, liveChart])

  const chartWindow: RangeWindow | null = range === '1H' ? liveWindow : remoteSnapshot?.window ?? null
  const chartEmpty = chartSeries.length > 0 && chartSeries.every((s) => !hasRealData(s.points))
  const chartResolved = range === '1H' ? chartSeries.length > 0 : remoteSnapshot !== null

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader />
      <RecentReportLog />
      <DashboardSensorCards
        series={series}
        chartSeries={chartSeries}
        range={range}
        onRangeChange={setRange}
        cachedAt={range === '1H' ? liveSavedAt : savedRangeAt}
        window={chartWindow}
        empty={chartResolved && chartEmpty}
        refreshing={range !== '1H' && refreshing}
      />
    </div>
  )
}
