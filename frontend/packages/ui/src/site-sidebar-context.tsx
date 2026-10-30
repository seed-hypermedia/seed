import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './button'
import { Tooltip } from './tooltip'

/** Reads a saved sidebar preference without treating invalid storage as a choice. */
export function readSidebarOpen(value: string | null, defaultOpen: boolean): boolean {
  return value === 'true' ? true : value === 'false' ? false : defaultOpen
}

/** Persists explicit toggles after hydration; server rendering uses the platform default. */
export function usePersistedSidebarOpen(defaultOpen: boolean) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    try {
      setOpen(readSidebarOpen(localStorage.getItem('seed.site-sidebar.open'), defaultOpen))
    } catch {
      // Storage can be disabled; toggling still works for this session.
    }
  }, [defaultOpen])
  const update = useCallback((value: boolean) => {
    setOpen(value)
    try {
      localStorage.setItem('seed.site-sidebar.open', String(value))
    } catch {
      // Keep the current session usable without storage.
    }
  }, [])
  return [open, update] as const
}

type SiteSidebarContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  target: HTMLDivElement | null
  setTarget: (target: HTMLDivElement | null) => void
  hasPageContent: boolean
  setHasPageContent: (value: boolean) => void
}

const SiteSidebarContext = createContext<SiteSidebarContextValue | null>(null)

/** Shares the sidebar toggle and the desktop slot for page-owned document actions. */
export function SiteSidebarProvider({
  open,
  setOpen,
  children,
}: {
  open: boolean
  setOpen: (open: boolean) => void
  children: ReactNode
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [hasPageContent, setHasPageContent] = useState(false)
  const value = useMemo(
    () => ({ open, setOpen, target, setTarget, hasPageContent, setHasPageContent }),
    [open, setOpen, target, hasPageContent],
  )
  return <SiteSidebarContext.Provider value={value}>{children}</SiteSidebarContext.Provider>
}

/** Returns shared sidebar controls when the page has a sidebar. */
export function useSiteSidebar() {
  return useContext(SiteSidebarContext)
}

/** Places a page's browser in the desktop sidebar while keeping page providers and permissions. */
export function SiteSidebarPortal({ children }: { children: ReactNode }) {
  const sidebar = useSiteSidebar()
  const setHasPageContent = sidebar?.setHasPageContent
  useEffect(() => {
    setHasPageContent?.(true)
    return () => setHasPageContent?.(false)
  }, [setHasPageContent])
  return sidebar?.target ? createPortal(children, sidebar.target) : null
}

/** Opens or closes the shared sidebar from a site or page header. */
export function SiteSidebarToggle() {
  const sidebar = useSiteSidebar()
  if (!sidebar) return null
  const label = sidebar.open ? 'Close sidebar' : 'Open sidebar'
  const Icon = sidebar.open ? PanelLeftClose : PanelLeftOpen
  return (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="iconSm"
        aria-label={label}
        aria-expanded={sidebar.open}
        className="no-window-drag text-muted-foreground opacity-50 hover:text-muted-foreground size-7 min-w-7 shrink-0 focus-visible:ring-2"
        onClick={() => sidebar.setOpen(!sidebar.open)}
      >
        <Icon className="size-5" />
      </Button>
    </Tooltip>
  )
}
