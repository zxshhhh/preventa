'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SensorSeries, TrendRange } from '@/lib/dashboardData'
import { bucketPoints } from '@/lib/dashboardData'
import { isApiConfigured } from '@/lib/api/config'
import { fetchRangeRaw } from '@/lib/api/telemetry'
import { useSensors } from '@/context/useSensors'
import DashboardHeader from '@/components/DashboardHeader'
import RecentReportLog from '@/components/RecentReportLog'
import DashboardSensorCards from '@/components/DashboardSensorCards'

const RANGE_REFRESH_MS = 60_000

export default function DashboardContent() {
  const { series } = useSensors()
  const [range, setRange] = useState<TrendRange>('1H')
  const [remote, setRemote] = useState<{ range: TrendRange; series: SensorSeries[] } | null>(null)

  // LIVE is the WebSocket buffer itself: every streamed reading (~2s cadence)
  // renders the moment it arrives. The provider keeps it filled — a one-time
  // hour seed on mount plus the live stream — so no time-based fetch here.
  const liveChart = useMemo(
    () => series.map((s) => ({ id: s.id, points: bucketPoints(s.points, '1H')})),
    [series]
  )

  useEffect(() => {
    if (range === '1H' || !isApiConfigured()) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const load = async () => {
      if (cancelled) return

      try {
        const data = await fetchRangeRaw(range)
        if (!cancelled) setRemote({ range, series: data })
      } catch {
        if (!cancelled) setRemote({ range, series: [] })
      } finally {
        if (!cancelled) {
          timer = setTimeout(load, RANGE_REFRESH_MS)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [range])

  const chartSeries = useMemo(() => {
    if (range === '1H') return liveChart

    // Historical ranges chart the fetched backend window; live WS readings
    // newer than the last fetched point are merged in so the tail ticks in
    // real time between the 60s refreshes. Merge on raw points, bucket once.
    const base = remote?.range === range ? remote.series : null
    if (!base || !base.length) return []
    return base.map((s) => {
      const lastT = s.points.length ? s.points[s.points.length - 1].t ?? 0 : 0
      const live = series.find((l) => l.id === s.id)?.points ?? []
      const fresh = live.filter((p) => typeof p.t === 'number' && p.t > lastT)
      return {
        id: s.id,
        points: bucketPoints(fresh.length ? [...s.points, ...fresh] : s.points, range),
      }
    })
  }, [remote, range, series, liveChart])

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader />
      <RecentReportLog />
      <DashboardSensorCards
        series={series}
        chartSeries={chartSeries}
        range={range}
        onRangeChange={setRange}
      />
    </div>
  )
}
