import type { Metadata } from 'next'
import DashboardContent from '@/components/DashboardContent'

export const metadata: Metadata = {
  title: 'Activity',
  description: 'Live sensor readings and fire risk status.',
}

export default function DashboardPage() {
  return (
    <div className="relative">
      <DashboardContent />
    </div>
  )
}
