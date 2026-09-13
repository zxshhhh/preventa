export type LogStatus = 'WARNING' | 'CRITICAL'

export interface LogEntry {
  timestamp: string
  status: LogStatus
  gas: number
  temperature: number
  humidity: number
  power: number
}

export interface MonthGroup {
  year: number
  key: string
  name: string
  logs: LogEntry[]
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const rawLogs: LogEntry[] = [
  { timestamp: '2026-07-03 09:47:22', status: 'WARNING',  gas: 118,  temperature: 31.2, humidity: 48,  power: 5.68 },
  { timestamp: '2026-07-09 12:18:55', status: 'CRITICAL', gas: 33,   temperature: 26.1, humidity: 44,  power: 9.41 },
  { timestamp: '2026-07-14 03:12:41', status: 'CRITICAL', gas: 186,  temperature: 29.4, humidity: 55,  power: 4.12 },
  { timestamp: '2026-07-21 18:05:37', status: 'WARNING',  gas: 42,   temperature: 27.8, humidity: 74,  power: 4.55 },
  { timestamp: '2026-07-27 15:33:09', status: 'WARNING',  gas: 21,   temperature: 52.3, humidity: 39,  power: 3.87 },
  { timestamp: '2026-08-05 07:21:19', status: 'WARNING',  gas: 106,  temperature: 24.9, humidity: 51,  power: 4.33 },
  { timestamp: '2026-08-18 22:44:02', status: 'CRITICAL', gas: 58,   temperature: 30.6, humidity: 79,  power: 6.02 },
  { timestamp: '2026-08-29 10:52:48', status: 'WARNING',  gas: 26,   temperature: 28.4, humidity: 47,  power: 8.34 },
  { timestamp: '2026-09-02 13:09:14', status: 'WARNING',  gas: 121,  temperature: 29.8, humidity: 50,  power: 4.61 },
  { timestamp: '2026-09-08 06:40:26', status: 'CRITICAL', gas: 34,   temperature: 56.8, humidity: 33,  power: 5.14 },
  { timestamp: '2026-09-11 17:25:53', status: 'WARNING',  gas: 132,  temperature: 25.6, humidity: 52,  power: 3.98 },
  { timestamp: '2026-09-13 08:14:36', status: 'WARNING',  gas: 109,  temperature: 26.3, humidity: 49,  power: 4.07 },
  { timestamp: '2026-09-13 12:47:36', status: 'WARNING',  gas: 109,  temperature: 26.3, humidity: 49,  power: 4.07 },
]

export function formatTime(fullTimestamp: string): string {
  const d = new Date(fullTimestamp)
  let h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return h + ':' + m + ' ' + ampm
}

export function formatFullDate(fullTimestamp: string): string {
  return new Date(fullTimestamp).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
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

export function groupByMonth(logs: LogEntry[]): MonthGroup[] {
  const years = Array.from(new Set(logs.map((l) => Number(l.timestamp.slice(0, 4))))).sort((a, b) => b - a)
  if (years.length === 0) return []
  const groups: MonthGroup[] = []
  for (const year of years) {
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