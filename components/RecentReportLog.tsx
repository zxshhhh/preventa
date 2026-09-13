'use client'

import { useSensors } from '@/context/useSensors'
import { useHydrated } from '@/lib/useHydrated'
import type { ReportLog } from '@/lib/dashboardData'
import { formatValue } from '@/lib/dashboardData'

const LEVEL_STYLE: Record<string, { badge: string; dot: string }> = {
  NOMINAL: { badge: 'bg-(--green-indicator)/15 text-(--green-indicator)', dot: 'bg-(--green-indicator)' },
  WARNING: { badge: 'bg-amber-400/15 text-amber-400', dot: 'bg-amber-400' },
  CRITICAL: { badge: 'bg-(--red-indicator)/15 text-(--red-indicator)', dot: 'bg-(--red-indicator)' },
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
}

function ReportCard({ report }: { report: ReportLog }) {
  const hydrated = useHydrated()

  return (
    <div className="border border-white/10 rounded-xl p-3 flex flex-col gap-2 bg-white/5">
      <p className="text-xs font-mono text-gray-400">
        {hydrated ? (
          <>
            {formatDate(report.timestamp)} · <span className="font-bold text-gray-300">{formatTime(report.timestamp)}</span>
          </>
        ) : (
          <span className="text-gray-500">—</span>
        )}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {report.readings.map((r) => {
          const style = LEVEL_STYLE[r.level]
          return (
            <div key={r.label} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                <span className="text-xs font-semibold text-gray-300 truncate">{r.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-mono font-bold text-gray-100">
                  {formatValue(r.value, r.decimals)} {r.unit}
                </span>
                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full whitespace-nowrap ${style.badge}`}>{r.level}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function RecentReportLog() {
  const { reports } = useSensors()

  return (
    <section className="panel-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm text-gray-100">Recent Report Log</h2>
        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-(--secondary-color)/10 text-(--secondary-color)">
          {reports.length}/3
        </span>
      </div>
      {reports.length ? (
        <div className="flex flex-col gap-3">
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No reports yet.</p>
      )}
    </section>
  )
}