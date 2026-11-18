import AuthGuard from '@/components/AuthGuard'
import Sidebar from '@/components/ui/Sidebar'
import MainShell from '@/components/ui/MainShell'
import { SensorProvider } from '@/context/useSensors'
import { DeviceProvider } from '@/context/useDevice'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SensorProvider>
        <DeviceProvider>
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          <Sidebar />
          <MainShell>{children}</MainShell>
        </DeviceProvider>
      </SensorProvider>
    </AuthGuard>
  )
}
