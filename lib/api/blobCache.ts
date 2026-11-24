/**
 * Authenticated capture-image cache.
 *
 * The JSON API cache cannot hold object URLs (they die on reload) or blobs
 * (too large for localStorage), so capture bytes live in IndexedDB with a small
 * in-memory map for instant reuse and single-flight dedupe. Writes are
 * best-effort: quota/private-mode errors only disable persistence.
 *
 * This module deliberately does not import the API client — callers pass a
 * fetcher so the cache stays independent of auth/token refresh logic.
 */
import { getCacheScope } from './cacheScope'

const DB_NAME = 'preventa-capture-blobs'
const DB_VERSION = 1
const STORE = 'captures'
const MAX_ENTRIES = 60
const MAX_BYTES = 20 * 1024 * 1024

interface StoredBlob {
  key: string
  blob: Blob
  savedAt: number
}

const memory = new Map<string, Blob>()
const inflight = new Map<string, Promise<Blob>>()

function scopedKey(id: string | number): string {
  return `${getCacheScope()}|${id}`
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

async function readStored(key: string): Promise<Blob | null> {
  const db = await openDb()
  if (!db) return null
  try {
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(key)
      request.onsuccess = () => resolve((request.result as StoredBlob | undefined)?.blob ?? null)
      request.onerror = () => resolve(null)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    })
  } catch {
    return null
  } finally {
    db.close()
  }
}

/** Cap both entry count and total bytes, evicting the oldest blobs first. */
async function writeStored(key: string, blob: Blob): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const all = store.getAll()

      all.onsuccess = () => {
        const entries = ((all.result ?? []) as StoredBlob[])
          .filter((entry) => entry?.key !== key)
          .sort((a, b) => a.savedAt - b.savedAt)
        let total = entries.reduce((sum, entry) => sum + (entry.blob?.size ?? 0), 0)

        while (
          entries.length &&
          (entries.length + 1 > MAX_ENTRIES || total + blob.size > MAX_BYTES)
        ) {
          const victim = entries.shift()!
          total -= victim.blob?.size ?? 0
          store.delete(victim.key)
        }

        if (blob.size <= MAX_BYTES) {
          store.put({ key, blob, savedAt: Date.now() } satisfies StoredBlob)
        }
      }
      all.onerror = () => {}
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    /* quota / private mode — the in-memory copy still works for this session */
  } finally {
    db.close()
  }
}

/** Synchronous in-memory peek — the UI uses this to skip the loading state. */
export function peekBlob(id: string | number): Blob | undefined {
  return memory.get(scopedKey(id))
}

/**
 * Returns a cached blob (memory first, then IndexedDB), fetching only when
 * nothing has been saved. Concurrent callers share one request.
 */
export function cachedBlob(
  id: string | number,
  fetcher: () => Promise<Blob>,
): Promise<Blob> {
  const key = scopedKey(id)
  const cached = memory.get(key)
  if (cached) return Promise.resolve(cached)

  const pending = inflight.get(key)
  if (pending) return pending

  const task = (async () => {
    const saved = await readStored(key)
    if (saved) {
      memory.set(key, saved)
      return saved
    }
    const blob = await fetcher()
    memory.set(key, blob)
    void writeStored(key, blob)
    return blob
  })()

  inflight.set(key, task)
  void task
    .catch(() => {})
    .finally(() => {
      if (inflight.get(key) === task) inflight.delete(key)
    })
  return task
}

/** Drop in-memory blobs and the whole store — called on login/logout/auth expiry. */
export function clearBlobCache(): void {
  memory.clear()
  inflight.clear()
  void (async () => {
    const db = await openDb()
    if (!db) return
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      })
    } catch {
      /* best effort */
    } finally {
      db.close()
    }
  })()
}
