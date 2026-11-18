'use client'

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import type { SensorId, SeriesPoint, StatusLevel } from '@/lib/dashboardData'
import {
  CHART_VIEW,
  CHART_RANGES,
  buildTicks,
  chartGeom,
  formatNumber,
  smoothPath,
} from '@/lib/dashboardData'
import { useChartHoverApi } from './ChartHoverProvider'

const { W, H, M } = CHART_VIEW
const INNER_W = W - M.left - M.right
const INNER_H = H - M.top - M.bottom

interface MetricStatus {
  level: StatusLevel
  color: string
  label: string
}

interface Props {
  id: SensorId
  title: string
  value: string
  unit: string
  decimals: number
  delta: number
  deltaLabel: string
  pulse: boolean
  chartPoints: SeriesPoint[]
  color: string
  status: MetricStatus
  statusText: string
  thresholdNominal: number
  thresholdWarning: number
  icon?: ReactNode
}

/** Status pill styling keyed by label; signal colors match the design tokens. */
const STATUS_CLASS: Record<string, string> = {
  NOMINAL: 'text-emerald-400 bg-emerald-400/10',
  WARNING: 'text-amber-400 bg-amber-400/10',
  CRITICAL: 'text-red-400 bg-red-400/10',
}

export default function DashboardMetricCard({
  id,
  title,
  value,
  unit,
  decimals,
  delta,
  deltaLabel,
  pulse,
  chartPoints,
  color,
  status,
  statusText,
  thresholdNominal,
  thresholdWarning,
  icon,
}: Props) {
  const gid = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const { setHover, scheduleClear, register } = useChartHoverApi()

  // Skeleton state: no plottable series yet (initial fetch, empty feed).
  const hasData = chartPoints.length >= 2

  const geom = hasData ? chartGeom(chartPoints, CHART_RANGES[id]) : null

  const fillPct = Math.min(100, ((hasData ? chartPoints[chartPoints.length - 1].value : 0) / thresholdWarning) * 100)

  const isUp = delta >= 0
  const last = hasData ? chartPoints[chartPoints.length - 1] : null

  const gridTicks = geom ? buildTicks(geom.ymin, geom.ymax, 4) : []
  const xAxisY = M.top + INNER_H
  const labelIdx = chartPoints.length > 2 ? [0, Math.floor((chartPoints.length - 1) / 2), chartPoints.length - 1] : []
  const labelAnchor = (i: number) => (i === 0 ? 'start' : i === chartPoints.length - 1 ? 'end' : 'middle')

  const fmt = (v: number) => formatNumber(v, decimals)

  // --- Hover plumbing -------------------------------------------------------
  // The card only *emits* the hovered bucket; the fullscreen overlay
  // (ChartHoverOverlay) renders the crosshair, synced dots and detail panel.
  const lastIndexRef = useRef<number | null>(null)

  const applyHover = useCallback(
    (index: number | null) => {
      if (index === null) {
        lastIndexRef.current = null
        setHover(null)
        return
      }
      lastIndexRef.current = index
      setHover({ cardId: id, index })
    },
    [id, setHover],
  )

  const indexFromClientX = useCallback(
    (clientX: number): number | null => {
      const svg = svgRef.current
      if (!svg || !hasData) return null
      const rect = svg.getBoundingClientRect()
      if (!rect.width) return null
      const userX = ((clientX - rect.left) / rect.width) * W
      const idx = Math.round(((userX - M.left) / INNER_W) * (chartPoints.length - 1))
      return Math.max(0, Math.min(idx, chartPoints.length - 1))
    },
    [hasData, chartPoints.length],
  )

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const idx = indexFromClientX(e.clientX)
    if (idx !== null) applyHover(idx)
  }

  const onLeave = () => {
    if (lastIndexRef.current !== null) applyHover(null)
  }

  // Touch scrubbing (PWA): drag across the chart moves the selection; lifting
  // the finger keeps the detail readable for a moment before auto-clearing.
  const onTouch = (e: React.TouchEvent<SVGSVGElement>) => {
    const t = e.touches[0]
    if (!t) return
    const idx = indexFromClientX(t.clientX)
    if (idx !== null) applyHover(idx)
  }
  const onTouchEnd = () => scheduleClear(2500)

  const onFocus = () => {
    if (hasData && lastIndexRef.current === null) applyHover(chartPoints.length - 1)
  }
  const onBlur = () => {
    if (lastIndexRef.current !== null) applyHover(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (!hasData) return
    const len = chartPoints.length
    const base = lastIndexRef.current ?? len - 1
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = Math.max(0, base - 1)
    else if (e.key === 'ArrowRight') next = Math.min(len - 1, base + 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = len - 1
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    applyHover(next)
  }

  // Register this card's chart rect so the overlay can pin the crosshair to
  // the exact dot position (re-read live on every render, scroll-safe).
  const getRect = useCallback(() => svgRef.current?.getBoundingClientRect() ?? null, [])
  useEffect(() => register(id, getRect), [register, id, getRect])

  const lineD = geom
    ? smoothPath(chartPoints.map((p, i) => ({ x: geom.xAt(i), y: geom.yAt(p.value) })))
    : ''
  const areaD =
    geom && hasData
      ? lineD +
        ` L ${geom.xAt(chartPoints.length - 1)} ${xAxisY} L ${geom.xAt(0)} ${xAxisY} Z`
      : ''

  const statusClass = STATUS_CLASS[status.label] ?? 'text-gray-400 bg-white/5'
  const deltaClass = isUp ? 'text-rose-400 bg-rose-400/10' : 'text-emerald-400 bg-emerald-400/10'

  // Newest-dot marker (screen coords via the shared geometry).
  const lastX = geom && last ? geom.xAt(chartPoints.length - 1) : 0
  const lastY = geom && last ? geom.yAt(last.value) : 0

  return (
    <div className="panel-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
          >
            <span style={{ color }}>{icon}</span>
          </span>
          <div className="min-w-0">
            <h2 className="font-bold text-sm text-gray-100 truncate">{title}</h2>
          </div>
        </div>
        <span className={`text-xs font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap ${statusClass}`}>
          {status.label}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="tnum text-4xl font-extrabold text-gray-100 tracking-tight leading-none">{value}</span>
            <span className="text-sm font-bold text-gray-400">{unit}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            {hasData ? (
              <>
                <span className={`tnum flex items-center gap-0.5 text-xs font-extrabold px-2 py-0.5 rounded-full ${deltaClass}`}>
                  {isUp ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  )}
                  {isUp ? '+' : ''}
                  {delta.toFixed(1)}%
                </span>
                <span className="text-xs font-semibold text-gray-400">{deltaLabel}</span>
              </>
            ) : (
              <span className="text-xs font-semibold text-gray-500">Loading readings</span>
            )}
          </div>
        </div>
      </div>
      <div className="relative">
        {!hasData ? (
          // Ghost chart: fixed placeholder wave in the same viewBox and margins
          // as the real chart so the swap-in causes no layout jump.
          <div className="skeleton-shine rounded-lg" aria-hidden="true">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block select-none">
              <path
                d={`M ${M.left} 66 C 78 34, 110 88, 150 64 C 186 44, 214 92, 250 66 C 272 52, 292 62, ${W - M.right} 50 L ${W - M.right} ${xAxisY} L ${M.left} ${xAxisY} Z`}
                fill="var(--chart-grid)"
              />
              <path
                d={`M ${M.left} 66 C 78 34, 110 88, 150 64 C 186 44, 214 92, 250 66 C 272 52, 292 62, ${W - M.right} 50`}
                fill="none"
                stroke="var(--chart-grid-strong)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <line x1={M.left} x2={W - M.right} y1={xAxisY} y2={xAxisY} stroke="var(--chart-grid-strong)" strokeWidth="1" />
              {[0, 0.5, 1].map((f) => (
                <rect
                  key={f}
                  x={M.left + f * (INNER_W - 44)}
                  y={xAxisY + 5}
                  width="44"
                  height="7"
                  rx="3.5"
                  fill="var(--chart-grid-strong)"
                />
              ))}
            </svg>
          </div>
        ) : geom && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto block select-none touch-none rounded-lg focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
            role="img"
            aria-label={`${title} trend, ${chartPoints.length} readings. Use the left and right arrow keys to inspect each reading.`}
            tabIndex={0}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
            onTouchStart={onTouch}
            onTouchMove={onTouch}
            onTouchEnd={onTouchEnd}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
          >
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {gridTicks.map((t) => (
              <line
                key={t}
                x1={geom.xAt(0)}
                x2={geom.xAt(chartPoints.length - 1)}
                y1={geom.yAt(t)}
                y2={geom.yAt(t)}
                stroke="var(--chart-grid)"
                strokeWidth="1"
              />
            ))}
            <line
              x1={geom.xAt(0)}
              x2={geom.xAt(chartPoints.length - 1)}
              y1={xAxisY}
              y2={xAxisY}
              stroke="var(--chart-grid-strong)"
              strokeWidth="1"
            />
            {gridTicks.map((t) => (
              <text
                key={t}
                x={M.left - 3}
                y={geom.yAt(t)}
                textAnchor="end"
                dominantBaseline="central"
                fontSize="8"
                fill="var(--chart-axis)"
              >
                {fmt(t)}
              </text>
            ))}
            {labelIdx.map((i) => (
              <text
                key={i}
                x={geom.xAt(i)}
                y={xAxisY + 10}
                textAnchor={labelAnchor(i)}
                fontSize="8"
                fill="var(--chart-axis)"
              >
                {chartPoints[i].label}
              </text>
            ))}
            {areaD && <path d={areaD} fill={`url(#${gid})`} />}
            {lineD && (
              <path d={lineD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
            {last && geom && (
              <g>
                {pulse && <circle className="dot-ping" cx={lastX} cy={lastY} r="4" fill={color} />}
                <circle cx={lastX} cy={lastY} r="8" fill={color} opacity="0.18" />
                <circle cx={lastX} cy={lastY} r="3.5" fill={color} stroke="var(--chart-dot-ring)" strokeWidth="2" />
              </g>
            )}
          </svg>
        )}
      </div>
      <div>
        <div className="relative h-1.5 rounded-full bg-white/10">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
            style={{ width: `${fillPct}%`, backgroundColor: status.color }}
          />
          <span
            className="absolute -top-0.5 h-2.5 w-0.5 bg-white/40 rounded-full"
            style={{ left: `${(thresholdNominal / thresholdWarning) * 100}%` }}
          />
        </div>
        <div className="flex justify-between gap-2 text-xs font-bold text-gray-400 mt-1.5">
          <span>NOMINAL ≤ {formatNumber(thresholdNominal, 0)} {unit}</span>
          <span>{statusText}</span>
        </div>
      </div>
    </div>
  )
}
