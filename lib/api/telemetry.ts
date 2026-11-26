import type { SensorId, SensorSeries, TrendRange, SeriesPoint, RangeWindow } from '@/lib/dashboardData'
import { RANGE_MS, bucketWindow, formatRangeLabel } from '@/lib/dashboardData'
import { apiGet } from './client'
import { CACHE_TAGS, CACHE_TTL, cachedFetch, emitCacheProgress, peekCache } from './cache'
import { ENDPOINTS } from './endpoints'

const SENSOR_IDS: SensorId[] = ['mq7', 'dht22', 'acs712', 'humidity']

const MAX_PAGES = 40
const REQUEST_BUDGET = 48
/** Coalesce fast page batches — every emission re-renders the whole dashboard. */
const PROGRESS_EMIT_MS = 100

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_PAGE_SIZE = 1000
const RANGE_TIMEOUT_MS = 30_000
const RANGE_CONCURRENCY = 3

/** A single newly completed day at ~2 s/readings fits in ~43 pages of 1000. */
const DAY_FETCH_MAX_PAGES = 60
const DAY_FETCH_BUDGET = 80
/** If the app was closed longer, a bounded catch-up or full rebuild is safer. */
const MAX_CATCHUP_DAYS = 3

export type HistoryRange = '7D' | '30D'

const RANGE_DAYS: Record<HistoryRange, number> = { '7D': 7, '30D': 30 }

export function isHistoryRange(range: TrendRange): range is HistoryRange {
  return range === '7D' || range === '30D'
}

export interface RangeSnapshot {
  range: TrendRange
  window: RangeWindow
  /** Raw (or hourly-compacted) timed points within the fixed window. */
  series: SensorSeries[]
  /** True when fetch completed within caps/budget without known coverage holes. */
  complete: boolean
  /** True for an in-flight snapshot built from only the pages fetched so far. */
  partial: boolean
  /** Local midnight the complete-day history is covered through. */
  coverageEnd?: number
  /** Number of fully fetched days in the window (0 for a sampled bootstrap). */
  exactDays?: number
}

interface FetchWindowOptions {
  signal?: AbortSignal
  budget?: { used: number; limit?: number }
  timeout?: number
  pageSize?: number
  concurrency?: number
  maxPages?: number
  /** Freshly fetched readings only (first page, then each batch's delta). */
  onItems?: (items: ReadingItem[]) => void
}

export interface FetchRangeOptions extends FetchWindowOptions {
  /** Partial snapshot for progressive rendering; never cached or persisted. */
  onProgress?: (snapshot: RangeSnapshot) => void
  /** Bypass the saved snapshot and rebuild the whole window. */
  fresh?: boolean
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

function emptySeries(): SensorSeries[] {
  return SENSOR_IDS.map((id) => ({ id, points: [] as SeriesPoint[] }))
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function addLocalDays(ts: number, days: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** Last N complete local calendar days: [midnight N days ago, midnight today). */
function historyWindow(range: HistoryRange, boundary: number): RangeWindow {
  return { start: addLocalDays(boundary, -RANGE_DAYS[range]), end: boundary }
}

function readingsOf(r: ReadingItem): Array<[SensorId, number]> {
  return [
    ['mq7', r.smooth_ppm],
    ['dht22', r.smooth_temperature],
    ['acs712', r.smooth_current],
    ['humidity', r.smooth_humidity],
  ]
}

function normalizeReadings(
  results: ReadingItem[],
  range: TrendRange,
  window?: RangeWindow,
  exclusiveEnd = false,
): SensorSeries[] {
  const buckets: Record<SensorId, SeriesPoint[]> = { mq7: [], dht22: [], acs712: [], humidity: [] }

  for (const r of results) {
    const t = new Date(r.timestamp).getTime()
    if (!Number.isFinite(t)) continue
    if (window && (t < window.start || (exclusiveEnd ? t >= window.end : t > window.end))) continue
    for (const [id, value] of readingsOf(r)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      buckets[id].push({ t, value, label: formatRangeLabel(t, range) })
    }
  }

  return SENSOR_IDS.map((id) => ({ id, points: buckets[id].sort((a, b) => (a.t ?? 0) - (b.t ?? 0)) }))
}

/** Merge two t-ascending arrays in O(n + m); paged results can arrive out of order. */
function mergeSortedPoints(a: SeriesPoint[], b: SeriesPoint[]): SeriesPoint[] {
  if (!b.length) return a
  if (!a.length) return b
  const out: SeriesPoint[] = new Array(a.length + b.length)
  let i = 0
  let j = 0
  let k = 0
  while (i < a.length && j < b.length) {
    out[k++] = (a[i].t ?? 0) <= (b[j].t ?? 0) ? a[i++] : b[j++]
  }
  while (i < a.length) out[k++] = a[i++]
  while (j < b.length) out[k++] = b[j++]
  return out
}

/** Append one batch without re-normalizing/sorting all previously read pages. */
function appendReadings(
  series: SensorSeries[],
  items: ReadingItem[],
  range: TrendRange,
  window: RangeWindow,
): SensorSeries[] {
  if (!items.length) return series
  const additions = normalizeReadings(items, range, window)
  return series.map((s) => {
    const add = additions.find((x) => x.id === s.id)?.points ?? []
    return add.length ? { id: s.id, points: mergeSortedPoints(s.points, add) } : s
  })
}

/** Compact timed readings into hourly averages so 30 days stay small enough to persist. */
function toHourlyPoints(points: SeriesPoint[], range: TrendRange, window: RangeWindow): SeriesPoint[] {
  const groups = new Map<number, { sum: number; count: number }>()
  for (const p of points) {
    if (typeof p.t !== 'number' || !Number.isFinite(p.t)) continue
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) continue
    if (p.t < window.start || p.t >= window.end) continue
    const hour = Math.floor(p.t / HOUR_MS) * HOUR_MS
    const group = groups.get(hour) ?? { sum: 0, count: 0 }
    group.sum += p.value
    group.count += 1
    groups.set(hour, group)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, group]) => ({ t, value: group.sum / group.count, label: formatRangeLabel(t, range) }))
}

/** Hourly buckets are keyed by timestamp: a re-fetched day replaces, never duplicates. */
function mergeHourlyPoints(a: SeriesPoint[], b: SeriesPoint[]): SeriesPoint[] {
  if (!a.length) return b
  if (!b.length) return a
  const merged = new Map<number, SeriesPoint>()
  for (const p of a) if (typeof p.t === 'number') merged.set(p.t, p)
  for (const p of b) if (typeof p.t === 'number') merged.set(p.t, p)
  return [...merged.values()].sort((x, y) => (x.t ?? 0) - (y.t ?? 0))
}

function appendHourlySeries(
  series: SensorSeries[],
  items: ReadingItem[],
  range: TrendRange,
  window: RangeWindow,
): SensorSeries[] {
  if (!items.length) return series
  const normalized = normalizeReadings(items, range, window, true)
  const hourly = normalized.map((s) => ({ id: s.id, points: toHourlyPoints(s.points, range, window) }))
  return series.map((s) => {
    const add = hourly.find((x) => x.id === s.id)?.points ?? []
    return add.length ? { id: s.id, points: mergeHourlyPoints(s.points, add) } : s
  })
}

function trimSeries(series: SensorSeries[], window: RangeWindow): SensorSeries[] {
  return series.map((s) => ({
    id: s.id,
    points: s.points.filter((p) => typeof p.t === 'number' && p.t >= window.start && p.t < window.end),
  }))
}

function withPage(params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params)
  next.set('page', String(page))
  return `${ENDPOINTS.readings}?${next.toString()}`
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function notifyItems(options: FetchWindowOptions, items: ReadingItem[]) {
  if (!options.onItems) return
  try {
    options.onItems(items)
  } catch {
    /* progress reporting must never break the underlying fetch */
  }
}

async function getReadings(path: string, options: FetchWindowOptions): Promise<PaginatedReadings | null> {
  const budget = options.budget
  if (budget && budget.used >= (budget.limit ?? REQUEST_BUDGET)) return null
  if (budget) budget.used += 1
  throwIfAborted(options.signal)
  return apiGet<PaginatedReadings>(path, { signal: options.signal, timeout: options.timeout })
}

function pageNumbers(totalPages: number, maxPages: number): number[] {
  if (maxPages < 1) return []
  if (totalPages <= maxPages) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages = new Set<number>()
  for (let i = 0; i < maxPages; i++) {
    pages.add(1 + Math.round((i * (totalPages - 1)) / (maxPages - 1)))
  }
  return [...pages].sort((a, b) => a - b)
}

async function fetchReadingsWindow(
  startMs: number,
  endMs: number,
  options: FetchWindowOptions = {},
): Promise<{ complete: boolean }> {
  const params = new URLSearchParams({
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    page_size: String(options.pageSize ?? DEFAULT_PAGE_SIZE),
  })

  const first = await getReadings(`${ENDPOINTS.readings}?${params.toString()}`, options)
  if (!first) return { complete: false }
  const firstResults = first.results ?? []
  if (!firstResults.length) return { complete: true }

  const pageSize = firstResults.length
  const totalPages = Math.max(1, Math.ceil((first.count ?? pageSize) / pageSize))
  const maxPages = options.maxPages ?? MAX_PAGES
  const pages = pageNumbers(totalPages, maxPages).filter((p) => p !== 1)

  // The first page is enough to render: publish it before waiting for the rest.
  notifyItems(options, firstResults)

  const concurrency = Math.max(1, options.concurrency ?? RANGE_CONCURRENCY)
  let complete = totalPages <= maxPages
  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency)
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
    const fresh: ReadingItem[] = []
    for (const items of results) fresh.push(...items)
    notifyItems(options, fresh)
    if (options.budget && options.budget.used >= (options.budget.limit ?? REQUEST_BUDGET)) {
      complete = false
      break
    }
  }

  return { complete }
}

function makeProgress(range: TrendRange, window: RangeWindow, options: FetchRangeOptions) {
  let lastEmit = 0
  return (series: SensorSeries[]) => {
    if (!options.onProgress) return
    const at = Date.now()
    if (at - lastEmit < PROGRESS_EMIT_MS) return
    lastEmit = at
    options.onProgress({ range, window, series, complete: false, partial: true })
  }
}

function defaultFetchOptions(options: FetchRangeOptions, limit = REQUEST_BUDGET, maxPages = MAX_PAGES): FetchWindowOptions {
  return {
    signal: options.signal,
    budget: { used: options.budget?.used ?? 0, limit: options.budget?.limit ?? limit },
    pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
    concurrency: options.concurrency ?? RANGE_CONCURRENCY,
    timeout: options.timeout ?? RANGE_TIMEOUT_MS,
    maxPages: options.maxPages ?? maxPages,
  }
}

/** 1H/24H keep the original sliding fixed-duration window. */
async function fetchTimeWindowSnapshot(range: TrendRange, options: FetchRangeOptions): Promise<RangeSnapshot> {
  const end = Date.now()
  const start = end - RANGE_MS[range]
  const window: RangeWindow = { start, end }
  const publish = makeProgress(range, window, options)
  let series = emptySeries()

  const opts: FetchWindowOptions = {
    ...defaultFetchOptions(options),
    onItems: (items) => {
      series = appendReadings(series, items, range, window)
      publish(series)
    },
  }

  const { complete } = await fetchReadingsWindow(start, end, opts)
  return { range, window, series, complete, partial: false }
}

/**
 * First load of a history range. Pages are sampled across the whole window so
 * the backend sees a bounded number of requests; each midnight rollover then
 * replaces one sampled day with a fully fetched one.
 */
async function bootstrapHistory(range: HistoryRange, boundary: number, options: FetchRangeOptions): Promise<RangeSnapshot> {
  const window = historyWindow(range, boundary)
  const publish = makeProgress(range, window, options)
  let series = emptySeries()

  const opts: FetchWindowOptions = {
    ...defaultFetchOptions(options),
    onItems: (items) => {
      series = appendHourlySeries(series, items, range, window)
      publish(series)
    },
  }

  const { complete } = await fetchReadingsWindow(window.start, window.end, opts)
  return {
    range,
    window,
    series: trimSeries(series, window),
    complete,
    partial: false,
    coverageEnd: boundary,
    exactDays: 0,
  }
}

/** Fetch only the newly completed day(s) and drop the oldest day(s) from the window. */
async function rollForward(
  range: HistoryRange,
  saved: RangeSnapshot,
  boundary: number,
  options: FetchRangeOptions,
): Promise<RangeSnapshot> {
  const window = historyWindow(range, boundary)
  const publish = makeProgress(range, window, options)
  let series = trimSeries(Array.isArray(saved.series) ? saved.series : emptySeries(), window)
  publish(series)

  if (typeof saved.coverageEnd !== 'number' || !Number.isFinite(saved.coverageEnd)) {
    return bootstrapHistory(range, boundary, options)
  }

  const fetchStart = Math.max(saved.coverageEnd, window.start)
  const shared = defaultFetchOptions(options)
  let cursor = fetchStart
  let fetchedDays = 0
  let allComplete = true

  while (cursor < boundary) {
    if (fetchedDays >= MAX_CATCHUP_DAYS) return bootstrapHistory(range, boundary, options)
    const dayEnd = addLocalDays(cursor, 1)
    const dayOpts: FetchWindowOptions = {
      ...shared,
      budget: { used: 0, limit: DAY_FETCH_BUDGET },
      maxPages: DAY_FETCH_MAX_PAGES,
      onItems: (items) => {
        series = appendHourlySeries(series, items, range, window)
        publish(series)
      },
    }
    const { complete } = await fetchReadingsWindow(cursor, dayEnd, dayOpts)
    allComplete = allComplete && complete
    cursor = dayEnd
    fetchedDays += 1
  }

  const exactDays = Math.min(RANGE_DAYS[range], (saved.exactDays ?? 0) + fetchedDays)
  return {
    range,
    window,
    series: trimSeries(series, window),
    complete: allComplete && exactDays >= RANGE_DAYS[range],
    partial: false,
    coverageEnd: boundary,
    exactDays,
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
  return { range, window, series: emptySeries(), complete: false, partial: false }
}

/**
 * Fixed-window range snapshot. Returns timed points within a fixed window;
 * callers bucket with bucketWindow(..., snapshot.window) so gaps are explicit.
 */
function normalizeSnapshot(value: unknown, range: TrendRange): RangeSnapshot {
  const end = Date.now()
  const fallbackWindow: RangeWindow = isHistoryRange(range)
    ? historyWindow(range, startOfLocalDay(end))
    : { start: end - RANGE_MS[range], end }
  if (isRangeSnapshot(value)) {
    const v = value as RangeSnapshot
    const w =
      v.window && Number.isFinite(v.window.start) && Number.isFinite(v.window.end)
        ? v.window
        : fallbackWindow
    const series = Array.isArray(v.series) ? v.series : []
    return {
      range,
      window: w,
      series: series as SensorSeries[],
      complete: Boolean(v.complete),
      partial: false,
      coverageEnd: typeof v.coverageEnd === 'number' && Number.isFinite(v.coverageEnd) ? v.coverageEnd : undefined,
      exactDays: typeof v.exactDays === 'number' && Number.isFinite(v.exactDays) ? v.exactDays : undefined,
    }
  }
  // Legacy persisted shape: SensorSeries[]
  if (Array.isArray(value)) {
    return { range, window: fallbackWindow, series: value as SensorSeries[], complete: false, partial: false }
  }
  return emptySnapshot(range, fallbackWindow)
}

/** Persisted form: hourly averages for history, chart buckets for live ranges. */
function compactSnapshot(snapshot: unknown, range: TrendRange): RangeSnapshot {
  const s = normalizeSnapshot(snapshot, range)
  return {
    ...s,
    series: s.series.map((series) => ({
      id: series.id,
      points: isHistoryRange(range)
        ? toHourlyPoints(series.points, range, s.window)
        : bucketWindow(series.points, range, s.window),
    })),
  }
}

export function fetchRangeRaw(range: TrendRange, options: FetchRangeOptions = {}): Promise<RangeSnapshot> {
  const key = `range:${range}`

  // The 60 s poll is a no-op until local midnight has actually passed.
  if (isHistoryRange(range) && !options.fresh) {
    throwIfAborted(options.signal)
    const saved = peekCache<RangeSnapshot>(key)
    if (saved && saved.coverageEnd === startOfLocalDay(Date.now())) {
      // Same object reference keeps the 60 s poll from re-rendering the dashboard.
      return Promise.resolve(saved)
    }
  }

  return cachedFetch(
    key,
    async () => {
      const wrapped: FetchRangeOptions = {
        ...options,
        onProgress: (snapshot) => {
          // Progress is display-only: subscribers see it, the cache does not.
          emitCacheProgress(key, snapshot)
          options.onProgress?.(snapshot)
        },
      }

      if (isHistoryRange(range)) {
        const boundary = startOfLocalDay(Date.now())
        const saved = peekCache<RangeSnapshot>(key)
        if (
          !options.fresh &&
          saved &&
          typeof saved.coverageEnd === 'number' &&
          Number.isFinite(saved.coverageEnd) &&
          saved.coverageEnd < boundary
        ) {
          return rollForward(range, saved, boundary, wrapped)
        }
        return bootstrapHistory(range, boundary, wrapped)
      }

      return fetchTimeWindowSnapshot(range, wrapped)
    },
    {
      ...CACHE_TTL.ranges,
      persist: true,
      tags: [CACHE_TAGS.ranges],
      // History handles its own schedule (no-op until midnight); never let the
      // generic TTL turn a poll into a full rebuild.
      fresh: isHistoryRange(range) || options.fresh === true,
      storageTransform: (snapshot) => compactSnapshot(snapshot, range),
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
