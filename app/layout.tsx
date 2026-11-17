import type { Metadata, Viewport } from 'next'
import './globals.css'
import { SidebarProvider } from '@/context/useSidebar'
import { ThemeProvider } from '@/context/useTheme'
import PwaRegister from '@/components/PwaRegister'

const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('preventa.theme');if(t==='light')document.documentElement.classList.add('light')}catch(e){}`

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
      <head>
        <link rel="preload" href="/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <ThemeProvider>
          <SidebarProvider>
            <PwaRegister />
            {children}
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
