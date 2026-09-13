'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

interface SidebarContextType {
  isMobileOpen: boolean
  toggle: () => void
  close: () => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  const toggle = () => setIsMobileOpen((prev) => !prev)
  const close = () => setIsMobileOpen(false)

  return (
    <SidebarContext.Provider value={{ isMobileOpen, toggle, close }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return context
}
