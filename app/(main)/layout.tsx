import Sidebar from '@/components/ui/Sidebar'
import MainShell from '@/components/ui/MainShell'
import { SensorProvider } from '@/context/useSensors'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <SensorProvider>
      <Sidebar />
      <MainShell>{children}</MainShell>
    </SensorProvider>
  )
}