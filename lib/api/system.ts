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
  id: number
  hardwareId: string
  name: string
  status: 'online' | 'offline'
  /** One-time setup key shown in a private view — never cached or logged. */
  apiKey: string | null
}

interface RawRegisteredDevice {
  id: number
  device_id: string
  name?: string
  status?: 'online' | 'offline'
  api_key?: string | null
}

/** POST /devices/register/ — hardware device_id + an owned residence_id (or an address for a new residence). */
export async function registerDevice(input: {
  deviceId: string
  residenceId?: number | null
  address?: string | null
}): Promise<RegisteredDevice> {
  const body: Record<string, unknown> = { device_id: input.deviceId.trim() }
  if (input.residenceId != null) body.residence_id = input.residenceId
  if (input.address) body.address = input.address.trim()

  const data = await apiPost<RawRegisteredDevice>(ENDPOINTS.deviceRegister, body)
  if (!data?.id || !data.device_id) throw new Error('Device registration failed — no device returned')

  return {
    id: data.id,
    hardwareId: data.device_id,
    name: data.name?.trim() || data.device_id,
    status: data.status ?? 'offline',
    apiKey: data.api_key ?? null,
  }
}

/** DELETE /devices/{pk}/delete/ — cascades readings, events, baselines and capture records. */
export async function deleteDevice(pk: number): Promise<void> {
  await apiDelete(ENDPOINTS.deviceDelete(pk))
}