import {Item as MenuItem} from '@radix-ui/react-dropdown-menu'
import {ChevronRight} from 'lucide-react'
import {DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from './components/dropdown-menu'
import {cn} from './utils'
import {type ReactNode, useEffect, useRef, useState} from 'react'

/** Shared account dropdown layout, including the mobile sheet's menu rows. */
export const accountMenuContentClassName =
  'w-80 max-w-[calc(100vw-2rem)] rounded-xl p-0 font-normal shadow-lg [&_svg]:stroke-[1.5] [&_[data-slot=dropdown-menu-item]]:gap-3 [&_[data-slot=dropdown-menu-item]]:rounded-none [&_[data-slot=dropdown-menu-item]]:px-4 [&_[data-slot=dropdown-menu-item]]:py-2 [&_[data-slot=dropdown-menu-item]]:text-sm [&_[data-slot=dropdown-menu-item]_svg]:size-4 [&_[data-slot=dropdown-menu-separator]]:mx-0 [&_[data-slot=dropdown-menu-separator]]:my-0'

/** Account identity details shared by desktop, web, and mobile account menus. */
export function AccountMenuIdentity({
  avatar,
  name,
  role,
  email,
}: {
  avatar: ReactNode
  name?: string | null
  role?: string | null
  email?: string | null
}) {
  return (
    <>
      <span className="shrink-0">{avatar}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span className="flex min-w-0 items-baseline gap-1 text-sm">
          <span className="truncate font-medium">{name || 'Account'}</span>
          {role ? <span className="text-muted-foreground shrink-0">· {role}</span> : null}
        </span>
        {email ? (
          <span className="text-muted-foreground truncate text-sm" title={email}>
            {email}
          </span>
        ) : null}
      </span>
    </>
  )
}

/** Muted section heading for account settings and sites. */
export function AccountMenuSection({children}: {children: ReactNode}) {
  return <div className="text-muted-foreground px-4 py-1 text-xs font-normal">{children}</div>
}

/** Scrolls long account lists and shows edge fades only where content is hidden. */
export function AccountMenuScrollArea({children}: {children: ReactNode}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({top: false, bottom: false})
  const updateEdges = () => {
    const element = scrollRef.current
    if (!element) return
    const top = element.scrollTop > 1
    const bottom = element.scrollHeight - element.clientHeight - element.scrollTop > 1
    setEdges((previous) => (previous.top === top && previous.bottom === bottom ? previous : {top, bottom}))
  }
  useEffect(() => {
    updateEdges()
    const observer = new ResizeObserver(updateEdges)
    if (scrollRef.current) observer.observe(scrollRef.current)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="relative flex min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 overflow-y-auto overscroll-contain" onScroll={updateEdges}>
        <div ref={contentRef}>{children}</div>
      </div>
      {edges.top ? (
        <div
          aria-hidden="true"
          data-scroll-fade="top"
          className="from-popover pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b to-transparent"
        />
      ) : null}
      {edges.bottom ? (
        <div
          aria-hidden="true"
          data-scroll-fade="bottom"
          className="from-popover pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-linear-to-t to-transparent"
        />
      ) : null}
    </div>
  )
}

/** A click-controlled account dropdown nested in the main account menu. */
export function AccountMenuSwitcher({identity, children}: {identity: ReactNode; children: ReactNode}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <MenuItem
          aria-label="Switch account"
          onSelect={(event) => event.preventDefault()}
          className="focus:bg-accent focus:text-accent-foreground flex w-full items-center gap-3 rounded-none px-4 py-3 text-sm font-normal outline-hidden select-none [&_svg]:stroke-[1.5]"
        >
          {identity}
          <ChevronRight className="ml-auto size-4" />
        </MenuItem>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label="Accounts"
        onFocusOutside={(event) => event.preventDefault()}
        side="left"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          accountMenuContentClassName,
          'flex max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] w-64 flex-col overflow-hidden',
        )}
      >
        <AccountMenuScrollArea>{children}</AccountMenuScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
