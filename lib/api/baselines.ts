import { apiGet } from './client'
import { ENDPOINTS } from './endpoints'

/** Averaged readings captured during the device's last calibration run. */
export interface DeviceBaseline {
  deviceId: string | null
  createdAt: string | null
  temperatureAvg: number | null
  humidityAvg: number | null
  gasProxyAvg: number | null
  currentAvg: number | null
}

interface RawBaseline {
  id?: number | string
  device_id?: string | number
  created_at?: string | null
  timestamp?: string | null
  temperature_avg?: number | string | null
  temperature?: number | string | null
  humidity_avg?: number | string | null
  humidity?: number | string | null
  gas_avg?: number | string | null
  ppm_avg?: number | string | null
  gas_proxy_avg?: number | string | null
  current_avg?: number | string | null
  current?: number | string | null
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function pick(...values: Array<unknown>): number | null {
  for (const v of values) {
    const n = toNumberOrNull(v)
    if (n !== null) return n
  }
  return null
}

function normalizeBaseline(raw: RawBaseline): DeviceBaseline {
  return {
    deviceId: raw.device_id != null ? String(raw.device_id) : null,
    createdAt: raw.created_at ?? raw.timestamp ?? null,
    temperatureAvg: pick(raw.temperature_avg, raw.temperature),
    humidityAvg: pick(raw.humidity_avg, raw.humidity),
    gasProxyAvg: pick(raw.gas_proxy_avg, raw.gas_avg, raw.ppm_avg),
    currentAvg: pick(raw.current_avg, raw.current),
  }
}

function extractBaseline(input: unknown): DeviceBaseline | null {
  if (!input) return null
  // The endpoint may return a single object or a paginated list (latest first).
  if (Array.isArray((input as { results?: RawBaseline[] }).results)) {
    const first = (input as { results: RawBaseline[] }).results[0]
    return first ? normalizeBaseline(first) : null
  }
  if (typeof (input as RawBaseline).id !== 'undefined' || 'created_at' in (input as RawBaseline)) {
    return normalizeBaseline(input as RawBaseline)
  }
  return null
}

/** GET /baselines/?device_id=<hardware-id> — calibration context for the selected device. */
export async function fetchBaseline(hardwareId?: string): Promise<DeviceBaseline | null> {
  const params = new URLSearchParams()
  if (hardwareId) params.set('device_id', hardwareId)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const data = await apiGet<unknown>(`${ENDPOINTS.baselines}${suffix}`)
  return extractBaseline(data)
}
