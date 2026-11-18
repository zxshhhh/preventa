export type LogStatus = 'WARNING' | 'CRITICAL'

export interface LogEntry {
  eventId?: number
  timestamp: string
  status: LogStatus
  gas: number
  temperature: number
  humidity: number
  power: number
  peakTier?: number
  peakFireType?: string
  eventStatus?: 'active' | 'resolved' | 'false_alarm'
  durationSeconds?: number
  endTime?: string
  deviceId?: number
}

export interface CaptureEntry {
  id: number
  timestamp: string
  imageUrl: string
  classification: string
  confidence: number | null
  deviceId: number
}

export interface ReadingEntry {
  id?: number | string
  timestamp: string
  values: Record<string, unknown>
}

export interface MonthGroup {
  year: number
  key: string
  name: string
  logs: LogEntry[]
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function formatTime(fullTimestamp: string): string {
  const d = new Date(fullTimestamp)

  if (Number.isNaN(d.getTime())) return 'Unknown time'

  let h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12

  return h + ':' + m + ' ' + ampm
}

export function formatFullDate(fullTimestamp: string): string {
  const d = new Date(fullTimestamp)

  if (Number.isNaN(d.getTime())) return 'Unknown date'

  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function statusClass(status: LogStatus): string {
  return status === 'CRITICAL'
    ? 'bg-(--red-indicator)/15 text-(--red-indicator)'
    : 'bg-amber-400/15 text-amber-400'
}

export function daySummary(entries: LogEntry[]): string {
  const warnings = entries.filter((e) => e.status === 'WARNING').length
  const criticals = entries.filter((e) => e.status === 'CRITICAL').length

  const parts: string[] = []

  if (warnings) parts.push(warnings + ' WARNING' + (warnings > 1 ? 'S' : ''))
  if (criticals) parts.push(criticals + ' CRITICAL' + (criticals > 1 ? 'S' : ''))

  return parts.join(' · ') || 'No events'
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

export function firstWeekday(year: number, monthIndex: number): number {
  return new Date(year, monthIndex, 1).getDay()
}

export function monthActivity(logs: LogEntry[]): Record<number, number> {
  const activity: Record<number, number> = {}

  for (const l of logs) {
    const day = Number(l.timestamp.slice(8, 10))
    activity[day] = (activity[day] || 0) + 1
  }

  return activity
}

/**
 * Builds the 12 month groups per year.
 * Pass years to keep the full month-card wall visible even when
 * the displayed logs are filtered down to nothing.
 */
export function groupByMonth(logs: LogEntry[], years?: number[]): MonthGroup[] {
  const yearList =
    years && years.length > 0
      ? [...years].sort((a, b) => b - a)
      : Array.from(
          new Set(logs.map((l) => Number(l.timestamp.slice(0, 4)))),
        ).sort((a, b) => b - a)

  if (yearList.length === 0) return []

  const groups: MonthGroup[] = []

  for (const year of yearList) {
    for (let m = 0; m < 12; m++) {
      const key = year + '-' + String(m + 1).padStart(2, '0')

      groups.push({
        year,
        key,
        name: MONTHS[m],
        logs: logs.filter((l) => l.timestamp.startsWith(key)),
      })
    }
  }

  return groups
}