'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { SensorConfig } from '@/lib/dashboardData'
import { SENSORS, HUMIDITY_CONFIG } from '@/lib/dashboardData'
import { useHydrated } from '@/lib/useHydrated'

const STORAGE_KEY = 'preventa.calibration'

type MetricKey = 'temperature' | 'humidity' | 'gas' | 'power'

interface Thresholds {
  nominal: number
  warning: number
}

type CalibrationMap = Record<MetricKey, Thresholds>

const METRICS: { key: MetricKey; title: string; cfg: SensorConfig }[] = [
  { key: 'temperature', title: 'Temperature', cfg: SENSORS.dht22 },
  { key: 'humidity', title: 'Humidity', cfg: HUMIDITY_CONFIG },
  { key: 'gas', title: 'Gas Concentration', cfg: SENSORS.mq7 },
  { key: 'power', title: 'Power Usage', cfg: SENSORS.acs712 },
]

const DEFAULT_CALIBRATION: CalibrationMap = {
  temperature: { nominal: SENSORS.dht22.thresholdNominal, warning: SENSORS.dht22.thresholdWarning },
  humidity: { nominal: HUMIDITY_CONFIG.thresholdNominal, warning: HUMIDITY_CONFIG.thresholdWarning },
  gas: { nominal: SENSORS.mq7.thresholdNominal, warning: SENSORS.mq7.thresholdWarning },
  power: { nominal: SENSORS.acs712.thresholdNominal, warning: SENSORS.acs712.thresholdWarning },
}

function cloneCalibration(c: CalibrationMap): CalibrationMap {
  return METRICS.reduce<CalibrationMap>((acc, { key }) => {
    acc[key] = { ...c[key] }
    return acc
  }, {} as CalibrationMap)
}

function sanitizeCalibration(raw: unknown): CalibrationMap | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<CalibrationMap>
  const out = cloneCalibration(DEFAULT_CALIBRATION)
  for (const { key } of METRICS) {
    const t = r[key]
    if (!t) return null
    const nominal = Number(t.nominal)
    const warning = Number(t.warning)
    if (!Number.isFinite(nominal) || !Number.isFinite(warning)) return null
    out[key] = { nominal, warning }
  }
  return out
}

function isSame(a: CalibrationMap, b: CalibrationMap): boolean {
  return METRICS.every(({ key }) => a[key].nominal === b[key].nominal && a[key].warning === b[key].warning)
}

import { useSensors } from '@/context/useSensors'

export default function SettingsContent() {
  const hydrated = useHydrated()
  const { pushToast } = useSensors()
  const [draft, setDraft] = useState<CalibrationMap>(() => cloneCalibration(DEFAULT_CALIBRATION))
  const [baseline, setBaseline] = useState<CalibrationMap>(() => cloneCalibration(DEFAULT_CALIBRATION))

  useEffect(() => {
    if (!hydrated) return
    const id = setTimeout(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        const parsed = sanitizeCalibration(JSON.parse(raw))
        if (parsed) {
          setDraft(parsed)
          setBaseline(parsed)
        }
      } catch {
        /* ignore corrupted storage */
      }
    }, 0)
    return () => clearTimeout(id)
  }, [hydrated])

  const valid = METRICS.every(({ key }) => {
    const n = draft[key].nominal
    const w = draft[key].warning
    return Number.isFinite(n) && Number.isFinite(w) && n >= 0 && w > n
  })
  const dirty = !isSame(draft, baseline)

  const handleChange = (key: MetricKey, field: 'nominal' | 'warning', input: string) => {
    setDraft((prev) => ({ ...prev, [key]: { ...prev[key], [field]: input === '' ? Number.NaN : Number(input) } }))
  }

  const persist = (c: CalibrationMap) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
    } catch {
      /* ignore storage failures */
    }
  }

  const handleSave = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    const next = cloneCalibration(draft)
    setBaseline(next)
    persist(next)
    pushToast('Calibration saved', 'Updated thresholds are now in effect.')
  }

  const handleReset = () => {
    const next = cloneCalibration(DEFAULT_CALIBRATION)
    setDraft(next)
    setBaseline(next)
    persist(next)
    pushToast('Calibration reset', 'Factory defaults restored.')
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold text-2xl text-gray-100">Settings</h1>
      </div>
      <CalibrationForm
        draft={draft}
        valid={valid}
        dirty={dirty}
        onChange={handleChange}
        onSave={handleSave}
        onReset={handleReset}
      />
      <HowItWorks current={draft} />
    </div>
  )
}

function CalibrationForm({
  draft,
  valid,
  dirty,
  onChange,
  onSave,
  onReset,
}: {
  draft: CalibrationMap
  valid: boolean
  dirty: boolean
  onChange: (key: MetricKey, field: 'nominal' | 'warning', input: string) => void
  onSave: (e: FormEvent) => void
  onReset: () => void
}) {
  const num = (v: number) => (Number.isFinite(v) ? String(v) : '')
  const invalid = (t: Thresholds) => Number.isFinite(t.nominal) && Number.isFinite(t.warning) && t.warning <= t.nominal

  return (
    <section className="panel-card p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-bold text-base text-gray-100 tracking-wide">Calibration</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Adjust the NOMINAL and WARNING thresholds for each sensor; values persist locally after saving.
          </p>
        </div>
      </div>

      <form onSubmit={onSave} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {METRICS.map(({ key, title, cfg }) => {
          const t = draft[key]
          const bad = invalid(t)
          return (
            <fieldset key={key} className="flex flex-col gap-2 rounded-xl border border-white/10 p-3">
              <legend className="text-[11px] font-bold text-gray-100 px-1">{title}</legend>
              <p className="text-[10px] text-gray-500 font-semibold -mt-1">{cfg.unit} · default {cfg.thresholdNominal}/{cfg.thresholdWarning}</p>
              <label className="flex items-center gap-2 text-[11px] font-bold text-gray-400">
                <span className="w-16 shrink-0">NOMINAL ≤</span>
                <input
                  type="number"
                  step={cfg.decimals > 0 ? 0.1 : 1}
                  min={0}
                  value={num(t.nominal)}
                  onChange={(e) => onChange(key, 'nominal', e.target.value)}
                  className="input-profile w-full flex-1"
                />
              </label>
              <label className="flex items-center gap-2 text-[11px] font-bold text-gray-400">
                <span className="w-16 shrink-0">WARNING &gt;</span>
                <input
                  type="number"
                  step={cfg.decimals > 0 ? 0.1 : 1}
                  min={0}
                  value={num(t.warning)}
                  onChange={(e) => onChange(key, 'warning', e.target.value)}
                  className="input-profile w-full flex-1"
                />
              </label>
              {bad && <p className="text-[10px] font-bold text-red-400">WARNING must be above NOMINAL</p>}
            </fieldset>
          )
        })}
        <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={!valid} className="btn-primary btn-md min-w-32 disabled:opacity-40 disabled:cursor-not-allowed">
            SAVE CALIBRATION
          </button>
          <button type="button" onClick={onReset} className="btn-outline btn-md">
            RESET TO FACTORY DEFAULTS
          </button>
          {dirty && <span className="text-xs font-semibold text-amber-400">Unsaved changes</span>}
        </div>
      </form>
    </section>
  )
}

function HowItWorks({ current }: { current: CalibrationMap }) {
  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">How Calibration Works</h2>
      <p className="text-xs text-gray-400 mt-1 leading-relaxed">
        Every sensor has two threshold levels that decide its live status badge. Calibration lets you set where{' '}
        <span className="font-bold text-gray-200">NOMINAL</span> ends and{' '}
        <span className="font-bold text-gray-200">WARNING</span> begins. The values the system compares each reading
        against before raising an alert.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3">
          <p className="text-[10px] font-extrabold tracking-wide text-emerald-300">NOMINAL (SAFE)</p>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            Reading is at or below the NOMINAL threshold. Everything is within expected range and the badge stays green.
          </p>
        </div>
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-3">
          <p className="text-[10px] font-extrabold tracking-wide text-amber-300">WARNING (ELEVATED)</p>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            Reading sits between NOMINAL and WARNING. The sensor is above normal, worth monitoring but not yet
            dangerous.
          </p>
        </div>
        <div className="rounded-xl border border-red-400/25 bg-red-400/10 p-3">
          <p className="text-[10px] font-extrabold tracking-wide text-red-300">CRITICAL (DANGER)</p>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            Reading exceeds the WARNING threshold. The system flags it CRITICAL and logs an alert event.
          </p>
        </div>
      </div>
      <div className="mt-4 text-xs text-gray-400 space-y-2 leading-relaxed">
        <p className="font-bold text-gray-100">What happens when you edit calibration?</p>
        <ul className="list-disc list-inside space-y-1.5">
          <li>
            <span className="font-bold">Lowering the WARNING threshold</span> makes a sensor more sensitive which it flips to
            WARNING/CRITICAL earlier and triggers alerts sooner. The trade-off is a higher chance of false alarms.
          </li>
          <li>
            <span className="font-bold">Raising the WARNING threshold</span> makes a sensor more tolerant which is fewer alerts
            and quieter notification logs. The trade-off is that a real hazard may go unnoticed longer.
          </li>
          <li>
            Keep <span className="font-bold">WARNING above NOMINAL</span> (the form enforces this). A reading that falls
            between the two shows as WARNING rather than NOMINAL.
          </li>
        </ul>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs min-w-130">
          <thead>
            <tr className="text-left text-gray-400 border-white/10">
              <th className="pb-2 pr-2">METRIC</th>
              <th className="pb-2 pr-2">UNIT</th>
              <th className="pb-2 pr-2">DEFAULT NOMINAL</th>
              <th className="pb-2 pr-2">DEFAULT WARNING</th>
              <th className="pb-2 pr-2">CURRENT NOMINAL</th>
              <th className="pb-2">CURRENT WARNING</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map(({ key, title, cfg }) => (
              <tr key={key} className="border-b border-white/10">
                <td className="py-2 pr-2 font-semibold text-gray-100">{title}</td>
                <td className="py-2 pr-2 text-gray-500">{cfg.unit}</td>
                <td className="py-2 pr-2 text-gray-500">{cfg.thresholdNominal}</td>
                <td className="py-2 pr-2 text-gray-500">{cfg.thresholdWarning}</td>
                <td className="py-2 pr-2 font-mono text-gray-300">{current[key].nominal}</td>
                <td className="py-2 font-mono text-gray-300">{current[key].warning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}