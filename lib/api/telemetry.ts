import type { SensorId, SensorSeries, TrendRange, SeriesPoint, RangeWindow } from '@/lib/dashboardData'
import { RANGE_MS, bucketWindow, formatRangeLabel } from '@/lib/dashboardData'
import { apiGet } from './client'
import { CACHE_TAGS, CACHE_TTL, cachedFetch } from './cache'
import { ENDPOINTS } from './endpoints'

const SENSOR_IDS: SensorId[] = ['mq7', 'dht22', 'acs712', 'humidity']

const MAX_PAGES = 40
const PAGE_BATCH = 6
const MAX_PROBE_REQUESTS = 5
const ANCHOR_MS = 24 * 60 * 60 * 1000
const REQUEST_BUDGET = 48

export interface RangeSnapshot {
  range: TrendRange
  window: RangeWindow
  /** Raw timed points within the fixed window (not carry-filled). */
  series: SensorSeries[]
  /** True when fetch completed within caps/budget without known coverage holes. */
  complete: boolean
}

interface FetchWindowOptions {
  signal?: AbortSignal
  budget?: { used: number }
}

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

function normalizeReadings(results: ReadingItem[], range: TrendRange, window?: RangeWindow): SensorSeries[] {
  const buckets: Record<SensorId, SeriesPoint[]> = { mq7: [], dht22: [], acs712: [], humidity: [] }

  for (const r of results) {
    const t = new Date(r.timestamp).getTime()
    if (!Number.isFinite(t)) continue
    if (window && (t < window.start || t > window.end)) continue
    for (const [id, value] of readingsOf(r)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      buckets[id].push({ t, value, label: formatRangeLabel(t, range) })
    }
  }

  return SENSOR_IDS.map((id) => ({ id, points: buckets[id].sort((a, b) => (a.t ?? 0) - (b.t ?? 0)) }))
}

function withPage(params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params)
  next.set('page', String(page))
  return `${ENDPOINTS.readings}?${next.toString()}`
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

async function getReadings(path: string, options: FetchWindowOptions): Promise<PaginatedReadings | null> {
  const budget = options.budget
  if (budget && budget.used >= REQUEST_BUDGET) return null
  if (budget) budget.used += 1
  throwIfAborted(options.signal)
  return apiGet<PaginatedReadings>(path, { signal: options.signal })
}

function pageNumbers(totalPages: number): number[] {
  if (totalPages <= MAX_PAGES) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages = new Set<number>()
  for (let i = 0; i < MAX_PAGES; i++) {
    pages.add(1 + Math.round((i * (totalPages - 1 )) / (MAX_PAGES - 1)))
  }
  return [...pages].sort((a, b) => a - b)
}

async function fetchReadingsWindow(
  startMs: number,
  endMs: number,
  options: FetchWindowOptions = {},
): Promise<{ items: ReadingItem[]; complete: boolean }> {
  const params = new URLSearchParams({
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  })

  const first = await getReadings(`${ENDPOINTS.readings}?${params.toString()}`, options)
  if (!first) return { items: [], complete: false }
  const firstResults = first.results ?? []
  if (!firstResults.length) return { items: [], complete: true }

  const pageSize = firstResults.length
  const totalPages = Math.max(1, Math.ceil((first.count ?? pageSize) / pageSize))
  const pages = pageNumbers(totalPages).filter((p) => p !== 1)

  const rest: ReadingItem[] = []
  let complete = totalPages <= MAX_PAGES
  for (let i = 0; i < pages.length; i += PAGE_BATCH) {
    const batch = pages.slice(i, i + PAGE_BATCH)
    const results = await Promise.all(
      batch.map(async (page) => {
        try {
          const data = await getReadings(withPage(params, page), options)
          if (!data) {
            complete = false
            return [] as ReadingItem[]
          }
          return data.results ?? []
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') throw err
          complete = false
          return [] as ReadingItem[]
        }
      }),
    )
    for (const items of results) rest.push(...items)
    if (options.budget && options.budget.used >= REQUEST_BUDGET) {
      complete = false
      break
    }
  }

  return { items: [...firstResults, ...rest], complete }
}

async function probeHasData(startMs: number, endMs: number, options: FetchWindowOptions): Promise<boolean | null> {
  const params = new URLSearchParams({
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  })
  try {
    const data = await getReadings(`${ENDPOINTS.readings}?${params.toString()}`, options)
    if (!data) return null
    return (data.results?.length ?? 0) > 0 || (data.count ?? 0) > 0
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return null
  }
}

async function findNearestDataStart(window: RangeWindow, options: FetchWindowOptions): Promise<number | null> {
  // Bounded nearest probe inside the fixed window: find earliest available data
  // near window.start with a hard request cap to avoid storms.
  let probes = 0
  let lo = window.start
  let hi = window.end
  let found: number | null = null

  while (probes < MAX_PROBE_REQUESTS && lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const has = await probeHasData(lo, mid, options)
    probes += 1
    if (has === true) {
      found = mid
      hi = mid
      if (mid - lo <= 6 * 60 * 60 * 1000) break
    } else if (has === false) {
      lo = mid + 1
    } else {
      break
    }
  }

  if (found == null) {
    // Coarse fallback: scan forward in day slices, bounded by remaining probe budget.
    for (let t = window.start; t < window.end && probes < MAX_PROBE_REQUESTS; t += ANCHOR_MS) {
      const end = Math.min(window.end, t + ANCHOR_MS)
      const has = await probeHasData(t, end, options)
      probes += 1
      if (has === true) return t
      if (has === null) return null
    }
    return null
  }

  return Math.max(window.start, lo)
}

async function fetchRangeSnapshot(range: TrendRange, options: FetchWindowOptions = {}): Promise<RangeSnapshot> {
  const end = Date.now()
  const start = end - RANGE_MS[range]
  const window: RangeWindow = { start, end }
  const budget = options.budget ?? { used: 0 }
  const opts: FetchWindowOptions = { ...options, budget }

  let fetchStart = start
  let complete = true

  if (range === '30D') {
    const anchorEnd = Math.min(end, start + ANCHOR_MS)
    const anchorHasData = await probeHasData(start, anchorEnd, opts)
    if (anchorHasData === false) {
      const nearest = await findNearestDataStart(window, opts)
      if (nearest == null) {
        return { range, window, series: SENSOR_IDS.map((id) => ({ id, points: [] })), complete: false }
      }
      fetchStart = nearest
      complete = nearest <= start
    } else if (anchorHasData == null) {
      complete = false
    }
  }

  const { items, complete: fetchComplete } = await fetchReadingsWindow(fetchStart, end, opts)
  return {
    range,
    window,
    series: normalizeReadings(items, range, window),
    complete: complete && fetchComplete,
  }
}

export async function fetchLatestSeries(options: FetchWindowOptions = {}): Promise<SensorSeries[]> {
  const data = await getReadings(ENDPOINTS.readings, options)
  return normalizeReadings(data?.results ?? [], '1H')
}

function isRangeSnapshot(value: unknown): value is RangeSnapshot {
  return Boolean(value && typeof value === 'object' && 'window' in (value as object) && 'series' in (value as object))
}

function emptySnapshot(range: TrendRange, window: RangeWindow): RangeSnapshot {
  return { range, window, series: SENSOR_IDS.map((id) => ({ id, points: [] })), complete: false }
}

/**
 * Fixed-window range snapshot. Returns raw timed points within a fixed window;
 * callers bucket with bucketWindow(..., snapshot.window) so gaps are explicit.
 */
function normalizeSnapshot(value: unknown, range: TrendRange): RangeSnapshot {
  const end = Date.now()
  const fallbackWindow: RangeWindow = { start: end - RANGE_MS[range], end }
  if (isRangeSnapshot(value)) {
    const v = value as RangeSnapshot
    const w =
      v.window && Number.isFinite(v.window.start) && Number.isFinite(v.window.end)
        ? v.window
        : fallbackWindow
    const series = Array.isArray(v.series) ? v.series : []
    return { range, window: w, series: series as SensorSeries[], complete: Boolean(v.complete) }
  }
  // Legacy persisted shape: SensorSeries[]
  if (Array.isArray(value)) {
    return { range, window: fallbackWindow, series: value as SensorSeries[], complete: false }
  }
  return emptySnapshot(range, fallbackWindow)
}

export function fetchRangeRaw(range: TrendRange, options: FetchWindowOptions = {}): Promise<RangeSnapshot> {
  return cachedFetch(
    `range:${range}`,
    async () => {
      try {
        return await fetchRangeSnapshot(range, options)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        throw err
      }
    },
    {
      ...CACHE_TTL.ranges,
      persist: true,
      tags: [CACHE_TAGS.ranges],
      storageTransform: (snapshot) => {
        const s = normalizeSnapshot(snapshot, range)
        return {
          ...s,
          series: s.series.map((series) => ({ id: series.id, points: bucketWindow(series.points, range, s.window) })),
        }
      },
    },
  ).then((value) => normalizeSnapshot(value, range))
}

export async function fetchRangeSeries(range: TrendRange): Promise<SensorSeries[]> {
  const snapshot = await fetchRangeRaw(range)
  return snapshot.series.map((s) => ({
    id: s.id,
    points: bucketWindow(s.points, range, snapshot.window),
  }))
}