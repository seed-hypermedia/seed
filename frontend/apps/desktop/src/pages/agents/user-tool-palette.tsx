import React, {useState} from 'react'
import {Wrench} from 'lucide-react'
import {Button} from '@shm/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {getSeedTool, type JsonSchema} from '@seed-hypermedia/agents-protocol'
import {useAgentServerHealth, useInvokeSessionTool} from '@/models/agents'
import {
  DEFAULT_AGENT_TOOLS,
  getToolAvailability,
  normalizeStoredAgentTools,
  type AgentServerWebCapabilities,
} from './agent-tools'

/**
 * The user's side of the symmetric log: run read, write, or any callable tool yourself, in this
 * thread. The call and its result land on the shared session log as actor-'user' events the agent
 * reads on its next turn — same verbs, same log, no side channel.
 */
export function UserToolPalette({
  serverUrl,
  accountId,
  sessionId,
  agentTools,
  agentToolsLoading,
  disabled,
}: {
  serverUrl: string
  accountId: string | null
  sessionId: string
  /** The agent definition's tools array; undefined means the default grant set. */
  agentTools?: string[]
  /** True while the agent definition is still loading — the callable list must wait, not grant-all. */
  agentToolsLoading?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const invoke = useInvokeSessionTool(serverUrl, accountId)
  const health = useAgentServerHealth(serverUrl)

  const capabilities: AgentServerWebCapabilities | undefined = health.data
    ? {
        ...(health.data.webTools ?? {search: true, readBrowser: true}),
        codeExec: health.data.codeExec,
        codeExecReason: health.data.codeExecReason,
        codeExecReasonCode: health.data.codeExecReasonCode,
      }
    : undefined
  const callables = agentToolsLoading
    ? null
    : normalizeStoredAgentTools(agentTools ?? DEFAULT_AGENT_TOOLS).filter(
        (name) => name !== 'publish' && getSeedTool(name) && getToolAvailability(name, capabilities).available,
      )

  /** True when the server answered with the tool's contract instead of running it (touch-expand). */
  function isContractMiss(output: unknown): boolean {
    if (typeof output !== 'object' || output === null) return false
    const value = output as {validationErrors?: unknown; contract?: unknown}
    return value.validationErrors !== undefined || value.contract !== undefined
  }

  async function run(verb: 'read' | 'write' | 'call', input: unknown) {
    setNotice(null)
    try {
      const response = await invoke.mutateAsync({sessionId, verb, input})
      if (response._ === 'InvokeSessionToolResponse') {
        if (response.error) {
          toast.error(response.error)
        } else if (isContractMiss(response.output)) {
          // The tool answered with its contract, not a result — keep the form open to retry.
          setNotice('Input didn’t match the tool’s contract — see the contract row in the thread, adjust, and run again.')
          return
        }
      }
      setOpen(false)
      setSelected(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tool call failed')
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSelected(null)
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled} title="Run a tool yourself — the agent sees the result">
          <Wrench className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        {notice ? (
          <div className="border-primary/30 bg-primary/10 text-primary mb-2 rounded-md border px-2 py-1.5 text-[11px]">
            {notice}
          </div>
        ) : null}
        {selected === null ? (
          <div className="flex flex-col gap-0.5">
            <SizableText size="xs" color="muted" className="px-2 pt-1 pb-1.5">
              Run a tool as yourself. The result lands on this thread's log for both of you.
            </SizableText>
            <PaletteRow label="Read" hint="~/memory, ~/tools, hm://, https://, activity:" onPick={() => setSelected('read')} />
            <PaletteRow label="Write" hint="~/memory, ~/tools, hm://, ipfs://" onPick={() => setSelected('write')} />
            {callables === null ? (
              <SizableText size="xs" color="muted" className="px-2 py-1.5">
                Loading this agent's tools…
              </SizableText>
            ) : (
              callables.map((name) => (
                <PaletteRow
                  key={name}
                  label={getSeedTool(name)?.label ?? name}
                  hint={name}
                  onPick={() => setSelected(name)}
                />
              ))
            )}
          </div>
        ) : selected === 'read' ? (
          <ReadForm busy={invoke.isPending} onBack={() => setSelected(null)} onRun={(input) => void run('read', input)} />
        ) : selected === 'write' ? (
          <WriteForm busy={invoke.isPending} onBack={() => setSelected(null)} onRun={(input) => void run('write', input)} />
        ) : (
          <CallableForm
            name={selected}
            busy={invoke.isPending}
            onBack={() => setSelected(null)}
            onRun={(input) => void run('call', {tool: selected, input})}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function PaletteRow({label, hint, onPick}: {label: string; hint: string; onPick: () => void}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="hover:bg-accent flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm"
    >
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground min-w-0 truncate font-mono text-[10px]">{hint}</span>
    </button>
  )
}

function FormShell({
  title,
  busy,
  canRun,
  onBack,
  onRun,
  children,
}: {
  title: string
  busy: boolean
  canRun: boolean
  onBack: () => void
  onRun: () => void
  children: React.ReactNode
}) {
  return (
    <form
      className="flex flex-col gap-2 p-1"
      onSubmit={(event) => {
        event.preventDefault()
        if (canRun && !busy) onRun()
      }}
    >
      <div className="flex items-center justify-between">
        <SizableText size="sm" weight="bold">
          {title}
        </SizableText>
        <Button size="sm" variant="ghost" type="button" onClick={onBack}>
          Back
        </Button>
      </div>
      {children}
      <Button size="sm" type="submit" disabled={!canRun || busy}>
        {busy ? 'Running…' : 'Run'}
      </Button>
    </form>
  )
}

const fieldClass =
  'border-border bg-background w-full rounded-md border px-2 py-1.5 font-mono text-xs focus:outline-none'

function ReadForm({busy, onBack, onRun}: {busy: boolean; onBack: () => void; onRun: (input: unknown) => void}) {
  const [address, setAddress] = useState('')
  return (
    <FormShell title="Read" busy={busy} canRun={!!address.trim()} onBack={onBack} onRun={() => onRun({address: address.trim()})}>
      <input
        autoFocus
        className={fieldClass}
        placeholder="~/memory/notes.md · hm://… · https://…"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
    </FormShell>
  )
}

function WriteForm({busy, onBack, onRun}: {busy: boolean; onBack: () => void; onRun: (input: unknown) => void}) {
  const [address, setAddress] = useState('')
  const [content, setContent] = useState('')
  const [optionsJson, setOptionsJson] = useState('')
  function submit() {
    let options: unknown
    if (optionsJson.trim()) {
      try {
        options = JSON.parse(optionsJson)
      } catch {
        toast.error('Options must be valid JSON')
        return
      }
    }
    onRun({address: address.trim(), ...(content ? {content} : {}), ...(options !== undefined ? {options} : {})})
  }
  return (
    <FormShell title="Write" busy={busy} canRun={!!address.trim()} onBack={onBack} onRun={submit}>
      <input
        autoFocus
        className={fieldClass}
        placeholder="~/memory/notes.md · hm://account/path"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      <textarea
        className={`${fieldClass} min-h-20`}
        placeholder="Content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <textarea
        className={`${fieldClass} min-h-10`}
        placeholder='Options JSON (optional), e.g. {"title": "My Doc"}'
        value={optionsJson}
        onChange={(event) => setOptionsJson(event.target.value)}
      />
    </FormShell>
  )
}

/** Form fields generated from the tool's registry input schema; deep shapes fall back to JSON. */
function CallableForm({
  name,
  busy,
  onBack,
  onRun,
}: {
  name: string
  busy: boolean
  onBack: () => void
  onRun: (input: unknown) => void
}) {
  const tool = getSeedTool(name)
  const schema: JsonSchema = tool?.inputSchema ?? {type: 'object'}
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const simple = Object.entries(properties).every(
    ([, prop]) => prop.type === 'string' || prop.type === 'number' || prop.type === 'integer' || prop.type === 'boolean',
  )
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [rawJson, setRawJson] = useState('{}')

  if (!simple) {
    return (
      <FormShell
        title={tool?.label ?? name}
        busy={busy}
        canRun
        onBack={onBack}
        onRun={() => {
          try {
            onRun(JSON.parse(rawJson))
          } catch {
            toast.error('Input must be valid JSON')
          }
        }}
      >
        <textarea
          autoFocus
          className={`${fieldClass} min-h-24`}
          value={rawJson}
          onChange={(event) => setRawJson(event.target.value)}
        />
      </FormShell>
    )
  }

  const requiredFilled = Array.from(required).every((key) => {
    const value = values[key]
    return typeof value === 'boolean' ? true : !!String(value ?? '').trim()
  })
  const numericErrors = Object.entries(properties).flatMap(([key, prop]) => {
    if (prop.type !== 'number' && prop.type !== 'integer') return []
    const value = values[key]
    if (value === undefined || value === '' || typeof value === 'boolean') return []
    return Number.isNaN(Number(value)) ? [key] : []
  })

  function submit() {
    const input: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(properties)) {
      const value = values[key]
      if (value === undefined || value === '') continue
      if (prop.type === 'number' || prop.type === 'integer') {
        input[key] = Number(value)
      } else if (prop.type === 'boolean') {
        input[key] = value === true
      } else {
        input[key] = value
      }
    }
    onRun(input)
  }

  return (
    <FormShell
      title={tool?.label ?? name}
      busy={busy}
      canRun={requiredFilled && numericErrors.length === 0}
      onBack={onBack}
      onRun={submit}
    >
      {Object.entries(properties).map(([key, prop], index) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-muted-foreground font-mono text-[10px]">
            {key}
            {required.has(key) ? ' *' : ''}
            {numericErrors.includes(key) ? <span className="text-destructive"> — must be a number</span> : null}
          </span>
          {prop.type === 'boolean' ? (
            <input
              type="checkbox"
              className="size-4"
              checked={values[key] === true}
              onChange={(event) => setValues((prev) => ({...prev, [key]: event.target.checked}))}
            />
          ) : prop.enum ? (
            <select
              className={fieldClass}
              value={String(values[key] ?? '')}
              onChange={(event) => setValues((prev) => ({...prev, [key]: event.target.value}))}
            >
              <option value="">—</option>
              {prop.enum.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus={index === 0}
              className={fieldClass}
              placeholder={prop.description?.slice(0, 60)}
              value={String(values[key] ?? '')}
              onChange={(event) => setValues((prev) => ({...prev, [key]: event.target.value}))}
            />
          )}
        </label>
      ))}
    </FormShell>
  )
}
