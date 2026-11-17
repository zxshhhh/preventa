'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useHydrated } from '@/lib/useHydrated'
import { isApiConfigured } from '@/lib/api/config'
import {
  fetchDeviceSettings,
  saveDeviceSettings,
  type DeviceSettingsSave,
  type DeviceSyncStatus,
} from '@/lib/api/settings'
import { formatFullDate, formatTime } from '@/lib/logReport'
import { fetchResidences, type ResidenceEntry } from '@/lib/api/profile'
import { registerDevice, deleteDevice, type RegisteredDevice } from '@/lib/api/system'
import {
  enableBrowserPush,
  disableBrowserPush,
  isPushConfigured,
  getStoredPushToken,
} from '@/lib/api/push'

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

  const [intervalInput, setIntervalInput] = useState<string>('')
  const [cameraEnabled, setCameraEnabled] = useState<boolean | null>(null)
  const [remoteBaseline, setRemoteBaseline] = useState<{
    interval: string
    camera: boolean | null
  }>({ interval: '', camera: null })
  const [sync, setSync] = useState<DeviceSyncStatus | null>(null)

  useEffect(() => {
    if (!hydrated) return

    let cancelled = false

    const id = setTimeout(() => {
      if (isApiConfigured()) {
        void fetchDeviceSettings()
          .then((remote) => {
            if (cancelled || !remote) return

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
          })
          .catch(() => {
            /* keep device settings at their initial values if the fetch fails */
          })
      }
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

  const deviceIntervalValid =
    intervalInput.trim() === '' ||
    (Number.isFinite(Number(intervalInput)) &&
      Number(intervalInput) >= 2 &&
      Number(intervalInput) <= 60)

  const deviceDirty =
    intervalInput !== remoteBaseline.interval ||
    cameraEnabled !== remoteBaseline.camera

  const saveDevice = () => {
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
          'Sent to the device — waiting for it to sync.',
        )
      })
      .catch(() =>
        pushToast(
          'Save failed',
          'Could not reach the API — device settings kept.',
        ),
      )
  }

  const refreshSync = () => {
    if (!isApiConfigured()) return

    void fetchDeviceSettings()
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
    </div>
  )
}

function AppearanceSection() {
  const hydrated = useHydrated()
  const { theme, setTheme } = useTheme()
  const active = hydrated ? theme : 'dark'

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">
        Appearance
      </h2>

      <p className="text-xs text-gray-500 mt-0.5">
        Choose between the dark radar theme and a lighter theme. The choice is
        saved on this device.
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
              (active === value
                ? 'btn-segment-active'
                : 'text-gray-400 hover:text-gray-200')
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

function SyncBanner({
  sync,
  onRefresh,
}: {
  sync: DeviceSyncStatus | null
  onRefresh: () => void
}) {
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

        <span className="text-[11px] font-extrabold tracking-wide">
          {label}
        </span>

        {at && (
          <span className="text-[11px] font-semibold text-gray-400 truncate">
            {formatFullDate(at)} · {formatTime(at)}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onRefresh}
        className="btn-ghost btn-sm shrink-0"
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
      <h2 className="font-bold text-base text-gray-100 tracking-wide">
        Device Reporting &amp; Camera
      </h2>

      <p className="text-xs text-gray-500 mt-0.5">
        Reporting settings sync from the cloud to the board. Device application
        does not confirm SMS receipt.
      </p>

      <div className="mt-4">
        <SyncBanner sync={sync} onRefresh={onRefresh} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div className="rounded-xl border border-white/10 p-3 flex flex-col gap-2">
          <p className="text-[11px] font-bold text-gray-100">
            Cloud reporting interval
          </p>

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
              2–60 whole seconds. Controls routine cloud uploads only — local
              acquisition stays on its nominal two-second schedule. Leave
              empty to restore the firmware default.
            </p>
          ) : (
            <p className="text-[10px] font-bold text-red-400">
              Enter a whole number between 2 and 60, or leave empty
            </p>
          )}
        </div>

        <div className="rounded-xl border border-white/10 p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold text-gray-100">
              Camera enabled
            </p>

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
              (cameraOn
                ? 'bg-(--secondary-color)'
                : 'bg-white/10 border border-white/10')
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

        {dirty && (
          <span className="text-xs font-semibold text-amber-400">
            Unsaved changes
          </span>
        )}
      </div>
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

  const canRegister =
    hardwareId.trim().length > 0 &&
    (residenceChoice !== 'new' || newAddress.trim().length > 0)

  const submitRegister = () => {
    if (!isApiConfigured() || !canRegister) return

    setRegistering(true)
    setRegistered(null)
    setRevealed(false)

    void registerDevice({
      deviceId: hardwareId,
      residenceId:
        residenceChoice !== '' && residenceChoice !== 'new'
          ? Number(residenceChoice)
          : null,
      address: residenceChoice === 'new' ? newAddress : null,
    })
      .then((device) => {
        setRegistered(device)
        setHardwareId('')
        setNewAddress('')
        refresh()

        pushToast(
          'Device registered',
          `${device.name} was added. Copy the setup key now — it is shown once.`,
        )
      })
      .catch((error: unknown) => {
        console.error('Device registration failed:', error)

        const message =
          error instanceof Error
            ? error.message
            : String(error)

        if (message.includes('device with this device id already exists')) {
          pushToast(
            'Device already registered',
            'This hardware ID is already associated with a registered device. Check Device Management or remove the existing registration first.',
          )
          return
        }

        pushToast('Registration failed', message)
      })
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

        if (registered?.id === device.id) {
          setRegistered(null)
        }

        refresh()
        pushToast(
          'Device removed',
          `${device.name} and its readings were deleted.`,
        )
      })
      .catch(() =>
        pushToast(
          'Delete failed',
          'Could not reach the API — device kept.',
        ),
      )
  }

  return (
    <section className="panel-card p-5">
      <h2 className="font-bold text-base text-gray-100 tracking-wide">
        Device Management
      </h2>

      <p className="text-xs text-gray-500 mt-0.5">
        Register a board to this account or remove a device. Removal deletes its
        readings, events, baselines and captures.
      </p>

      {/* Register form */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <div className="rounded-xl border border-white/10 p-3 flex flex-col gap-2">
          <p className="text-[11px] font-bold text-gray-100">
            Hardware device ID
          </p>

          <input
            value={hardwareId}
            onChange={(e) => setHardwareId(e.target.value)}
            placeholder="e.g. PREVENTA-001"
            className="input-profile w-full"
          />
        </div>

        <div className="rounded-xl border border-white/10 p-3 flex flex-col gap-2">
          <p className="text-[11px] font-bold text-gray-100">
            Residence
          </p>

          <select
            value={residenceChoice}
            onChange={(e) => setResidenceChoice(e.target.value)}
            className="input-profile w-full"
          >
            <option value="">No residence selected</option>

            {residences.map((r) => (
              <option key={r.id} value={r.id}>
                {r.address || `Residence ${r.id}`}
              </option>
            ))}

            <option value="new">+ New residence…</option>
          </select>
        </div>

        <div className="rounded-xl border border-white/10 p-3 flex flex-col gap-2">
          <p className="text-[11px] font-bold text-gray-100">
            New residence address
          </p>

          <input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder={
              residenceChoice === 'new'
                ? 'Street, city'
                : 'Only used with “+ New residence…”'
            }
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

        {!canRegister && (
          <span className="text-xs text-gray-500">
            Enter a hardware ID
            {residenceChoice === 'new' ? ' and an address' : ''}.
          </span>
        )}
      </div>

      {/* One-time api_key reveal */}
      {registered?.apiKey && (
        <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3">
          <p className="text-[11px] font-extrabold tracking-wide text-amber-300">
            SETUP KEY — SHOWN ONCE
          </p>

          <p className="text-xs text-gray-300 mt-1 leading-relaxed">
            Copy it now and enter it on the board&apos;s setup portal. It is
            never stored in client caches or logs.
          </p>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <code className="flex-1 min-w-0 truncate rounded-lg bg-black/30 px-3 py-2 text-xs tnum text-gray-100">
              {revealed
                ? registered.apiKey
                : '•'.repeat(
                    Math.min(24, Math.max(8, registered.apiKey.length)),
                  )}
            </code>

            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="btn-outline btn-sm"
            >
              {revealed ? 'HIDE' : 'REVEAL'}
            </button>

            <button
              type="button"
              onClick={() =>
                void navigator.clipboard?.writeText(registered.apiKey ?? '')
              }
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

                <p className="text-[11px] text-gray-500 tnum truncate">
                  {d.hardwareId}
                </p>
              </div>

              {confirmDeleteId === d.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] font-bold text-gray-400 hidden sm:inline">
                    Deletes all readings —
                  </span>

                  <button
                    onClick={() => removeDevice(d)}
                    className="btn-ghost btn-sm text-(--red-indicator)"
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

type PushStatus =
  | 'disabled'
  | 'enabled'
  | 'enabling'
  | 'disabling'
  | 'conflict'

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
            disabled={busy}
            className="btn-outline btn-md min-w-32 disabled:opacity-40"
          >
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
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            ENABLED ON THIS BROWSER
          </span>
        )}
      </div>

      {!configured && (
        <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
          Push integration is pending — the backend teammate still needs to
          send the Firebase Web config and VAPID key. Fire Event History stays
          usable in the meantime.
        </p>
      )}

      {notice && (
        <p
          className={
            'text-[11px] mt-3 leading-relaxed ' +
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
