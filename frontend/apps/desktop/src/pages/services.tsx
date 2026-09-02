import {
  ServiceInfo,
  ServiceInput,
  useClearServiceLogs,
  useCreateService,
  useRemoveService,
  useServiceAction,
  useServiceLogs,
  useServices,
  useUpdateService,
} from '@/models/services'
import {useNavRoute, useNavigate} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Badge} from '@shm/ui/components/badge'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {Switch} from '@shm/ui/components/switch'
import {Textarea} from '@shm/ui/components/textarea'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {Pencil, Play, Plus, RotateCw, Square, Trash2} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'

/**
 * Desktop-only Services page: lists the long-running shell commands managed by the app, lets the
 * user define new ones, start/stop/restart them, and watch their output. The same services are
 * reachable from the menu-bar tray and from the local HTTP API at /api/services.
 */

type Pane = {mode: 'view'} | {mode: 'new'} | {mode: 'edit'}

export default function ServicesPage() {
  const route = useNavRoute()
  if (route.key !== 'services') throw new Error('Services page rendered for a different route')
  const navigate = useNavigate('replace')
  const services = useServices()
  const list = services.data ?? []
  const selectedId = route.serviceId ?? null
  const selected = list.find((service) => service.id === selectedId) ?? null
  const [pane, setPane] = useState<Pane>({mode: 'view'})

  // A removed or never-existing selection falls back to the first service.
  useEffect(() => {
    if (!services.data) return
    if (selectedId && !selected) {
      navigate({key: 'services', serviceId: services.data[0]?.id})
    } else if (!selectedId && services.data[0] && pane.mode === 'view') {
      navigate({key: 'services', serviceId: services.data[0].id})
    }
  }, [services.data, selectedId, selected, pane.mode, navigate])

  function select(id: string) {
    setPane({mode: 'view'})
    navigate({key: 'services', serviceId: id})
  }

  return (
    <div className="border-border bg-background relative flex h-full max-h-full overflow-hidden rounded-lg border">
      <aside className="border-border flex w-72 shrink-0 flex-col border-r">
        <div className="border-border flex items-center justify-between border-b px-3 py-2">
          <SizableText weight="bold">Services</SizableText>
          <Button size="sm" variant="outline" onClick={() => setPane({mode: 'new'})}>
            <Plus /> New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {services.isLoading ? (
            <p className="text-muted-foreground p-3 text-sm">Loading…</p>
          ) : list.length === 0 ? (
            <div className="text-muted-foreground flex flex-col gap-2 p-3 text-sm">
              <p>No services yet.</p>
              <p>A service is any long-running shell command the app starts for you and keeps an eye on.</p>
            </div>
          ) : (
            list.map((service) => (
              <button
                key={service.id}
                type="button"
                onClick={() => select(service.id)}
                className={cn(
                  'hover:bg-muted flex w-full flex-col gap-1 border-b px-3 py-2 text-left',
                  selectedId === service.id && pane.mode !== 'new' && 'bg-muted',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{service.name}</span>
                  <StatusBadge service={service} />
                </div>
                <span className="text-muted-foreground truncate font-mono text-xs">{service.command}</span>
              </button>
            ))
          )}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {pane.mode === 'new' ? (
          <ServiceForm
            key="new"
            title="New Service"
            onDone={(id) => {
              setPane({mode: 'view'})
              if (id) navigate({key: 'services', serviceId: id})
            }}
          />
        ) : pane.mode === 'edit' && selected ? (
          <ServiceForm
            key={selected.id}
            title={`Edit ${selected.name}`}
            service={selected}
            onDone={() => setPane({mode: 'view'})}
          />
        ) : selected ? (
          <ServiceDetail service={selected} onEdit={() => setPane({mode: 'edit'})} />
        ) : (
          <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm">
            <p>Select a service, or create one.</p>
            <Button variant="outline" onClick={() => setPane({mode: 'new'})}>
              <Plus /> New Service
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}

function StatusBadge({service}: {service: ServiceInfo}) {
  const {status} = service.runtime
  const variant =
    status === 'running'
      ? 'default'
      : status === 'failed'
        ? 'destructive'
        : status === 'stopping'
          ? 'warning'
          : 'outline'
  return <Badge variant={variant}>{status}</Badge>
}

function useUptime(startedAt: number | null, running: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  if (!startedAt || !running) return null
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`
}

function ServiceDetail({service, onEdit}: {service: ServiceInfo; onEdit: () => void}) {
  const action = useServiceAction()
  const remove = useRemoveService()
  const clearLogs = useClearServiceLogs()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const {runtime} = service
  const active = runtime.status === 'running' || runtime.status === 'stopping'
  const uptime = useUptime(runtime.startedAt, runtime.status === 'running')
  const busy = action.isPending || remove.isPending

  useEffect(() => setConfirmingDelete(false), [service.id])

  return (
    <>
      <div className="border-border flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <SizableText size="lg" weight="bold" className="truncate">
              {service.name}
            </SizableText>
            <StatusBadge service={service} />
            {service.autoStart ? <Badge variant="secondary">auto-start</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {active ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => action.mutate({id: service.id, action: 'restart'})}
                >
                  <RotateCw /> Restart
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || runtime.status === 'stopping'}
                  onClick={() => action.mutate({id: service.id, action: 'stop'})}
                >
                  <Square /> Stop
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => action.mutate({id: service.id, action: 'start'})}>
                <Play /> Start
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit}>
              <Pencil /> Edit
            </Button>
            {confirmingDelete ? (
              <>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => remove.mutate(service.id)}>
                  Confirm delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                <Trash2 /> Delete
              </Button>
            )}
          </div>
        </div>
        <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt>Command</dt>
          <dd className="text-foreground font-mono break-all select-text">{service.command}</dd>
          <dt>Directory</dt>
          <dd className="font-mono break-all select-text">{service.cwd || '~ (home)'}</dd>
          {service.env && Object.keys(service.env).length ? (
            <>
              <dt>Environment</dt>
              <dd className="font-mono break-all select-text">
                {Object.entries(service.env)
                  .map(([key, value]) => `${key}=${value}`)
                  .join('  ')}
              </dd>
            </>
          ) : null}
          <dt>State</dt>
          <dd>
            {runtime.status === 'running' && `Running as pid ${runtime.pid}${uptime ? ` for ${uptime}` : ''}`}
            {runtime.status === 'stopping' && 'Stopping…'}
            {runtime.status === 'stopped' && (runtime.exitedAt ? 'Stopped' : 'Never started')}
            {runtime.status === 'exited' && `Exited with code ${runtime.exitCode ?? 0}`}
            {runtime.status === 'failed' && (runtime.error || 'Failed')}
          </dd>
        </dl>
      </div>
      <LogView
        serviceId={service.id}
        running={runtime.status === 'running'}
        onClear={() => clearLogs.mutate(service.id)}
      />
    </>
  )
}

function LogView({serviceId, running, onClear}: {serviceId: string; running: boolean; onClear: () => void}) {
  const logs = useServiceLogs(serviceId)
  const [follow, setFollow] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lines = logs.data?.lines ?? []

  useEffect(() => {
    if (!follow || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [lines, follow])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border text-muted-foreground flex items-center justify-between border-b px-4 py-1.5 text-xs">
        <span>
          Output{running ? ' (live)' : ''}
          {logs.data?.path ? <span className="ml-2 font-mono opacity-70">{logs.data.path}</span> : null}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5">
            <Switch checked={follow} onCheckedChange={setFollow} /> Follow
          </label>
          <Button size="xs" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
          if (!atBottom && follow) setFollow(false)
        }}
        className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-100 select-text"
      >
        {lines.length === 0 ? (
          <span className="text-zinc-500">No output yet.</span>
        ) : (
          lines.map((line, index) => (
            <div
              key={`${line.ts}-${index}`}
              className={cn(
                'whitespace-pre-wrap',
                line.stream === 'stderr' && 'text-amber-300',
                line.stream === 'system' && 'text-sky-300 italic',
              )}
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) throw new Error(`Environment line must look like KEY=value: "${line}"`)
    env[line.slice(0, eq).trim()] = line.slice(eq + 1)
  }
  return env
}

function formatEnv(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function ServiceForm({
  title,
  service,
  onDone,
}: {
  title: string
  service?: ServiceInfo
  onDone: (createdId?: string) => void
}) {
  const create = useCreateService()
  const update = useUpdateService()
  const [name, setName] = useState(service?.name ?? '')
  const [command, setCommand] = useState(service?.command ?? '')
  const [cwd, setCwd] = useState(service?.cwd ?? '')
  const [envText, setEnvText] = useState(formatEnv(service?.env))
  const [autoStart, setAutoStart] = useState(service?.autoStart ?? false)
  const [startNow, setStartNow] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || update.isPending
  const canSubmit = useMemo(() => name.trim().length > 0 && command.trim().length > 0, [name, command])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    let env: Record<string, string>
    try {
      env = parseEnv(envText)
    } catch (parseError) {
      setError((parseError as Error).message)
      return
    }
    const input: ServiceInput = {name: name.trim(), command: command.trim(), cwd: cwd.trim(), env, autoStart}
    if (service) {
      update.mutate({id: service.id, ...input}, {onSuccess: () => onDone()})
    } else {
      create.mutate({...input, start: startNow}, {onSuccess: (created) => onDone(created.id)})
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <SizableText size="lg" weight="bold">
        {title}
      </SizableText>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="service-name">Name</Label>
        <Input id="service-name" value={name} onChangeText={setName} placeholder="web dev server" autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="service-command">Command</Label>
        <Textarea
          id="service-command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="pnpm dev"
          className="font-mono"
          rows={2}
        />
        <p className="text-muted-foreground text-xs">Runs through your shell, so pipes, `&&` and env expansion work.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="service-cwd">Working directory</Label>
        <Input
          id="service-cwd"
          value={cwd}
          onChangeText={setCwd}
          placeholder="/Users/you/project (defaults to your home directory)"
          className="font-mono"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="service-env">Environment variables</Label>
        <Textarea
          id="service-env"
          value={envText}
          onChange={(event) => setEnvText(event.target.value)}
          placeholder={'PORT=3000\nNODE_ENV=development'}
          className="font-mono"
          rows={3}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={autoStart} onCheckedChange={setAutoStart} /> Start automatically when Seed launches
      </label>
      {!service ? (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={startNow} onCheckedChange={setStartNow} /> Start now
        </label>
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!canSubmit || pending} loading={pending}>
          {service ? 'Save' : 'Create'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
