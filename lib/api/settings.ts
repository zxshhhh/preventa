import { SENSORS, HUMIDITY_CONFIG } from '@/lib/dashboardData'
import { apiGet, apiPatch } from './client'
import { CACHE_TAGS, CACHE_TTL, cachedFetch, invalidateTags } from './cache'
import { ENDPOINTS } from './endpoints'

export type CalibrationMetric = 'temperature' | 'humidity' | 'gas' | 'power'

export interface Thresholds {
  nominal: number
  warning: number
}

export type CalibrationSettings = Record<CalibrationMetric, Thresholds>

export const DEFAULT_CALIBRATION: CalibrationSettings = {
  temperature: { nominal: SENSORS.dht22.thresholdNominal, warning: SENSORS.dht22.thresholdWarning },
  humidity: { nominal: HUMIDITY_CONFIG.thresholdNominal, warning: HUMIDITY_CONFIG.thresholdWarning },
  gas: { nominal: SENSORS.mq7.thresholdNominal, warning: SENSORS.mq7.thresholdWarning },
  power: { nominal: SENSORS.acs712.thresholdNominal, warning: SENSORS.acs712.thresholdWarning },
}

const DEVICE_ID_KEY = 'preventa.deviceId'

/** Numeric threshold fields may be null — the device reports its firmware default. */
export interface DeviceConfig {
  id: number
  ppm_threshold: number | null
  temperature_threshold: number | null
  humidity_threshold: number | null
  current_threshold: number | null
  sample_interval_sec: number | null
  camera_enabled: boolean | null
  config_pending: boolean | null
  config_applied_at: string | null
}

interface PaginatedDevices {
  count: number
  next: string | null
  previous: string | null
  results: DeviceConfig[]
}

/** null pending = the sync fields are absent from the response → "Sync status unavailable." */
export interface DeviceSyncStatus {
  deviceId: number | null
  pending: boolean | null
  appliedAt: string | null
}

export interface DeviceRemoteState {
  deviceId: number
  calibration: CalibrationSettings
  sampleIntervalSec: number | null
  cameraEnabled: boolean | null
  sync: DeviceSyncStatus
}

/** Only the fields the caller wants changed — sent to PATCH /devices/{id}/update/. */
export interface DeviceSettingsSave {
  calibration?: CalibrationSettings
  /** null restores the firmware default reporting interval */
  sampleIntervalSec?: number | null
  cameraEnabled?: boolean | null
}

async function getCachedDeviceId(): Promise<number | null> {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(DEVICE_ID_KEY)
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

async function setCachedDeviceId(id: number): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(DEVICE_ID_KEY, String(id))
  } catch {
    /* ignore */
  }
}

/**
 * Resolves a device by its numeric id. Callers pass the shared current-device
 * selection; the cached id / first device remain a fallback for legacy callers.
 */
export async function fetchDeviceDetail(deviceId?: number | null): Promise<DeviceConfig | null> {
  if (typeof deviceId === 'number') {
    try {
      return await apiGet<DeviceConfig>(ENDPOINTS.updateDevice(deviceId).replace('/update/', ''))
    } catch {
      return null
    }
  }
  const cached = await getCachedDeviceId()
  if (cached) {
    try {
      const data = await apiGet<DeviceConfig>(ENDPOINTS.updateDevice(cached).replace('/update/', ''))
      if (data) return data
    } catch {
      /* fall through to list */
    }
  }
  const list = await apiGet<PaginatedDevices>(ENDPOINTS.devices)
  const first = list?.results?.[0]
  if (first) await setCachedDeviceId(first.id)
  return first ?? null
}

/** Null threshold values on the device fall back to the app's firmware defaults. */
function toCalibration(device: DeviceConfig): CalibrationSettings {
  return {
    temperature: { nominal: DEFAULT_CALIBRATION.temperature.nominal, warning: device.temperature_threshold ?? DEFAULT_CALIBRATION.temperature.warning },
    humidity: { nominal: DEFAULT_CALIBRATION.humidity.nominal, warning: device.humidity_threshold ?? DEFAULT_CALIBRATION.humidity.warning },
    gas: { nominal: DEFAULT_CALIBRATION.gas.nominal, warning: device.ppm_threshold ?? DEFAULT_CALIBRATION.gas.warning },
    power: { nominal: DEFAULT_CALIBRATION.power.nominal, warning: device.current_threshold ?? DEFAULT_CALIBRATION.power.warning },
  }
}

function toRemoteState(device: DeviceConfig): DeviceRemoteState {
  return {
    deviceId: device.id,
    calibration: toCalibration(device),
    sampleIntervalSec: device.sample_interval_sec ?? null,
    cameraEnabled: device.camera_enabled ?? null,
    sync: {
      deviceId: device.id,
      pending: device.config_pending ?? null,
      appliedAt: device.config_applied_at ?? null,
    },
  }
}

/** `fresh: true` bypasses the cache for device-sync polling and manual refresh. */
export function fetchDeviceSettings(options?: { fresh?: boolean; deviceId?: number | null }): Promise<DeviceRemoteState | null> {
  return cachedFetch(
    `device-settings:${options?.deviceId ?? 'default'}`,
    async () => {
      const device = await fetchDeviceDetail(options?.deviceId)
      return device ? toRemoteState(device) : null
    },
    {
      ...CACHE_TTL.settings,
      persist: true,
      tags: [CACHE_TAGS.settings],
      fresh: options?.fresh,
    },
  )
}

export async function saveDeviceSettings(
  save: DeviceSettingsSave,
  deviceId?: number | null,
): Promise<DeviceRemoteState | null> {
  const device = await fetchDeviceDetail(deviceId)
  if (!device) return null
  if (typeof deviceId === 'number') await setCachedDeviceId(device.id)

  const body: Record<string, unknown> = {}
  if (save.calibration) {
    body.ppm_threshold = save.calibration.gas.warning
    body.temperature_threshold = save.calibration.temperature.warning
    body.humidity_threshold = save.calibration.humidity.warning
    body.current_threshold = save.calibration.power.warning
  }
  if (save.sampleIntervalSec !== undefined) {
    const sec = save.sampleIntervalSec
    body.sample_interval_sec = sec === null ? null : Math.min(60, Math.max(2, Math.round(sec)))
  }
  if (save.cameraEnabled !== undefined) {
    body.camera_enabled = save.cameraEnabled
  }

  const data = await apiPatch<DeviceConfig>(ENDPOINTS.updateDevice(device.id), body)
  invalidateTags([CACHE_TAGS.settings])
  return data ? toRemoteState(data) : null
}

export async function fetchCalibration(): Promise<CalibrationSettings | null> {
  const remote = await fetchDeviceSettings()
  return remote?.calibration ?? null
}

export async function saveCalibration(settings: CalibrationSettings): Promise<CalibrationSettings | null> {
  const remote = await saveDeviceSettings({ calibration: settings })
  return remote?.calibration ?? null
}
