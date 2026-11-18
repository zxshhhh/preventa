'use client'

import { useEffect, useReducer, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { SensorSeries, TrendRange } from '@/lib/dashboardData'
import {
  CHART_RANGES,
  CARD_ORDER,
  CHART_VIEW,
  SENSORS,
  alignedIndex,
  chartGeom,
  formatFullTimestamp,
  formatNumber,
  rangeDeltaText,
} from '@/lib/dashboardData'
import type { CSSProperties } from 'react'
import { useChartHover, useChartHoverApi } from './ChartHoverProvider'

interface Props {
  chartSeries: SensorSeries[]
  range: TrendRange
}

const PANEL_W = 288
const PANEL_HALF = 140

const subscribeNoop = () => () => {}
const clientTrue = () => true
const serverFalse = () => false

export default function ChartHoverOverlay({ chartSeries, range }: Props) {
  const hover = useChartHover()
  const api = useChartHoverApi()

  const mounted = useSyncExternalStore(
    subscribeNoop,
    clientTrue,
    serverFalse,
  )

  const [, reposition] = useReducer((c: number) => c + 1, 0)

  const active = hover !== null

  useEffect(() => {
    if (!active) return

    const repositionHandler = () => reposition()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.setHover(null)
    }

    const onBlur = () => api.setHover(null)

    // Dismiss when tapping/clicking outside a chart.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return

      if (!target.closest('svg[role="img"]')) {
        api.setHover(null)
      }
    }

    window.addEventListener('scroll', repositionHandler, true)
    window.addEventListener('resize', repositionHandler)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    document.addEventListener('pointerdown', onPointerDown)

    return () => {
      window.removeEventListener('scroll', repositionHandler, true)
      window.removeEventListener('resize', repositionHandler)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [active, api])

  if (!mounted || !hover) return null

  const hoveredSeries = chartSeries.find(
    (s) => s.id === hover.cardId,
  )

  if (!hoveredSeries || hoveredSeries.points.length < 2) return null

  const hoverLen = hoveredSeries.points.length
  const hi = Math.max(0, Math.min(hover.index, hoverLen - 1))
  const hoveredPoint = hoveredSeries.points[hi]
  const hoverT = hoveredPoint.t

  const hoveredGeom = chartGeom(
    hoveredSeries.points,
    CHART_RANGES[hover.cardId],
  )

  const hoveredRect = api.getRect(hover.cardId)

  if (
    !hoveredGeom ||
    !hoveredRect ||
    !hoveredRect.width ||
    !hoveredRect.height
  ) return null

  const toScreen = (
    geom: { xAt: (i: number) => number; yAt: (v: number) => number },
    i: number,
    v: number,
    rect: DOMRect,
  ) => ({
    x: rect.left + (geom.xAt(i) / CHART_VIEW.W) * rect.width,
    y: rect.top + (geom.yAt(v) / CHART_VIEW.H) * rect.height,
  })

  const { x, y } = toScreen(
    hoveredGeom,
    hi,
    hoveredPoint.value,
    hoveredRect,
  )

  const rows = CARD_ORDER.flatMap((id) => {
    const series = chartSeries.find((s) => s.id === id)

    if (!series || !series.points.length) return []

    const ai = alignedIndex(
      series.points,
      hoverT,
      hi,
      hoverLen,
    )

    if (ai < 0) return []

    const geom = chartGeom(series.points, CHART_RANGES[id])
    const rect = api.getRect(id)

    if (!geom || !rect || !rect.width || !rect.height) return []

    const p = series.points[ai]
    const cfg = SENSORS[id]

    return [{
      id,
      name: cfg.name,
      unit: cfg.unit,
      color: cfg.color,
      label: formatNumber(p.value, cfg.decimals),
      ...toScreen(geom, ai, p.value, rect),
      active: id === hover.cardId,
    }]
  })

  const timestamp = formatFullTimestamp(hoverT, range)
  const hoveredCfg = SENSORS[hover.cardId]

  const announce =
    `${hoveredCfg.name} ${formatNumber(hoveredPoint.value, hoveredCfg.decimals)} ${hoveredCfg.unit}, ${timestamp}`

  const vw = window.innerWidth
  const vh = window.innerHeight

  // Mobile uses a bottom sheet instead of positioning beside the dot.
  const isMobile = vw <= 640

  const panelWidth = Math.min(PANEL_W, vw - 24)

  const panelOnRight = x < vw / 2

  const panelLeft = Math.max(
    12,
    Math.min(x + 24, vw - panelWidth - 12),
  )

  const panelRight = Math.max(
    12,
    Math.min(vw - x + 24, vw - panelWidth - 12),
  )

  const panelTop = Math.max(
    PANEL_HALF + 8,
    Math.min(y, vh - PANEL_HALF - 8),
  )

  const panelStyle: CSSProperties = isMobile
    ? {
        left: 12,
        right: 12,
        bottom: 'max(12px, env(safe-area-inset-bottom))',
        width: 'auto',
        maxHeight: 'min(42dvh, 300px)',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }
    : {
        width: PANEL_W,
        top: panelTop,
        left: panelOnRight ? panelLeft : undefined,
        right: panelOnRight ? undefined : panelRight,
        transform: 'translateY(-50%)',
        maxHeight: 'calc(100dvh - 24px)',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }

  return createPortal(
    <>
      <div
        className="pointer-events-none fixed inset-0 z-40"
        aria-hidden="true"
      >
        {/* Crosshair */}
        <div
          className="absolute inset-y-0 w-px"
          style={{
            left: x,
            background:
              'linear-gradient(to bottom, transparent, rgba(148,163,184,0.5) 15%, rgba(148,163,184,0.5) 85%, transparent)',
          }}
        />

        {/* Synchronized dots across all sensor charts */}
        {rows.map((r) => (
          <div
            key={r.id}
            className="absolute"
            style={{
              left: r.x,
              top: r.y,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {r.active && (
              <span
                className="absolute inset-0 animate-ping rounded-full"
                style={{
                  backgroundColor: r.color,
                  opacity: 0.35,
                }}
              />
            )}

            <span
              className={
                'relative block rounded-full border-2 border-white ' +
                (r.active ? 'h-4 w-4' : 'h-3.5 w-3.5')
              }
              style={{
                backgroundColor: r.color,
                boxShadow: r.active
                  ? `0 0 0 5px ${r.color}40, 0 4px 14px rgba(0,0,0,0.45)`
                  : '0 2px 8px rgba(0,0,0,0.4)',
              }}
            />
          </div>
        ))}

        {/* Responsive detail panel */}
        <div
          className={
            'absolute rounded-2xl border border-white/10 backdrop-blur-md ' +
            'bg-(--surface-solid)/10 shadow-2xl ' +
            (isMobile
              ? 'p-3'
              : 'p-4')
          }
          style={panelStyle}
        >
          <div className="overflow-y-auto overscroll-contain">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  {rangeDeltaText(range).toUpperCase()}
                </p>
                <p className="tnum mt-0.5 text-xs sm:text-sm font-bold text-gray-100 wrap-break-word">
                  {timestamp}
                </p>
              </div>

              {isMobile && (
                <button
                  type="button"
                  onClick={() => api.setHover(null)}
                  className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-gray-400 active:bg-white/10"
                  aria-label="Close chart details"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div className="mt-2 sm:mt-3 space-y-1">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className={
                    'flex items-center gap-2 rounded-lg px-2 py-1.5 ' +
                    (r.active ? 'bg-white/5' : '')
                  }
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="min-w-0 truncate text-xs font-semibold text-gray-400">
                    {r.name}
                  </span>
                  <span className="tnum ml-auto text-sm sm:text-base font-extrabold text-gray-100">
                    {r.label}
                  </span>
                  <span className="w-12 shrink-0 text-right text-[10px] sm:text-[11px] font-bold text-gray-500">
                    {r.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </>,
    document.body,
  )
}
