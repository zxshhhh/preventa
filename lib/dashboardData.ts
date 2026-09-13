export type SensorId = 'mq7' | 'dht22' | 'acs712'
export type TrendRange = '24H' | '7D' | '30D'
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
}

export const HUMIDITY_CONFIG: SensorConfig = {
  id: 'dht22',
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
}

export function humidityFromTemp(temp: number): number {
  const h = 40 + (24.5 - temp) * 3
  return Math.round(Math.min(80, Math.max(30, h)))
}

export function deriveHumidity(points: SeriesPoint[]): SeriesPoint[] {
  return points.map((p) => ({ label: p.label, value: humidityFromTemp(p.value) }))
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

export function snapshotReadings(series: SensorSeries[]): ReportReading[] {
  const last = (id: SensorId) => series.find((s) => s.id === id)?.points.at(-1)
  const gas = last('mq7')
  const temp = last('dht22')
  const power = last('acs712')
  const readings: ReportReading[] = []

  if (gas) {
    const cfg = SENSORS.mq7
    readings.push({
      label: cfg.name,
      value: gas.value,
      unit: cfg.unit,
      decimals: cfg.decimals,
      level: levelFor(cfg, gas.value).level,
    })
  }
  if (temp) {
    const cfg = SENSORS.dht22
    readings.push({
      label: cfg.name,
      value: temp.value,
      unit: cfg.unit,
      decimals: cfg.decimals,
      level: levelFor(cfg, temp.value).level,
    })
    const humidity = humidityFromTemp(temp.value)
    readings.push({
      label: HUMIDITY_CONFIG.name,
      value: humidity,
      unit: HUMIDITY_CONFIG.unit,
      decimals: HUMIDITY_CONFIG.decimals,
      level: levelFor(HUMIDITY_CONFIG, humidity).level,
    })
  }
  if (power) {
    const cfg = SENSORS.acs712
    readings.push({
      label: cfg.name,
      value: power.value,
      unit: cfg.unit,
      decimals: cfg.decimals,
      level: levelFor(cfg, power.value).level,
    })
  }
  return readings
}

const HOUR_MS = 3600e3
const DAY_MS = 86400e3
const SEED = 20260731

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round(value * f) / f
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0
  return h & 0xffff
}

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function formatTimeLabel(d: Date): string {
  let h = d.getHours()
  const am = h < 12 ? 'AM' : 'PM'
  h = h % 12 || 12
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m} ${am}`
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function randomWalk(
  cfg: SensorConfig,
  stepMs: number,
  count: number,
  end: Date,
  rng: () => number,
  labeler: (d: Date) => string,
): SeriesPoint[] {
  const points: SeriesPoint[] = []
  let value = cfg.baseline + (rng() - 0.5) * cfg.volatility * 2
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * stepMs)
    value = clamp(value + (rng() - 0.5) * cfg.volatility, cfg.min, cfg.max)
    if (cfg.spikeChance && rng() < cfg.spikeChance) value = clamp(value + (cfg.spike ?? 0), cfg.min, cfg.max)
    points.push({ label: labeler(d), value: round(value, cfg.decimals) })
  }
  return points
}

export function generateSeries(now = new Date()): SensorSeries[] {
  return (Object.keys(SENSORS) as SensorId[]).map((id) => {
    const cfg = SENSORS[id]
    const rng = mulberry32(SEED + hash(id))
    return { id, points: randomWalk(cfg, HOUR_MS, 24, now, rng, formatTimeLabel) }
  })
}

export function buildRangeSeries(range: TrendRange, now = new Date()): SensorSeries[] {
  const count = range === '7D' ? 7 : 30
  return (Object.keys(SENSORS) as SensorId[]).map((id) => {
    const cfg = SENSORS[id]
    const rng = mulberry32(SEED + hash(id) + (range === '7D' ? 11 : 17))
    return { id, points: randomWalk(cfg, DAY_MS, count, now, rng, formatDateLabel) }
  })
}

const ALARM_PERIOD_MS = 300_000
const ALARM_EPISODE_MS = 50_000

const SYSTEM_PERIOD_MS = 300_000
const SYSTEM_OFFLINE_MS = 27_000

export function systemOnline(now = new Date()): boolean {
  const elapsed = now.getTime() % SYSTEM_PERIOD_MS
  const offset = ((hash('system::status') % 97) / 97) * (SYSTEM_PERIOD_MS - SYSTEM_OFFLINE_MS)
  return elapsed < offset || elapsed >= offset + SYSTEM_OFFLINE_MS
}function alarmTarget(cfg: SensorConfig, now: Date): number | null {
  const elapsed = now.getTime() % ALARM_PERIOD_MS
  const offset = ((hash(cfg.id) % 97) / 97) * (ALARM_PERIOD_MS - ALARM_EPISODE_MS)
  if (elapsed < offset || elapsed >= offset + ALARM_EPISODE_MS) return null
  const bump = (hash(cfg.id + '!') % 31) / 31
  return cfg.thresholdWarning * (1.02 + bump * 0.28)
}

export function tickSeries(series: SensorSeries[], now = new Date(), maxPoints = 48): SensorSeries[] {
  const label = formatTimeLabel(now)
  return series.map((s) => {
    const cfg = SENSORS[s.id]
    const pts = s.points
    const last = pts.length ? pts[pts.length - 1].value : cfg.baseline
    const prev = pts.length > 1 ? pts[pts.length - 2].value : last
    const target = alarmTarget(cfg, now)
    let value =
      last +
      (target !== null ? (target - last) * 0.28 : (last - prev) * 0.25) +
      (Math.random() - 0.5) * cfg.volatility * 0.4
    if (cfg.spikeChance && Math.random() < cfg.spikeChance) value += cfg.spike ?? 0
    const upper = target !== null ? Math.max(cfg.max, target * 1.06) : cfg.max
    value = clamp(value, cfg.min, upper)
    const rounded = round(value, cfg.decimals)

    if (pts.length && pts[pts.length - 1].label === label) {
      return { id: s.id, points: pts.slice(0, -1).concat({ label, value: rounded }) }
    }
    return { id: s.id, points: pts.concat({ label, value: rounded }).slice(-maxPoints) }
  })
}

export function recentActivity(series: SensorSeries[]): string {
  let bestName = ''
  let bestAbs = 0
  let bestDir = 1

  for (const s of series) {
    const points = s.points
    if (points.length < 8) continue
    const prev = points.slice(-7, -1)
    const last = points[points.length - 1].value
    const avg = prev.reduce((a, b) => a + b.value, 0) / prev.length
    if (avg === 0) continue
    const rel = (last - avg) / avg
    const abs = Math.abs(rel)
    if (abs > bestAbs) {
      bestAbs = abs
      bestDir = rel >= 0 ? 1 : -1
      bestName = SENSORS[s.id].name
    }
  }

  if (!bestName) return 'No recent activity'
  const verb = bestAbs >= 0.05 ? (bestDir > 0 ? 'rising' : 'dropping') : 'stable'
  return `${bestName} is ${verb}`
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