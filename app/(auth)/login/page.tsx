import LoginForm from '@/features/auth/components/LoginForm'
import Image from 'next/image'

const features = [
  'Real-time sensor monitoring',
  'ESP32-CAM surveillance archive',
  'Instant fire & smoke alerts',
]

export default function LoginPage() {
  return (
    <main className="relative min-h-screen flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <div className="relative z-10 w-full max-w-md md:max-w-4xl bg-(--surface-solid) rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col md:flex-row">
        <div className="bg-ember text-white p-4 sm:p-8 lg:p-10 md:w-2/5 flex items-center gap-3 md:flex-col md:justify-between md:items-start">
          <Image src="/PREVENTA-LOGO.png" alt="PREVENTA" width="80" height="80" className="w-12 sm:w-16 md:w-20 h-auto shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold leading-tight md:mt-8">Welcome to PREVENTA</h1>
            <p className="mt-1 md:mt-2 text-xs sm:text-sm text-white/80 leading-relaxed">Fire prevention and sensor monitoring dashboard.</p>
            <ul className="hidden md:block space-y-3 md:mt-8">
              {features.map((f) => (
                <li key={f} className="flex items-center gap-3 text-sm text-white/90">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white/20 shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="hidden md:block text-white/30 shrink-0">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </div>
        <div className="flex-1 p-5 sm:p-10 flex flex-col justify-center">
          <LoginForm />
        </div>
      </div>
    </main>
  )
}
