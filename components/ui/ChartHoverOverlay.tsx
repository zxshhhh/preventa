'use client'

import { useEffect, useReducer, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { SensorSeries, TrendRange } from '@/lib/dashboardData'
import {
  CARD_ORDER,
  CHART_RANGES,
  CHART_VIEW,
  NO_DATA_GAP_MESSAGE,
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
const V_GAP = 18

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

  const hoveredSeries = chartSeries.find((s) => s.id === hover.cardId)
  if (!hoveredSeries || hoveredSeries.points.length < 2) return null

  const hoverLen = hoveredSeries.points.length
  const hi = Math.max(0, Math.min(hover.index, hoverLen - 1))
  const hoveredPoint = hoveredSeries.points[hi]
  const hoverT = hoveredPoint.t

  const hoveredGeom = chartGeom(hoveredSeries.points, CHART_RANGES[hover.cardId])
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

  const hoveredValue =
    typeof hoveredPoint.value === 'number' && Number.isFinite(hoveredPoint.value)
      ? hoveredPoint.value
      : hoveredGeom.ymin
  const { x, y } = toScreen(hoveredGeom, hi, hoveredValue, hoveredRect)

  const rows = CARD_ORDER.flatMap((id) => {
    const series = chartSeries.find((s) => s.id === id)
    if (!series || !series.points.length) return []

    const ai = alignedIndex(series.points, hoverT, hi, hoverLen)
    if (ai < 0) return []

    const geom = chartGeom(series.points, CHART_RANGES[id])
    const rect = api.getRect(id)
    if (!geom || !rect || !rect.width || !rect.height) return []

    const p = series.points[ai]
    const cfg = SENSORS[id]
    const missing = !(typeof p.value === 'number' && Number.isFinite(p.value))
    const valueForY = missing ? geom.ymin : (p.value as number)

    return [
      {
        id,
        name: cfg.name,
        unit: cfg.unit,
        color: cfg.color,
        missing,
        label: missing ? 'No data' : formatNumber(p.value as number, cfg.decimals),
        ...toScreen(geom, ai, valueForY, rect),
        active: id === hover.cardId,
      },
    ]
  })

  const timestamp = formatFullTimestamp(hoverT, range)
  const hoveredCfg = SENSORS[hover.cardId]
  const hoveredMissing = !(typeof hoveredPoint.value === 'number' && Number.isFinite(hoveredPoint.value))

  const announce = hoveredMissing
    ? `${hoveredCfg.name}, ${NO_DATA_GAP_MESSAGE}, ${timestamp}`
    : `${hoveredCfg.name} ${formatNumber(hoveredPoint.value as number, hoveredCfg.decimals)} ${hoveredCfg.unit}, ${timestamp}`

  const vw = window.innerWidth
  const vh = window.innerHeight

  const margin = 12
  // Comfortable height for the 4-reading detail panel (avoids unnecessary scrollbars).
  const COMFORTABLE_H = 250
  const panelWidth = Math.min(PANEL_W, vw - margin * 2)

  // Keep the panel under the point, centered horizontally and clamped on-screen.
  const panelLeft = Math.max(margin, Math.min(x - panelWidth / 2, vw - panelWidth - margin))

  // Prefer below; flip above when below can't fit comfortably (e.g. bottom of page / lower cards like Humidity or Power Usage).
  const availableBelow = vh - y - V_GAP - margin
  const availableAbove = y - V_GAP - margin
  const canFitBelow = availableBelow >= COMFORTABLE_H
  const canFitAbove = availableAbove >= COMFORTABLE_H
  const placeBelow = canFitBelow ? true : canFitAbove ? false : availableBelow >= availableAbove
  const sideSpace = placeBelow ? availableBelow : availableAbove
  const panelMaxH = Math.max(120, Math.min(vh - margin * 2, sideSpace))

  const panelStyle: CSSProperties = {
    width: panelWidth,
    left: panelLeft,
    top: placeBelow ? y + V_GAP : y - V_GAP,
    transform: placeBelow ? undefined : 'translateY(-100%)',
    maxHeight: panelMaxH,
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
              'linear-gradient(to bottom, transparent, var(--chart-crosshair) 15%, var(--chart-crosshair) 85%, transparent)',
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
            {r.active && !r.missing && (
              <span
                className="absolute inset-0 animate-ping rounded-full"
                style={{ backgroundColor: r.color, opacity: 0.35 }}
              />
            )}

            <span
              className={
                'relative block rounded-full border-2 ' +
                (r.active ? 'h-4 w-4 ' : 'h-3.5 w-3.5 ') +
                (r.missing ? 'border-gray-400/70' : 'border-white')
              }
              style={{
                backgroundColor: r.missing ? 'rgba(148,163,184,0.35)' : r.color,
                boxShadow: r.active
                  ? `0 0 0 5px color-mix(in srgb, ${r.missing ? '#94a3b8' : r.color} 25%, transparent), 0 4px 14px rgba(0,0,0,0.45)`
                  : '0 2px 8px rgba(0,0,0,0.4)',
              }}
            />
          </div>
        ))}

        {/* Detail panel follows the hovered point and flips near edges/corners */}
        <div
          className="absolute rounded-2xl border border-white/10 backdrop-blur-md bg-(--surface-solid)/10 shadow-2xl p-3 sm:p-4"
          style={panelStyle}
        >
          <div className="overflow-y-auto overscroll-contain">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
                  {rangeDeltaText(range).toUpperCase()}
                </p>
                <p className="tnum mt-0.5 text-xs sm:text-sm font-bold text-gray-100 wrap-break-word">
                  {timestamp}
                </p>
              </div>
            </div>
            {hoveredMissing && (
              <p className="mt-2 text-xs font-semibold text-gray-300">{NO_DATA_GAP_MESSAGE}</p>
            )}
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
                    style={{ backgroundColor: r.missing ? 'rgba(148,163,184,0.7)' : r.color }}
                  />
                  <span className="min-w-0 truncate text-xs font-semibold text-gray-400">
                    {r.name}
                  </span>
                  <span className={`ml-auto text-sm sm:text-base font-extrabold ${r.missing ? 'text-gray-400 text-xs sm:text-xs' : 'tnum text-gray-100'}`}>
                    {r.missing ? 'No data in this time range' : r.label}
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs font-bold text-gray-500">
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
