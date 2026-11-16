'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SensorSeries, TrendRange } from '@/lib/dashboardData'
import { bucketPoints } from '@/lib/dashboardData'
import { isApiConfigured } from '@/lib/api/config'
import { fetchRangeSeries } from '@/lib/api/telemetry'
import { useSensors } from '@/context/useSensors'
import DashboardHeader from '@/components/DashboardHeader'
import RecentReportLog from '@/components/RecentReportLog'
import DashboardSensorCards from '@/components/DashboardSensorCards'

const RANGE_REFRESH_MS = 60_000

export default function DashboardContent() {
  const { series } = useSensors()
  const [range, setRange] = useState<TrendRange>('1H')
  const [remote, setRemote] = useState<{ range: TrendRange; series: SensorSeries[] } | null>(null)
  const [loading, setLoading] = useState(false)

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

    console.log(`[Trend] Fetching range: ${range}`)
    setLoading(true)

    try {
      const data = await fetchRangeSeries(range)

      console.log(`[Trend] API response for ${range}:`, data)

      if (!cancelled) {
        setRemote({ range, series: data })
      }
    } catch (err) {
      console.error(`[Trend] Failed to fetch ${range}:`, err)

      if (!cancelled) {
        setRemote({ range, series: [] })
      }
    } finally {
      if (!cancelled) {
        setLoading(false)
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

  const chartSeries = range === '1H' ? liveChart : remote?.range == range ? remote.series : []

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader />
      <RecentReportLog />
      <DashboardSensorCards
        series={series}
        chartSeries={chartSeries}
        range={range}
        onRangeChange={setRange}
        loading={loading}
      />
    </div>
  )
}