'use client'

export default function MainShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen pt-19 lg:pt-0 lg:pl-21">
      <main className="flex-1 w-full max-w-full p-4 lg:p-9">{children}</main>
    </div>
  )
}