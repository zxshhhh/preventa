export type SensorId = 'mq7' | 'dht22' | 'acs712' | 'humidity'
export type TrendRange = '1H' | '24H' | '7D' | '30D'
export type StatusLevel = 'NOMINAL' | 'WARNING' | 'CRITICAL'

export interface SensorConfig {
  id: SensorId
  name: string
  unit: string
  decimals: number
  color: string
  thresholdNominal: number
  thresholdWarning: number
  min: number
  max: number
  baseline: number
  volatility: number
  spikeChance?: number
  spike?: number
}

export interface SeriesPoint {
  label: string
  value: number
  t?: number
}

export interface SensorSeries {
  id: SensorId
  points: SeriesPoint[]
}

export const SENSORS: Record<SensorId, SensorConfig> = {
  mq7: {
    id: 'mq7',
    name: 'Gas Concentration',
    unit: 'PPM',
    decimals: 0,
    color: '#60A5FA',
    thresholdNominal: 50,
    thresholdWarning: 100,
    min: 10,
    max: 95,
    baseline: 22,
    volatility: 5,
    spikeChance: 0.02,
    spike: 30,
  },
  dht22: {
    id: 'dht22',
    name: 'Temperature',
    unit: '°C',
    decimals: 1,
    color: '#FB923C',
    thresholdNominal: 40,
    thresholdWarning: 50,
    min: 16,
    max: 34,
    baseline: 24.5,
    volatility: 1.8,
  },
  acs712: {
    id: 'acs712',
    name: 'Power Usage',
    unit: 'AMPS',
    decimals: 2,
    color: '#FACC15',
    thresholdNominal: 6,
    thresholdWarning: 8,
    min: 1.5,
    max: 7.5,
    baseline: 3.9,
    volatility: 0.65,
  },
  humidity: {
    id: 'humidity',
    name: 'Humidity',
    unit: '%',
    decimals: 0,
    color: '#22D3EE',
    thresholdNominal: 50,
    thresholdWarning: 70,
    min: 30,
    max: 80,
    baseline: 46,
    volatility: 1,
  },
}

export const HUMIDITY_CONFIG: SensorConfig = SENSORS.humidity

export interface ReportReading {
  label: string
  value: number
  unit: string
  decimals: number
  level: StatusLevel
}

export interface ReportLog {
  id: string
  timestamp: number
  readings: ReportReading[]
}

export const RANGE_MS: Record<TrendRange, number> = {
  '1H': 60 * 60 * 1000,
  '24H': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '30D': 30 * 24 * 60 * 60 * 1000,
}

const BUCKET_COUNT: Record<TrendRange, number> = {
  '1H': 60,
  '24H': 96,
  '7D': 84,
  '30D': 90,
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function clockLabel(d: Date): string {
  const h24 = d.getHours()
  const suffix = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 || 12
  return `${h12}:${pad2(d.getMinutes())} ${suffix}`
}

export function formatRangeLabel(ts: number, range: TrendRange): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  if (range === '30D') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (range === '7D') return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${clockLabel(d)}`
  return clockLabel(d)
}

export function bucketPoints(points: SeriesPoint[], range: TrendRange): SeriesPoint[] {
  const timed = points.filter((p): p is SeriesPoint & { t: number } => typeof p.t === 'number' && Number.isFinite(p.t))
  if (timed.length < 2) return points

  const sorted = [...timed].sort((a, b) => a.t - b.t)
  const start = sorted[0].t
  const end = sorted[sorted.length - 1].t
  const bucketCount = BUCKET_COUNT[range]
  const size = Math.max((end - start) / bucketCount, 1)

  const sums = new Array<number>(bucketCount).fill(0)
  const counts = new Array<number>(bucketCount).fill(0)

  for (const p of sorted) {
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((p.t - start) / size)))
    sums[idx] += p.value
    counts[idx] += 1
  }

  const out: SeriesPoint[] = []
  let carry: number | null = null

  for (let i = 0; i < bucketCount; i++) {
    const value: number | null = counts[i] > 0 ? sums[i] / counts[i] : carry
    if (value === null) continue
    carry = value
    const t = Math.round(start + i * size)
    out.push({ t, value, label: formatRangeLabel(t, range)})
  }

  return out
}

export function levelFor(cfg: SensorConfig, value: number): { level: StatusLevel; color: string; label: string } {
  if (value > cfg.thresholdWarning) return { level: 'CRITICAL', color: '#F87171', label: 'CRITICAL' }
  if (value > cfg.thresholdNominal) return { level: 'WARNING', color: '#FBBF24', label: 'WARNING' }
  return { level: 'NOMINAL', color: '#34D399', label: 'NOMINAL' }
}

export function formatValue(value: number, decimals: number): string {
  return value.toFixed(decimals)
}

export function deltaPercent(points: SeriesPoint[], back = 6): number {
  if (points.length < back + 1) return 0
  const last = points[points.length - 1].value
  const slice = points.slice(-back - 1, -1)
  const avg = slice.reduce((a, b) => a + b.value, 0) / slice.length
  if (avg === 0) return 0
  return ((last - avg) / avg) * 100
}

export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

export function sparklineLayout(
  points: SeriesPoint[],
  width = 96,
  height = 32,
): { line: string; area: string; last: { x: number; y: number } | null } {
  if (points.length < 2) return { line: '', area: '', last: null }
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const xy = points.map((p, i) => ({
    x: (i / (points.length - 1)) * width,
    y: height - 3 - ((p.value - min) / span) * (height - 6),
  }))
  const line = smoothPath(xy)
  const area = line ? line + ` L ${width} ${height} L 0 ${height} Z` : ''
  return { line, area, last: xy[xy.length - 1] }
}

function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / Math.pow(10, exponent)
  let nf: number
  if (round) nf = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10
  else nf = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nf * Math.pow(10, exponent)
}

export function buildTicks(min: number, max: number, count = 4): number[] {
  const span = max - min
  if (span <= 0) return [min]
  const rough = span / (count - 1)
  const step = niceNum(rough, false)
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)))
  return ticks
}