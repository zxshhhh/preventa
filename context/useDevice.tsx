'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHydrated } from '@/lib/useHydrated'
import { isApiConfigured } from '@/lib/api/config'
import { fetchDevices, type OwnerDevice } from '@/lib/api/system'

const SELECTED_DEVICE_KEY = 'preventa.selectedDeviceId'

/** `null` = no device yet, `'all'` = the aggregate view, a number = a board's numeric id. */
export type DeviceSelection = number | 'all' | null

interface DeviceContextType {
  devices: OwnerDevice[]
  /** Null for the aggregate view or before the first device has loaded. */
  selected: OwnerDevice | null
  selection: DeviceSelection
  isAllDevices: boolean
  setSelectedId: (id: DeviceSelection) => void
  refresh: () => void
  loading: boolean
}

const DeviceContext = createContext<DeviceContextType | undefined>(undefined)

function parseSelection(raw: string | null): DeviceSelection {
  if (raw === 'all') return 'all'
  if (raw === null || raw === '') return null
  const id = Number(raw)
  return Number.isFinite(id) ? id : null
}

function persistSelection(id: DeviceSelection) {
  try {
    if (id === null) localStorage.removeItem(SELECTED_DEVICE_KEY)
    else localStorage.setItem(SELECTED_DEVICE_KEY, String(id))
  } catch {
    /* ignore storage failures */
  }
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const hydrated = useHydrated()
  const [devices, setDevices] = useState<OwnerDevice[]>([])
  const [selectedId, setSelectedIdState] = useState<DeviceSelection>(null)
  const [loading, setLoading] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const cleanupRef = useRef<(() => void) | null>(null)

  const load = useCallback(() => {
    if (!isApiConfigured()) return null
    let cancelled = false
    setLoading(true)
    void fetchDevices({ fresh: reloadToken > 0 })
      .then((list) => {
        if (cancelled) return
        setDevices(list)
        setSelectedIdState((current) => {
          // Keep a valid selection (including the aggregate view); otherwise
          // restore the stored id or auto-pick the first device.
          const isValid = (value: DeviceSelection) =>
            value === 'all' || (typeof value === 'number' && list.some((d) => d.id === value))
          if (isValid(current)) return current
          const stored = typeof window !== 'undefined' ? parseSelection(localStorage.getItem(SELECTED_DEVICE_KEY)) : null
          const next = isValid(stored) ? stored : (list[0]?.id ?? null)
          persistSelection(next)
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
  }, [reloadToken])

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

  const setSelectedId = useCallback((id: DeviceSelection) => {
    setSelectedIdState(id)
    persistSelection(id)
  }, [])

  const selected = useMemo(
    () => (typeof selectedId === 'number' ? devices.find((d) => d.id === selectedId) ?? null : null),
    [devices, selectedId]
  )
  const isAllDevices = selectedId === 'all'

  const value = useMemo<DeviceContextType>(
    () => ({
      devices,
      selected,
      selection: selectedId,
      isAllDevices,
      setSelectedId,
      refresh: () => setReloadToken((t) => t + 1),
      loading,
    }),
    [devices, selected, selectedId, isAllDevices, setSelectedId, loading]
  )

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
}

export function useDevices(): DeviceContextType {
  const ctx = useContext(DeviceContext)
  if (!ctx) throw new Error('useDevices must be used inside a DeviceProvider')
  return ctx
}
