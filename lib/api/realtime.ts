import type { SeriesPoint } from '@/lib/dashboardData'
import { formatRangeLabel } from '@/lib/dashboardData'
import { getWebSocketUrl } from './config'

export interface LiveReadingPayload {
  id: number
  device: number
  timestamp: string
  smooth_ppm: number
  smooth_temperature: number
  smooth_humidity: number
  smooth_current: number
  fusion_score: number
  final_tier: number
  tier_name: string
  fire_type: string
  relay_cut: boolean
  siren: boolean
  cam_active: boolean
  cam_confidence: number | null
}

export interface FusionData {
  fusionScore: number
  finalTier: number
  tierName: string
  fireType: string
  relayCut: boolean
  siren: boolean
  camActive: boolean
  camConfidence: number | null
}

export interface SensorPoint {
  mq7: SeriesPoint
  dht22: SeriesPoint
  acs712: SeriesPoint
  humidity: SeriesPoint
}

function toPoint(iso: string, value: number): SeriesPoint {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return { label: '', value }
  return { t, value, label: formatRangeLabel(t, '1H')}
}

function mapPayload(payload: LiveReadingPayload): SensorPoint {
  return {
    mq7: toPoint(payload.timestamp, payload.smooth_ppm),
    dht22: toPoint(payload.timestamp, payload.smooth_temperature),
    acs712: toPoint(payload.timestamp, payload.smooth_current),
    humidity: toPoint(payload.timestamp, payload.smooth_humidity),
  }
}

export function connectLiveTelemetry(
  token: string,
  onReading: (points: SensorPoint, fusion: FusionData) => void,
  onClose?: (code: number) => void,
  onOpen?: () => void
): WebSocket {
  const url = `${getWebSocketUrl()}?token=${encodeURIComponent(token)}`
  const ws = new WebSocket(url)

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'new_reading' && msg.payload) {
        const p = msg.payload as LiveReadingPayload
        const points = mapPayload(p)
        const fusion: FusionData = {
          fusionScore: p.fusion_score,
          finalTier: p.final_tier,
          tierName: p.tier_name,
          fireType: p.fire_type,
          relayCut: p.relay_cut,
          siren: p.siren,
          camActive: p.cam_active,
          camConfidence: p.cam_confidence,
        }
        onReading(points, fusion)
      }
    } catch {
      /* ignore malformed messages */
    }
  }

  ws.onopen = () => {
    onOpen?.()
  }

  ws.onclose = (e) => {
    onClose?.(e.code)
  }

  ws.onerror = () => {
    /* error events fire before onclose with the code */
  }

  return ws
}