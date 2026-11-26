import type { Metadata } from 'next'
import AuthShell from '@/features/auth/components/AuthShell'
import LoginForm from '@/features/auth/components/LoginForm'
import SystemStatus from '@/components/ui/SystemStatus'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the Preventa fire prevention dashboard.',
}

export default function LoginPage() {
  return (
    <AuthShell>
      <LoginForm />
      <div className="mt-4 flex justify-center">
        <SystemStatus />
      </div>
    </AuthShell>
  )
}
