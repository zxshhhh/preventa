'use client'

import { useEffect, useReducer, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { SensorSeries, TrendRange } from '@/lib/dashboardData'
import {
  CARD_ORDER,
  CHART_VIEW,
  SENSORS,
  alignedIndex,
  chartGeom,
  formatFullTimestamp,
  formatNumber,
  rangeDeltaText,
} from '@/lib/dashboardData'
import { useChartHover, useChartHoverApi } from './ChartHoverProvider'

interface Props {
  chartSeries: SensorSeries[]
  range: TrendRange
}

const PANEL_W = 288 // w-72
const PANEL_HALF = 140

const subscribeNoop = () => () => {}
const clientTrue = () => true
const serverFalse = () => false

/**
 * Fullscreen hover detail for the Activity Reading trends.
 *
 * Portaled to document.body — the metric cards use backdrop-filter, which
 * turns them into containing blocks that would trap a fixed layer. The
 * crosshair spans the whole viewport and every card highlights its dot at the
 * hovered moment, so the detail never detaches from the point under the
 * pointer (even on the first or last dot of a chart).
 *
 * All geometry is read at render time (never memoized) so a scroll/resize
 * "bump" re-render alone keeps every dot and the panel glued to the charts.
 */
export default function ChartHoverOverlay({ chartSeries, range }: Props) {
  const hover = useChartHover()
  const api = useChartHoverApi()
  // Hydration-safe "are we on the client" gate — pages are statically
  // prerendered, and createPortal needs a real document. useSyncExternalStore
  // returns the server snapshot (false) during hydration, then flips to true.
  const mounted = useSyncExternalStore(subscribeNoop, clientTrue, serverFalse)
  // Scroll/resize re-render trigger (state value itself is irrelevant).
  const [, reposition] = useReducer((c: number) => c + 1, 0)

  const active = hover !== null

  // While inspecting: keep the crosshair glued to the dot across scrolling and
  // resizing, and close on Escape or window blur.
  useEffect(() => {
    if (!active) return
    const repositionHandler = () => reposition()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.setHover(null)
    }
    const onBlur = () => api.setHover(null)
    window.addEventListener('scroll', repositionHandler, true)
    window.addEventListener('resize', repositionHandler)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('scroll', repositionHandler, true)
      window.removeEventListener('resize', repositionHandler)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [active, api])

  if (!mounted || !hover) return null

  const hoveredSeries = chartSeries.find((s) => s.id === hover.cardId)
  if (!hoveredSeries || hoveredSeries.points.length < 2) return null

  const hoverLen = hoveredSeries.points.length
  const hi = Math.max(0, Math.min(hover.index, hoverLen - 1))
  const hoveredPoint = hoveredSeries.points[hi]
  const hoverT = hoveredPoint.t
  const hoveredGeom = chartGeom(hoveredSeries.points)
  const hoveredRect = api.getRect(hover.cardId)
  if (!hoveredGeom || !hoveredRect || !hoveredRect.width || !hoveredRect.height) return null

  const toScreen = (
    geom: { xAt: (i: number) => number; yAt: (v: number) => number },
    i: number,
    v: number,
    rect: DOMRect,
  ) => ({
    x: rect.left + (geom.xAt(i) / CHART_VIEW.W) * rect.width,
    y: rect.top + (geom.yAt(v) / CHART_VIEW.H) * rect.height,
  })
  const { x, y } = toScreen(hoveredGeom, hi, hoveredPoint.value, hoveredRect)

  const rows = CARD_ORDER.flatMap((id) => {
    const series = chartSeries.find((s) => s.id === id)
    if (!series || !series.points.length) return []
    const ai = alignedIndex(series.points, hoverT, hi, hoverLen)
    if (ai < 0) return []
    const geom = chartGeom(series.points)
    const rect = api.getRect(id)
    if (!geom || !rect || !rect.width || !rect.height) return []
    const p = series.points[ai]
    const cfg = SENSORS[id]
    return [
      {
        id,
        name: cfg.name,
        unit: cfg.unit,
        color: cfg.color,
        label: formatNumber(p.value, cfg.decimals),
        ...toScreen(geom, ai, p.value, rect),
        active: id === hover.cardId,
      },
    ]
  })

  const timestamp = formatFullTimestamp(hoverT, range)
  const hoveredCfg = SENSORS[hover.cardId]
  const announce = `${hoveredCfg.name} ${formatNumber(hoveredPoint.value, hoveredCfg.decimals)} ${hoveredCfg.unit}, ${timestamp}`

  const vw = window.innerWidth
  const vh = window.innerHeight
  const panelOnRight = x < vw / 2
  const panelLeft = Math.max(12, Math.min(x + 24, vw - PANEL_W - 12))
  const panelRight = Math.max(12, Math.min(vw - x + 24, vw - PANEL_W - 12))
  const panelTop = Math.max(PANEL_HALF + 8, Math.min(y, vh - PANEL_HALF - 8))

  return createPortal(
    <>
      <div className="pointer-events-none fixed inset-0 z-40" aria-hidden="true">
        {/* Viewport-wide crosshair pinned to the exact hovered timestamp */}
        <div
          className="absolute inset-y-0 w-px"
          style={{
            left: x,
            background:
              'linear-gradient(to bottom, transparent, rgba(148,163,184,0.5) 15%, rgba(148,163,184,0.5) 85%, transparent)',
          }}
        />
        {/* Every card highlights its dot at the same moment */}
        {rows.map((r) => (
          <div
            key={r.id}
            className="absolute"
            style={{ left: r.x, top: r.y, transform: 'translate(-50%, -50%)' }}
          >
            {r.active && (
              <span
                className="absolute inset-0 animate-ping rounded-full"
                style={{ backgroundColor: r.color, opacity: 0.35 }}
              />
            )}
            <span
              className={'relative block rounded-full border-2 border-white ' + (r.active ? 'h-4 w-4' : 'h-3.5 w-3.5')}
              style={{
                backgroundColor: r.color,
                boxShadow: r.active
                  ? `0 0 0 5px ${r.color}40, 0 4px 14px rgba(0,0,0,0.45)`
                  : '0 2px 8px rgba(0,0,0,0.4)',
              }}
            />
          </div>
        ))}
        {/* Detail panel anchored beside the dot, flipping sides at screen edges */}
        <div
          className="absolute w-72 rounded-2xl border border-white/10 bg-(--surface-solid) p-4 shadow-2xl"
          style={{
            top: panelTop,
            left: panelOnRight ? panelLeft : undefined,
            right: panelOnRight ? undefined : panelRight,
            transform: 'translateY(-50%)',
          }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{rangeDeltaText(range).toUpperCase()}</p>
          <p className="tnum mt-0.5 text-sm font-bold text-gray-100">{timestamp}</p>
          <div className="mt-3 space-y-1">
            {rows.map((r) => (
              <div
                key={r.id}
                className={'flex items-center gap-2 rounded-lg px-2 py-1.5 ' + (r.active ? 'bg-white/5' : '')}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="truncate text-xs font-semibold text-gray-400">{r.name}</span>
                <span className="tnum ml-auto text-base font-extrabold text-gray-100">{r.label}</span>
                <span className="w-12 text-right text-[11px] font-bold text-gray-500">{r.unit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Screen-reader announcement of the hovered reading */}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </>,
    document.body,
  )
}
