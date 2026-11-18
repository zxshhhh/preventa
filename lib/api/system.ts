import { apiGet, apiPost, apiDelete } from './client'
import { ENDPOINTS } from './endpoints'

interface Device {
  id: number
  device_id: string
  name?: string
  status: 'online' | 'offline'
  last_heartbeat: string
}

interface PaginatedDevices {
  count: number
  next: string | null
  previous: string | null
  results: Device[]
}

/** Owner-facing device entry. `hardwareId` is the string device_id used by list filters. */
export interface OwnerDevice {
  id: number
  hardwareId: string
  name: string
  status: 'online' | 'offline'
  lastHeartbeat: string | null
  residenceId: number | null
}

export async function fetchDevices(): Promise<OwnerDevice[]> {
  const data = await apiGet<PaginatedDevices>(ENDPOINTS.devices)
  return (data?.results ?? []).map((d) => ({
    id: d.id,
    hardwareId: d.device_id,
    name: d.name?.trim() || d.device_id,
    status: d.status,
    lastHeartbeat: d.last_heartbeat ?? null,
    residenceId: (d as { residence_id?: number | null }).residence_id ?? null,
  }))
}

export async function fetchSystemStatus(): Promise<boolean> {
  const data = await apiGet<PaginatedDevices>(ENDPOINTS.devices)
  const results = data?.results ?? []
  return results.some((d) => d.status === 'online')
}

export interface RegisteredDevice {
  /** Primary key of the created device, or null when the response did not include one (resolve via `findDeviceByHardwareId`). */
  id: number | null
  hardwareId: string
  name: string
  status: 'online' | 'offline'
  /** One-time setup key shown in a private view — never cached or logged. */
  apiKey: string | null
}

/** Registration can be slower than a regular read (the backend provisions the board) — allow more time than the default. */
const REGISTER_TIMEOUT_MS = 45_000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function pick(record: Record<string, unknown> | null, keys: string[]): unknown {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function pickString(record: Record<string, unknown> | null, keys: string[]): string | null {
  const value = pick(record, keys)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function pickNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  const value = pick(record, keys)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * `POST /devices/register/` responses differ across backend revisions: the device may be returned bare,
 * nested under `device` / `data` / `result` (sometimes with the api_key alongside it), or as a single-item
 * list. Normalize whatever we get instead of rejecting a successful registration.
 */
function unwrapRegisteredDevice(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(Array.isArray(payload) ? payload[0] : payload)
  if (!record) return null

  for (const key of ['device', 'data', 'result', 'registered_device']) {
    const nested = asRecord(record[key])
    if (nested) return nested
  }

  return record
}

function readApiKey(
  device: Record<string, unknown> | null,
  outer: Record<string, unknown> | null,
): string | null {
  const keys = ['api_key', 'apiKey', 'setup_key', 'setupKey', 'device_api_key']
  const direct = pickString(device, keys) ?? pickString(outer, keys)
  if (direct) return direct

  for (const scope of [device, outer]) {
    const credentials = asRecord(pick(scope, ['credentials', 'secret', 'setup']))
    const nested = pickString(credentials, keys)
    if (nested) return nested
  }

  return null
}

/** Compare hardware ids the way the backend stores them — trimmed, case-insensitive. */
export function sameHardwareId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Resolve a device row by its hardware `device_id` (used to confirm a registration that came back without a usable body). */
export async function findDeviceByHardwareId(hardwareId: string): Promise<OwnerDevice | null> {
  const wanted = hardwareId.trim()
  if (!wanted) return null

  const list = await fetchDevices()
  return list.find((d) => sameHardwareId(d.hardwareId, wanted)) ?? null
}

/** POST /devices/register/ — hardware device_id + an owned residence_id (or an address for a new residence). */
export async function registerDevice(input: {
  deviceId: string
  residenceId?: number | null
  address?: string | null
}): Promise<RegisteredDevice> {
  const hardwareId = input.deviceId.trim()
  const body: Record<string, unknown> = { device_id: hardwareId }
  if (input.residenceId != null) body.residence_id = input.residenceId
  if (input.address) body.address = input.address.trim()

  const payload = await apiPost<unknown>(ENDPOINTS.deviceRegister, body, {
    timeout: REGISTER_TIMEOUT_MS,
  })

  const outer = asRecord(Array.isArray(payload) ? payload[0] : payload)
  const device = unwrapRegisteredDevice(payload)

  return {
    id:
      pickNumber(device, ['id', 'pk']) ??
      pickNumber(outer, ['id', 'pk']),
    hardwareId:
      pickString(device, ['device_id', 'hardware_id', 'deviceId', 'hardwareId']) ??
      hardwareId,
    name:
      pickString(device, ['name', 'label']) ??
      hardwareId,
    status: pickString(device, ['status']) === 'online' ? 'online' : 'offline',
    apiKey: readApiKey(device, outer),
  }
}

/** DELETE /devices/{pk}/delete/ — cascades readings, events, baselines and capture records. */
export async function deleteDevice(pk: number): Promise<void> {
  await apiDelete(ENDPOINTS.deviceDelete(pk))
}
