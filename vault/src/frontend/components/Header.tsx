import { Button } from '@/frontend/components/ui/button'
import { useActions, useAppState } from '@/frontend/store'
import { useTheme } from '@/frontend/use-theme'
import { ChevronDown, LogOut, Moon, Sun } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Application header with user info, theme toggle, and logout button.
 */
export function Header() {
  const {session} = useAppState()
  const actions = useActions()
  const {resolvedTheme, setTheme, theme} = useTheme()

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark')
    else if (theme === 'dark') setTheme('system')
    else setTheme('light')
  }

  return (
    <header className="bg-panel border-border flex items-center justify-between border-b px-8 py-4">
      <Link
        to="/"
        className="!text-primary hover:!text-primary text-xl font-semibold transition-opacity hover:no-underline hover:opacity-80"
      >
        <span className="font-semibold">hyper.media</span> <span className="font-light">Identity Vault</span>
      </Link>
      <div className="flex items-center gap-2">
        {session?.authenticated && <AccountMenu email={session.email || ""} onSignOut={actions.handleLogout} />}
        <Button
          variant="ghost"
          size="sm"
          onClick={cycleTheme}
          title={`Theme: ${theme} (click to cycle)`}
          className="size-8 p-0"
        >
          {resolvedTheme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
      </div>
    </header>
  )
}

function AccountMenu({email, onSignOut}: {email: string; onSignOut: () => void}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors"
      >
        {email}
        <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="bg-popover border-border absolute top-full right-0 z-50 mt-1 min-w-[140px] rounded-md border py-1 shadow-md">
          <button
            onClick={() => {
              close()
              onSignOut()
            }}
            className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors"
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
