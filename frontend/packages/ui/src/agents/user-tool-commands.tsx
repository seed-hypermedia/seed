import React, {createContext, useContext, useRef, useState} from 'react'
import {PenLine, BookOpenText, X} from 'lucide-react'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {getSeedTool, type JsonSchema} from '@seed-hypermedia/agents-protocol'
import {useAgentServerHealth, useInvokeSessionTool} from './models'
import {
  DEFAULT_AGENT_TOOLS,
  getToolAvailability,
  normalizeStoredAgentTools,
  type AgentServerWebCapabilities,
} from './agent-tools'
import type {AgentsSlashMenuItem} from './platform'
import {getToolIcon} from './tool-icons'

const TOOL_GROUP = 'Run a tool'

/**
 * The user's side of the symmetric log: run read, write, or any callable tool yourself, in this
 * thread. The call and its result land on the shared session log as actor-'user' events the agent
 * reads on its next turn — same verbs, same log, no side channel.
 *
 * Tools are offered as commands in the composer's `/` menu; picking one opens its form above the
 * input. Returns the menu items (read on every query) and that form, or null while none is open.
 */
export function useUserToolCommands({
  serverUrl,
  accountId,
  sessionId,
  agentTools,
  agentToolsLoading,
  enabled = true,
  blockedReason,
  onStartSession,
  onSessionStarted,
  onClose,
}: {
  serverUrl: string
  accountId: string | null
  /** Absent for a draft composer: tool calls land on a session's log, so no session yet means the
   * first run creates one via {@link onStartSession} — or, without that, no tool commands. */
  sessionId?: string
  /** The agent definition's tools array; undefined means the default grant set. */
  agentTools?: string[]
  /** True while the agent definition is still loading — the callable list must wait, not grant-all. */
  agentToolsLoading?: boolean
  /** Off when the user may not run session tools (e.g. chat-only access): no commands at all. */
  enabled?: boolean
  /** When set, an open form stays fillable but cannot run, and says why. */
  blockedReason?: string
  /** Draft mode: creates the session the first tool run needs, so a tool call can start a session
   * the same way a first message does. */
  onStartSession?: () => Promise<string>
  /** Called once a tool run that created its own session finishes, e.g. to navigate to it. */
  onSessionStarted?: (sessionId: string) => void
  /** Called when the form closes (run, dismissed), e.g. to return focus to the editor. */
  onClose?: () => void
}): {getSlashMenuItems: () => AgentsSlashMenuItem[]; form: React.ReactNode} {
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const invoke = useInvokeSessionTool(serverUrl, accountId)
  const health = useAgentServerHealth(serverUrl)
  /** Session a draft-mode run created, so a contract-miss retry or a failed call reuses it
   * instead of opening another. */
  const startedSessionIdRef = useRef<string | null>(null)

  const capabilities: AgentServerWebCapabilities | undefined = health.data
    ? {
        ...(health.data.webTools ?? {search: true, readBrowser: true}),
        codeExec: health.data.codeExec,
        codeExecReason: health.data.codeExecReason,
        codeExecReasonCode: health.data.codeExecReasonCode,
      }
    : undefined
  // While the agent definition loads the callable list must wait rather than grant all tools.
  const callables = agentToolsLoading
    ? []
    : normalizeStoredAgentTools(agentTools ?? DEFAULT_AGENT_TOOLS).filter(
        (name) => name !== 'publish' && getSeedTool(name) && getToolAvailability(name, capabilities).available,
      )
  const canRun = enabled && !!(sessionId || onStartSession)

  function open(name: string) {
    setNotice(null)
    setSelected(name)
  }

  function close() {
    setSelected(null)
    setNotice(null)
    onClose?.()
  }

  function getSlashMenuItems(): AgentsSlashMenuItem[] {
    if (!canRun) return []
    return [
      {
        name: 'Read',
        aliases: ['read', 'open', 'fetch'],
        group: TOOL_GROUP,
        icon: <BookOpenText size={18} />,
        hint: '~/memory, ~/tools, hm://, https://, activity:',
        onSelect: () => open('read'),
      },
      {
        name: 'Write',
        aliases: ['write', 'save'],
        group: TOOL_GROUP,
        icon: <PenLine size={18} />,
        hint: '~/memory, ~/tools, hm://, ipfs://',
        onSelect: () => open('write'),
      },
      ...callables.map((name): AgentsSlashMenuItem => {
        const tool = getSeedTool(name)
        const Icon = getToolIcon(name, tool?.render?.kind)
        return {
          name: tool?.label ?? name,
          aliases: [name, ...name.split('_')],
          group: TOOL_GROUP,
          icon: <Icon size={18} />,
          hint: name,
          onSelect: () => open(name),
        }
      }),
    ]
  }

  /** True when the server answered with the tool's contract instead of running it (touch-expand). */
  function isContractMiss(output: unknown): boolean {
    if (typeof output !== 'object' || output === null) return false
    const value = output as {validationErrors?: unknown; contract?: unknown}
    return value.validationErrors !== undefined || value.contract !== undefined
  }

  async function run(verb: 'read' | 'write' | 'call', input: unknown) {
    setNotice(null)
    try {
      let targetSessionId = sessionId ?? startedSessionIdRef.current
      if (!targetSessionId) {
        if (!onStartSession) return
        targetSessionId = await onStartSession()
        startedSessionIdRef.current = targetSessionId
      }
      const startedHere = !sessionId && startedSessionIdRef.current === targetSessionId
      const response = await invoke.mutateAsync({sessionId: targetSessionId, verb, input})
      if (response._ === 'InvokeSessionToolResponse') {
        if (response.error) {
          toast.error(response.error)
        } else if (isContractMiss(response.output)) {
          // The tool answered with its contract, not a result — keep the form open to retry.
          setNotice(
            'Input didn’t match the tool’s contract — see the contract row in the thread, adjust, and run again.',
          )
          return
        }
      }
      close()
      // Even a failed call lands on the new session's log, so surface the session either way.
      if (startedHere) onSessionStarted?.(targetSessionId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tool call failed')
    }
  }

  const form =
    selected === null || !canRun ? null : (
      <ToolFormBlockedContext.Provider value={blockedReason ?? null}>
        <div
          className="border-border bg-background mx-3 mt-2 rounded-md border p-2"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              close()
            }
          }}
        >
          {notice ? (
            <div className="border-primary/30 bg-primary/10 text-primary mb-2 rounded-md border px-2 py-1.5 text-[11px]">
              {notice}
            </div>
          ) : null}
          {selected === 'read' ? (
            <ReadForm busy={invoke.isPending} onClose={close} onRun={(input) => void run('read', input)} />
          ) : selected === 'write' ? (
            <WriteForm busy={invoke.isPending} onClose={close} onRun={(input) => void run('write', input)} />
          ) : (
            <CallableForm
              key={selected}
              name={selected}
              busy={invoke.isPending}
              onClose={close}
              onRun={(input) => void run('call', {tool: selected, input})}
            />
          )}
        </div>
      </ToolFormBlockedContext.Provider>
    )

  return {getSlashMenuItems, form}
}

/** Why an open tool form can't run right now (e.g. the agent is mid-turn), or null when it can. */
const ToolFormBlockedContext = createContext<string | null>(null)

function FormShell({
  title,
  busy,
  canRun,
  onClose,
  onRun,
  children,
}: {
  title: string
  busy: boolean
  canRun: boolean
  onClose: () => void
  onRun: () => void
  children: React.ReactNode
}) {
  const blockedReason = useContext(ToolFormBlockedContext)
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (canRun && !busy && !blockedReason) onRun()
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <SizableText size="sm" weight="bold">
          {title}
        </SizableText>
        <Button size="iconSm" variant="ghost" type="button" aria-label="Close tool" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
      {children}
      <div className="flex items-center justify-end gap-2">
        {blockedReason ? (
          <SizableText size="xs" color="muted">
            {blockedReason}
          </SizableText>
        ) : null}
        <Button size="sm" type="submit" disabled={!canRun || busy || !!blockedReason}>
          {busy ? 'Running…' : 'Run'}
        </Button>
      </div>
    </form>
  )
}

const fieldClass =
  'border-border bg-background w-full rounded-md border px-2 py-1.5 font-mono text-xs focus:outline-none'

function ReadForm({busy, onClose, onRun}: {busy: boolean; onClose: () => void; onRun: (input: unknown) => void}) {
  const [address, setAddress] = useState('')
  return (
    <FormShell
      title="Read"
      busy={busy}
      canRun={!!address.trim()}
      onClose={onClose}
      onRun={() => onRun({address: address.trim()})}
    >
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

function WriteForm({busy, onClose, onRun}: {busy: boolean; onClose: () => void; onRun: (input: unknown) => void}) {
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
    <FormShell title="Write" busy={busy} canRun={!!address.trim()} onClose={onClose} onRun={submit}>
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
        placeholder='Options JSON (optional), e.g. {"name": "My Doc"}'
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
  onClose,
  onRun,
}: {
  name: string
  busy: boolean
  onClose: () => void
  onRun: (input: unknown) => void
}) {
  const tool = getSeedTool(name)
  const schema: JsonSchema = tool?.inputSchema ?? {type: 'object'}
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const simple = Object.entries(properties).every(
    ([, prop]) =>
      prop.type === 'string' || prop.type === 'number' || prop.type === 'integer' || prop.type === 'boolean',
  )
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [rawJson, setRawJson] = useState('{}')

  if (!simple) {
    return (
      <FormShell
        title={tool?.label ?? name}
        busy={busy}
        canRun
        onClose={onClose}
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
      onClose={onClose}
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
