import type { Metadata } from 'next'
import ProfileContent from '@/components/ProfileContent'

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Account, emergency contacts and residences.',
}

export default function ProfilePage() {
  return (
    <div className="relative">
      <ProfileContent />
    </div>
  )
}
