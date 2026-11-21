/**
 * API-layer cache: TTL + single-flight dedupe + optional localStorage persistence.
 *
 * Domain modules cache their *normalized* results (never raw paginated responses).
 * Live WebSocket telemetry, capture blobs, auth and one-time setup keys are never
 * cached here. Persistence is versioned, user-scoped and best-effort — quota or
 * storage errors only disable persistence; the in-memory cache keeps working.
 */

const PREFIX = 'preventa.api-cache.v1'
const MAX_ENTRIES = 50
// Bumped to fit compact (bucketed) history ranges alongside the other persisted reads.
const MAX_BYTES = 512 * 1024

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** Network-level failures (offline, DNS, timeout) are safe to mask with cached data. */
function isNetworkFailure(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  return status === 0 || isOffline()
}

export const CACHE_TAGS = {
  devices: 'devices',
  logs: 'logs',
  ranges: 'ranges',
  profile: 'profile',
  settings: 'settings',
  baselines: 'baselines',
} as const

export const CACHE_TTL = {
  devices: { ttlMs: 30_000, staleMs: 300_000 },
  logs: { ttlMs: 60_000, staleMs: 300_000 },
  ranges: { ttlMs: 60_000, staleMs: 300_000 },
  profile: { ttlMs: 300_000, staleMs: 1_800_000 },
  settings: { ttlMs: 120_000, staleMs: 600_000 },
  baselines: { ttlMs: 300_000, staleMs: 1_800_000 },
  deviceCode: { ttlMs: 3_600_000, staleMs: 86_400_000 },
} as const

export interface CacheOptions<T> {
  ttlMs: number
  staleMs?: number
  persist?: boolean
  tags?: string[]
  /** Bypass fresh + stale hits — used by polling that must see server truth. */
  fresh?: boolean
  /** Applied only when writing to localStorage (e.g. cap the persisted log history). */
  storageTransform?: (value: T) => unknown
}

interface Entry {
  value: unknown
  storedAt: number
  ttlMs: number
  staleMs: number
  tags: string[]
  persist: boolean
}

interface PersistedEntry {
  v: 1
  scope: string
  savedAt: number
  value: unknown
  tags: string[]
}

interface CacheEvent {
  value?: unknown
  refreshing: boolean
  invalidated?: boolean
}

type Listener = (event: CacheEvent) => void

const memory = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()
const listeners = new Map<string, Set<Listener>>()
let generation = 0

/** Stable per-user scope. Username is set at login and survives token refresh. */
function scope(): string {
  if (typeof window === 'undefined') return 'anon'
  try {
    const username = localStorage.getItem('preventa.username')?.trim()
    if (username) return `u:${username.toLowerCase()}`
    const token = localStorage.getItem('preventa.token')
    if (token) {
      // Legacy sessions without a stored username: a compact deterministic hash
      // keeps persisted entries from mixing users without storing the JWT itself.
      let h = 2166136261
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
      return `t:${(h >>> 0).toString(36)}`
    }
  } catch {
    /* storage unavailable */
  }
  return 'anon'
}

function scoped(key: string): string {
  return `${scope()}|${key}`
}

function plainKey(fullKey: string): string {
  const prefix = `${scope()}|`
  return fullKey.startsWith(prefix) ? fullKey.slice(prefix.length) : fullKey
}

function storageKey(fullKey: string): string {
  return `${PREFIX}:${fullKey}`
}

function readPersisted(fullKey: string): PersistedEntry | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(fullKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedEntry
    if (parsed?.v !== 1 || parsed.scope !== scope()) return null
    return parsed
  } catch {
    return null
  }
}

function storedKeys(): string[] {
  if (typeof window === 'undefined') return []
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(`${PREFIX}:`)) out.push(key)
    }
  } catch {
    /* storage unavailable */
  }
  return out
}

function removePersisted(fullKey: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey(fullKey))
  } catch {
    /* storage unavailable */
  }
}

function loadEntry<T>(fullKey: string, options: CacheOptions<T>): Entry | null {
  const existing = memory.get(fullKey)
  if (existing) return existing

  const persisted = readPersisted(fullKey)
  if (!persisted) return null
  const entry: Entry = {
    value: persisted.value as T,
    storedAt: persisted.savedAt,
    ttlMs: options.ttlMs,
    staleMs: options.staleMs ?? options.ttlMs * 10,
    tags: Array.isArray(persisted.tags) ? persisted.tags : (options.tags ?? []),
    persist: true,
  }
  memory.set(fullKey, entry)
  return entry
}

/** Best-effort write: caps both entry count and total serialized size. */
function persistEntry<T>(fullKey: string, entry: Entry, options: CacheOptions<T>): void {
  if (!options.persist || typeof window === 'undefined') return
  try {
    const payload: PersistedEntry = {
      v: 1,
      scope: scope(),
      savedAt: entry.storedAt,
      value: options.storageTransform ? options.storageTransform(entry.value as T) : entry.value,
      tags: entry.tags,
    }
    const serialized = JSON.stringify(payload)
    const key = storageKey(fullKey)
    const newSize = serialized.length + key.length

    const existing = storedKeys().filter((k) => k !== key)
    let total = 0
    const oldestFirst = existing
      .map((k) => {
        const size = (localStorage.getItem(k)?.length ?? 0) + k.length
        total += size
        let savedAt = 0
        try {
          const parsed = JSON.parse(localStorage.getItem(k) ?? '') as PersistedEntry
          if (parsed?.v === 1) savedAt = parsed.savedAt
        } catch {
          /* unreadable entry — evict first */
        }
        return { key: k, size, savedAt }
      })
      .sort((a, b) => a.savedAt - b.savedAt)

    // Evict oldest entries before writing so a near-full quota doesn't lose the new snapshot.
    while ((existing.length + 1 > MAX_ENTRIES || total + newSize > MAX_BYTES) && oldestFirst.length) {
      const victim = oldestFirst.shift()!
      total -= victim.size
      localStorage.removeItem(victim.key)
    }

    // An oversized single entry (e.g. an accidentally huge log page) is skipped.
    if (total + newSize <= MAX_BYTES) localStorage.setItem(key, serialized)
  } catch {
    /* quota / serialization failure — memory cache still works */
  }
}

function emit(key: string, event: CacheEvent): void {
  const set = listeners.get(key)
  if (!set) return
  for (const listener of set) {
    try {
      listener(event)
    } catch {
      /* one bad subscriber must not break the cache */
    }
  }
}

function refresh<T>(fullKey: string, key: string, fetcher: () => Promise<T>, options: CacheOptions<T>): Promise<T> {
  const pending = inflight.get(fullKey)
  if (pending) return pending as Promise<T>

  const atGeneration = generation

  async function execute(): Promise<T> {
    emit(key, { refreshing: true })
    try {
      const value = await fetcher()
      if (generation === atGeneration) {
        const entry: Entry = {
          value,
          storedAt: Date.now(),
          ttlMs: options.ttlMs,
          staleMs: options.staleMs ?? options.ttlMs * 10,
          tags: options.tags ?? [],
          persist: options.persist === true,
        }
        memory.set(fullKey, entry)
        persistEntry(fullKey, entry, options)
        emit(key, { value, refreshing: false })
      } else {
        // Session changed while the request was in flight — don't write it back.
        emit(key, { refreshing: false })
      }
      return value
    } catch (err) {
      emit(key, { refreshing: false })
      throw err
    } finally {
      if (inflight.get(fullKey) === running) inflight.delete(fullKey)
    }
  }

  const running = execute()
  inflight.set(fullKey, running)
  return running
}

/**
 * Fetch through the cache. Fresh hits resolve instantly; stale hits revalidate
 * in the background. Offline (or on a network-level failure) the last saved
 * value is served regardless of TTL — no fetcher is started while offline.
 */
export function cachedFetch<T>(key: string, fetcher: () => Promise<T>, options: CacheOptions<T>): Promise<T> {
  const fullKey = scoped(key)
  const entry = loadEntry(fullKey, options)
  const age = entry ? Date.now() - entry.storedAt : Number.POSITIVE_INFINITY

  // Offline: the saved snapshot is the truth for this session, however old.
  if (entry && isOffline()) return Promise.resolve(entry.value as T)
  if (!entry && isOffline()) return Promise.reject(new Error('Offline — no saved data available'))

  if (entry && !options.fresh && age < entry.ttlMs) return Promise.resolve(entry.value as T)

  if (entry && !options.fresh && age < entry.staleMs) {
    void refresh(fullKey, key, fetcher, options).catch(() => {
      /* keep the stale value; the next call retries */
    })
    return Promise.resolve(entry.value as T)
  }

  return refresh(fullKey, key, fetcher, options).catch((err) => {
    // A network failure must not replace good saved data with an error screen.
    const saved = memory.get(fullKey)
    if (saved && isNetworkFailure(err)) return saved.value as T
    throw err
  })
}

/** Synchronous peek for UI hydration — never starts a request or mutates the cache. */
export function peekCache<T>(key: string): T | undefined {
  const fullKey = scoped(key)
  if (memory.has(fullKey)) return memory.get(fullKey)!.value as T
  return readPersisted(fullKey)?.value as T | undefined
}

export interface CacheMeta {
  /** Epoch ms of the last successful read, or null when nothing has been cached. */
  savedAt: number | null
  /** True once the entry is older than its fresh TTL (still usable offline). */
  stale: boolean
}

/** Freshness metadata for "last saved" labels — never starts a request. */
export function getCacheMeta<T>(key: string, options: Pick<CacheOptions<T>, 'ttlMs' | 'staleMs'>): CacheMeta {
  const entry = loadEntry(scoped(key), options as CacheOptions<T>)
  if (!entry) return { savedAt: null, stale: false }
  return { savedAt: entry.storedAt, stale: Date.now() - entry.storedAt >= entry.ttlMs }
}

export function subscribeCache(key: string, listener: Listener): () => void {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (!set!.size) listeners.delete(key)
  }
}

function dropKey(fullKey: string): void {
  memory.delete(fullKey)
  removePersisted(fullKey)
  emit(plainKey(fullKey), { refreshing: false, invalidated: true })
}

export function invalidateKey(key: string): void {
  dropKey(scoped(key))
}

export function invalidateTags(tags: string[]): void {
  if (!tags.length) return
  const wanted = new Set(tags)

  for (const fullKey of [...memory.keys()]) {
    if (memory.get(fullKey)?.tags.some((tag) => wanted.has(tag))) dropKey(fullKey)
  }

  // Persisted entries may not have been loaded into memory this session.
  const scopePrefix = `${scope()}|`
  for (const storageFullKey of storedKeys()) {
    const keyPath = storageFullKey.slice(PREFIX.length + 1)
    if (!keyPath.startsWith(scopePrefix)) continue
    const persisted = readPersisted(keyPath)
    if (!persisted?.tags.some((tag) => wanted.has(tag))) continue
    removePersisted(keyPath)
    emit(plainKey(keyPath), { refreshing: false, invalidated: true })
  }
}

/** Wipe all entries and block in-flight writes from landing in the new session. */
export function clearApiCache(): void {
  generation++
  memory.clear()
  inflight.clear()
  for (const key of storedKeys()) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* storage unavailable */
    }
  }
  for (const key of [...listeners.keys()]) emit(key, { refreshing: false, invalidated: true })
}
