import Sidebar from '@/components/ui/Sidebar'
import MainShell from '@/components/ui/MainShell'
import { SensorProvider } from '@/context/useSensors'
import { DeviceProvider } from '@/context/useDevice'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <SensorProvider>
      <DeviceProvider>
        <Sidebar />
        <MainShell>{children}</MainShell>
      </DeviceProvider>
    </SensorProvider>
  )
}