import { apiGet } from './client'
import { ENDPOINTS } from './endpoints'

export type NotificationChannel = 'push' | 'sms' | 'unknown'
export type NotificationStatus = 'pending' | 'accepted' | 'delivered' | 'failed' | 'unknown'

export interface DeliveryActivity {
  id: string
  channel: NotificationChannel
  eventId: string | null
  status: NotificationStatus
  /** Readable label — 'accepted' renders as "Accepted by push provider." per the contract. */
  statusLabel: string
  contactId: number | null
  sentAt: string | null
  deliveredAt: string | null
}

interface RawNotification {
  id: number | string
  channel?: string
  event_id?: number | string
  event?: number | string
  status?: string
  contact_id?: number | null
  contact?: number | null
  sent_at?: string | null
  delivered_at?: string | null
  created_at?: string | null
  timestamp?: string | null
}

interface PaginatedNotifications {
  count: number
  next: string | null
  previous: string | null
  results: RawNotification[]
}

function normalizeChannel(raw: string | undefined): NotificationChannel {
  const value = raw?.toLowerCase().trim()
  if (!value) return 'unknown'
  if (value.includes('push')) return 'push'
  if (value.includes('sms')) return 'sms'
  return 'unknown'
}

const STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted by push provider',
  delivered: 'Delivered',
  failed: 'Failed',
  unknown: 'Unknown',
}

function normalizeStatus(raw: string | undefined): NotificationStatus {
  const value = raw?.toLowerCase().trim()
  if (!value) return 'unknown'
  if (value === 'sent' || value === 'accepted' || value === 'accepted_by_provider') return 'accepted'
  if (value === 'delivered' || value === 'received') return 'delivered'
  if (value === 'failed' || value === 'error') return 'failed'
  if (value === 'pending' || value === 'queued' || value === 'unsent') return 'pending'
  return 'unknown'
}

function firstString(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (v && typeof v === 'string') return v
  }
  return null
}

function normalizeActivity(raw: RawNotification): DeliveryActivity {
  const status = normalizeStatus(raw.status)
  return {
    id: String(raw.id),
    channel: normalizeChannel(raw.channel),
    eventId: raw.event_id != null ? String(raw.event_id) : raw.event != null ? String(raw.event) : null,
    status,
    statusLabel: STATUS_LABELS[status],
    contactId: raw.contact_id ?? raw.contact ?? null,
    sentAt: firstString(raw.sent_at, raw.created_at, raw.timestamp),
    deliveredAt: raw.delivered_at ?? null,
  }
}

/** GET /notifications/ — delivery activity for both channels (fields like contact_id can be absent or null). */
export async function fetchNotifications(limit = 50): Promise<DeliveryActivity[]> {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  const data = await apiGet<PaginatedNotifications>(`${ENDPOINTS.notifications}?${params.toString()}`)
  if (!data || !Array.isArray(data.results)) return []
  return data.results.map(normalizeActivity)
}
