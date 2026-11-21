import type { SensorId, SensorSeries, TrendRange, SeriesPoint } from '@/lib/dashboardData'
import { RANGE_MS, bucketPoints, formatRangeLabel } from '@/lib/dashboardData'
import { apiGet } from './client'
import { CACHE_TAGS, CACHE_TTL, cachedFetch } from './cache'
import { ENDPOINTS } from './endpoints'

const SENSOR_IDS: SensorId[] = ['mq7', 'dht22', 'acs712', 'humidity']

const MAX_PAGES = 40
const PAGE_BATCH = 6

interface ReadingItem {
  id: number
  device: number
  timestamp: string
  smooth_ppm: number
  smooth_temperature: number
  smooth_humidity: number
  smooth_current: number
}

interface PaginatedReadings {
  count: number
  next: string | null
  previous: string | null
  results: ReadingItem[]
}

function readingsOf(r: ReadingItem): Array<[SensorId, number]> {
  return [
    ['mq7', r.smooth_ppm],
    ['dht22', r.smooth_temperature],
    ['acs712', r.smooth_current],
    ['humidity', r.smooth_humidity],
  ]
}

function normalizeReadings(results: ReadingItem[], range: TrendRange): SensorSeries[] {
  const buckets: Record<SensorId, SeriesPoint[]> = { mq7: [], dht22: [], acs712: [], humidity: [] }

  for (const r of results) {
    const t = new Date(r.timestamp).getTime()
    if (!Number.isFinite(t)) continue
    for (const [id, value] of readingsOf(r)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      buckets[id].push({t, value, label: formatRangeLabel(t, range)})
    }
  }

  return SENSOR_IDS.map((id) => ({ id, points: buckets[id] }))
}

function withPage(params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params)
  next.set('page', String(page))
  return `${ENDPOINTS.readings}?${next.toString()}`
}

function pageNumbers(totalPages: number): number[] {
  if (totalPages <= MAX_PAGES) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages = new Set<number>()
  for (let i = 0; i < MAX_PAGES; i++) {
    pages.add(1 + Math.round((i * (totalPages - 1 )) / (MAX_PAGES - 1)))
  }
  return [...pages].sort((a, b) => a - b)
}

async function fetchWindow(range: TrendRange): Promise<ReadingItem[]> {
  const end = Date.now()
  const start = end - RANGE_MS[range]
  const params = new URLSearchParams({
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  })

  const first = await apiGet<PaginatedReadings>(`${ENDPOINTS.readings}?${params.toString()}`)
  const firstResults = first.results ?? []
  if (!firstResults.length) return []

  const pageSize = firstResults.length
  const totalPages = Math.max(1, Math.ceil((first.count ?? pageSize) / pageSize))
  const pages = pageNumbers(totalPages).filter((p) => p !== 1)

  const rest: ReadingItem[] = []
  for (let i = 0; i < pages.length; i += PAGE_BATCH) {
    const batch = pages.slice(i, i + PAGE_BATCH)
    const results = await Promise.all(batch.map((page) => 
      apiGet<PaginatedReadings>(withPage(params, page))
      .then((d) => d.results ?? [])
      .catch(() => [] as ReadingItem[]),
      ),
    )
    for (const items of results) rest.push(...items)
  }

  return [...firstResults, ...rest]
}

export async function fetchLatestSeries(): Promise<SensorSeries[]> {
  const data = await apiGet<PaginatedReadings>(ENDPOINTS.readings)
  return normalizeReadings(data.results ?? [], '1H')
}

/**
 * Raw (un-bucketed) readings for the requested window — callers that merge live
 * points bucket themselves. The in-memory value stays raw; only the persisted
 * snapshot is compacted to bucketed points so history survives an offline reload
 * without blowing the localStorage budget. Live telemetry never goes through here.
 */
export function fetchRangeRaw(range: TrendRange): Promise<SensorSeries[]> {
  return cachedFetch(
    `range:${range}`,
    async () => {
      const items = await fetchWindow(range)
      if (!items.length) return []
      return normalizeReadings(items, range)
    },
    {
      ...CACHE_TTL.ranges,
      persist: true,
      tags: [CACHE_TAGS.ranges],
      storageTransform: (series) => series.map((s) => ({ id: s.id, points: bucketPoints(s.points, range) })),
    },
  )
}

export async function fetchRangeSeries(range: TrendRange): Promise<SensorSeries[]> {
  const raw = await fetchRangeRaw(range)
  return raw.map((s) => ({
    id: s.id,
    points: bucketPoints(s.points, range),
  }))
}