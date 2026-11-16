import type { SensorId } from '@/lib/dashboardData'
import { apiGet } from './client'
import { ENDPOINTS } from './endpoints'

export type ApiEventLevel = 'WARNING' | 'CRITICAL'

export interface ApiEvent {
  id: string
  sensorId: SensorId
  level: ApiEventLevel
  value: number
  unit: string
  title: string
  message: string
  timestamp: number
  read: boolean
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

const TIER_LABELS: Record<number, string> = {
  1: 'Normal',
  2: 'Mild',
  3: 'Warning',
  4: 'Severe',
}

function normalizeEvents(input: unknown): ApiEvent[] {
  if (!input || typeof input !== 'object') return []
  const obj = input as PaginatedEvents
  if (!Array.isArray(obj.results)) return []

  const out: ApiEvent[] = []
  for (const raw of obj.results) {
    const level = raw.peak_tier >= 4 ? 'CRITICAL' : 'WARNING'
    const title = `Fire alert — ${raw.peak_fire_type}`
    const tierLabel = TIER_LABELS[raw.peak_tier] ?? `Tier ${raw.peak_tier}`
    const message = `${tierLabel} · ${raw.peak_fire_type} · device ${raw.device_id}${raw.duration_seconds ? ` · ${raw.duration_seconds}s` : ''}`
    const timestamp = new Date(raw.start_time).getTime()

    out.push({
      id: String(raw.id),
      sensorId: 'mq7' as SensorId,
      level,
      value: raw.peak_tier,
      unit: 'tier',
      title,
      message,
      timestamp,
      read: raw.status !== 'active',
    })
  }
  return out
}

export async function fetchEvents(limit = 50): Promise<ApiEvent[]> {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  const data = await apiGet<PaginatedEvents>(`${ENDPOINTS.events}?${params.toString()}`)
  return normalizeEvents(data)
}

export async function fetchActiveEvents(): Promise<ApiEvent[]> {
  const data = await apiGet<PaginatedEvents>(`${ENDPOINTS.events}?status=active`)
  return normalizeEvents(data)
}