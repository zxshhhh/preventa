import type { LogEntry, CaptureEntry } from '@/lib/logReport'
import { apiGet, apiBlob } from './client'
import { ENDPOINTS } from './endpoints'

export type EventStatusFilter = 'active' | 'resolved' | 'false_alarm'

export interface LogFilters {
  /** Hardware device_id string from GET /devices/ (distinct from the numeric device id on events). */
  deviceId?: string
  status?: EventStatusFilter
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toLogTimestamp(value: unknown): string {
  const trimmed = String(value).trim()
  const num = Number(trimmed)
  if (Number.isFinite(num) && /^\d+(\.\d+)?$/.test(trimmed) && trimmed.length > 8) {
    const d = new Date(num)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  return trimmed
}

interface FireEvent {
  id: number
  device_id: number
  start_time: string
  end_time: string | null
  duration_seconds: number | null
  peak_tier: number
  peak_fire_type: string
  status: 'active' | 'resolved' | 'false_alarm'
}

interface PaginatedEvents {
  count: number
  next: string | null
  previous: string | null
  results: FireEvent[]
}

interface CaptureItem {
  id: number
  device_id: number
  timestamp: string
  image: string
  image_url: string
  classification: string
  confidence: number | null
}

interface PaginatedCaptures {
  count: number
  next: string | null
  previous: string | null
  results: CaptureItem[]
}

function normalizeLogs(input: unknown): LogEntry[] {
  if (!input || typeof input !== 'object') return []
  const obj = input as PaginatedEvents
  if (!Array.isArray(obj.results)) return []

  const out: LogEntry[] = []
  for (const raw of obj.results) {
    const peakTier = raw.peak_tier ?? 0
    const status = peakTier >= 4 ? 'CRITICAL' : 'WARNING'
    out.push({
      timestamp: toLogTimestamp(raw.start_time),
      status,
      gas: 0,
      temperature: 0,
      humidity: 0,
      power: 0,
      peakTier,
      peakFireType: raw.peak_fire_type,
      eventStatus: raw.status,
      durationSeconds: raw.duration_seconds ?? undefined,
      endTime: raw.end_time ?? undefined,
      deviceId: raw.device_id,
    })
  }
  return out
}

function normalizeCaptures(input: unknown): CaptureEntry[] {
  if (!input || typeof input !== 'object') return []
  const obj = input as PaginatedCaptures
  if (!Array.isArray(obj.results)) return []

  return obj.results.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    imageUrl: r.image_url,
    classification: r.classification,
    confidence: r.confidence,
    deviceId: r.device_id,
  }))
}

export async function fetchLogs(filters?: LogFilters): Promise<LogEntry[]> {
  const params = new URLSearchParams()
  if (filters?.deviceId) params.set('device_id', filters.deviceId)
  if (filters?.status) params.set('status', filters.status)
  const qs = params.toString()
  const path = qs ? `${ENDPOINTS.events}?${qs}` : ENDPOINTS.events
  const data = await apiGet<PaginatedEvents>(path)
  return normalizeLogs(data)
}

export async function fetchCaptures(deviceId?: string): Promise<CaptureEntry[]> {
  const params = new URLSearchParams()
  if (deviceId) params.set('device_id', deviceId)
  const path = `${ENDPOINTS.captures}?${params.toString()}`
  const data = await apiGet<PaginatedCaptures>(path)
  return normalizeCaptures(data)
}

export function findNearestCapture(captures: CaptureEntry[], targetTimestamp: string): CaptureEntry | null {
  if (!captures.length) return null
  const target = new Date(targetTimestamp).getTime()
  let best: CaptureEntry | null = null
  let bestDiff = Infinity
  for (const c of captures) {
    const diff = Math.abs(new Date(c.timestamp).getTime() - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = c
    }
  }
  return best
}

/**
 * Fetches a capture image through the authenticated route (owner JWT) and returns
 * a blob object URL. The caller is responsible for revoking the URL when done.
 */
export async function fetchCaptureImage(id: string | number): Promise<string> {
  const blob = await apiBlob(ENDPOINTS.captureImage(id))
  return URL.createObjectURL(blob)
}