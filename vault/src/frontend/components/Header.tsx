import logoUrl from '@/frontend/assets/hypermedia-logo.png'
import {useActions, useAppState} from '@/frontend/store'
import {ChevronDown, LogOut} from 'lucide-react'
import {useCallback, useEffect, useRef, useState} from 'react'
import {Link} from 'react-router-dom'

/**
 * Application header with user info and logout button.
 */
export function Header() {
  const {session} = useAppState()
  const actions = useActions()
  return (
    <header className="border-border dark:bg-background z-20 flex w-full transform-gpu flex-row items-center border-b bg-white p-4 transition-transform duration-200">
      <div className="flex min-w-0 items-center self-stretch sm:shrink-0">
        <div className="flex flex-1 justify-center overflow-hidden">
          <Link
            to="/"
            className="!text-foreground hover:!text-foreground flex min-w-0 items-center justify-center gap-2 !no-underline hover:!no-underline"
          >
            <img src={logoUrl} alt="" className="size-6 rounded-full" />
            <p className="text-foreground min-w-0 truncate overflow-hidden text-center font-bold select-none md:text-left">
              Hypermedia Identity
            </p>
          </Link>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-end gap-2">
        {session?.authenticated && <AccountMenu email={session.email || ''} onSignOut={actions.handleLogout} />}
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
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
