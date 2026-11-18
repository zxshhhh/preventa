import type { Metadata } from 'next'
import LogConsole from '@/components/LogConsole'

export const metadata: Metadata = {
  title: 'Logs',
  description: 'Fire event history, sensor readings and camera snapshots.',
}

export default function LogPage() {
  return <LogConsole />
}
