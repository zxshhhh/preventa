'use client'

import { useId, useMemo, useState, type PointerEvent } from 'react'
import type { CaptureEntry, LogEntry, ReadingEntry } from '@/lib/logReport'
import {
  EVIDENCE_GROUPS,
  EVIDENCE_METRICS,
  explainReading,
  findTriggerReading,
  metricValue,
  readingNumber,
  samplingGapMs,
  sensorEvidence,
  sortEventReadings,
  temperatureDiscrepancy,
  type EvidenceGroup,
  type EvidenceMetric,
} from '@/lib/eventEvidence'

const W = 640
const LEFT = 58
const RIGHT = 16
const TOP = 18
const H = 126
const BOTTOM = 26
const timeFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

function timeLabel(timestamp: string | number) {
  return timeFormat.format(new Date(timestamp))
}

function EvidenceChart({
  readings, metric, selectedIndex, onSelect, log, captures,
}: {
  readings: ReadingEntry[]
  metric: EvidenceMetric
  selectedIndex: number
  onSelect: (index: number) => void
  log: LogEntry
  captures: CaptureEntry[]
}) {
  const description = EVIDENCE_METRICS[metric]
  const values = readings.map((reading) => metricValue(reading, metric))
  const available = values.filter((value): value is number => value !== null)
  const start = Date.parse(readings[0].timestamp)
  const end = Date.parse(readings[readings.length - 1].timestamp)
  const span = Math.max(1, end - start)
  const x = (timestamp: number) => LEFT + ((timestamp - start) / span) * (W - LEFT - RIGHT)
  const maximum = Math.max(...available, 0)
  const minimum = Math.min(...available, 0)
  const range = metric === 'temperature' && available.length ? maximum - Math.min(...available) : maximum - minimum
  const padding = Math.max(range * 0.1, metric === 'current' || metric === 'currentDelta' ? 0.05 : 0.2)
  // Temperature keeps a local scale so small changes remain visible.
  const floor = metric === 'temperature' && available.length ? Math.min(...available) - padding : minimum - padding
  const ceiling = metric === 'tier' ? 5 : metric === 'camera' ? 100 : maximum + padding
  const lower = metric === 'tier' || metric === 'camera' ? 0 : floor
  const y = (value: number) => TOP + (1 - (value - lower) / Math.max(0.001, ceiling - lower)) * (H - TOP - BOTTOM)
  const gapLimit = samplingGapMs(readings)
  const selected = readings[selectedIndex]
  const selectedValue = values[selectedIndex]
  let path = ''
  let connected = false
  for (let index = 0; index < readings.length; index++) {
    const value = values[index]
    if (value === null) {
      connected = false
      continue
    }
    const t = Date.parse(readings[index].timestamp)
    const gap = index > 0 && t - Date.parse(readings[index - 1].timestamp) > gapLimit
    const px = x(t).toFixed(2)
    const py = y(value).toFixed(2)
    if (!connected || gap) path += `M${px},${py} `
    else path += metric === 'tier' ? `H${px} V${py} ` : `L${px},${py} `
    connected = true
  }

  function selectAt(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - bounds.left) / bounds.width) * W
    const t = start + ((px - LEFT) / (W - LEFT - RIGHT)) * span
    let nearest = 0
    for (let index = 1; index < readings.length; index++) {
      if (Math.abs(Date.parse(readings[index].timestamp) - t) < Math.abs(Date.parse(readings[nearest].timestamp) - t)) nearest = index
    }
    onSelect(nearest)
  }

  return (
    <figure className="min-w-0 rounded-xl border border-white/10 bg-black/15 p-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="font-semibold text-gray-300">{description.label}</span>
        <span className="tnum text-gray-100">
          {selectedValue === null ? 'Unavailable' : `${selectedValue.toFixed(description.decimals)} ${description.unit}`}
        </span>
      </figcaption>
      {available.length === 0 ? (
        <p className="py-6 text-sm text-gray-400">This measurement was unavailable in the saved readings.</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-2 block w-full touch-pan-y"
          role="img"
          aria-label={`${description.label} in ${description.unit}, from ${timeLabel(start)} to ${timeLabel(end)} Manila time. Use the sample slider below to inspect values.`}
          onPointerDown={selectAt}
          onPointerMove={(event) => { if (event.buttons === 1) selectAt(event) }}
        >
          {[0, 0.5, 1].map((fraction) => {
            const value = lower + (ceiling - lower) * fraction
            return (
              <g key={fraction}>
                <line x1={LEFT} x2={W - RIGHT} y1={y(value)} y2={y(value)} stroke="currentColor" className="text-white/10" />
                <text x={LEFT - 8} y={y(value) + 4} textAnchor="end" fontSize="11" fill="currentColor" className="text-gray-400">{value.toFixed(description.decimals)}</text>
              </g>
            )
          })}
          {[{ time: log.timestamp, label: 'Event start' }, { time: log.endTime, label: 'Event resolved' }].map((marker) => {
            const t = marker.time ? Date.parse(marker.time) : NaN
            if (t < start || t > end || !Number.isFinite(t)) return null
            return (
              <line key={marker.label} x1={x(t)} x2={x(t)} y1={TOP} y2={H - BOTTOM}
                stroke="var(--amber-indicator)" strokeDasharray="4 4">
                <title>{`${marker.label} ${timeLabel(t)}`}</title>
              </line>
            )
          })}
          <path d={path} fill="none" stroke={metric === 'tier' ? 'var(--amber-indicator)' : 'var(--sensor-gas)'} strokeWidth="2" strokeLinejoin="round" />
          {readings.map((reading, index) => {
            const value = values[index]
            if (value === null) return null
            return (
              <circle key={reading.id ?? reading.timestamp} cx={x(Date.parse(reading.timestamp))}
                cy={y(value)} r={index === selectedIndex ? 4 : 2}
                fill={metric === 'tier' ? 'var(--amber-indicator)' : 'var(--sensor-gas)'} />
            )
          })}
          <line x1={x(Date.parse(selected.timestamp))} x2={x(Date.parse(selected.timestamp))} y1={TOP} y2={H - BOTTOM} stroke="var(--primary-text-color)" opacity="0.65" />
          {metric === 'tier' && captures.map((capture) => {
            const t = Date.parse(capture.timestamp)
            if (!Number.isFinite(t) || t < start || t > end) return null
            return (
              <path key={capture.id} d={`M${x(t)},4 l4,4 l-4,4 l-4,-4 Z`} fill="#a78bfa">
                <title>{`Nearby capture ${timeLabel(t)}`}</title>
              </path>
            )
          })}
          <text x={LEFT} y={H - 4} fontSize="11" fill="currentColor" className="text-gray-400">{timeLabel(start)}</text>
          <text x={W - RIGHT} y={H - 4} fontSize="11" textAnchor="end" fill="currentColor" className="text-gray-400">{timeLabel(end)}</text>
        </svg>
      )}
    </figure>
  )
}

export default function EventTimeline({ readings: input, captures, log }: {
  readings: ReadingEntry[]
  captures: CaptureEntry[]
  log: LogEntry
}) {
  const readings = useMemo(() => sortEventReadings(input), [input])
  const trigger = findTriggerReading(readings, log.timestamp)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [chosenGroup, setChosenGroup] = useState<EvidenceGroup | null>(null)
  const controlId = useId()
  if (!readings.length) return <p className="text-sm text-gray-400">No timestamped readings are available for this event.</p>

  const requestedTime = selectedTime ?? trigger?.timestamp ?? readings[0].timestamp
  const foundIndex = readings.findIndex((reading) => reading.timestamp === requestedTime)
  const selectedIndex = foundIndex < 0 ? 0 : foundIndex
  const selected = readings[selectedIndex]
  const explanation = explainReading(selected)
  const group = chosenGroup ?? explainReading(trigger ?? selected).group
  const discrepancy = temperatureDiscrepancy(readings, selected)
  const startTime = Date.parse(log.timestamp)
  const endTime = log.endTime ? Date.parse(log.endTime) : Infinity
  const eventReadings = readings.filter((reading) => {
    const t = Date.parse(reading.timestamp)
    return t >= startTime - 5_000 && t <= endTime
  })
  const peak = eventReadings.reduce<ReadingEntry | null>((best, reading) =>
    (metricValue(reading, 'tier') ?? -1) > (best ? metricValue(best, 'tier') ?? -1 : -1) ? reading : best, null,
  )
  const transitions = eventReadings.filter((reading, index) => {
    const tier = metricValue(reading, 'tier')
    return tier !== null && (index === 0 || tier !== metricValue(eventReadings[index - 1], 'tier'))
  })
  const gapLimit = samplingGapMs(readings)
  const gaps = readings.slice(1).filter((reading, index) =>
    Date.parse(reading.timestamp) - Date.parse(readings[index].timestamp) > gapLimit,
  ).length
  const metrics = EVIDENCE_GROUPS[group].metrics
  const position = Date.parse(selected.timestamp) < startTime - 5_000 ? 'Before event'
    : Date.parse(selected.timestamp) > endTime ? 'After event' : selected === trigger ? 'Event start sample' : 'Selected sample'

  return (
    <div className="space-y-4">
      {!trigger && <p role="status" className="text-sm text-amber-300">The Tier 3+ reading nearest the event start is unavailable. You can inspect the remaining evidence below.</p>}
      <div className="rounded-xl border border-white/15 bg-white/5 p-4">
        <p className="text-xs text-gray-400">{position} · {timeLabel(selected.timestamp)} Manila time</p>
        <h4 className="mt-1 text-base font-bold text-gray-100">{explanation.title}</h4>
        <p className="mt-2 text-sm leading-relaxed text-gray-300">{explanation.detail}</p>
        {discrepancy && <p className="mt-3 text-sm leading-relaxed text-(--amber-indicator)">{discrepancy}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {sensorEvidence(selected).map((sensor) => (
            <div key={sensor.key} className="rounded-lg bg-black/20 p-2">
              <dt className="text-xs text-gray-400">{sensor.label}</dt>
              <dd className={sensor.state && sensor.state > 0 ? 'text-sm font-semibold text-(--amber-indicator)' : 'text-sm text-gray-200'}>{sensor.stateLabel}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { label: 'Event start', reading: trigger },
          { label: 'Recorded peak', reading: peak },
          { label: 'Latest sample', reading: readings[readings.length - 1] },
        ].map((item) => (
          <button key={item.label} type="button" disabled={!item.reading} className="btn-outline btn-sm min-h-11 disabled:opacity-40" onClick={() => { if (item.reading) setSelectedTime(item.reading.timestamp) }}>{item.label}</button>
        ))}
      </div>
      <EvidenceChart readings={readings} selectedIndex={selectedIndex} onSelect={(index) => setSelectedTime(readings[index].timestamp)} metric="tier" log={log} captures={captures} />
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={controlId + '-metric'} className="text-sm font-semibold text-gray-300">Measurement</label>
        <select id={controlId + '-metric'} value={group} onChange={(event) => setChosenGroup(event.target.value as EvidenceGroup)} className="min-h-11 rounded-lg border border-white/20 bg-(--surface-solid) px-3 text-sm text-gray-100">
          {(Object.keys(EVIDENCE_GROUPS) as EvidenceGroup[]).map((key) => <option key={key} value={key}>{EVIDENCE_GROUPS[key].label}</option>)}
        </select>
      </div>
      {metrics.map((metric) => <EvidenceChart key={metric} readings={readings} selectedIndex={selectedIndex} onSelect={(index) => setSelectedTime(readings[index].timestamp)} metric={metric} log={log} captures={captures} />)}

      <div>
        <label htmlFor={controlId + '-sample'} className="text-xs text-gray-300">Inspect sample {selectedIndex + 1} of {readings.length} · {timeLabel(selected.timestamp)}</label>
        <input id={controlId + '-sample'} type="range" min={0} max={Math.max(0, readings.length - 1)} value={selectedIndex} disabled={readings.length === 1} onChange={(event) => setSelectedTime(readings[Number(event.target.value)].timestamp)} className="mt-1 block min-h-11 w-full accent-amber-400" />
        <p className="text-xs leading-relaxed text-gray-400">Points are saved uploads. Dashed lines mark event start and resolution. Diamonds mark nearby captures. {gaps > 0 && `${gaps} upload gap${gaps === 1 ? '' : 's'} shown as breaks. `}Times are in Manila.</p>
      </div>
      {transitions.length > 0 && <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto" aria-label="Recorded tier changes">
        {transitions.map((reading) => <button type="button" key={reading.id ?? reading.timestamp} className="btn-outline btn-sm min-h-11" onClick={() => setSelectedTime(reading.timestamp)}>{timeLabel(reading.timestamp)} · Tier {metricValue(reading, 'tier')}</button>)}
      </div>}

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          { label: 'Initial tier', value: readingNumber(selected, 'initial_tier') },
          { label: 'Fusion tier', value: readingNumber(selected, 'fusion_tier') },
          { label: 'Fusion score', value: metricValue(selected, 'fusion') },
          { label: 'Final tier', value: metricValue(selected, 'tier') },
        ].map((item) => <div key={item.label} className="rounded-lg border border-white/10 p-3"><dt className="text-gray-400">{item.label}</dt><dd className="mt-1 tnum text-sm font-semibold text-gray-100">{item.value ?? 'Unavailable'}</dd></div>)}
      </dl>
      <p className="text-xs leading-relaxed text-gray-300">
        Relay cut {selected.values.relay_cut === true ? 'flag on' : selected.values.relay_cut === false ? 'flag off' : 'flag unavailable'}
        {' · '}Siren {selected.values.siren === true ? 'active' : selected.values.siren === false ? 'inactive' : 'state unavailable'}
        {' · '}Notification {selected.values.send_notif === true ? 'requested by device' : selected.values.send_notif === false ? 'not requested at this sample' : 'flag unavailable'}
      </p>
      <p className="text-xs leading-relaxed text-gray-400">Explanations use the saved device decisions. Historical firmware and threshold snapshots are unavailable. Nearby captures are matched by upload time.</p>
    </div>
  )
}
