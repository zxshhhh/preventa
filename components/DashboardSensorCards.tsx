import type { ReactNode } from 'react'
import DashboardMetricCard from './ui/DashboardMetricCard'
import type { SensorId, SensorSeries, SeriesPoint, TrendRange } from '@/lib/dashboardData'
import {
  SENSORS,
  HUMIDITY_CONFIG,
  levelFor,
  deltaPercent,
  formatValue,
  deriveHumidity,
} from '@/lib/dashboardData'

const RANGES: TrendRange[] = ['24H', '7D', '30D']

interface Props {
  series: SensorSeries[]
  chartSeries: SensorSeries[]
  range: TrendRange
  onRangeChange: (r: TrendRange) => void
}

const ICONS: Record<SensorId, ReactNode> = {
  mq7: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 12H14M16.5 4C17.8807 4 19 5.11929 19 6.5C19 7.88071 17.8807 9 16.5 9H14M5 9H10M17 19C18.1046 19 19 18.1046 19 17C19 15.8954 18.1046 15 17 15H11M4 15H7" />
    </svg>
  ),
  dht22: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 2C12.5523 2 13 2.44772 13 3V12.5C14.1046 12.5 15 13.3954 15 14.5V17C15 19.2091 13.2091 21 11 21C8.79086 21 7 19.2091 7 17V14.5C7 13.3954 7.89543 12.5 9 12.5V3C9 2.44772 9.44772 2 10 2H12Z" />
      <circle cx="11" cy="17" r="2" />
    </svg>
  ),
  acs712: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" />
    </svg>
  ),
}

const HUMIDITY_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
  </svg>
)

interface CardData {
  key: string
  icon: ReactNode
  title: string
  value: string
  current: number
  unit: string
  decimals: number
  delta: number
  chartPoints: SeriesPoint[]
  color: string
  status: ReturnType<typeof levelFor>
  statusText: string
  thresholdNominal: number
  thresholdWarning: number
}

export default function DashboardSensorCards({ series, chartSeries, range, onRangeChange }: Props) {
  const cards: CardData[] = []

  for (const id of Object.keys(SENSORS) as SensorId[]) {
    const cfg = SENSORS[id]
    const points = series.find((x) => x.id === id)?.points ?? []
    const last = points[points.length - 1]
    const current = last?.value ?? cfg.baseline
    const chartPoints = chartSeries.find((x) => x.id === id)?.points ?? points
    cards.push({
      key: id,
      icon: ICONS[id],
      title: cfg.name,
      value: formatValue(current, cfg.decimals),
      current,
      unit: cfg.unit,
      decimals: cfg.decimals,
      delta: deltaPercent(points),
      chartPoints,
      color: cfg.color,
      status: levelFor(cfg, current),
      statusText: `WARNING > ${cfg.thresholdWarning} ${cfg.unit}`,
      thresholdNominal: cfg.thresholdNominal,
      thresholdWarning: cfg.thresholdWarning,
    })
    if (id === 'dht22' && points.length) {
      const hPoints = deriveHumidity(points)
      const hCurrent = hPoints[hPoints.length - 1].value
      const hChartPoints = chartPoints.length ? deriveHumidity(chartPoints) : hPoints
      cards.push({
        key: 'humidity',
        icon: HUMIDITY_ICON,
        title: HUMIDITY_CONFIG.name,
        value: formatValue(hCurrent, HUMIDITY_CONFIG.decimals),
        current: hCurrent,
        unit: HUMIDITY_CONFIG.unit,
        decimals: HUMIDITY_CONFIG.decimals,
        delta: deltaPercent(hPoints),
        chartPoints: hChartPoints,
        color: HUMIDITY_CONFIG.color,
        status: levelFor(HUMIDITY_CONFIG, hCurrent),
        statusText: `WARNING > ${HUMIDITY_CONFIG.thresholdWarning} ${HUMIDITY_CONFIG.unit}`,
        thresholdNominal: HUMIDITY_CONFIG.thresholdNominal,
        thresholdWarning: HUMIDITY_CONFIG.thresholdWarning,
      })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-base text-gray-100 tracking-wide">Activity Reading</h2>
          <p className="text-xs text-gray-400 mt-0.5">Live telemetry with selectable trend window</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap bg-white/5 border border-white/10 rounded-lg p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              className={'btn-segment ' + (range === r ? 'btn-segment-active' : 'text-gray-400 hover:text-gray-200')}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-5">
        {cards.map(({ key, ...d }) => (
          <DashboardMetricCard key={key} {...d} />
        ))}
      </div>
    </div>
  )
}