import type {
  LogEntry,
  CaptureEntry,
  ReadingEntry,
} from '@/lib/logReport'

import { apiGet, apiBlob } from './client'
import { CACHE_TAGS, CACHE_TTL, cachedFetch } from './cache'
import { ENDPOINTS } from './endpoints'
import { EVENT_LOOKBACK_MS, EVENT_RECOVERY_MS } from '@/lib/eventEvidence'

export type EventStatusFilter = 'active' | 'resolved' | 'false_alarm'

export interface LogFilters {
  /**
   * Hardware device code.
   * This is different from the numeric device ID stored on events.
   */
  deviceId?: string | number
  status?: EventStatusFilter
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

interface DeviceDetail {
  id: number
  device_id: string
}

interface CaptureItem {
  id: number
  device_id: number
  timestamp: string
  image?: string
  image_url?: string
  classification: string
  confidence: number | null
}

interface PaginatedCaptures {
  count: number
  next: string | null
  previous: string | null
  results: CaptureItem[]
}

interface PaginatedReadings {
  count?: number
  next?: string | null
  previous?: string | null
  results?: Record<string, unknown>[]
}

interface RawReading {
  id?: number | string
  timestamp?: string
  created_at?: string
  recorded_at?: string
  time?: string
  [key: string]: unknown
}

/**
 * Captures slightly before and after the event window are included
 * because the camera timestamp may not exactly match the event time.
 *
 * These margins do not prove that a capture belongs to an event.
 */
const CAPTURE_BEFORE_SECONDS = 10
const CAPTURE_AFTER_SECONDS = 30

function normalizeLogs(input: unknown): LogEntry[] {
  if (!input || typeof input !== 'object') return []

  const obj = input as PaginatedEvents
  if (!Array.isArray(obj.results)) return []

  return obj.results.map((raw) => {
    const peakTier = Number(raw.peak_tier ?? 0)

    return {
      eventId: raw.id,
      timestamp: raw.start_time,
      status: peakTier >= 4 ? 'CRITICAL' : 'WARNING',
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
    }
  })
}

function normalizeCaptures(input: unknown): CaptureEntry[] {
  if (!input || typeof input !== 'object') return []

  const obj = input as PaginatedCaptures
  if (!Array.isArray(obj.results)) return []

  return obj.results.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    imageUrl: r.image_url ?? r.image ?? '',
    classification: r.classification,
    confidence: r.confidence,
    deviceId: r.device_id,
  }))
}

function normalizeReading(raw: Record<string, unknown>): ReadingEntry {
  const reading = raw as RawReading

  const timestamp =
    reading.timestamp ??
    reading.created_at ??
    reading.recorded_at ??
    reading.time ??
    ''

  const values = { ...raw }

  delete values.id
  delete values.timestamp
  delete values.created_at
  delete values.recorded_at
  delete values.time

  return {
    id: reading.id,
    timestamp: String(timestamp),
    values,
  }
}

/**
 * Handles relative and absolute pagination URLs.
 * apiGet expects a path relative to the configured API base URL.
 */
function getRelativeApiPath(url: string): string {
  if (url.startsWith('/')) return url

  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

async function fetchAllCapturePages(
  initialPath: string,
): Promise<CaptureEntry[]> {
  const all: CaptureEntry[] = []
  const visited = new Set<string>()

  let path: string | null = initialPath

  while (path && !visited.has(path)) {
    visited.add(path)
    const data: PaginatedCaptures = await apiGet<PaginatedCaptures>(path)

    if (Array.isArray(data.results)) {
      all.push(...normalizeCaptures(data))
    }

    path = data.next ? getRelativeApiPath(data.next) : null
  }

  return all
}

async function fetchAllReadingPages(
  initialPath: string,
): Promise<ReadingEntry[]> {
  const all: ReadingEntry[] = []
  const visited = new Set<string>()

  let path: string | null = initialPath

  while (path && !visited.has(path)) {
    visited.add(path)
    const data: PaginatedReadings = await apiGet<PaginatedReadings>(path)
    if (Array.isArray(data.results)) {
      all.push(
        ...data.results.map((item) => normalizeReading(item)),
      )
    }

    path = data.next ? getRelativeApiPath(data.next) : null
  }

  return all
}

/**
 * Loads every page of fire events so callers can see the full history,
 * including events from older years that aren't on the first page.
 */
async function fetchAllEventPages(
  initialPath: string,
): Promise<LogEntry[]> {
  const all: LogEntry[] = []
  const visited = new Set<string>()

  let path: string | null = initialPath

  while (path && !visited.has(path)) {
    visited.add(path)
    const data: PaginatedEvents = await apiGet<PaginatedEvents>(path)

    if (Array.isArray(data.results)) {
      all.push(...normalizeLogs(data))
    }

    path = data.next ? getRelativeApiPath(data.next) : null
  }

  return all
}

/**
 * Loads fire events. The assembled (all-pages) result is cached; persistence is
 * capped to the newest 200 entries so a long event history cannot fill storage.
 */
export function fetchLogs(
  filters?: LogFilters,
  options?: { fresh?: boolean },
): Promise<LogEntry[]> {
  const key = `logs:${filters?.deviceId ?? ''}:${filters?.status ?? ''}`
  const params = new URLSearchParams()

  if (filters?.deviceId) {
    params.set('device_id', String(filters.deviceId))
  }

  if (filters?.status) {
    params.set('status', filters.status)
  }

  const qs = params.toString()
  const path = qs
    ? `${ENDPOINTS.events}?${qs}`
    : ENDPOINTS.events

  return cachedFetch(key, () => fetchAllEventPages(path), {
    ...CACHE_TTL.logs,
    persist: true,
    tags: [CACHE_TAGS.logs],
    fresh: options?.fresh,
    storageTransform: (logs) => logs.slice(0, 200),
  })
}

/**
 * Retrieves the actual ESP32 device code using the numeric
 * database ID stored in event.device_id.
 *
 * Example:
 * Event device_id = 3
 * GET /api/v1/devices/3/
 * Response device_id = "ESP32CAM_001"
 */
export function fetchDeviceCode(
  numericDeviceId: number,
): Promise<string> {
  return cachedFetch(
    `device-code:${numericDeviceId}`,
    async () => {
      const device = await apiGet<DeviceDetail>(
        ENDPOINTS.device(numericDeviceId),
      )

      if (!device?.device_id) {
        throw new Error(
          `Device ${numericDeviceId} did not return a hardware device_id.`,
        )
      }

      return String(device.device_id)
    },
    { ...CACHE_TTL.deviceCode, tags: [CACHE_TAGS.devices] },
  )
}

/**
 * Loads readings for a specific device and event time window.
 *
 * Include two minutes before the trigger and one minute after resolution.
 * Active events end at the current time.
 */
export async function fetchEventReadings(
  deviceCode: string,
  eventStart: string,
  eventEnd?: string | null,
): Promise<ReadingEntry[]> {
  const startDate = new Date(eventStart)

  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Invalid event start timestamp.')
  }

  startDate.setTime(startDate.getTime() - EVENT_LOOKBACK_MS)

  const endDate = eventEnd ? new Date(eventEnd) : new Date()

  if (Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid event end timestamp.')
  }
  if (eventEnd) endDate.setTime(Math.min(Date.now(), endDate.getTime() + EVENT_RECOVERY_MS))

  const params = new URLSearchParams({
    device_id: deviceCode,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  })

  return fetchAllReadingPages(
    `${ENDPOINTS.readings}?${params.toString()}`,
  )
}

/**
 * Loads all captures for a hardware device, following pagination.
 */
export async function fetchCaptures(
  deviceCode: string,
): Promise<CaptureEntry[]> {
  const params = new URLSearchParams({
    device_id: deviceCode,
  })

  return fetchAllCapturePages(
    `${ENDPOINTS.captures}?${params.toString()}`,
  )
}

/**
 * Finds every capture within the event window, including a small
 * timestamp margin before and after the event.
 *
 * Results are ordered from oldest to newest.
 *
 * These are nearby captures, not confirmed event-linked images.
 */
export function findCapturesNearEvent(
  captures: CaptureEntry[],
  eventStart: string,
  eventEnd?: string | null,
): CaptureEntry[] {
  const start = new Date(eventStart).getTime()

  const end = eventEnd
    ? new Date(eventEnd).getTime()
    : Date.now()

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return []
  }

  const lowerBound =
    start - CAPTURE_BEFORE_SECONDS * 1000

  const upperBound =
    end + CAPTURE_AFTER_SECONDS * 1000

  return captures
    .filter((capture) => {
      const timestamp = new Date(capture.timestamp).getTime()

      return (
        Number.isFinite(timestamp) &&
        timestamp >= lowerBound &&
        timestamp <= upperBound
      )
    })
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime(),
    )
}

/**
 * Returns the single reading closest to the event start.
 *
 * The backend saves the triggering reading just before creating the
 * corresponding event, so the nearest reading is the most relevant one
 * to display. Ties favour the earlier reading.
 */
export function findEventReading(
  readings: ReadingEntry[],
  eventStart: string,
): ReadingEntry | null {
  const start = new Date(eventStart).getTime()
  if (!Number.isFinite(start)) return null

  let closest: ReadingEntry | null = null
  let closestTime = Number.POSITIVE_INFINITY
  let smallestDistance = Number.POSITIVE_INFINITY

  for (const reading of readings) {
    const timestamp = new Date(reading.timestamp).getTime()
    if (!Number.isFinite(timestamp)) continue

    const distance = Math.abs(timestamp - start)

    if (
      distance < smallestDistance ||
      (distance === smallestDistance && timestamp < closestTime)
    ) {
      closest = reading
      closestTime = timestamp
      smallestDistance = distance
    }
  }

  return closest
}

/**
 * Fetches an image through the authenticated route using the
 * user's Bearer token and returns a blob object URL.
 *
 * The component using this URL must revoke it when finished.
 */
export async function fetchCaptureImage(
  id: string | number,
): Promise<string> {
  const blob = await apiBlob(ENDPOINTS.captureImage(id))
  return URL.createObjectURL(blob)
}
