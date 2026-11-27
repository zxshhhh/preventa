'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useHydrated } from '@/lib/useHydrated'
import { useOnline } from '@/lib/useOnline'
import { isApiConfigured } from '@/lib/api/config'
import { peekCache } from '@/lib/api/cache'
import {
  fetchDeviceSettings,
  saveDeviceSettings,
  type DeviceRemoteState,
  type DeviceSettingsSave,
  type DeviceSyncStatus,
} from '@/lib/api/settings'
import { SkeletonBar, SkeletonCircle } from '@/components/ui/Skeleton'
import { formatFullDate, formatTime } from '@/lib/logReport'
import {
  deleteDevice,
} from '@/lib/api/system'
import {
  enableBrowserPush,
  disableBrowserPush,
} from '@/lib/api/push'
import { usePushState } from '@/lib/api/usePushState'

import { useSensors } from '@/context/useSensors'
import { useDevices } from '@/context/useDevice'
import { useTheme, type Theme } from '@/context/useTheme'
import {
  useA11y,
  A11Y_DEFAULTS,
  type ContrastPreference,
  type MotionPreference,
  type TextScalePreference,
} from '@/context/useA11y'

interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

const THEMES: SegmentOption<Theme>[] = [
  {
    value: 'system',
    label: 'SYSTEM',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'DARK',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    ),
  },
  {
    value: 'light',
    label: 'LIGHT',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    ),
  },
]

const MOTION_OPTIONS: SegmentOption<MotionPreference>[] = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'reduced', label: 'REDUCED' },
  { value: 'full', label: 'FULL' },
]

const CONTRAST_OPTIONS: SegmentOption<ContrastPreference>[] = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'high', label: 'HIGH' },
  { value: 'standard', label: 'STANDARD' },
]

const TEXT_SCALE_OPTIONS: SegmentOption<TextScalePreference>[] = [
  { value: 'default', label: 'DEFAULT' },
  { value: 'large', label: 'LARGE' },
]

/**
 * Mutually exclusive setting rendered as native radios (arrow-key navigation
 * and a proper group name for screen readers) inside the existing pill style.
 */
function SegmentedField<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string
  name: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{legend}</legend>

      <div className="flex items-center gap-1 flex-wrap bg-white/5 border border-white/10 rounded-lg p-1 mt-2 w-fit">
        {options.map((option) => {
          const active = value === option.value

          return (
            <label
              key={option.value}
              className={
                'relative flex items-center gap-1.5 btn-segment has-focus-visible:ring-2 has-focus-visible:ring-(--focus-ring) ' +
                (active
                  ? 'btn-segment-active'
                  : 'text-gray-400 hover:text-gray-200')
              }
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.icon}
              {option.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default function SettingsContent() {
  const hydrated = useHydrated()
  const online = useOnline()
  const { pushToast } = useSensors()

  const [intervalInput, setIntervalInput] = useState<string>('')
  const [cameraEnabled, setCameraEnabled] = useState<boolean | null>(null)
  const [remoteBaseline, setRemoteBaseline] = useState<{
    interval: string
    camera: boolean | null
  }>({ interval: '', camera: null })
  const [sync, setSync] = useState<DeviceSyncStatus | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)

  useEffect(() => {
    if (!hydrated) return

    let cancelled = false

    const applyRemote = (remote: DeviceRemoteState) => {
      if (cancelled) return

      const interval =
        remote.sampleIntervalSec === null
          ? ''
          : String(remote.sampleIntervalSec)

      setIntervalInput(interval)
      setCameraEnabled(remote.cameraEnabled)
      setRemoteBaseline({
        interval,
        camera: remote.cameraEnabled,
      })
      setSync(remote.sync)
    }

    const id = setTimeout(() => {
      if (!isApiConfigured()) return

      // A cached hit resolves synchronously — seed it without a shimmer flash.
      const cached = peekCache<DeviceRemoteState>('device-settings')
      if (cached) applyRemote(cached)
      else setSettingsLoading(true)

      void fetchDeviceSettings()
        .then((remote) => {
          if (remote) applyRemote(remote)
        })
        .catch(() => {
          /* keep device settings at their initial values if the fetch fails */
        })
        .finally(() => {
          if (!cancelled) setSettingsLoading(false)
        })
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [hydrated])

  // While a save is pending, poll the device detail until the board syncs.
  // Polling only runs while the Settings screen is open.
  useEffect(() => {
    if (sync?.pending !== true || !isApiConfigured()) return

    const id = setInterval(() => {
      // Poll must observe the board's real sync state, not the cached snapshot.
      void fetchDeviceSettings({ fresh: true })
        .then((remote) => {
          if (remote) setSync(remote.sync)
        })
        .catch(() => {
          /* keep waiting; the next tick retries */
        })
    }, 10_000)

    return () => clearInterval(id)
  }, [sync?.pending])

  const deviceIntervalValid =
    intervalInput.trim() === '' ||
    (Number.isFinite(Number(intervalInput)) &&
      Number(intervalInput) >= 2 &&
      Number(intervalInput) <= 60)

  const deviceDirty =
    intervalInput !== remoteBaseline.interval ||
    cameraEnabled !== remoteBaseline.camera

  const saveDevice = () => {
    if (!online) {
      pushToast('Unavailable offline', 'Reconnect to send device settings.', 'WARNING')
      return
    }
    if (!isApiConfigured()) {
      setRemoteBaseline({
        interval: intervalInput,
        camera: cameraEnabled,
      })

      pushToast(
        'Device settings saved',
        'Reporting settings stored locally (API not configured).',
      )
      return
    }

    const raw = Number(intervalInput)
    const payload: DeviceSettingsSave = {}

    if (intervalInput !== remoteBaseline.interval) {
      payload.sampleIntervalSec =
        intervalInput.trim() === '' || !Number.isFinite(raw)
          ? null
          : raw
    }

    if (cameraEnabled !== remoteBaseline.camera) {
      payload.cameraEnabled = cameraEnabled
    }

    void saveDeviceSettings(payload)
      .then((remote) => {
        if (remote) {
          setSync(remote.sync)

          const interval =
            remote.sampleIntervalSec === null
              ? ''
              : String(remote.sampleIntervalSec)

          setIntervalInput(interval)
          setCameraEnabled(remote.cameraEnabled)
          setRemoteBaseline({
            interval,
            camera: remote.cameraEnabled,
          })
        }

        pushToast(
          'Device settings saved',
          'Sent to the device. Waiting for it to sync.',
        )
      })
      .catch(() =>
        pushToast(
          'Save failed',
          'Could not reach the API. Your device settings were kept.',
        ),
      )
  }

  const refreshSync = () => {
    if (!online || !isApiConfigured()) return

    void fetchDeviceSettings({ fresh: true })
      .then((remote) => {
        if (remote) setSync(remote.sync)
      })
      .catch(() =>
        pushToast('Refresh failed', 'Could not reach the API.'),
      )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold text-2xl text-gray-100">Settings</h1>
      </div>

      <AppearanceSection />

      <AccessibilitySection />

      <DeviceReportingSection
        intervalInput={intervalInput}
        cameraEnabled={cameraEnabled}
        dirty={deviceDirty}
        valid={deviceIntervalValid}
        sync={sync}
        offline={!online}
        loading={settingsLoading}
        onIntervalChange={setIntervalInput}
        onCameraChange={setCameraEnabled}
        onSave={saveDevice}
        onRefresh={refreshSync}
      />

      <DeviceManagementSection />

      <BrowserNotificationsSection />
    </div>
  )
}

function AppearanceSection() {
  const hydrated = useHydrated()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const active = hydrated ? theme : 'system'

  const detail = !hydrated
    ? 'Following your device setting.'
    : theme === 'system'
      ? `Following your device, currently ${resolvedTheme}.`
      : `Using the ${theme} theme on this device.`

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">
        Appearance
      </h2>

      <p className="text-xs text-gray-500 mt-0.5">
        System follows your device&apos;s light or dark setting and is the
        default. The choice is saved on this device. {detail}
      </p>

      <div className="mt-3">
        <SegmentedField
          legend="Theme"
          name="theme"
          value={active}
          options={THEMES}
          onChange={setTheme}
        />
      </div>
    </section>
  )
}

function AccessibilitySection() {
  const hydrated = useHydrated()
  const { settings, setSetting, reset } = useA11y()
  const active = hydrated ? settings : A11Y_DEFAULTS

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">
        Accessibility
      </h2>

      <p className="text-xs text-gray-500 mt-0.5">
        Preferences apply to this device and follow WCAG 2.1 AA guidance. The
        default values track your operating system. Browser zoom also remains
        available for larger text.
      </p>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-xs font-bold text-gray-100">Reduce motion</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            Stops the pulse, ping and shimmer animations. System respects your
            device&apos;s reduced motion setting.
          </p>
          <SegmentedField
            legend="Reduce motion"
            name="a11y-motion"
            value={active.motion}
            options={MOTION_OPTIONS}
            onChange={(value) => setSetting('motion', value)}
          />
        </div>

        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-xs font-bold text-gray-100">Contrast</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            High contrast strengthens text, borders, focus outlines and chart
            colours. System respects your device&apos;s contrast preference.
          </p>
          <SegmentedField
            legend="Contrast"
            name="a11y-contrast"
            value={active.contrast}
            options={CONTRAST_OPTIONS}
            onChange={(value) => setSetting('contrast', value)}
          />
        </div>

        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-xs font-bold text-gray-100">Text size</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            Scales text and spacing together. Use browser zoom for sizes beyond
            the options here.
          </p>
          <SegmentedField
            legend="Text size"
            name="a11y-text-scale"
            value={active.textScale}
            options={TEXT_SCALE_OPTIONS}
            onChange={(value) => setSetting('textScale', value)}
          />
        </div>

        <div className="rounded-xl border border-white/10 p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p id="a11y-focus-strong-label" className="text-xs font-bold text-gray-100">
              Enhanced focus outlines
            </p>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
              Adds thicker keyboard focus rings with stronger contrast across the app.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={active.focusStrong}
            aria-labelledby="a11y-focus-strong-label"
            onClick={() => setSetting('focusStrong', !active.focusStrong)}
            className={
              'relative w-11 h-6 rounded-full transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg-color) ' +
              (active.focusStrong
                ? 'bg-(--secondary-color)'
                : 'bg-white/15 border border-white/40')
            }
          >
            <span
              className={
                'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ' +
                (active.focusStrong ? 'translate-x-5' : 'translate-x-0')
              }
            />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={reset}
        disabled={!hydrated}
        className="btn-ghost btn-sm mt-4 disabled:opacity-40 disabled:pointer-events-none"
      >
        RESET ACCESSIBILITY SETTINGS
      </button>
    </section>
  )
}

function SyncBanner({
  sync,
  offline,
  loading,
  onRefresh,
}: {
  sync: DeviceSyncStatus | null
  offline: boolean
  loading: boolean
  onRefresh: () => void
}) {
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
      >
        <span className="sr-only">Loading device settings…</span>

        <div className="flex items-center gap-2 min-w-0">
          <SkeletonCircle className="w-2 h-2" />
          <SkeletonBar className="h-3 w-48 max-w-[60vw]" />
        </div>

        <SkeletonBar className="h-7 w-28 rounded-lg" />
      </div>
    )
  }

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
    <div
      role="status"
      aria-live="polite"
      className={
        'flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 ' +
        style
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={
            'w-2 h-2 rounded-full shrink-0 ' +
            (pending === true
              ? 'bg-amber-400 animate-pulse'
              : pending === false
                ? 'bg-emerald-400'
                : 'bg-gray-500')
          }
        />

        <span className="text-xs font-extrabold tracking-wide">
          {label}
        </span>

        {at && (
          <span className="text-xs font-semibold text-gray-400 truncate">
            {formatFullDate(at)} · {formatTime(at)}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onRefresh}
        disabled={offline}
        title={offline ? 'Reconnect to refresh device status' : undefined}
        className="btn-ghost btn-sm shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      >
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
  offline,
  loading,
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
  offline: boolean
  loading: boolean
  onIntervalChange: (value: string) => void
  onCameraChange: (value: boolean) => void
  onSave: () => void
  onRefresh: () => void
}) {
  const cameraOn = cameraEnabled === true

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">
        Device Reporting &amp; Camera
      </h2>

      <p className="text-xs text-gray-500 mt-0.5">
        Reporting settings sync from the cloud to the board. Device application
        does not confirm SMS receipt.
      </p>

      <div className="mt-4">
        <SyncBanner
          sync={sync}
          offline={offline}
          loading={loading}
          onRefresh={onRefresh}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {loading ? (
          <div className="rounded-xl border border-white/10 p-3 flex flex-col gap-2">
            <SkeletonBar className="h-3 w-36" />
            <SkeletonBar className="h-10 w-full rounded-lg" />
            <SkeletonBar className="h-3 w-11/12" />
            <SkeletonBar className="h-3 w-3/5" />
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 p-3 flex flex-col gap-2">
            <p className="text-xs font-bold text-gray-100">
              Cloud reporting interval
            </p>

            <label className="flex items-center gap-2 text-xs font-bold text-gray-400">
              <span className="shrink-0">SECONDS</span>

              <input
                type="number"
                min={2}
                max={60}
                step={1}
                placeholder="firmware default"
                value={intervalInput}
                onChange={(e) => onIntervalChange(e.target.value)}
                readOnly={offline}
                aria-label="Cloud reporting interval in seconds"
                aria-invalid={!valid}
                aria-describedby="reporting-interval-help"
                className="input-profile w-full flex-1"
              />
            </label>

            {valid ? (
              <p id="reporting-interval-help" className="text-xs text-gray-500 leading-relaxed">
                2 to 60 whole seconds. This controls routine cloud uploads only.
                Local sampling stays on its normal two second schedule. Leave
                this empty to use the firmware default.
              </p>
            ) : (
              <p id="reporting-interval-help" role="alert" className="text-xs font-bold text-red-400">
                Enter a whole number between 2 and 60, or leave empty
              </p>
            )}
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-white/10 p-3 flex items-center justify-between gap-3">
            <div className="flex-1 flex flex-col gap-2">
              <SkeletonBar className="h-3 w-28" />
              <SkeletonBar className="h-3 w-4/5" />
            </div>

            <SkeletonBar className="h-6 w-11 rounded-full" />
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-gray-100">
                Camera enabled
              </p>

              <p className="text-xs text-gray-500 leading-relaxed mt-1">
                Turns the ESP32-CAM snapshot capture on or off on the board.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={cameraOn}
              aria-label="Camera enabled"
              onClick={() => onCameraChange(!cameraOn)}
              disabled={offline}
              className={
                'relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg-color) ' +
                (cameraOn
                  ? 'bg-(--secondary-color)'
                  : 'bg-white/15 border border-white/40')
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
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          type="button"
          onClick={onSave}
          disabled={loading || !valid || !dirty || offline}
          title={
            offline
              ? 'Reconnect to make changes'
              : loading
                ? 'Waiting for device settings'
                : undefined
          }
          className="btn-primary btn-md min-w-32 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          SAVE DEVICE SETTINGS
        </button>

        {offline ? (
          <span className="text-xs font-semibold text-(--amber-indicator)">
            Offline. Settings cannot be changed until you reconnect.
          </span>
        ) : dirty ? (
          <span className="text-xs font-semibold text-amber-400">
            Unsaved changes
          </span>
        ) : null}
      </div>
    </section>
  )
}

function DeviceManagementSection() {
  const { devices, refresh, loading: devicesLoading } = useDevices()
  const online = useOnline()
  const { pushToast } = useSensors()
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const ownerSetupUrl = 'https://preventa.duckdns.org/setup/'

  const removeDevice = (device: { id: number; name: string }) => {
    if (!online || !isApiConfigured()) { setConfirmDeleteId(null); return }
    void deleteDevice(device.id).then(() => {
      setConfirmDeleteId(null)
      refresh()
      pushToast('Device removed', `${device.name} and its readings were deleted.`)
    }).catch(() => pushToast('Delete failed', 'Could not reach the API — device kept.', 'CRITICAL'))
  }

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">Device Management</h2>
      <p className="text-xs text-gray-500 mt-0.5">Activate a physical device using its QR card and pairing code. Set its room so alerts identify where the risk was detected.</p>
      <div className="mt-4 rounded-xl border border-white/10 p-4">
        <a href={ownerSetupUrl} target="_blank" rel="noopener noreferrer" className="btn-primary btn-md inline-flex">ACTIVATE DEVICE / EDIT LOCATION</a>
        <p className="text-xs text-gray-400 mt-3">Sign in on the secure setup page with the same PREVENTA username and password. Return here and refresh after activation. Device API keys stay on the hardware.</p>
        <button type="button" onClick={() => refresh()} className="btn-outline btn-sm mt-3">REFRESH DEVICES</button>
      </div>
      <p className="text-xs text-gray-500 mt-4">Removing a device deletes its readings, events, baselines and captures.</p>
      {/* Registered devices with removal */}
      <div className="mt-4 flex flex-col gap-2">
        {devicesLoading && devices.length === 0 ? (
          <>
            <span role="status" className="sr-only">
              Loading devices…
            </span>

            {['row-1', 'row-2', 'row-3'].map((row) => (
              <div
                key={row}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/5"
              >
                <SkeletonCircle className="w-2.5 h-2.5" />

                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <SkeletonBar className="h-3.5 w-32" />
                  <SkeletonBar className="h-3 w-24" />
                </div>

                <SkeletonBar className="h-7 w-7 rounded-lg" />
              </div>
            ))}
          </>
        ) : devices.length === 0 ? (
          <p className="text-xs text-gray-500">
            No devices on this account yet.
          </p>
        ) : (
          devices.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-white/5"
            >
              <span
                className={
                  'w-2.5 h-2.5 rounded-full shrink-0 ' +
                  (d.status === 'online'
                    ? 'bg-(--green-indicator)'
                    : 'bg-gray-500')
                }
              />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-100 truncate">
                  {d.name}
                </p>

                <p className="text-xs text-gray-500 tnum truncate">
                  {d.hardwareId}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {d.location || 'Location not set'}{d.activationState === 'pending' ? ' · Waiting for activation' : ''}
                </p>
              </div>

              {confirmDeleteId === d.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs font-bold text-gray-400 hidden sm:inline">
                    Deletes all readings.
                  </span>

                  <button
                    onClick={() => removeDevice(d)}
                    disabled={!online}
                    className="btn-ghost btn-sm text-(--red-indicator) disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    DELETE
                  </button>

                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="btn-ghost btn-sm"
                  >
                    CANCEL
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(d.id)}
                  disabled={!online}
                  aria-label={`Remove ${d.name}`}
                  title={online ? undefined : 'Reconnect to remove a device'}
                  className="btn-icon btn-sm text-(--red-indicator) shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
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

type PushStatus =
  | 'disabled'
  | 'enabled'
  | 'enabling'
  | 'disabling'
  | 'conflict'
  | 'blocked'
  | 'install'

function BrowserNotificationsSection() {
  const online = useOnline()
  const { ready, capability } = usePushState()
  const [busyState, setBusyState] = useState<'enabling' | 'disabling' | null>(null)
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const configured = capability.configured
  const permission = capability.permission
  const needsInstall = capability.needsHomeScreenInstall
  const baseStatus: PushStatus = capability.enabled
    ? 'enabled'
    : conflict
      ? 'conflict'
      : permission === 'denied'
        ? 'blocked'
        : needsInstall
          ? 'install'
          : 'disabled'
  const status: PushStatus = busyState ?? baseStatus

  const handleEnable = () => {
    if (!online) return
    setBusyState('enabling')
    setConflict(false)
    setNotice(null)

    void enableBrowserPush().then((result) => {
      setBusyState(null)
      if (result.ok) {
        setNotice('Enabled on this device.')
      } else {
        setConflict(result.reason === 'conflict')
        setNotice(result.message)
      }
    })
  }

  const handleDisable = () => {
    if (!online) return
    setBusyState('disabling')
    setConflict(false)
    setNotice(null)

    void disableBrowserPush().then((result) => {
      setBusyState(null)
      if (result.ok) setNotice('Browser notifications are turned off for this device.')
      else setNotice(result.message ?? 'Unsubscribe failed. Please try again.')
    })
  }

  const busy = busyState !== null
  const canEnable = ready && configured && online && status !== 'enabled' && status !== 'blocked' && status !== 'install'

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">
        Browser Notifications
      </h2>

      <p className="text-xs text-gray-500 mt-0.5">
        Push alerts target enrolled owner browsers. SMS receipt is handled
        separately by the board&apos;s cellular module.
      </p>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        {status === 'enabled' ? (
          <button
            type="button"
            onClick={handleDisable}
            disabled={busy || !online}
            title={online ? undefined : 'Reconnect to change push settings'}
            className="btn-outline btn-md min-w-32 disabled:opacity-40"
          >
            {busy ? 'DISABLING…' : 'DISABLE BROWSER NOTIFICATIONS'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleEnable}
            disabled={!canEnable || busy}
            title={online ? undefined : 'Reconnect to change push settings'}
            className="btn-primary btn-md min-w-32 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'ENABLING…' : 'ENABLE BROWSER NOTIFICATIONS'}
          </button>
        )}

        {ready && status === 'enabled' && !busy && (
          <span className="text-xs font-extrabold tracking-wide text-emerald-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            ENABLED ON THIS DEVICE
          </span>
        )}
        {ready && status === 'blocked' && (
          <span className="text-xs font-extrabold tracking-wide text-(--amber-indicator) flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-(--amber-indicator)" />
            BLOCKED IN BROWSER
          </span>
        )}
      </div>

      {ready && needsInstall && configured && (
        <p className="text-xs text-gray-400 mt-3 leading-relaxed">
          On iPhone or iPad, tap <span className="text-gray-200">Share → Add to Home Screen</span>, open Preventa from
          your Home Screen, then enable notifications there. Safari tabs can&apos;t receive push alerts.
        </p>
      )}

      {ready && permission === 'denied' && (
        <p className="text-xs text-gray-400 mt-3 leading-relaxed">
          Notifications are blocked for this site. Open your browser&apos;s site settings, allow notifications for
          Preventa, then return here to enroll this device.
        </p>
      )}

      {ready && !configured && (
        <p className="text-xs text-gray-500 mt-3 leading-relaxed">
          Push notifications are not ready yet. The backend team still needs to
          send the Firebase web config and VAPID key. Fire Event History remains
          available.
        </p>
      )}

      {notice && (
        <p
          className={
            'text-xs mt-3 leading-relaxed ' +
            (status === 'conflict'
              ? 'text-amber-300 font-semibold'
              : 'text-gray-400')
          }
        >
          {notice}
        </p>
      )}
    </section>
  )
}
