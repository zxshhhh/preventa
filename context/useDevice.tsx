'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHydrated } from '@/lib/useHydrated'
import { isApiConfigured } from '@/lib/api/config'
import { fetchDevices, type OwnerDevice } from '@/lib/api/system'

const SELECTED_DEVICE_KEY = 'preventa.selectedDeviceId'

interface DeviceContextType {
  devices: OwnerDevice[]
  selected: OwnerDevice | null
  setSelectedId: (id: number | null) => void
  refresh: () => void
  loading: boolean
}

const DeviceContext = createContext<DeviceContextType | undefined>(undefined)

export function DeviceProvider({ children }: { children: ReactNode }) {
  const hydrated = useHydrated()
  const [devices, setDevices] = useState<OwnerDevice[]>([])
  const [selectedId, setSelectedIdState] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const cleanupRef = useRef<(() => void) | null>(null)

  const load = useCallback(() => {
    if (!isApiConfigured()) return null
    let cancelled = false
    setLoading(true)
    void fetchDevices()
      .then((list) => {
        if (cancelled) return
        setDevices(list)
        setSelectedIdState((current) => {
          // Keep the stored selection if it still exists; otherwise auto-pick the first device.
          if (current !== null && list.some((d) => d.id === current)) return current
          const stored = typeof window !== 'undefined' ? Number(localStorage.getItem(SELECTED_DEVICE_KEY)) : Number.NaN
          const storedValid = Number.isFinite(stored) && list.some((d) => d.id === stored)
          const next = storedValid ? stored : (list[0]?.id ?? null)
          try {
            if (next === null) localStorage.removeItem(SELECTED_DEVICE_KEY)
            else localStorage.setItem(SELECTED_DEVICE_KEY, String(next))
          } catch {
            /* ignore storage failures */
          }
          return next
        })
      })
      .catch(() => {
        /* keep the previous device list on failure */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return undefined
    // Deferred so the initial setLoading() call isn't a synchronous setState inside the effect.
    const t = setTimeout(() => {
      cleanupRef.current = load() ?? null
    }, 0)
    return () => {
      clearTimeout(t)
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [hydrated, load, reloadToken])

  const setSelectedId = useCallback((id: number | null) => {
    setSelectedIdState(id)
    try {
      if (id === null) localStorage.removeItem(SELECTED_DEVICE_KEY)
      else localStorage.setItem(SELECTED_DEVICE_KEY, String(id))
    } catch {
      /* ignore storage failures */
    }
  }, [])

  const selected = useMemo(
    () => devices.find((d) => d.id === selectedId) ?? null,
    [devices, selectedId]
  )

  const value = useMemo<DeviceContextType>(
    () => ({
      devices,
      selected,
      setSelectedId,
      refresh: () => setReloadToken((t) => t + 1),
      loading,
    }),
    [devices, selected, setSelectedId, loading]
  )

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
}

export function useDevices(): DeviceContextType {
  const ctx = useContext(DeviceContext)
  if (!ctx) throw new Error('useDevices must be used inside a DeviceProvider')
  return ctx
}
