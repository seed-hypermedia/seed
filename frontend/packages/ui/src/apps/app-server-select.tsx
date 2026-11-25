import {Check, ChevronsUpDown, Plus, X} from 'lucide-react'
import {useRef, useState, type KeyboardEvent} from 'react'
import {findAppServer} from '../agents/client'
import {useRememberAgentServer} from '../agents/models'
import {Button} from '../button'
import {Input} from '../components/input'
import {Popover, PopoverContent, PopoverTrigger} from '../components/popover'
import {describeHostServer} from '../server-host-card'
import {Spinner} from '../spinner'
import {cn} from '../utils'
import {appServerErrorMessage, useAppServerCheck, type AppServerCheck} from './running'

/** One server offered as the place to run an app. */
export type AppServerOption = {
  url: string
  /** Set on servers the user added: forgets it. */
  onForget?: () => void
}

/** What a server's answer means for the person choosing it. */
export type AppServerVerdict = {
  tone: 'ok' | 'no' | 'checking' | 'idle'
  /** One short line: "Ready to run this app", or why not. */
  text: string
}

/** A server's check, in words (see `useAppServerCheck`). */
export function appServerVerdict(check: {
  data?: AppServerCheck
  error?: unknown
  isError: boolean
  isInitialLoading: boolean
  fetchStatus?: string
}): AppServerVerdict {
  if (check.isInitialLoading) return {tone: 'checking', text: 'Checking…'}
  if (check.isError) return {tone: 'no', text: appServerErrorMessage(check.error)}
  if (!check.data) return {tone: 'idle', text: ''}
  if (check.data.run) return {tone: 'ok', text: 'Already running here'}
  if (check.data.allowed) return {tone: 'ok', text: 'Ready to run this app'}
  return {tone: 'no', text: check.data.reason || 'This server will not run this app'}
}

function StatusDot({tone}: {tone: AppServerVerdict['tone']}) {
  if (tone === 'checking') return <Spinner className="size-3 shrink-0" />
  return (
    <span
      aria-hidden
      className={cn(
        'size-2 shrink-0 rounded-full',
        tone === 'ok' ? 'bg-green-500' : tone === 'no' ? 'bg-amber-500' : 'bg-muted-foreground/40',
      )}
    />
  )
}

/**
 * Chooses the server an app runs on. The closed control names the chosen server, with a dot for whether
 * it will run this app for the signed-in account (the reason is its tooltip); the list offers the
 * servers already known, each with its own dot, and takes a new one by host name (`hyper.media`), which is looked up (see
 * `findAppServer`), remembered on this device and chosen.
 */
export function AppServerSelect({
  appId,
  value,
  onChange,
  options,
  localServerUrl,
}: {
  appId: string
  /** The chosen server URL, or '' when none is chosen yet. */
  value: string
  onChange: (serverUrl: string) => void
  options: readonly AppServerOption[]
  localServerUrl?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const listed = value && !options.some((option) => option.url === value) ? [...options, {url: value}] : options
  const chosen = listed.find((option) => option.url === value)
  const verdict = appServerVerdict(useAppServerCheck(value, appId))
  const listRef = useRef<HTMLDivElement>(null)

  function moveFocus(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-server-row]') ?? [])
    if (!rows.length) return
    event.preventDefault()
    const at = rows.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length
    rows[next]?.focus()
  }

  return (
    <div className="grid gap-1.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setAdding(false)
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Server"
            aria-haspopup="listbox"
            title={verdict.text || undefined}
            className="border-border hover:bg-muted/50 focus-visible:ring-ring/50 dark:bg-input/30 flex min-h-11 w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm outline-none focus-visible:ring-[3px]"
          >
            {chosen ? (
              <>
                <StatusDot tone={verdict.tone} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{describeHostServer(chosen.url, localServerUrl)}</span>
                </span>
              </>
            ) : (
              <span className="text-muted-foreground flex-1">Choose a server</span>
            )}
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-1">
          <div ref={listRef} role="listbox" aria-label="Servers" onKeyDown={moveFocus}>
            {listed.map((option) => (
              <ServerRow
                key={option.url}
                appId={appId}
                option={option}
                selected={option.url === value}
                localServerUrl={localServerUrl}
                onSelect={() => {
                  onChange(option.url)
                  setOpen(false)
                }}
              />
            ))}
            {listed.length ? <div className="bg-border -mx-1 my-1 h-px" /> : null}
            {adding ? (
              <AddServer
                onAdded={(serverUrl) => {
                  onChange(serverUrl)
                  setOpen(false)
                  setAdding(false)
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <button
                type="button"
                data-server-row
                className="hover:bg-accent focus-visible:bg-accent flex min-h-10 w-full items-center gap-2.5 rounded-sm px-2 text-left text-sm outline-none"
                onClick={() => setAdding(true)}
              >
                <Plus className="text-muted-foreground size-4" /> Add a server…
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** One server in the list: its name, why it is offered, and what it answered for this app. */
function ServerRow({
  appId,
  option,
  selected,
  localServerUrl,
  onSelect,
}: {
  appId: string
  option: AppServerOption
  selected: boolean
  localServerUrl?: string | null
  onSelect: () => void
}) {
  const verdict = appServerVerdict(useAppServerCheck(option.url, appId))
  const name = describeHostServer(option.url, localServerUrl)
  return (
    <div className="group flex items-center">
      <button
        type="button"
        role="option"
        aria-selected={selected}
        data-server-row
        title={verdict.text || undefined}
        className="hover:bg-accent focus-visible:bg-accent flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm outline-none"
        onClick={onSelect}
      >
        <StatusDot tone={verdict.tone} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate', verdict.tone === 'no' ? 'text-muted-foreground' : 'font-medium')}>
            {name}
          </span>
        </span>
        {selected ? <Check className="size-4 shrink-0" /> : null}
      </button>
      {option.onForget && !selected ? (
        <button
          type="button"
          aria-label={`Forget ${name}`}
          title="Forget this server"
          className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-8 shrink-0 items-center justify-center rounded-sm opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
          onClick={option.onForget}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

/** Adds a server by name: looks it up, remembers it on this device, and hands back its URL. */
function AddServer({onAdded, onCancel}: {onAdded: (serverUrl: string) => void; onCancel: () => void}) {
  const remember = useRememberAgentServer()
  const [text, setText] = useState('')
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (!text.trim() || looking) return
    setLooking(true)
    setError(null)
    try {
      const serverUrl = await findAppServer(text)
      // Remembering is a convenience; the server is chosen even if the settings store refuses.
      await remember.mutateAsync(serverUrl).catch(() => null)
      onAdded(serverUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That server could not be found')
    } finally {
      setLooking(false)
    }
  }

  return (
    <div className="grid gap-1.5 p-1">
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          aria-label="Server name"
          placeholder="hyper.media"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          disabled={looking}
          onChange={(event) => {
            setText(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            // Arrow keys belong to the text here, not to the list around it.
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              void add()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          }}
        />
        <Button type="button" size="sm" variant="brand" disabled={!text.trim() || looking} onClick={() => void add()}>
          {looking ? 'Looking…' : 'Add'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive px-1 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  )
}
