'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useHydrated } from '@/lib/useHydrated'
import { useOnline } from '@/lib/useOnline'
import { cachedFetch, getCacheMeta, peekCache, subscribeCache, type CacheOptions } from './cache'

export interface UseCachedQueryOptions<T> extends CacheOptions<T> {
  /** Skip the request entirely (e.g. until hydrated / API configured). */
  enabled?: boolean
  /** Optional interval that re-runs the cached fetch (deduped by the cache). */
  pollMs?: number
}

export interface CachedQuery<T> {
  data: T | null
  error: unknown
  refreshing: boolean
  /** Latest uncached intermediate value while a fetch is still in flight. */
  progress: T | null
  refresh: () => Promise<void>
  /** True when the displayed value is older than its fresh TTL. */
  stale: boolean
  /** Epoch ms of the last successful fetch behind the displayed value. */
  savedAt: number | null
  /** Current browser connectivity — lets screens switch to read-only mode. */
  offline: boolean
}

/**
 * Thin React view over the API-layer cache. Persisted values are only read after
 * hydration so the prerendered HTML and the first client render always match.
 */
export function useCachedQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseCachedQueryOptions<T>,
): CachedQuery<T> {
  const hydrated = useHydrated()
  const online = useOnline()
  const enabled = hydrated && Boolean(key) && options.enabled !== false

  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [progress, setProgress] = useState<T | null>(null)
  const [stale, setStale] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const keyRef = useRef(key)
  const fetcherRef = useRef(fetcher)
  const optionsRef = useRef(options)
  const dataRef = useRef<T | null>(null)
  const onlineRef = useRef(online)
  const runRef = useRef<(fresh: boolean) => Promise<void>>(async () => {})

  // Keep mutable inputs current outside render.
  useEffect(() => {
    keyRef.current = key
    fetcherRef.current = fetcher
    optionsRef.current = options
  }, [key, fetcher, options])

  useEffect(() => {
    onlineRef.current = online
  }, [online])

  const syncMeta = useCallback((k: string) => {
    const meta = getCacheMeta<T>(k, optionsRef.current)
    setSavedAt(meta.savedAt)
    setStale(meta.stale)
  }, [])

  useEffect(() => {
    runRef.current = async (fresh: boolean) => {
      const k = keyRef.current
      if (!k) return
      if (fresh || dataRef.current == null) setRefreshing(true)
      try {
        const value = await cachedFetch<T>(k, fetcherRef.current, { ...optionsRef.current, fresh })
        dataRef.current = value
        setData(value)
        setProgress(null)
        setError(null)
        syncMeta(k)
      } catch (err) {
        setProgress(null)
        // A saved snapshot is still on screen — don't replace it with a red banner
        // just because the network is down.
        if (!onlineRef.current && dataRef.current != null) {
          setError(null)
          setStale(true)
        } else {
          setError(err)
        }
      } finally {
        setRefreshing(false)
      }
    }
  }, [syncMeta])

  const refresh = useCallback(async () => {
    await runRef.current(true)
  }, [])

  // A key change (e.g. switching chart ranges) must never keep showing the
  // previous key's snapshot — especially offline, where no new read replaces it.
  useEffect(() => {
    const t = setTimeout(() => {
      dataRef.current = null
      setData(null)
      setProgress(null)
      setError(null)
      setSavedAt(null)
      setStale(false)
    }, 0)
    return () => clearTimeout(t)
  }, [key])

  useEffect(() => {
    if (!enabled || !key) return

    let active = true
    const unsubscribe = subscribeCache(key, (event) => {
      if (!active) return
      if (event.invalidated) {
        setProgress(null)
        void runRef.current(true)
        return
      }
      // Partial pages are display-only: never overwrite the cached value or
      // its freshness metadata with an incomplete snapshot.
      if (event.partial) {
        if (event.value !== undefined) setProgress(event.value as T)
        setRefreshing(true)
        return
      }
      if (event.value !== undefined) {
        dataRef.current = event.value as T
        setData(event.value as T)
        setProgress(null)
        syncMeta(key)
      }
      setRefreshing(event.refreshing)
    })

    // Deferred so the initial cache read/state update isn't synchronous in the effect.
    const timer = setTimeout(() => {
      if (!active) return
      const cached = peekCache<T>(key)
      if (cached !== undefined) {
        dataRef.current = cached
        setData(cached)
      }
      syncMeta(key)
      setError(null)
      void runRef.current(false)
    }, 0)

    return () => {
      active = false
      clearTimeout(timer)
      unsubscribe()
    }
  }, [enabled, key, syncMeta])

  useEffect(() => {
    if (!enabled || !options.pollMs) return
    const id = setInterval(() => {
      void runRef.current(false)
    }, options.pollMs)
    return () => clearInterval(id)
  }, [enabled, options.pollMs])

  return { data, error, refreshing, progress, refresh, stale, savedAt, offline: !online }
}
