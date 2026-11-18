'use client'

import { useEffect, useState } from 'react'
import { lockScroll } from '@/lib/scrollLock'
import type { LogEntry } from '@/lib/logReport'
import { formatTime, formatFullDate } from '@/lib/logReport'
import { fetchCaptures, fetchCaptureImage, findNearestCapture } from '@/lib/api/reports'

interface Props {
  log: LogEntry
  onClose: () => void
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded-lg p-3">
      <p className="text-[10px] font-extrabold text-gray-400 tracking-wide">{label}</p>
      <p className="text-sm font-bold text-gray-100 mt-0.5">{value}</p>
    </div>
  )
}

function TierBadge({ tier, label }: { tier: number; label: string }) {
  const isCritical = tier >= 4
  return (
    <span className={'bg-white text-xs font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 ' + (isCritical ? 'text-red-500' : 'text-amber-600')}>
      {label} (Tier {tier})
    </span>
  )
}

function EsplCamSnapshot({
  log,
  captureDeviceId,
}: {
  log: LogEntry
  captureDeviceId?: string
}) {
  const [capture, setCapture] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    const load = async () => {
      if (!captureDeviceId) {
        setState('missing')
        return
      }
      setState('loading')
      try {
        const captures = await fetchCaptures(captureDeviceId)
        if (cancelled) return
        const nearest = findNearestCapture(captures, log.timestamp)
        if (!nearest) {
          setState('missing')
          return
        }
        // Authenticated image route — blob URL, revoked on cleanup.
        const url = await fetchCaptureImage(nearest.id)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setCapture(url)
        setState('ready')
      } catch {
        if (!cancelled) setState('missing')
      }
    }

    void load()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [log, captureDeviceId])

  if (state === 'loading') {
    return (
      <div className="relative aspect-video bg-neutral-900 rounded-lg overflow-hidden flex flex-col items-center justify-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        <span className="text-xs tnum text-neutral-500">Loading capture...</span>
      </div>
    )
  }

  if (state === 'missing') {
    return (
      <div className="relative aspect-video bg-neutral-900 rounded-lg overflow-hidden flex flex-col items-center justify-center gap-2 border border-white/10">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
        <span className="text-xs tnum text-neutral-500">Snapshot unavailable</span>
        <span className="absolute bottom-2 left-2 text-[10px] tnum text-neutral-500">{formatTime(log.timestamp)}</span>
        <span className="absolute bottom-2 right-2 text-[10px] tnum text-neutral-500">{log.status}</span>
      </div>
    )
  }

  return (
    <div className="relative aspect-video bg-neutral-900 rounded-lg overflow-hidden">
      <img
        src={capture as string}
        alt="ESP32-CAM capture"
        className="w-full h-full object-cover"
      />
      <span className="absolute top-2 left-2 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[10px] font-bold text-red-400">REC</span>
      </span>
      <span className="absolute bottom-2 left-2 text-[10px] tnum text-neutral-500">{formatTime(log.timestamp)}</span>
      <span className="absolute bottom-2 right-2 text-[10px] tnum text-neutral-500">{log.status}</span>
    </div>
  )
}

export default function LogDetailModal({
  log,
  onClose,
  captureDeviceId,
}: {
  log: LogEntry
  onClose: () => void
  captureDeviceId?: string
}) {
  useEffect(() => lockScroll(), [])

  const tierLabel = log.peakTier
    ? log.peakTier >= 4
      ? 'Severe'
      : log.peakTier === 3
        ? 'Warning'
        : log.peakTier === 2
          ? 'Mild'
          : 'Normal'
    : '—'

  return (
    <div className="fixed inset-0 z-60 flex items-end lg:items-center justify-center">
      <div className="fixed inset-0" onClick={onClose} />
      <div className="relative z-10 w-full lg:w-190 max-w-4xl max-h-[85vh] lg:max-h-[80vh] bg-(--surface-solid) rounded-t-xl lg:rounded-xl drop-shadow-2xl flex flex-col overflow-hidden">
        <div className="bg-ember text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <TierBadge tier={log.peakTier ?? 0} label={tierLabel} />
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight truncate">{formatFullDate(log.timestamp)}</p>
              <p className="text-xs opacity-80 mt-0.5">{formatTime(log.timestamp)}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon-light text-2xl leading-none shrink-0 ml-3">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoItem label="PEAK TIER" value={log.peakTier ? `Tier ${log.peakTier} (${tierLabel})` : '—'} />
            <InfoItem label="FIRE TYPE" value={log.peakFireType ?? '—'} />
            <InfoItem label="DURATION" value={log.durationSeconds ? `${log.durationSeconds}s` : '—'} />
            <InfoItem label="STATUS" value={log.eventStatus ?? '—'} />
          </div>
          <div>
            <h3 className="text-[10px] font-extrabold text-gray-400 tracking-wide mb-2">SNAPSHOT</h3>
            <EsplCamSnapshot
              log={log}
              captureDeviceId={captureDeviceId}
            />
          </div>
        </div>
        <div className="h-4 w-full flex bg-ember"></div>
      </div>
    </div>
  )
}