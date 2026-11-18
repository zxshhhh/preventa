import type { Metadata } from 'next'
import SettingsContent from '@/components/SettingsContent'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Appearance, accessibility, calibration and device management.',
}

export default function SettingsPage() {
  return (
    <div className="relative">
      <SettingsContent />
    </div>
  )
}
