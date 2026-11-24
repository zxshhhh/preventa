import { useEffect, useState, type ReactNode } from 'react'
import { useOnline, formatSavedAt } from '@/lib/useOnline'
import DashboardMetricCard from './ui/DashboardMetricCard'
import ChartHoverOverlay from './ui/ChartHoverOverlay'
import { ChartHoverProvider, useChartHoverApi } from './ui/ChartHoverProvider'
import type { SensorId, SensorSeries, SeriesPoint, StatusLevel, TrendRange, RangeWindow } from '@/lib/dashboardData'
import {
  CARD_ORDER,
  NO_DATA_GAP_MESSAGE,
  SENSORS,
  deltaFromFirst,
  formatNumber,
  hasRealData,
  lastRealPoint,
  levelFor,
  rangeDeltaText,
} from '@/lib/dashboardData'

const RANGES: TrendRange[] = ['1H', '24H', '7D', '30D']

const RANGE_LABELS: Record<TrendRange, string> = {
  '1H': 'LIVE',
  '24H': '24H',
  '7D': '7D',
  '30D': '30D',
}

/** The IoT feed is considered dead when no reading has been received for this long. */
const LIVE_STALE_MS = 120_000

const ICONS: Record<SensorId, ReactNode> = {
  mq7: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 12H14M16.5 4C17.8807 4 19 5.11929 19 6.5C19 7.88071 17.8807 9 16.5 9H14M5 9H10M17 19C18.1046 19 19 18.1046 19 17C19 15.8954 18.1046 15 17 15H11M4 15H7" />
    </svg>
  ),
  dht22: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 2C12.5523 2 13 2.44772 13 3V12.5C14.1046 12.5 15 13.3954 15 14.5V17C15 19.2091 13.2091 21 11 21C8.79086 21 7 19.2091 7 17V14.5C7 13.3954 7.89543 12.5 9 12.5V3C9.44772 2 9.44772 2 10 2H12Z" />
      <circle cx="11" cy="17" r="2" />
    </svg>
  ),
  acs712: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" />
    </svg>
  ),
  humidity: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
    </svg>
  ),
}

interface CardData {
  id: SensorId
  icon: ReactNode
  title: string
  value: string
  unit: string
  decimals: number
  delta: number
  deltaLabel: string
  pulse: boolean
  chartPoints: SeriesPoint[]
  color: string
  status: { level: StatusLevel; color: string; label: string }
  statusText: string
  thresholdNominal: number
  thresholdWarning: number
  hasAnyData: boolean
  lastReadingLabel?: string
}

/** Range switches invalidate the hovered bucket — drop the selection. */
function ClearHoverOnRangeChange({ range }: { range: TrendRange }) {
  const { setHover } = useChartHoverApi()
  useEffect(() => {
    setHover(null)
  }, [range, setHover])
  return null
}

interface Props {
  series: SensorSeries[]
  chartSeries: SensorSeries[]
  range: TrendRange
  onRangeChange: (r: TrendRange) => void
  /** Timestamp of the saved snapshot currently shown (live or historical). */
  cachedAt?: number | null
  window: RangeWindow | null
  /** True when the selected fixed window has resolved with no real readings. */
  empty: boolean
  refreshing?: boolean
}

export default function DashboardSensorCards({
  series,
  chartSeries,
  range,
  onRangeChange,
  cachedAt,
  window,
  empty,
  refreshing,
}: Props) {
  const online = useOnline()
  // Re-evaluate feed freshness on a tick so the dot flips to red even when no
  // new readings arrive (and trigger no re-render otherwise). `now` starts at 0
  // and is only set client-side after mount, keeping SSR/hydration consistent.
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 5000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])

  // Newest backend reading timestamp across all buffers — both the live WS
  // stream and the 30s backfill stamp points with the device's payload time.
  let lastReadingT = 0
  for (const s of series) {
    for (const p of s.points) {
      if (typeof p.t === 'number' && p.t > lastReadingT) lastReadingT = p.t
    }
  }
  const liveFeed = online && now > 0 && lastReadingT > 0 && now - lastReadingT <= LIVE_STALE_MS

  // Card values are anchored to real readings inside the selected fixed window.
  // Gap buckets (value null) are rendered as gray diagonal no-data gaps.
  const cards: CardData[] = CARD_ORDER.map((id) => {
    const cfg = SENSORS[id]
    const chartPoints = chartSeries.find((x) => x.id === id)?.points ?? []
    const anyData = hasRealData(chartPoints)
    const lastReal = lastRealPoint(chartPoints)
    const tailGap = anyData && lastReal && chartPoints.length > 0 && chartPoints[chartPoints.length - 1]?.value == null

    return {
      id,
      icon: ICONS[id],
      title: cfg.name,
      value: lastReal ? formatNumber(lastReal.value, cfg.decimals) : '-',
      unit: cfg.unit,
      decimals: cfg.decimals,
      delta: anyData ? deltaFromFirst(chartPoints) : 0,
      deltaLabel: rangeDeltaText(range),
      pulse: range === '1H' && liveFeed && !tailGap,
      chartPoints,
      color: cfg.color,
      status: lastReal
        ? levelFor(cfg, lastReal.value)
        : { level: 'NOMINAL' as StatusLevel, color: 'var(--info-indicator)', label: 'NO DATA' },
      statusText: `WARNING > ${formatNumber(cfg.thresholdWarning, 0)} ${cfg.unit}`,
      thresholdNominal: cfg.thresholdNominal,
      thresholdWarning: cfg.thresholdWarning,
      hasAnyData: anyData,
      lastReadingLabel: tailGap ? 'Last reading' : undefined,
    }
  })

  return (
    <ChartHoverProvider>
      <ClearHoverOnRangeChange range={range} />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-base text-gray-100 tracking-wide">Activity Reading</h2>
            <p className="text-xs text-gray-400 mt-0.5">Readings adapt to the selected trend window</p>
            {!online && (
              <p className="text-xs text-(--amber-indicator) mt-0.5">
                CACHED DATA{cachedAt ? ` · ${formatSavedAt(cachedAt)}` : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-wrap bg-white/5 border border-white/10 rounded-lg p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => onRangeChange(r)}
                className={'btn-segment ' + (range === r ? 'btn-segment-active' : 'text-gray-400 hover:text-gray-200')}
              >
                {r === '1H' && (
                  <span className="relative inline-flex h-2 w-2 align-middle mr-1.5">
                    {liveFeed && (
                      <span className="absolute inline-flex h-full w-full rounded-full bg-(--green-indicator) opacity-75 animate-ping" />
                    )}
                    <span
                      className={
                        'relative inline-flex rounded-full h-2 w-2 ' +
                        (!online ? 'bg-(--amber-indicator)' : liveFeed ? 'bg-(--green-indicator)' : 'bg-(--red-indicator)')
                      }
                    />
                  </span>
                )}
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        {!online && range !== '1H' && chartSeries.every((s) => s.points.length === 0) && !empty && (
          <p role="status" className="text-sm text-(--amber-indicator)">
            No saved data for this range. Reconnect once to save it for offline use.
          </p>
        )}
        {empty && (
          <p role="status" className="text-sm text-gray-400">
            {NO_DATA_GAP_MESSAGE}
            {refreshing ? ' Checking for readings…' : ''}
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-5">
          {cards.map(({ id, ...d }) => (
            <DashboardMetricCard key={id} id={id} {...d} window={window} range={range} />
          ))}
        </div>
      </div>
      <ChartHoverOverlay chartSeries={chartSeries} range={range} />
    </ChartHoverProvider>
  )
}
