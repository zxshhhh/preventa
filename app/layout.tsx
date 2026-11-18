import type { Metadata, Viewport } from 'next'
import './globals.css'
import { SidebarProvider } from '@/context/useSidebar'
import { ThemeProvider } from '@/context/useTheme'
import { A11yProvider } from '@/context/useA11y'
import { AuthProvider } from '@/context/useAuth'
import PwaRegister from '@/components/PwaRegister'

/**
 * Runs before first paint so a stored / OS preference never flashes the
 * wrong theme or accessibility mode. Keep in sync with useTheme + useA11y.
 */
const APP_PREFS_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var q=function(s){return !!(window.matchMedia&&window.matchMedia(s).matches)};var t=localStorage.getItem('preventa.theme')||'system';var dark=t==='dark'||(t!=='light'&&q('(prefers-color-scheme: dark)'));d.classList.toggle('light',!dark);d.classList.toggle('dark',dark);var a={};try{a=JSON.parse(localStorage.getItem('preventa.a11y')||'{}')||{}}catch(e){}var m=a.motion||'system';var reduce=m==='reduced'||(m==='system'&&q('(prefers-reduced-motion: reduce)'));var c=a.contrast||'system';var high=c==='high'||(c==='system'&&(q('(prefers-contrast: more)')||q('(forced-colors: active)')));d.classList.toggle('a11y-reduce-motion',reduce);d.classList.toggle('a11y-high-contrast',high);d.classList.toggle('a11y-focus-strong',a.focusStrong===true);d.classList.toggle('a11y-text-lg',a.textScale==='large');}catch(e){}})();`

export const metadata: Metadata = {
  title: {
    default: 'Preventa',
    template: '%s · Preventa',
  },
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F1F3F8' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0F19' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: APP_PREFS_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <AuthProvider>
          <ThemeProvider>
            <A11yProvider>
              <SidebarProvider>
                <PwaRegister />
                {children}
              </SidebarProvider>
            </A11yProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
