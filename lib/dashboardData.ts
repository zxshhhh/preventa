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
  value: number | null
  t?: number
  /** Numeric hardware device id from the backend reading (absent on chart buckets). */
  device?: number
  /** True when this bucket had no device reading in the selected window. */
  gap?: boolean
  /** True when this bucket is unresolved because range pages are still loading. */
  loading?: boolean
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
    color: 'var(--sensor-gas)',
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
    color: 'var(--sensor-temp)',
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
    color: 'var(--sensor-power)',
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
    color: 'var(--sensor-humidity)',
    thresholdNominal: 90,
    thresholdWarning: 100,
    min: 30,
    max: 80,
    baseline: 46,
    volatility: 1,
  },
}

export const HUMIDITY_CONFIG: SensorConfig = SENSORS.humidity

/** Metric card render order (gas, temperature, humidity, power). */
export const CARD_ORDER: SensorId[] = ['mq7', 'dht22', 'humidity', 'acs712']

export const CHART_RANGES: Record<SensorId, { min: number; max: number }> = {
  mq7: { min: 0, max: 100 },       // Gas Concentration (PPM)
  dht22: { min: 15, max: 65 },    // Temperature (°C)
  humidity: { min: 40, max: 100 }, // Humidity (%)
  acs712: { min: -4, max: 8 },     // Power Usage (AMPS)
}

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

export const NO_DATA_GAP_MESSAGE = 'No data gathered from the device in this time range'

export interface WindowedSeriesPoint extends SeriesPoint {
  t: number
  value: number | null
  gap: boolean
}

export interface RangeWindow {
  start: number
  end: number
}

export function bucketWindow(
  points: SeriesPoint[],
  range: TrendRange,
  window: RangeWindow,
  options: { pending?: boolean } = {},
): WindowedSeriesPoint[] {
  const bucketCount = BUCKET_COUNT[range]
  const start = window.start
  const end = window.end
  const span = Math.max(end - start, 1)
  const size = span / bucketCount

  const sums = new Array<number>(bucketCount).fill(0)
  const counts = new Array<number>(bucketCount).fill(0)

  for (const p of points) {
    if (typeof p.t !== 'number' || !Number.isFinite(p.t)) continue
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) continue
    if (p.t < start || p.t > end) continue
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((p.t - start) / size)))
    sums[idx] += p.value
    counts[idx] += 1
  }

  const out: WindowedSeriesPoint[] = []
  for (let i = 0; i < bucketCount; i++) {
    // End-align bucket timestamps so the right edge follows the current fixed window.
    const t = Math.min(end, Math.round(start + (i + 1) * size))
    const hasData = counts[i] > 0
    out.push({
      t,
      label: formatRangeLabel(t, range),
      value: hasData ? sums[i] / counts[i] : null,
      gap: !hasData && options.pending !== true,
      loading: !hasData && options.pending === true,
    })
  }

  return out
}

/**
 * Legacy data-span bucketing kept for non-chart callers that still need compacted
 * numeric series. Chart rendering should use bucketWindow for fixed windows/gaps.
 */
export function bucketPoints(points: SeriesPoint[], range: TrendRange): SeriesPoint[] {
  const timed = points.filter(
    (p): p is SeriesPoint & { t: number; value: number } =>
      typeof p.t === 'number' && Number.isFinite(p.t) && typeof p.value === 'number' && Number.isFinite(p.value),
  )
  if (timed.length < 2) return timed

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
    out.push({ t, value, label: formatRangeLabel(t, range) })
  }

  return out
}

export function levelFor(cfg: SensorConfig, value: number): { level: StatusLevel; color: string; label: string } {
  if (value > cfg.thresholdWarning) return { level: 'CRITICAL', color: 'var(--signal-critical)', label: 'CRITICAL' }
  if (value > cfg.thresholdNominal) return { level: 'WARNING', color: 'var(--signal-warning)', label: 'WARNING' }
  return { level: 'NOMINAL', color: 'var(--signal-nominal)', label: 'NOMINAL' }
}

const numberFormatCache = new Map<number, Intl.NumberFormat>()

/**
 * Locale-formatted number with fixed decimals and thousands grouping
 * (e.g. 1,024 PPM). One shared formatter per decimals count.
 */
export function formatNumber(value: number, decimals: number): string {
  let fmt = numberFormatCache.get(decimals)
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    numberFormatCache.set(decimals, fmt)
  }
  return Number.isFinite(value) ? fmt.format(value) : '-'
}

function realPoints(points: SeriesPoint[]): Array<SeriesPoint & { value: number; t: number }> {
  return points.filter(
    (p): p is SeriesPoint & { value: number; t: number } =>
      typeof p.value === 'number' && Number.isFinite(p.value) && typeof p.t === 'number' && Number.isFinite(p.t),
  )
}

export function firstRealPoint(points: SeriesPoint[]): (SeriesPoint & { value: number; t: number }) | null {
  return realPoints(points)[0] ?? null
}

export function lastRealPoint(points: SeriesPoint[]): (SeriesPoint & { value: number; t: number }) | null {
  const real = realPoints(points)
  return real[real.length - 1] ?? null
}

export function hasRealData(points: SeriesPoint[]): boolean {
  return points.some((p) => typeof p.value === 'number' && Number.isFinite(p.value))
}

/**
 * Percent change from the first real reading in a fixed window to the last real one.
 * Missing/gap buckets are ignored so gaps do not fake continuity.
 */
export function deltaFromFirst(points: SeriesPoint[]): number {
  const real = realPoints(points)
  if (real.length < 2) return 0
  const first = real[0].value
  const last = real[real.length - 1].value
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return 0
  return ((last - first) / Math.abs(first)) * 100
}

const RANGE_DELTA_TEXT: Record<TrendRange, string> = {
  '1H': 'past hour',
  '24H': 'past 24 hrs',
  '7D': 'last 7 complete days',
  '30D': 'last 30 complete days',
}

/** Human label for the selected trend window, e.g. "past 24 hrs". */
export function rangeDeltaText(range: TrendRange): string {
  return RANGE_DELTA_TEXT[range]
}

/**
 * Full, unambiguous timestamp for the hover detail: clock-only for LIVE,
 * "Tue, Nov 17 · 10:42 AM" for longer windows, with the year on 30D.
 */
export function formatFullTimestamp(ts: number | undefined, range: TrendRange): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const time = clockLabel(d)
  if (range === '1H') return time
  const date = d.toLocaleDateString(
    'en-US',
    range === '30D'
      ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
      : { weekday: 'short', month: 'short', day: 'numeric' },
  )
  return `${date} · ${time}`
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

/** Shared metric-card chart geometry (SVG user-space units). */
export const CHART_VIEW = {
  W: 320,
  H: 130,
  M: { top: 12, right: 8, bottom: 14, left: 34 },
} as const

export interface ChartGeom {
  xAt: (i: number) => number
  yAt: (v: number) => number
  ymin: number
  ymax: number
}

/**
 * Scale mapper for the metric-card trend chart. Shared by the card itself and
 * the fullscreen hover overlay so dot positions always agree, pixel for pixel.
 */

export function chartGeom(
  points: SeriesPoint[],
  fixedRange?: { min: number; max: number },
): ChartGeom | null {
  if (!points.length) return null

  const { W, H, M } = CHART_VIEW
  const innerW = W - M.left - M.right
  const innerH = H - M.top - M.bottom

  const values = points
    .map((p) => p.value)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const dataMin = values.length ? Math.min(...values) : 0
  const dataMax = values.length ? Math.max(...values) : 1

  const pad = (dataMax - dataMin) * 0.14 || Math.max(Math.abs(dataMax) * 0.05, 1)

  const ymin = fixedRange?.min ?? dataMin - pad
  const ymax = fixedRange?.max ?? dataMax + pad
  const safeSpan = ymax - ymin || 1

  const xAt = (i: number) => M.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2)

  const yAt = (v: number) => M.top + innerH - ((v - ymin) / safeSpan) * innerH

  return { xAt, yAt, ymin, ymax }
}

/** True when a finite reading falls inside the chart's rendered y-axis bounds. */
export function isWithinChartRange(value: number | null | undefined, geom: ChartGeom): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= geom.ymin && value <= geom.ymax
}

/** Keep overlay anchors in the plot area when a reading is outside the fixed axis. */
export function clampChartY(y: number): number {
  const top = CHART_VIEW.M.top
  const bottom = CHART_VIEW.H - CHART_VIEW.M.bottom
  return Math.max(top, Math.min(y, bottom))
}

export function contiguousSegments(points: SeriesPoint[]): Array<Array<SeriesPoint & { value: number }>> {
  const segments: Array<Array<SeriesPoint & { value: number }>> = []
  let current: Array<SeriesPoint & { value: number }> = []
  for (const p of points) {
    if (typeof p.value === 'number' && Number.isFinite(p.value)) {
      current.push(p as SeriesPoint & { value: number })
    } else if (current.length) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)
  return segments
}

function bucketRanges(points: SeriesPoint[], matches: (point: SeriesPoint) => boolean): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let start: number | null = null
  for (let i = 0; i < points.length; i++) {
    const hit = matches(points[i])
    if (hit && start === null) start = i
    if (!hit && start !== null) {
      ranges.push({ start, end: i - 1 })
      start = null
    }
  }
  if (start !== null) ranges.push({ start, end: points.length - 1 })
  return ranges
}

/** Resolved no-data buckets (loading buckets are excluded). */
export function gapRanges(points: SeriesPoint[]): Array<{ start: number; end: number }> {
  return bucketRanges(
    points,
    (p) => p.loading !== true && !(typeof p.value === 'number' && Number.isFinite(p.value)),
  )
}

/** Buckets still waiting on range pages — rendered with the animated hatch. */
export function loadingRanges(points: SeriesPoint[]): Array<{ start: number; end: number }> {
  return bucketRanges(points, (p) => p.loading === true)
}


/**
 * Index in `points` matching a hovered dot from another card: nearest
 * timestamp when both series are timed (bucket timestamps line up across
 * sensors), proportional fallback otherwise. Returns -1 for empty series.
 */
export function alignedIndex(
  points: SeriesPoint[],
  hoverT: number | undefined,
  hoverIndex: number,
  hoverLen: number,
): number {
  if (!points.length) return -1
  if (typeof hoverT === 'number' && Number.isFinite(hoverT)) {
    let lo = 0
    let hi = points.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const pt = points[mid].t
      if (typeof pt === 'number' && pt < hoverT) lo = mid + 1
      else hi = mid
    }
    let best = lo
    if (lo > 0) {
      const a = points[lo - 1]
      const b = points[lo]
      const da = Math.abs((typeof a.t === 'number' ? a.t : 0) - hoverT)
      const db = Math.abs((typeof b.t === 'number' ? b.t : 0) - hoverT)
      if (da < db) best = lo - 1
    }
    return best
  }
  const ratio = hoverLen > 1 ? hoverIndex / (hoverLen - 1) : 0
  return Math.round(ratio * (points.length - 1))
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