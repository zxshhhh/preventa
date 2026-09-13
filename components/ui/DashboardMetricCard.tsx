'use client'

import { useId, useRef, useState, type ReactNode } from 'react'
import type { SeriesPoint, StatusLevel } from '@/lib/dashboardData'
import { formatValue, smoothPath, buildTicks } from '@/lib/dashboardData'

const W = 320
const H = 130
const M = { top: 12, right: 8, bottom: 14, left: 34 }

interface MetricStatus {
  level: StatusLevel
  color: string
  label: string
}

interface Props {
  title: string
  value: string
  current: number
  unit: string
  decimals: number
  delta: number
  chartPoints: SeriesPoint[]
  color: string
  status: MetricStatus
  statusText: string
  thresholdNominal: number
  thresholdWarning: number
  icon?: ReactNode
}

export default function DashboardMetricCard({
  title,
  value,
  current,
  unit,
  decimals,
  delta,
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
  const [hover, setHover] = useState<number | null>(null)

  const fillPct = Math.min(100, (current / thresholdWarning) * 100)

  const isUp = delta >= 0
  const deltaColor = isUp ? '#FB7185' : '#34D399'

  const innerW = W - M.left - M.right
  const innerH = H - M.top - M.bottom

  const values = chartPoints.map((p) => p.value)
  const dataMin = values.length ? Math.min(...values) : 0
  const dataMax = values.length ? Math.max(...values) : 1
  const pad = (dataMax - dataMin) * 0.14 || Math.max(dataMax * 0.05, 1)
  const ymin = dataMin - pad
  const ymax = dataMax + pad

  const xAt = (i: number) => M.left + (chartPoints.length > 1 ? (i / (chartPoints.length - 1)) * innerW : M.left)
  const yAt = (v: number) => M.top + innerH - ((v - ymin) / (ymax - ymin)) * innerH

  const xy = chartPoints.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }))
  const lineD = smoothPath(xy)
  const areaD = chartPoints.length > 1 ? lineD + ` L ${xAt(chartPoints.length - 1)} ${M.top + innerH} L ${xAt(0)} ${M.top + innerH} Z` : ''

  const last = chartPoints.length ? chartPoints[chartPoints.length - 1] : null
  const hi = hover !== null && chartPoints.length ? Math.max(0, Math.min(hover, chartPoints.length - 1)) : null

  const gridTicks = chartPoints.length > 1 ? buildTicks(ymin, ymax, 4) : []
  const xAxisY = M.top + innerH
  const labelIdx =
    chartPoints.length > 2 ? [0, Math.floor((chartPoints.length - 1) / 2), chartPoints.length - 1] : []

  const fmt = (v: number) => formatValue(v, decimals)

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || chartPoints.length < 2) return
    const p = svg.createSVGPoint()
    p.x = e.clientX
    p.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const loc = p.matrixTransform(ctm.inverse())
    const idx = Math.round(((loc.x - M.left) / innerW) * (chartPoints.length - 1))
    setHover(Math.max(0, Math.min(idx, chartPoints.length - 1)))
  }

  return (
    <div className="panel-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: color + '1A' }}
          >
            <span style={{ color }}>{icon}</span>
          </span>
          <div className="min-w-0">
            <h2 className="font-bold text-sm text-gray-100 truncate">{title}</h2>
          </div>
        </div>
        <span
          className="text-[10px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ backgroundColor: status.color + '26', color: status.level === 'NOMINAL' ? '#34D399' : status.color }}
        >
          {status.label}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold text-gray-100 tracking-tight">{value}</span>
            <span className="text-sm font-bold text-gray-400">{unit}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className="flex items-center gap-0.5 text-[11px] font-extrabold px-2 py-0.5 rounded-full"
              style={{ color: deltaColor, backgroundColor: deltaColor + '1A' }}
            >
              {isUp ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
              {isUp ? '+' : ''}
              {delta.toFixed(1)}%
            </span>
            <span className="text-[11px] font-semibold text-gray-400">vs recent avg</span>
          </div>
        </div>
      </div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto block select-none"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
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
              x1={xAt(0)}
              x2={xAt(chartPoints.length - 1)}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke="rgba(148,163,184,0.14)"
              strokeWidth="1"
            />
          ))}
          <line
            x1={xAt(0)}
            x2={xAt(chartPoints.length - 1)}
            y1={xAxisY}
            y2={xAxisY}
            stroke="rgba(148,163,184,0.25)"
            strokeWidth="1"
          />
          {gridTicks.map((t) => (
            <text
              key={t}
              x={M.left - 3}
              y={yAt(t)}
              textAnchor="end"
              dominantBaseline="central"
              fontSize="8"
              fill="#64748B"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {fmt(t)}
            </text>
          ))}
          {labelIdx.map((i) => (
            <text
              key={i}
              x={xAt(i)}
              y={xAxisY + 10}
              textAnchor="middle"
              fontSize="8"
              fill="#64748B"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {chartPoints[i].label}
            </text>
          ))}
          {areaD && <path d={areaD} fill={`url(#${gid})`} />}
          {lineD && (
            <path d={lineD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {last && <circle cx={xAt(chartPoints.length - 1)} cy={yAt(last.value)} r="3.5" fill={color} stroke="#fff" strokeWidth="2" />}
          {hi !== null && chartPoints[hi] && (
            <g>
              <line x1={xAt(hi)} y1={M.top} x2={xAt(hi)} y2={M.top + innerH} stroke="rgba(148,163,184,0.5)" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={xAt(hi)} cy={yAt(chartPoints[hi].value)} r="5" fill={color} stroke="#fff" strokeWidth="2.5" />
            </g>
          )}
        </svg>

        {hi !== null && chartPoints[hi] && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full bg-gray-800 ring-1 ring-white/10 text-white rounded-lg px-3 py-2 text-xs shadow-xl whitespace-nowrap"
            style={{
              left: `${Math.max(12, Math.min(88, (xAt(hi) / W) * 100))}%`,
              top: `${Math.max(22, (yAt(chartPoints[hi].value) / H) * 100)}%`,
            }}
          >
            <p className="font-bold">{chartPoints[hi].label}</p>
            <p className="mt-0.5 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="font-mono font-semibold">
                {fmt(chartPoints[hi].value)} {unit}
              </span>
            </p>
          </div>
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
        <div className="flex justify-between text-[10px] font-bold text-gray-400 mt-1.5">
          <span>NOMINAL ≤ {thresholdNominal} {unit}</span>
          <span>{statusText}</span>
        </div>
      </div>
    </div>
  )
}