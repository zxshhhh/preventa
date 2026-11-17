'use client'

import { useEffect, useState } from 'react'
import { useHydrated } from '@/lib/useHydrated'
import { isApiConfigured } from '@/lib/api/config'
import { fetchLogs } from '@/lib/api/reports'
import type { LogEntry } from '@/lib/logReport'

const MAX_REPORTS = 3

const TIER_BADGE: Record<number, { badge: string; label: string }> = {
  1: { badge: 'bg-(--green-indicator)/15 text-(--green-indicator)', label: 'Normal' },
  2: { badge: 'bg-(--secondary-color)/15 text-(--secondary-color)', label: 'Mild' },
  3: { badge: 'bg-amber-400/15 text-amber-400', label: 'Warning' },
  4: { badge: 'bg-(--red-indicator)/15 text-(--red-indicator)', label: 'Severe' },
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
}

function TierBadge({ tier }: { tier: number }) {
  const cfg = TIER_BADGE[tier] ?? TIER_BADGE[1]
  return (
    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap ${cfg.badge}`}>
      {cfg.label} (Tier {tier})
    </span>
  )
}

function FireTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    smoldering: 'bg-amber-400/20 text-amber-400',
    flaming: 'bg-red-500/20 text-red-400',
    electrical: 'bg-yellow-400/20 text-yellow-400',
    unknown: 'bg-gray-500/20 text-gray-400',
    none: 'bg-green-400/20 text-green-400',
  }
  return (
    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap ${colors[type] ?? colors.unknown}`}>
      {type}
    </span>
  )
}

function ReportCard({ log }: { log: LogEntry }) {
  const hydrated = useHydrated()

  return (
    <div className="border border-white/10 rounded-xl p-3 flex flex-col gap-2 bg-white/5">
      <p className="text-xs tnum text-gray-400">
        {hydrated ? (
          <>
            {formatDate(log.timestamp)} · <span className="font-bold text-gray-300">{formatTime(log.timestamp)}</span>
          </>
        ) : (
          <span className="text-gray-500">—</span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <TierBadge tier={log.peakTier ?? 1} />
        <FireTypeBadge type={log.peakFireType ?? 'none'} />
        {log.durationSeconds && (
          <span className="text-xs tnum text-gray-300 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
            {log.durationSeconds}s
          </span>
        )}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${log.eventStatus === 'active' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>
          {log.eventStatus ?? '—'}
        </span>
      </div>
    </div>
  )
}

export default function RecentReportLog() {
  const hydrated = useHydrated()
  const [reports, setReports] = useState<LogEntry[]>([])

  useEffect(() => {
    if (!hydrated || !isApiConfigured()) return
    let cancelled = false
    const load = async () => {
      try {
        const logs = await fetchLogs()
        if (cancelled || !logs.length) return
        const latest = [...logs]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, MAX_REPORTS)
        setReports(latest)
      } catch {
        /* keep the last known reports if the fetch fails */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [hydrated])

  return (
    <section className="panel-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm text-gray-100">Recent Report Log</h2>
        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-(--secondary-color)/10 text-(--secondary-color)">
          {reports.length}/{MAX_REPORTS}
        </span>
      </div>
      {reports.length ? (
        <div className="flex flex-col gap-3">
          {reports.map((log, i) => (
            <ReportCard key={i} log={log} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No reports yet.</p>
      )}
    </section>
  )
}