import type { Metadata, Viewport } from 'next'
import './globals.css'
import { SidebarProvider } from '@/context/useSidebar'
import PwaRegister from '@/components/PwaRegister'

export const metadata: Metadata = {
  title: 'Preventa',
  description: 'Fire prevention and sensor monitoring dashboard',
  applicationName: 'Preventa',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Preventa',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: {
      url: '/apple-touch-icon.png',
      sizes: '180x180',
    },
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B0F19',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <SidebarProvider>
          <PwaRegister />
          {children}
        </SidebarProvider>
      </body>
    </html>
  )
}
