'use client'

import { useEffect } from 'react'
import { lockScroll } from '@/lib/scrollLock'
import type { LogEntry } from '@/lib/logReport'
import { formatTime, formatFullDate } from '@/lib/logReport'

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

function EsplCamSnapshot({ log }: { log: LogEntry }) {
  return (
    <div className="relative aspect-video bg-neutral-900 rounded-lg overflow-hidden flex flex-col items-center justify-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
      <span className="text-xs font-mono text-neutral-500">ESP32-CAM</span>
      <span className="absolute top-2 left-2 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[10px] font-bold text-red-400">REC</span>
      </span>
      <span className="absolute bottom-2 left-2 text-[10px] font-mono text-neutral-500">{formatTime(log.timestamp)}</span>
      <span className="absolute bottom-2 right-2 text-[10px] font-mono text-neutral-500">{log.status}</span>
    </div>
  )
}

export default function LogDetailModal({ log, onClose }: Props) {
  useEffect(() => lockScroll(), [])

  return (
    <div className="fixed inset-0 z-60 flex items-end lg:items-center justify-center">
      <div className="fixed inset-0" onClick={onClose} />
      <div className="relative z-10 w-full lg:w-190 max-w-4xl max-h-[85vh] lg:max-h-[80vh] bg-(--surface-solid) rounded-t-xl lg:rounded-xl drop-shadow-2xl flex flex-col overflow-hidden">
        <div className="bg-ember text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className={'bg-white text-xs font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 ' + (log.status === 'CRITICAL' ? 'text-red-500' : 'text-amber-600')}>
              {log.status}
            </span>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight truncate">{formatFullDate(log.timestamp)}</p>
              <p className="text-xs opacity-80 mt-0.5">{formatTime(log.timestamp)}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon-light text-2xl leading-none shrink-0 ml-3">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoItem label="GAS CONCENTRATION" value={log.gas.toFixed(0) + ' PPM'} />
            <InfoItem label="TEMPERATURE" value={log.temperature.toFixed(1) + ' °C'} />
            <InfoItem label="HUMIDITY" value={log.humidity.toFixed(0) + ' %'} />
            <InfoItem label="POWER USAGE" value={log.power.toFixed(2) + ' AMPS'} />
          </div>
          <div>
            <h3 className="text-[10px] font-extrabold text-gray-400 tracking-wide mb-2">ESPCAM32 SNAPSHOT</h3>
            <EsplCamSnapshot log={log} />
          </div>
        </div>
        <div className="h-4 w-full flex bg-ember"></div>
      </div>
    </div>
  )
}