'use client'

import { useDevices } from '@/context/useDevice'
import { useHydrated } from '@/lib/useHydrated'

interface Props {
  /** The Settings screens need a concrete board to read/write; Activity can show all boards. */
  allowAll?: boolean
  label?: string
  className?: string
}

/** Shared view selector for the hardware board whose data/settings are on screen. */
export default function CurrentDeviceSelector({
  allowAll = false,
  label = 'CURRENT HARDWARE DEVICE',
  className = '',
}: Props) {
  const hydrated = useHydrated()
  const { devices, selected, selection, isAllDevices, setSelectedId } = useDevices()

  if (!hydrated) {
    return (
      <div className={`flex flex-col gap-1.5 ${className}`} aria-hidden="true">
        <span className="text-xs font-bold tracking-wide text-gray-500">{label}</span>
        <div className="h-10 w-full max-w-80 rounded-lg border border-white/10 bg-white/5" />
      </div>
    )
  }

  if (!devices.length) {
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <span className="text-xs font-bold tracking-wide text-gray-500">{label}</span>
        <span role="status" className="text-xs font-semibold text-(--amber-indicator)">
          NO HARDWARE DEVICE DETECTED
        </span>
      </div>
    )
  }

  if (devices.length === 1) {
    const d = devices[0]
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <span className="text-xs font-bold tracking-wide text-gray-500">{label}</span>
        <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${d.status === 'online' ? 'bg-(--green-indicator)' : 'bg-gray-500'}`}
          />
          <span className="font-bold text-gray-200 truncate">{d.name || d.hardwareId}</span>
          <span className="text-gray-500 truncate">{d.hardwareId}</span>
        </div>
      </div>
    )
  }

  const value =
    !allowAll && (isAllDevices || selection === null)
      ? ''
      : selection === null
        ? 'all'
        : String(selection)

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor="current-hardware-device" className="text-xs font-bold tracking-wide text-gray-500">
        {label}
      </label>
      <select
        id="current-hardware-device"
        aria-label={label}
        className="input-profile w-full max-w-80 text-xs"
        value={value}
        onChange={(e) => setSelectedId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
      >
        {value === '' && (
          <option value="" disabled>
            Select a hardware device
          </option>
        )}
        {allowAll && <option value="all">All devices</option>}
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name || d.hardwareId} · {d.hardwareId}
          </option>
        ))}
      </select>
      {!isAllDevices && selected && (
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${selected.status === 'online' ? 'bg-(--green-indicator)' : 'bg-gray-500'}`}
          />
          {selected.status === 'online' ? 'ONLINE' : 'OFFLINE'}
        </span>
      )}
    </div>
  )
}
