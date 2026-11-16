'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { SensorConfig } from '@/lib/dashboardData'
import { SENSORS, HUMIDITY_CONFIG } from '@/lib/dashboardData'
import { useHydrated } from '@/lib/useHydrated'
import { isApiConfigured } from '@/lib/api/config'
import { fetchDeviceSettings, saveDeviceSettings, saveCalibration, type CalibrationSettings, type DeviceSettingsSave, type DeviceSyncStatus } from '@/lib/api/settings'
import { formatFullDate, formatTime } from '@/lib/logReport'
import { fetchBaseline, type DeviceBaseline } from '@/lib/api/baselines'
import { fetchResidences, type ResidenceEntry } from '@/lib/api/profile'
import { registerDevice, deleteDevice, type RegisteredDevice } from '@/lib/api/system'
import {
  enableBrowserPush,
  disableBrowserPush,
  isPushConfigured,
  getStoredPushToken,
} from '@/lib/api/push'

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
import { useDevices } from '@/context/useDevice'
import { useTheme, type Theme } from '@/context/useTheme'

const THEMES: { value: Theme; label: string; icon: ReactNode }[] = [
  {
    value: 'dark',
    label: 'DARK',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    ),
  },
  {
    value: 'light',
    label: 'LIGHT',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    ),
  },
]

export default function SettingsContent() {
  const hydrated = useHydrated()
  const { pushToast } = useSensors()
  const [draft, setDraft] = useState<CalibrationMap>(() => cloneCalibration(DEFAULT_CALIBRATION))
  const [baseline, setBaseline] = useState<CalibrationMap>(() => cloneCalibration(DEFAULT_CALIBRATION))
  const [intervalInput, setIntervalInput] = useState<string>('')
  const [cameraEnabled, setCameraEnabled] = useState<boolean | null>(null)
  const [remoteBaseline, setRemoteBaseline] = useState<{ interval: string; camera: boolean | null }>({ interval: '', camera: null })
  const [sync, setSync] = useState<DeviceSyncStatus | null>(null)

  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    const id = setTimeout(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = sanitizeCalibration(JSON.parse(raw))
          if (parsed) {
            setDraft(parsed)
            setBaseline(parsed)
          }
        }
      } catch {
        /* ignore corrupted storage */
      }

      if (isApiConfigured()) {
        void fetchDeviceSettings()
          .then((remote) => {
            if (cancelled || !remote) return
            const parsed = sanitizeCalibration(remote.calibration)
            if (parsed) {
              setDraft(parsed)
              setBaseline(parsed)
            }
            const interval = remote.sampleIntervalSec === null ? '' : String(remote.sampleIntervalSec)
            setIntervalInput(interval)
            setCameraEnabled(remote.cameraEnabled)
            setRemoteBaseline({ interval, camera: remote.cameraEnabled })
            setSync(remote.sync)
          })
          .catch(() => {
            /* keep local calibration if the fetch fails */
          })
      }
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [hydrated])

  // While a save is pending, poll the device detail until the board syncs (only while the screen is open).
  useEffect(() => {
    if (sync?.pending !== true || !isApiConfigured()) return
    const id = setInterval(() => {
      void fetchDeviceSettings()
        .then((remote) => {
          if (remote) setSync(remote.sync)
        })
        .catch(() => {
          /* keep waiting; the next tick retries */
        })
    }, 10_000)
    return () => clearInterval(id)
  }, [sync?.pending])

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
    if (!isApiConfigured()) {
      pushToast('Calibration saved', 'Updated thresholds are now in effect.')
      return
    }
    void saveCalibration(next as CalibrationSettings)
      .then(() => pushToast('Calibration saved', 'Updated thresholds synced to the server.'))
      .catch(() => pushToast('Save failed', 'Could not reach the API — thresholds kept locally.'))
  }

  const handleReset = () => {
    const next = cloneCalibration(DEFAULT_CALIBRATION)
    setDraft(next)
    setBaseline(next)
    persist(next)
    if (!isApiConfigured()) {
      pushToast('Calibration reset', 'Factory defaults restored.')
      return
    }
    void saveCalibration(next as CalibrationSettings)
      .then(() => pushToast('Calibration reset', 'Factory defaults synced to the server.'))
      .catch(() => pushToast('Reset failed', 'Could not reach the API — defaults kept locally.'))
  }

  const deviceIntervalValid =
    intervalInput.trim() === '' ||
    (Number.isFinite(Number(intervalInput)) && Number(intervalInput) >= 2 && Number(intervalInput) <= 60)
  const deviceDirty = intervalInput !== remoteBaseline.interval || cameraEnabled !== remoteBaseline.camera

  const saveDevice = () => {
    if (!isApiConfigured()) {
      setRemoteBaseline({ interval: intervalInput, camera: cameraEnabled })
      pushToast('Device settings saved', 'Reporting settings stored locally (API not configured).')
      return
    }
    const raw = Number(intervalInput)
    const payload: DeviceSettingsSave = {}
    if (intervalInput !== remoteBaseline.interval) {
      payload.sampleIntervalSec = intervalInput.trim() === '' || !Number.isFinite(raw) ? null : raw
    }
    if (cameraEnabled !== remoteBaseline.camera) {
      payload.cameraEnabled = cameraEnabled
    }
    void saveDeviceSettings(payload)
      .then((remote) => {
        if (remote) {
          setSync(remote.sync)
          const interval = remote.sampleIntervalSec === null ? '' : String(remote.sampleIntervalSec)
          setIntervalInput(interval)
          setCameraEnabled(remote.cameraEnabled)
          setRemoteBaseline({ interval, camera: remote.cameraEnabled })
        }
        pushToast('Device settings saved', 'Sent to the device — waiting for it to sync.')
      })
      .catch(() => pushToast('Save failed', 'Could not reach the API — device settings kept.'))
  }

  const refreshSync = () => {
    if (!isApiConfigured()) return
    void fetchDeviceSettings()
      .then((remote) => {
        if (remote) setSync(remote.sync)
      })
      .catch(() => pushToast('Refresh failed', 'Could not reach the API.'))
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold text-2xl text-gray-100">Settings</h1>
      </div>
      <AppearanceSection />
      <CalibrationForm
        draft={draft}
        valid={valid}
        dirty={dirty}
        onChange={handleChange}
        onSave={handleSave}
        onReset={handleReset}
      />
      <CalibrationStatusSection />
      <DeviceReportingSection
        intervalInput={intervalInput}
        cameraEnabled={cameraEnabled}
        dirty={deviceDirty}
        valid={deviceIntervalValid}
        sync={sync}
        onIntervalChange={setIntervalInput}
        onCameraChange={setCameraEnabled}
        onSave={saveDevice}
        onRefresh={refreshSync}
      />
      <DeviceManagementSection />
      <BrowserNotificationsSection />
      <HowItWorks current={draft} />
    </div>
  )
}

function AppearanceSection() {
  const hydrated = useHydrated()
  const { theme, setTheme } = useTheme()
  const active = hydrated ? theme : 'dark'

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">Appearance</h2>
      <p className="text-xs text-gray-500 mt-0.5">
        Choose between the dark radar theme and a lighter theme. The choice is saved on this device.
      </p>
      <div className="flex items-center gap-1 flex-wrap bg-white/5 border border-white/10 rounded-lg p-1 mt-4 w-fit">
        {THEMES.map(({ value, label, icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={active === value}
            onClick={() => setTheme(value)}
            className={
              'flex items-center gap-1.5 btn-segment ' +
              (active === value ? 'btn-segment-active' : 'text-gray-400 hover:text-gray-200')
            }
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
    </section>
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

function SyncBanner({ sync, onRefresh }: { sync: DeviceSyncStatus | null; onRefresh: () => void }) {
  const pending = sync?.pending ?? null
  const style =
    pending === true
      ? 'border-amber-400/25 bg-amber-400/10 text-amber-300'
      : pending === false
        ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
        : 'border-white/10 bg-white/5 text-gray-400'
  const label =
    pending === true
      ? 'SAVED, AWAITING DEVICE SYNC'
      : pending === false
        ? 'APPLIED'
        : 'SYNC STATUS UNAVAILABLE'
  const at = pending === false ? sync?.appliedAt : null

  return (
    <div className={'flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 ' + style}>
      <div className="flex items-center gap-2 min-w-0">
        <span className={'w-2 h-2 rounded-full shrink-0 ' + (pending === true ? 'bg-amber-400 animate-pulse' : pending === false ? 'bg-emerald-400' : 'bg-gray-500')} />
        <span className="text-[11px] font-extrabold tracking-wide">{label}</span>
        {at && (
          <span className="text-[11px] font-semibold text-gray-400 truncate">
            {formatFullDate(at)} · {formatTime(at)}
          </span>
        )}
      </div>
      <button type="button" onClick={onRefresh} className="btn-ghost btn-sm shrink-0">
        REFRESH STATUS
      </button>
    </div>
  )
}

function DeviceReportingSection({
  intervalInput,
  cameraEnabled,
  dirty,
  valid,
  sync,
  onIntervalChange,
  onCameraChange,
  onSave,
  onRefresh,
}: {
  intervalInput: string
  cameraEnabled: boolean | null
  dirty: boolean
  valid: boolean
  sync: DeviceSyncStatus | null
  onIntervalChange: (value: string) => void
  onCameraChange: (value: boolean) => void
  onSave: () => void
  onRefresh: () => void
}) {
  const cameraOn = cameraEnabled === true

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">Device Reporting &amp; Camera</h2>
      <p className="text-xs text-gray-500 mt-0.5">
        Reporting settings sync from the cloud to the board. Device application does not confirm SMS receipt.
      </p>

      <div className="mt-4">
        <SyncBanner sync={sync} onRefresh={onRefresh} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div className="rounded-xl border border-white/10 p-3 flex flex-col gap-2">
          <p className="text-[11px] font-bold text-gray-100">Cloud reporting interval</p>
          <label className="flex items-center gap-2 text-[11px] font-bold text-gray-400">
            <span className="shrink-0">SECONDS</span>
            <input
              type="number"
              min={2}
              max={60}
              step={1}
              placeholder="firmware default"
              value={intervalInput}
              onChange={(e) => onIntervalChange(e.target.value)}
              className="input-profile w-full flex-1"
            />
          </label>
          {valid ? (
            <p className="text-[10px] text-gray-500 leading-relaxed">
              2–60 whole seconds. Controls routine cloud uploads only — local acquisition stays on its nominal
              two-second schedule. Leave empty to restore the firmware default.
            </p>
          ) : (
            <p className="text-[10px] font-bold text-red-400">Enter a whole number between 2 and 60, or leave empty</p>
          )}
        </div>
        <div className="rounded-xl border border-white/10 p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold text-gray-100">Camera enabled</p>
            <p className="text-[10px] text-gray-500 leading-relaxed mt-1">
              Turns the ESP32-CAM snapshot capture on or off on the board.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={cameraOn}
            onClick={() => onCameraChange(!cameraOn)}
            className={
              'relative w-11 h-6 rounded-full transition-colors shrink-0 ' +
              (cameraOn ? 'bg-(--secondary-color)' : 'bg-white/10 border border-white/10')
            }
          >
            <span
              className={
                'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ' +
                (cameraOn ? 'translate-x-5' : 'translate-x-0')
              }
            />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          type="button"
          onClick={onSave}
          disabled={!valid || !dirty}
          className="btn-primary btn-md min-w-32 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          SAVE DEVICE SETTINGS
        </button>
        {dirty && <span className="text-xs font-semibold text-amber-400">Unsaved changes</span>}
      </div>
    </section>
  )
}

function CalibrationStatusSection() {
  const { selected } = useDevices()
  const [baseline, setBaseline] = useState<DeviceBaseline | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'unconfigured'>('loading')

  useEffect(() => {
    let cancelled = false
    // Deferred so the initial setState calls aren't synchronous inside the effect.
    const id = setTimeout(() => {
      if (!isApiConfigured()) {
        setState('unconfigured')
        return
      }
      setState('loading')
      void fetchBaseline(selected?.hardwareId)
        .then((b) => {
          if (cancelled) return
          setBaseline(b)
          setState(b ? 'ready' : 'empty')
        })
        .catch(() => {
          if (!cancelled) setState('error')
        })
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [selected?.hardwareId])

  const rows: { label: string; value: string }[] = [
    { label: 'TEMPERATURE AVG', value: baseline?.temperatureAvg != null ? `${baseline.temperatureAvg} °C` : '—' },
    { label: 'HUMIDITY AVG', value: baseline?.humidityAvg != null ? `${baseline.humidityAvg} %RH` : '—' },
    { label: 'GAS PROXY AVG', value: baseline?.gasProxyAvg != null ? `${baseline.gasProxyAvg}` : '—' },
    { label: 'CURRENT AVG', value: baseline?.currentAvg != null ? `${baseline.currentAvg} A` : '—' },
  ]

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">Calibration Status</h2>
      <p className="text-xs text-gray-500 mt-0.5">
        Baseline averages recorded during the device&apos;s last calibration run{selected ? ` — ${selected.name}` : ''}.
        Shown here as calibration context.
      </p>
      {state === 'loading' ? (
        <p className="text-xs text-gray-500 mt-4">Loading calibration data…</p>
      ) : state === 'unconfigured' ? (
        <p className="text-xs text-gray-500 mt-4">Connect the API to load calibration data.</p>
      ) : state === 'error' ? (
        <p className="text-xs text-amber-400 font-semibold mt-4">Calibration data is unavailable right now.</p>
      ) : state === 'empty' || !baseline ? (
        <p className="text-xs text-gray-500 mt-4">No calibration baseline recorded yet.</p>
      ) : (
        <>
          {baseline.createdAt && (
            <p className="text-[11px] text-gray-400 font-mono mt-3">
              Calibrated {formatFullDate(baseline.createdAt)} · {formatTime(baseline.createdAt)}
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {rows.map((r) => (
              <div key={r.label} className="rounded-xl border border-white/10 p-3">
                <p className="text-[10px] font-extrabold tracking-wide text-gray-400">{r.label}</p>
                <p className="text-sm font-bold text-gray-100 mt-1 font-mono">{r.value}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function DeviceManagementSection() {
  const { devices, refresh } = useDevices()
  const { pushToast } = useSensors()
  const [residences, setResidences] = useState<ResidenceEntry[]>([])
  const [hardwareId, setHardwareId] = useState('')
  const [residenceChoice, setResidenceChoice] = useState<string>('')
  const [newAddress, setNewAddress] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState<RegisteredDevice | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!isApiConfigured()) return
    let cancelled = false
    void fetchResidences()
      .then((list) => {
        if (!cancelled) setResidences(list)
      })
      .catch(() => {
        /* the register form still works with a new-residence address */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const canRegister = hardwareId.trim().length > 0 && (residenceChoice !== 'new' || newAddress.trim().length > 0)

  const submitRegister = () => {
    if (!isApiConfigured() || !canRegister) return
    setRegistering(true)
    setRegistered(null)
    setRevealed(false)
    void registerDevice({
      deviceId: hardwareId,
      residenceId: residenceChoice !== '' && residenceChoice !== 'new' ? Number(residenceChoice) : null,
      address: residenceChoice === 'new' ? newAddress : null,
    })
      .then((device) => {
        setRegistered(device)
        setHardwareId('')
        setNewAddress('')
        refresh()
        pushToast('Device registered', `${device.name} was added. Copy the setup key now — it is shown once.`)
      })
      .catch(() => pushToast('Registration failed', 'Could not register the device — check the hardware ID and try again.'))
      .finally(() => setRegistering(false))
  }

  const removeDevice = (device: { id: number; name: string }) => {
    if (!isApiConfigured()) {
      setConfirmDeleteId(null)
      return
    }
    void deleteDevice(device.id)
      .then(() => {
        setConfirmDeleteId(null)
        if (registered?.id === device.id) setRegistered(null)
        refresh()
        pushToast('Device removed', `${device.name} and its readings were deleted.`)
      })
      .catch(() => pushToast('Delete failed', 'Could not reach the API — device kept.'))
  }

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">Device Management</h2>
      <p className="text-xs text-gray-500 mt-0.5">
        Register a board to this account or remove a device. Removal deletes its readings, events, baselines and captures.
      </p>

      {/* Register form */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <div className="rounded-xl border border-white/10 p-3 flex flex-col gap-2">
          <p className="text-[11px] font-bold text-gray-100">Hardware device ID</p>
          <input
            value={hardwareId}
            onChange={(e) => setHardwareId(e.target.value)}
            placeholder="e.g. PREVENTA-001"
            className="input-profile w-full"
          />
        </div>
        <div className="rounded-xl border border-white/10 p-3 flex flex-col gap-2">
          <p className="text-[11px] font-bold text-gray-100">Residence</p>
          <select
            value={residenceChoice}
            onChange={(e) => setResidenceChoice(e.target.value)}
            className="input-profile w-full"
          >
            <option value="">No residence selected</option>
            {residences.map((r) => (
              <option key={r.id} value={r.id}>{r.address || `Residence ${r.id}`}</option>
            ))}
            <option value="new">+ New residence…</option>
          </select>
        </div>
        <div className="rounded-xl border border-white/10 p-3 flex flex-col gap-2">
          <p className="text-[11px] font-bold text-gray-100">New residence address</p>
          <input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder={residenceChoice === 'new' ? 'Street, city' : 'Only used with “+ New residence…”'}
            disabled={residenceChoice !== 'new'}
            className="input-profile w-full disabled:opacity-40"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          onClick={submitRegister}
          disabled={!canRegister || registering}
          className="btn-primary btn-md min-w-32 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          REGISTER DEVICE
        </button>
        {!canRegister && <span className="text-xs text-gray-500">Enter a hardware ID{residenceChoice === 'new' ? ' and an address' : ''}.</span>}
      </div>

      {/* One-time api_key reveal */}
      {registered?.apiKey && (
        <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3">
          <p className="text-[11px] font-extrabold tracking-wide text-amber-300">SETUP KEY — SHOWN ONCE</p>
          <p className="text-xs text-gray-300 mt-1 leading-relaxed">
            Copy it now and enter it on the board&apos;s setup portal. It is never stored in client caches or logs.
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <code className="flex-1 min-w-0 truncate rounded-lg bg-black/30 px-3 py-2 text-xs font-mono text-gray-100">
              {revealed ? registered.apiKey : '•'.repeat(Math.min(24, Math.max(8, registered.apiKey.length)))}
            </code>
            <button type="button" onClick={() => setRevealed((r) => !r)} className="btn-outline btn-sm">
              {revealed ? 'HIDE' : 'REVEAL'}
            </button>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(registered.apiKey ?? '')}
              className="btn-ghost btn-sm"
            >
              COPY
            </button>
          </div>
        </div>
      )}

      {/* Registered devices with removal */}
      <div className="mt-4 flex flex-col gap-2">
        {devices.length === 0 ? (
          <p className="text-xs text-gray-500">No devices on this account yet.</p>
        ) : (
          devices.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
              <span
                className={'w-2.5 h-2.5 rounded-full shrink-0 ' + (d.status === 'online' ? 'bg-(--green-indicator)' : 'bg-gray-500')}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-100 truncate">{d.name}</p>
                <p className="text-[11px] text-gray-500 font-mono truncate">{d.hardwareId}</p>
              </div>
              {confirmDeleteId === d.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] font-bold text-gray-400 hidden sm:inline">Deletes all readings —</span>
                  <button onClick={() => removeDevice(d)} className="btn-ghost btn-sm text-(--red-indicator)">DELETE</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="btn-ghost btn-sm">CANCEL</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(d.id)}
                  aria-label={`Remove ${d.name}`}
                  className="btn-icon btn-sm text-(--red-indicator) shrink-0"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  )
}

type PushStatus = 'disabled' | 'enabled' | 'enabling' | 'disabling' | 'conflict'

function BrowserNotificationsSection() {
  const hydrated = useHydrated()
  const configured = isPushConfigured()
  const [status, setStatus] = useState<PushStatus>('disabled')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!hydrated) return
    const id = setTimeout(() => {
      setNotice(null)
      setStatus(getStoredPushToken() ? 'enabled' : 'disabled')
    }, 0)
    return () => clearTimeout(id)
  }, [hydrated])

  const handleEnable = () => {
    setStatus('enabling')
    setNotice(null)
    void enableBrowserPush().then((result) => {
      if (result.ok) {
        setStatus('enabled')
        setNotice('Enabled on this browser.')
      } else {
        setStatus(result.reason === 'conflict' ? 'conflict' : 'disabled')
        setNotice(result.message)
      }
    })
  }

  const handleDisable = () => {
    setStatus('disabling')
    setNotice(null)
    void disableBrowserPush().then((result) => {
      if (result.ok) {
        setStatus('disabled')
        setNotice('Browser notifications are turned off for this browser.')
      } else {
        setStatus('enabled')
        setNotice(result.message ?? 'Unsubscribe failed — please retry.')
      }
    })
  }

  const busy = status === 'enabling' || status === 'disabling'

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">Browser Notifications</h2>
      <p className="text-xs text-gray-500 mt-0.5">
        Push alerts target enrolled owner browsers. SMS receipt is handled separately by the board&apos;s cellular module.
      </p>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        {status === 'enabled' ? (
          <button type="button" onClick={handleDisable} disabled={busy} className="btn-outline btn-md min-w-32 disabled:opacity-40">
            {busy ? 'DISABLING…' : 'DISABLE BROWSER NOTIFICATIONS'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy || !configured}
            className="btn-primary btn-md min-w-32 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'ENABLING…' : 'ENABLE BROWSER NOTIFICATIONS'}
          </button>
        )}
        {hydrated && status === 'enabled' && !busy && (
          <span className="text-[11px] font-extrabold tracking-wide text-emerald-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> ENABLED ON THIS BROWSER
          </span>
        )}
      </div>

      {!configured && (
        <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
          Push integration is pending — the backend teammate still needs to send the Firebase Web config and VAPID key.
          Fire Event History stays usable in the meantime.
        </p>
      )}
      {notice && (
        <p
          className={
            'text-[11px] mt-3 leading-relaxed ' +
            (status === 'conflict' ? 'text-amber-300 font-semibold' : 'text-gray-400')
          }
        >
          {notice}
        </p>
      )}
    </section>
  )
}