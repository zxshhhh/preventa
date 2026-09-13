'use client'

import { useMemo, useState } from 'react'
import type { TrendRange } from '@/lib/dashboardData'
import { buildRangeSeries } from '@/lib/dashboardData'
import { useSensors } from '@/context/useSensors'
import DashboardHeader from '@/components/DashboardHeader'
import RecentReportLog from '@/components/RecentReportLog'
import DashboardSensorCards from '@/components/DashboardSensorCards'

export default function DashboardContent() {
  const { series } = useSensors()
  const [range, setRange] = useState<TrendRange>('24H')

  const chartSeries = useMemo(() => {
    if (range === '24H') return series
    return buildRangeSeries(range)
  }, [range, series])

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