import type { ReadingEntry } from './logReport'

export const EVENT_LOOKBACK_MS = 120_000
export const EVENT_RECOVERY_MS = 60_000

export const EVIDENCE_METRICS = {
  temperature: { label: 'Temperature', unit: '°C', key: 'smooth_temperature', decimals: 1 },
  temperatureRate: { label: 'Reported temperature rise', unit: '°C/min', key: 'temp_ror', decimals: 2 },
  gas: { label: 'Gas estimate', unit: 'ppm', key: 'smooth_ppm', decimals: 1 },
  gasDeviation: { label: 'Gas above rolling baseline', unit: '%', key: 'deviation_ppm', decimals: 1 },
  current: { label: 'Current', unit: 'A', key: 'smooth_current', decimals: 3 },
  currentDelta: { label: 'Current above rolling baseline', unit: 'A', key: 'curr_delta_A', decimals: 3 },
  humidity: { label: 'Humidity', unit: '%', key: 'smooth_humidity', decimals: 1 },
  camera: { label: 'Reported fire confidence', unit: '%', key: 'cam_confidence', decimals: 1 },
  fusion: { label: 'Fusion score', unit: 'points', key: 'fusion_score', decimals: 0 },
  tier: { label: 'Device tier', unit: 'tier', key: 'final_tier', decimals: 0 },
} as const

export type EvidenceMetric = keyof typeof EVIDENCE_METRICS
export type EvidenceGroup = 'temperature' | 'gas' | 'current' | 'humidity' | 'camera' | 'fusion'

export const EVIDENCE_GROUPS: Record<EvidenceGroup, { label: string; metrics: EvidenceMetric[] }> = {
  temperature: { label: 'Temperature', metrics: ['temperature', 'temperatureRate'] },
  gas: { label: 'Gas', metrics: ['gas', 'gasDeviation'] },
  current: { label: 'Current', metrics: ['current', 'currentDelta'] },
  humidity: { label: 'Humidity', metrics: ['humidity'] },
  camera: { label: 'Camera', metrics: ['camera'] },
  fusion: { label: 'Fusion', metrics: ['fusion'] },
}

const SENSOR_STATES = [
  { key: 'state_mq7', label: 'Gas', group: 'gas' },
  { key: 'state_temp', label: 'Temperature', group: 'temperature' },
  { key: 'state_acs', label: 'Current', group: 'current' },
  { key: 'state_camera', label: 'Camera', group: 'camera' },
] as const

const STATE_LABELS = ['Normal', 'Mild', 'Moderate', 'Severe']

export function readingNumber(reading: ReadingEntry, key: string): number | null {
  const raw = reading.values[key]
  if (typeof raw !== 'number' && typeof raw !== 'string') return null
  if (typeof raw === 'string' && raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function metricValue(reading: ReadingEntry, metric: EvidenceMetric): number | null {
  if (metric === 'temperatureRate' && reading.values.temp_ror_valid !== true) return null
  const value = readingNumber(reading, EVIDENCE_METRICS[metric].key)
  if (value === null) return null
  if (metric === 'tier' && (!Number.isInteger(value) || value < 0 || value > 5)) return null
  if (metric === 'camera' && (value < 0 || value > 100)) return null
  return value
}

export function sortEventReadings(readings: ReadingEntry[]): ReadingEntry[] {
  const unique = new Map<string, ReadingEntry>()
  for (const reading of readings) {
    if (!Number.isFinite(Date.parse(reading.timestamp))) continue
    const key = reading.id === undefined ? reading.timestamp : String(reading.id)
    unique.set(key, reading)
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

export function findTriggerReading(readings: ReadingEntry[], eventStart: string): ReadingEntry | null {
  const start = Date.parse(eventStart)
  const candidates = readings.filter((reading) =>
    Math.abs(Date.parse(reading.timestamp) - start) <= 5_000 &&
    (metricValue(reading, 'tier') ?? 0) >= 3,
  )
  return candidates.sort((a, b) =>
    Math.abs(Date.parse(a.timestamp) - start) - Math.abs(Date.parse(b.timestamp) - start),
  )[0] ?? null
}

export function sensorEvidence(reading: ReadingEntry) {
  return SENSOR_STATES.map((sensor) => {
    const value = readingNumber(reading, sensor.key)
    const valid = value !== null && Number.isInteger(value) && value >= 0 && value <= 3
    return { ...sensor, state: valid ? value : null, stateLabel: valid ? STATE_LABELS[value] : 'Unavailable' }
  })
}

export function explainReading(reading: ReadingEntry) {
  const states = sensorEvidence(reading)
  const abnormal = states.filter((sensor) => sensor.state !== null && sensor.state > 0)
  const tier = metricValue(reading, 'tier')
  const initial = readingNumber(reading, 'initial_tier')
  const fusionTier = readingNumber(reading, 'fusion_tier')
  const isRecovery = tier !== null && tier > 0 && initial !== null && fusionTier !== null &&
    initial < tier && fusionTier < tier && states.every((sensor) => sensor.state === 0)

  if (isRecovery) {
    return {
      title: `Tier ${tier} retained during recovery`,
      detail: 'All recorded sensor states were normal. The device kept the higher tier while its recovery counter advanced.',
      group: 'fusion' as EvidenceGroup,
    }
  }
  if (abnormal.length === 0) {
    return {
      title: tier === 0 ? 'Normal device state' : 'Trigger details unavailable',
      detail: tier === 0
        ? 'The device reported Tier 0 at this sample.'
        : 'The saved reading has insufficient sensor-state evidence to explain this tier.',
      group: 'fusion' as EvidenceGroup,
    }
  }

  const highestState = Math.max(...abnormal.map((sensor) => sensor.state ?? 0))
  const primary = abnormal.find((sensor) => sensor.state === highestState)!
  const descriptions = abnormal.map((sensor) => `${sensor.label} state ${sensor.state}`)
  const values: string[] = []
  const temperature = metricValue(reading, 'temperature')
  const rate = metricValue(reading, 'temperatureRate')
  const gas = metricValue(reading, 'gas')
  const deviation = metricValue(reading, 'gasDeviation')
  const current = metricValue(reading, 'current')
  const delta = metricValue(reading, 'currentDelta')
  const confidence = metricValue(reading, 'camera')

  if (primary.group === 'temperature') {
    if (temperature !== null) values.push(`${temperature.toFixed(1)} °C`)
    if (rate !== null) values.push(`${rate.toFixed(2)} °C/min reported rise`)
  }
  if (primary.group === 'gas') {
    if (gas !== null) values.push(`${gas.toFixed(1)} ppm estimated gas`)
    if (deviation !== null) values.push(`${deviation.toFixed(1)}% relative to the rolling baseline`)
  }
  if (primary.group === 'current') {
    if (current !== null) values.push(`${current.toFixed(3)} A`)
    if (delta !== null) values.push(`${delta.toFixed(3)} A relative to the rolling baseline`)
  }
  if (primary.group === 'camera' && confidence !== null) values.push(`${confidence.toFixed(1)}% reported fire confidence`)

  return {
    title: abnormal.length > 1 ? 'Several sensor states contributed' : `${primary.label} reported a ${STATE_LABELS[highestState].toLowerCase()} state`,
    detail: `Recorded ${descriptions.join(', ')}.${values.length ? ` ${values.join(' · ')}.` : ''}`,
    group: primary.group as EvidenceGroup,
  }
}

export function temperatureDiscrepancy(readings: ReadingEntry[], reading: ReadingEntry): string | null {
  const rate = metricValue(reading, 'temperatureRate')
  if (rate === null || rate < 5) return null
  const time = Date.parse(reading.timestamp)
  const window = readings.filter((point) => {
    const offset = time - Date.parse(point.timestamp)
    return offset >= 0 && offset <= 45_000 && metricValue(point, 'temperature') !== null
  })
  if (window.length < 3 || time - Date.parse(window[0].timestamp) < 20_000) return null
  const temperatures = window.map((point) => metricValue(point, 'temperature')!)
  const low = Math.min(...temperatures)
  const high = Math.max(...temperatures)
  if (high - low > 0.3) return null
  return `The available temperatures over the preceding ${Math.round((time - Date.parse(window[0].timestamp)) / 1000)} s stayed between ${low.toFixed(1)} and ${high.toFixed(1)} °C while the device reported ${rate.toFixed(2)} °C/min. Internal samples between uploads are unavailable.`
}

export function samplingGapMs(readings: ReadingEntry[]): number {
  const gaps = readings.slice(1).map((point, index) =>
    Date.parse(point.timestamp) - Date.parse(readings[index].timestamp),
  ).filter((gap) => gap > 0).sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)] ?? 4_000
  return Math.max(10_000, Math.min(30_000, median * 3))
}
