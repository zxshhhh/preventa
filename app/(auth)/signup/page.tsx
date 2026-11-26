import type { Metadata } from 'next'
import AuthShell from '@/features/auth/components/AuthShell'
import SignupForm from '@/features/auth/components/SignupForm'
import SystemStatus from '@/components/ui/SystemStatus'

export const metadata: Metadata = {
  title: 'Sign up',
  description: 'Create a Preventa account to monitor fire and sensor activity.',
}

export default function SignupPage() {
  return (
    <AuthShell>
      <SignupForm />
      <div className="mt-4 flex justify-center">
        <SystemStatus />
      </div>
    </AuthShell>
  )
}
