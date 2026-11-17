'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SensorId } from '@/lib/dashboardData'

/**
 * Hover state for the Activity Reading trend charts.
 *
 * Hovering any card's chart selects one bucket index; the fullscreen overlay
 * (ChartHoverOverlay) then highlights every card's dot at that same moment.
 *
 * Two contexts are split on purpose: the metric cards only ever need
 * `setHover`/`getRect` (stable identities), so 60 Hz mousemove updates re-render
 * the overlay alone — never the four cards.
 */

export interface HoverPoint {
  cardId: SensorId
  index: number
}

interface ChartHoverApi {
  /** Select (or clear) the hovered bucket. No-ops when nothing changes. */
  setHover: (hover: HoverPoint | null) => void
  /** Auto-clear the selection after `ms` (touch-end keep-alive). */
  scheduleClear: (ms: number) => void
  /** Register a card's chart SVG rect getter; returns the unregister fn. */
  register: (cardId: SensorId, getRect: () => DOMRect | null) => () => void
  /** Current viewport-space rect of a card's chart SVG (null if unmounted). */
  getRect: (cardId: SensorId) => DOMRect | null
}

const HoverApiContext = createContext<ChartHoverApi | null>(null)
const HoverStateContext = createContext<HoverPoint | null>(null)

export function ChartHoverProvider({ children }: { children: ReactNode }) {
  const [hover, setHoverState] = useState<HoverPoint | null>(null)
  const rectsRef = useRef(new Map<SensorId, () => DOMRect | null>())
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setHover = useCallback((next: HoverPoint | null) => {
    // A fresh selection cancels any pending touch-end auto-clear.
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    setHoverState((prev) => {
      if (prev === next) return prev
      if (prev && next && prev.cardId === next.cardId && prev.index === next.index) return prev
      return next
    })
  }, [])

  const scheduleClear = useCallback((ms: number) => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = null
      setHoverState(null)
    }, ms)
  }, [])

  const register = useCallback((cardId: SensorId, getRect: () => DOMRect | null) => {
    rectsRef.current.set(cardId, getRect)
    return () => {
      if (rectsRef.current.get(cardId) === getRect) rectsRef.current.delete(cardId)
    }
  }, [])

  const getRect = useCallback(
    (cardId: SensorId) => rectsRef.current.get(cardId)?.() ?? null,
    [],
  )

  const api = useMemo(
    () => ({ setHover, scheduleClear, register, getRect }),
    [setHover, scheduleClear, register, getRect],
  )

  return (
    <HoverApiContext.Provider value={api}>
      <HoverStateContext.Provider value={hover}>{children}</HoverStateContext.Provider>
    </HoverApiContext.Provider>
  )
}

export function useChartHoverApi(): ChartHoverApi {
  const api = useContext(HoverApiContext)
  if (!api) throw new Error('useChartHoverApi requires <ChartHoverProvider>')
  return api
}

/** The currently hovered bucket (null when no chart is being inspected). */
export function useChartHover(): HoverPoint | null {
  return useContext(HoverStateContext)
}
