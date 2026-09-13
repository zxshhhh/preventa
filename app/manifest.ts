import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PREVENTA',
    short_name: 'PREVENTA',
    description: 'Fire prevention and sensor monitoring dashboard',
    id: '/',
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    background_color: '#0B0F19',
    theme_color: '#0B0F19',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}