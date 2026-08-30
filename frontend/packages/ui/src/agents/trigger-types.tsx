import {type AgentSessionTriggerContext, type AgentTriggerSource, type TriggerContinuation} from './client'
import type {AgentToolInfo} from '@seed-hypermedia/agents-protocol'
import {Textarea} from '@shm/ui/components/textarea'
import {useNavigate} from './navigation'
import {AccountSearchInput, type SearchResult} from '@shm/ui/collaborators-page'
import {Input} from '@shm/ui/components/input'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Notice} from '@shm/ui/notice'
import {SizableText} from '@shm/ui/text'
import type {LoadedEvent} from '@shm/shared/models/activity-service'
import {useSearch} from '@shm/shared/models/search'
import type {NavRoute} from '@shm/shared/routes'
import {getEventRoute} from '@shm/ui/feed'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {hmId, packHmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {
  AtSign,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquare,
  Webhook,
  Workflow,
} from 'lucide-react'
import React, {useEffect, useMemo, useState} from 'react'

/**
 * Canonical per-trigger-type frontend definitions.
 *
 * Each trigger type (`AgentTriggerSource['type']`) keeps its option label, default config, summary,
 * configuration form, and triggered-session context rendering in one place so the four trigger types
 * stay in sync. The session UI renders {@link TriggerContextView} instead of the raw `<trigger_context>`
 * block that is sent to the model.
 */

export const TRIGGER_TYPE_OPTIONS: {value: AgentTriggerSource['type']; label: string}[] = [
  {value: 'document-comment', label: 'Comment in a document'},
  {value: 'user-mention', label: 'User mention'},
  {value: 'site-update', label: 'Space update'},
  {value: 'schedule', label: 'Schedule'},
  {value: 'webhook', label: 'Webhook'},
]

const SCHEDULE_MODE_OPTIONS = [
  {value: 'interval', label: 'Every interval'},
  {value: 'weekly', label: 'Days of week'},
  {value: 'once', label: 'One time'},
] as const

const SCHEDULE_UNIT_OPTIONS = [
  {value: 'minutes', label: 'Minutes'},
  {value: 'hours', label: 'Hours'},
] as const

export function defaultSourceForType(type: AgentTriggerSource['type']): AgentTriggerSource {
  if (type === 'webhook') return {type}
  if (type === 'user-mention') return {type, mentionedAccounts: []}
  if (type === 'site-update') return {type, resourcePrefix: '', eventTypes: ['doc-update', 'comment']}
  if (type === 'schedule') return {type, schedule: {kind: 'interval', every: 1, unit: 'hours'}}
  return {type: 'document-comment', resource: ''}
}

/** Reads the mentioned account list, tolerating legacy triggers that stored a single `mentionedAccount`. */
export function mentionedAccountsOf(source: Extract<AgentTriggerSource, {type: 'user-mention'}>): string[] {
  const legacy = (source as {mentionedAccount?: string}).mentionedAccount
  return source.mentionedAccounts ?? (legacy ? [legacy] : [])
}

/** Compact human-readable description of how a trigger is configured. */
export function summarizeTriggerSource(source: AgentTriggerSource): string {
  if (source.type === 'webhook') return 'Incoming webhook request'
  if (source.type === 'document-comment') {
    return `Comment in ${source.resource}${source.author ? ` by ${source.author}` : ''}`
  }
  if (source.type === 'user-mention') {
    const accounts = mentionedAccountsOf(source)
    const mention = accounts.length ? accounts.map(abbreviateUid).join(', ') : 'anyone'
    return `Mention of ${mention}${source.resourcePrefix ? ` in ${source.resourcePrefix}` : ''}`
  }
  if (source.type === 'site-update') {
    return `Update in ${source.resourcePrefix}${source.eventTypes?.length ? ` (${source.eventTypes.join(', ')})` : ''}`
  }
  if (source.type === 'run-completed') {
    const whose = source.agentId ? ' by this agent' : ''
    const named = source.titleMatch ? ` named like “${source.titleMatch}”` : ''
    return `When a run${named}${whose} ${source.status ?? 'finishes'}`
  }
  if (source.schedule.kind === 'interval') return `Every ${source.schedule.every} ${source.schedule.unit}`
  if (source.schedule.kind === 'once') return `Once at ${formattedDateMedium(new Date(source.schedule.runAt))}`
  return `${source.schedule.daysOfWeek.map(dayName).join(', ')} at ${source.schedule.timeOfDay} ${
    source.schedule.timezone
  }`
}

// ---------------------------------------------------------------------------
// Configuration form
// ---------------------------------------------------------------------------

export function TriggerSourceFields({
  source,
  onChange,
  trailing,
  lockSourceType = false,
  allowWebhook = true,
}: {
  source: AgentTriggerSource
  onChange: (source: AgentTriggerSource) => void
  trailing?: React.ReactNode
  lockSourceType?: boolean
  allowWebhook?: boolean
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <SizableText size="sm" weight="bold">
            Trigger Session on:
          </SizableText>
          <SelectDropdown
            options={
              allowWebhook || source.type === 'webhook'
                ? TRIGGER_TYPE_OPTIONS
                : TRIGGER_TYPE_OPTIONS.filter((option) => option.value !== 'webhook')
            }
            value={source.type}
            onValue={(value) => onChange(defaultSourceForType(value as AgentTriggerSource['type']))}
            disabled={lockSourceType}
          />
        </label>
        {trailing}
      </div>
      {source.type === 'document-comment' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <DocumentAutocompleteField
            label="Document"
            value={source.resource}
            onChange={(value) => onChange({...source, resource: value})}
            placeholder="Search documents or enter hm:// URL"
          />
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Author filter
            </SizableText>
            <Input
              value={source.author || ''}
              onChange={(event) => onChange({...source, author: event.target.value || undefined})}
              placeholder="optional account ID"
            />
          </label>
        </div>
      ) : null}
      {source.type === 'user-mention' ? (
        <div className="grid gap-3">
          <MentionedAccountsField
            accounts={mentionedAccountsOf(source)}
            onChange={(accounts) => onChange({...source, mentionedAccounts: accounts})}
          />
        </div>
      ) : null}
      {source.type === 'site-update' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <AccountAutocompleteField
            label="Resource/space prefix"
            value={source.resourcePrefix}
            onChange={(value) => onChange({...source, resourcePrefix: value})}
            placeholder="Search space/account or enter hm:// prefix"
            valueFormat="hm-url"
          />
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Event types
            </SizableText>
            <Input
              value={(source.eventTypes || []).join(', ')}
              onChange={(event) =>
                onChange({
                  ...source,
                  eventTypes: event.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
              placeholder="doc-update, comment"
            />
          </label>
        </div>
      ) : null}
      {source.type === 'schedule' ? <ScheduleTriggerFields source={source} onChange={onChange} /> : null}
      {source.type === 'webhook' ? (
        <SizableText size="sm" color="muted">
          Creates a private HTTP endpoint. The secret webhook URL is shown once after creation.
        </SizableText>
      ) : null}
    </div>
  )
}

function ScheduleTriggerFields({
  source,
  onChange,
}: {
  source: Extract<AgentTriggerSource, {type: 'schedule'}>
  onChange: (source: AgentTriggerSource) => void
}) {
  const schedule = source.schedule
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const setSchedule = (next: Extract<AgentTriggerSource, {type: 'schedule'}>['schedule']) =>
    onChange({type: 'schedule', schedule: next})
  return (
    <div className="grid gap-3">
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Schedule mode
        </SizableText>
        <SelectDropdown
          options={SCHEDULE_MODE_OPTIONS}
          value={schedule.kind}
          onValue={(kind) => {
            if (kind === 'weekly') setSchedule({kind, daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: '09:00', timezone})
            else if (kind === 'once') setSchedule({kind, runAt: Date.now() + 60 * 60 * 1000, timezone})
            else setSchedule({kind: 'interval', every: 1, unit: 'hours'})
          }}
        />
      </label>
      {schedule.kind === 'interval' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Every
            </SizableText>
            <Input
              type="number"
              min={1}
              value={schedule.every}
              onChange={(event) => setSchedule({...schedule, every: Number(event.target.value) || 1})}
            />
          </label>
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Unit
            </SizableText>
            <SelectDropdown
              options={SCHEDULE_UNIT_OPTIONS}
              value={schedule.unit}
              onValue={(value) => setSchedule({...schedule, unit: value as 'minutes' | 'hours'})}
            />
          </label>
        </div>
      ) : null}
      {schedule.kind === 'weekly' ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {[
              ['Mon', 1],
              ['Tue', 2],
              ['Wed', 3],
              ['Thu', 4],
              ['Fri', 5],
              ['Sat', 6],
              ['Sun', 0],
            ].map(([day, dayIndex]) => (
              <label key={day} className="border-border flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={schedule.daysOfWeek.includes(dayIndex as number)}
                  onChange={(event) => {
                    const dayNumber = dayIndex as number
                    const daysOfWeek = event.target.checked
                      ? [...schedule.daysOfWeek, dayNumber].sort()
                      : schedule.daysOfWeek.filter((item) => item !== dayNumber)
                    setSchedule({...schedule, daysOfWeek})
                  }}
                />
                {day}
              </label>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <SizableText size="sm" weight="bold">
                Time of day
              </SizableText>
              <Input
                type="time"
                value={schedule.timeOfDay}
                onChange={(event) => setSchedule({...schedule, timeOfDay: event.target.value})}
              />
            </label>
            <label className="flex flex-col gap-1">
              <SizableText size="sm" weight="bold">
                Timezone
              </SizableText>
              <Input
                value={schedule.timezone}
                onChange={(event) => setSchedule({...schedule, timezone: event.target.value})}
              />
            </label>
          </div>
        </div>
      ) : null}
      {schedule.kind === 'once' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Date and time
            </SizableText>
            <Input
              type="datetime-local"
              value={dateTimeLocalValue(schedule.runAt)}
              onChange={(event) => setSchedule({...schedule, runAt: new Date(event.target.value).getTime(), timezone})}
            />
          </label>
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Timezone
            </SizableText>
            <Input
              value={schedule.timezone || timezone}
              onChange={(event) => setSchedule({...schedule, timezone: event.target.value})}
            />
          </label>
        </div>
      ) : null}
    </div>
  )
}

function DocumentAutocompleteField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [focused, setFocused] = useState(false)
  const search = useSearch(value, {
    enabled: focused && value.trim().length > 0,
    pageSize: 12,
  })
  const documents = useMemo(
    () => (search.data?.entities || []).filter((item) => item.type === 'document').slice(0, 8),
    [search.data?.entities],
  )

  return (
    <label className="relative flex flex-col gap-1">
      <SizableText size="sm" weight="bold">
        {label}
      </SizableText>
      <Input
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {focused && documents.length ? (
        <div className="border-border bg-popover absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border p-1 shadow-lg">
          {documents.map((document) => {
            const nextValue = packHmId(document.id)
            return (
              <button
                key={document.id.id}
                type="button"
                className="hover:bg-muted flex w-full flex-col rounded px-2 py-2 text-left"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(nextValue)
                  setFocused(false)
                }}
              >
                <SizableText size="sm" weight="bold" className="truncate">
                  {document.title || nextValue}
                </SizableText>
                <SizableText size="xs" color="muted" className="truncate font-mono">
                  {nextValue}
                </SizableText>
              </button>
            )
          })}
        </div>
      ) : null}
    </label>
  )
}

function AccountAutocompleteField({
  label,
  value,
  onChange,
  placeholder,
  valueFormat,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  valueFormat: 'uid' | 'hm-url'
}) {
  const [focused, setFocused] = useState(false)
  const search = useSearch(value, {
    enabled: focused && value.trim().length > 0,
    pageSize: 12,
  })
  const accounts = useMemo(
    () => (search.data?.entities || []).filter((item) => item.type === 'contact' || !item.id.path?.length).slice(0, 8),
    [search.data?.entities],
  )

  return (
    <label className="relative flex flex-col gap-1">
      <SizableText size="sm" weight="bold">
        {label}
      </SizableText>
      <Input
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {focused && accounts.length ? (
        <div className="border-border bg-popover absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border p-1 shadow-lg">
          {accounts.map((account) => {
            const nextValue = valueFormat === 'hm-url' ? `hm://${account.id.uid}` : account.id.uid
            return (
              <button
                key={`${account.id.id}:${account.type}`}
                type="button"
                className="hover:bg-muted flex w-full flex-col rounded px-2 py-2 text-left"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(nextValue)
                  setFocused(false)
                }}
              >
                <SizableText size="sm" weight="bold" className="truncate">
                  {account.title || account.id.uid}
                </SizableText>
                <SizableText size="xs" color="muted" className="truncate font-mono">
                  {nextValue}
                </SizableText>
              </button>
            )
          })}
        </div>
      ) : null}
    </label>
  )
}

function MentionedAccountsField({accounts, onChange}: {accounts: string[]; onChange: (accounts: string[]) => void}) {
  const accountsKey = accounts.join('|')
  const values = useMemo<SearchResult[]>(
    () => accounts.map((uid) => ({id: hmId(uid), label: abbreviateUid(uid), unresolved: true})),
    // accountsKey captures the contents of `accounts` for memoization
    [accountsKey],
  )
  return (
    <div className="flex flex-col gap-1">
      <SizableText size="sm" weight="bold">
        Mentioned accounts
      </SizableText>
      <div className="border-border bg-input flex min-h-9 items-center overflow-hidden rounded-md border">
        <AccountSearchInput
          label="Mentioned accounts"
          placeholder="Search or paste accounts"
          values={values}
          onValuesChange={(next) => onChange(next.map((value) => value.id.uid))}
        />
      </div>
    </div>
  )
}

function dateTimeLocalValue(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const offsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function dayName(day: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] || String(day)
}

// ---------------------------------------------------------------------------
// Triggered-session context rendering
// ---------------------------------------------------------------------------

/** Resolves the in-app route that opens the comment, document, or activity that fired a trigger. */
export function getTriggerActivityRoute(context: AgentSessionTriggerContext): NavRoute | null {
  // The stored activity is a resolved LoadedEvent (the shape `/api/ListEvents` returns), so reuse the
  // activity feed's own routing. This links to the exact comment, the document where a mention was made,
  // or the document at the specific version that fired the trigger.
  const resolvedRoute = getEventRoute(context.activity as unknown as LoadedEvent)
  if (resolvedRoute) return resolvedRoute

  // Raw ActivityFeed events (`newBlob`) used by tests and callers that bypass the resolving endpoint.
  const blob = recordField(context.activity, 'newBlob')
  if (blob) {
    const blobType = stringField(blob, 'blobType') || stringField(blob, 'blob_type')
    const resource = stringField(blob, 'resource')
    const resourceId = resource ? unpackHmId(resource) : null
    if (blobType === 'Comment' && resourceId) {
      return {key: 'comments', id: resourceId, openComment: stringField(blob, 'blobId') || stringField(blob, 'blob_id')}
    }
    if ((blobType === 'Ref' || blobType === 'Change') && resourceId) {
      return {key: 'document', id: resourceId}
    }
  }

  // Last resort: fall back to the configured trigger source location.
  if (context.source.type === 'document-comment') {
    const id = unpackHmId(context.source.resource)
    return id ? {key: 'comments', id} : null
  }
  if (context.source.type === 'site-update') {
    const id = unpackHmId(context.source.resourcePrefix)
    return id ? {key: 'activity', id} : null
  }
  return null
}

const TRIGGER_TYPE_ICONS: Record<AgentTriggerSource['type'], React.ComponentType<{className?: string}>> = {
  'document-comment': MessageSquare,
  'user-mention': AtSign,
  'site-update': FileText,
  schedule: CalendarClock,
  'run-completed': Workflow,
  webhook: Webhook,
}

/**
 * Friendly card shown at the top of a triggered session in place of the raw `<trigger_context>` /
 * `<trigger_instructions>` text. The headline and icon depend on the trigger type; the full activity
 * payload that was sent to the model stays available behind the collapsible details.
 */
export function TriggerContextView({
  context,
  instructions,
  serverUrl,
  agentId,
}: {
  context: AgentSessionTriggerContext
  instructions?: string
  serverUrl: string
  agentId?: string
}) {
  const navigate = useNavigate()
  const Icon = TRIGGER_TYPE_ICONS[context.source.type]
  const activityRoute = useMemo(() => getTriggerActivityRoute(context), [context])
  const triggerRoute: NavRoute | null = agentId
    ? {key: 'agent', agentId, serverUrl, tab: 'triggers', triggerId: context.triggerId}
    : null

  return (
    <div className="bg-muted/40 mr-6 ml-6 rounded-lg border px-3 py-2 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <span className="shrink-0">Triggered by</span>
        <ContextLink
          route={triggerRoute}
          onNavigate={navigate}
          title="Open this trigger"
          className="shrink-0 font-medium"
        >
          {context.triggerName}
        </ContextLink>
        <ContextLink
          route={activityRoute}
          onNavigate={navigate}
          title="Open the comment, document, or update that started this session"
          className="text-muted-foreground min-w-0 truncate"
        >
          {context.activitySummary}
        </ContextLink>
      </div>
      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span>{summarizeTriggerSource(context.source)}</span>
        <span>Fired {formattedDateMedium(new Date(context.firedAt))}</span>
        {context.status && context.status !== 'fired' ? <span>Status: {context.status}</span> : null}
      </div>
      {context.error ? (
        <Notice size="sm" title="Trigger error" className="mt-2">
          {context.error}
        </Notice>
      ) : null}
      <TriggerDisclosure label="Activity details">
        <pre className="bg-background/60 text-foreground max-h-72 overflow-auto rounded-md border p-2 text-[11px] whitespace-pre-wrap">
          {JSON.stringify(context.activity, null, 2)}
        </pre>
      </TriggerDisclosure>
      {instructions ? (
        <TriggerDisclosure label="Trigger instructions">
          <p className="bg-background/60 text-foreground rounded-md border p-2 text-[11px] whitespace-pre-wrap">
            {instructions}
          </p>
        </TriggerDisclosure>
      ) : null}
    </div>
  )
}

/** Renders text that navigates to `route` when present, or plain text when there is nowhere to link. */
function ContextLink({
  route,
  onNavigate,
  title,
  className,
  children,
}: {
  route: NavRoute | null
  onNavigate: (route: NavRoute) => void
  title: string
  className?: string
  children: React.ReactNode
}) {
  if (!route) return <span className={className}>{children}</span>
  return (
    <button
      type="button"
      title={title}
      onClick={() => onNavigate(route)}
      className={`hover:text-foreground text-left hover:underline ${className ?? ''}`}
    >
      {children}
    </button>
  )
}

/** Inline collapsible row used for the trigger card's "Activity details" / "Trigger instructions" sections. */
function TriggerDisclosure({label, children}: {label: string; children: React.ReactNode}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="text-muted-foreground hover:text-foreground mt-1.5 flex items-center gap-1"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
      </button>
      {open ? <div className="mt-1.5">{children}</div> : null}
    </>
  )
}

function recordField(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' ? (field as Record<string, unknown>) : null
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field ? field : undefined
}

// ---------------------------------------------------------------------------------------------
// Continuations: what a firing does. `newThread` (the default) hands every firing to a model;
// `tool` and `script` run code with no model involved, optionally escalating to a session on failure.
// ---------------------------------------------------------------------------------------------

type ContinuationKind = TriggerContinuation['kind']

const CONTINUATION_KIND_OPTIONS: Array<{value: ContinuationKind; label: string}> = [
  {value: 'newThread', label: 'Start a thread (model handles it)'},
  {value: 'tool', label: 'Call a tool (no model)'},
  {value: 'script', label: 'Run a script (no model)'},
  {value: 'wake', label: 'Wake a parked run'},
]

const DEFAULT_TRIGGER_SCRIPT = `export default async function (input, ctx) {
  // input = {event, input, trigger}. A webhook's JSON body is input.event.payload.
  const result = await ctx.call('read', {address: '~/triggers/'}, {description: 'Example: read the trigger list'})
  // Bring a model in only when something needs judgment:
  // if (result.problem) return ctx.delegate({title: 'Look into this', brief: JSON.stringify(result)})
  return result
}
`

export function defaultContinuationForKind(
  kind: ContinuationKind,
  previous?: TriggerContinuation,
): TriggerContinuation {
  const onFailure = previous && 'onFailure' in previous && previous.onFailure ? {onFailure: previous.onFailure} : {}
  switch (kind) {
    case 'newThread':
      return {kind: 'newThread'}
    case 'wake':
      return {kind: 'wake', signal: previous?.kind === 'wake' ? previous.signal : 'answer'}
    case 'tool':
      return {kind: 'tool', tool: previous?.kind === 'tool' ? previous.tool : '', ...onFailure}
    case 'script':
      return {
        kind: 'script',
        script: previous?.kind === 'script' ? previous.script : DEFAULT_TRIGGER_SCRIPT,
        ...onFailure,
      }
  }
}

/** One line for a trigger's page and list: what happens when it fires. */
export function summarizeTriggerContinuation(continuation: TriggerContinuation | undefined): string {
  if (!continuation || continuation.kind === 'newThread') return 'Starts a session from the prompt'
  if (continuation.kind === 'wake') return `Wakes a parked run with signal "${continuation.signal}"`
  const escalates = continuation.onFailure === 'thread' ? '; starts a session from the prompt if it fails' : ''
  if (continuation.kind === 'tool') return `Calls tool "${continuation.tool || '…'}" with no model${escalates}`
  return `Runs a script with no model${escalates}`
}

/**
 * Whether a trigger's prompt has any role: it starts every thread of a `newThread` trigger, and is
 * the recovery session's opener for a headless one that escalates on failure. A headless trigger
 * that does not escalate never uses it, so nothing about it is shown.
 */
export function triggerUsesPrompt(continuation: TriggerContinuation | undefined): boolean {
  return !isHeadlessContinuation(continuation) || continuation.onFailure === 'thread'
}

/** True when the continuation runs without a model unless something fails. */
export function isHeadlessContinuation(
  continuation: TriggerContinuation | undefined,
): continuation is Extract<TriggerContinuation, {kind: 'tool' | 'script'}> {
  return continuation?.kind === 'tool' || continuation?.kind === 'script'
}

/**
 * Edits a trigger's continuation. JSON fields keep their own draft text so a half-typed value never
 * clobbers the saved one: only parseable JSON propagates.
 */
export function TriggerContinuationFields({
  continuation,
  onChange,
  tools,
  disabled = false,
}: {
  continuation: TriggerContinuation | undefined
  onChange: (continuation: TriggerContinuation) => void
  /** The agent's tools, for the tool picker; undefined while loading. */
  tools: AgentToolInfo[] | undefined
  disabled?: boolean
}) {
  const current: TriggerContinuation = continuation ?? {kind: 'newThread'}
  const toolOptions = useMemo(() => {
    const names = new Set<string>(['read', 'write'])
    for (const tool of tools ?? []) names.add(tool.name)
    if (current.kind === 'tool' && current.tool) names.add(current.tool)
    return Array.from(names)
      .sort()
      .map((name) => {
        const info = tools?.find((tool) => tool.name === name)
        const kind = name === 'read' || name === 'write' ? 'verb' : info?.kind ?? 'tool'
        return {value: name, label: `${name} · ${kind}`}
      })
  }, [tools, current])
  return (
    <div className="grid gap-3">
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          When it fires:
        </SizableText>
        <SelectDropdown
          options={CONTINUATION_KIND_OPTIONS}
          value={current.kind}
          onValue={(value) => onChange(defaultContinuationForKind(value as ContinuationKind, current))}
          disabled={disabled}
        />
      </label>
      {current.kind === 'tool' ? (
        <>
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Tool
            </SizableText>
            <SelectDropdown
              options={toolOptions}
              value={current.tool}
              placeholder="Choose a tool"
              onValue={(value) => onChange({...current, tool: value})}
              disabled={disabled}
            />
            <SizableText size="xs" color="muted">
              Any of the agent&apos;s tools, including ones it authored under ~/tools. The call runs with no model.
            </SizableText>
          </label>
          <JsonTemplateField
            label="Tool input"
            value={current.input}
            placeholder={'{"payload": "$event.payload"}'}
            hint={
              'JSON handed to the tool. Leave empty to pass the whole trigger event. Strings "$event" and "$event.<path>" are replaced from the event; a webhook body is "$event.payload".'
            }
            onChange={(input) => onChange(input === undefined ? {...current, input: undefined} : {...current, input})}
            disabled={disabled}
          />
        </>
      ) : null}
      {current.kind === 'script' ? (
        <>
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Script
            </SizableText>
            <Textarea
              className="min-h-56 font-mono text-xs"
              value={current.script}
              onChange={(event) => onChange({...current, script: event.target.value})}
              disabled={disabled}
              spellCheck={false}
            />
            <SizableText size="xs" color="muted">
              A workflow module: <code>export default async function (input, ctx)</code> with{' '}
              <code>input = {'{event, input, trigger}'}</code>. Use <code>ctx.call</code> for tools,{' '}
              <code>ctx.delegate</code> to bring in a model only when needed, <code>ctx.waitForEvent</code> to pause for
              a person. No imports, Date, Math.random, or fetch.
            </SizableText>
          </label>
          <JsonTemplateField
            label="Script input"
            value={current.input}
            placeholder={'{"threshold": 3}'}
            hint="Optional JSON the script receives as input.input, alongside the event."
            onChange={(input) => onChange(input === undefined ? {...current, input: undefined} : {...current, input})}
            disabled={disabled}
          />
        </>
      ) : null}
      {current.kind === 'wake' ? (
        <label className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            Signal
          </SizableText>
          <Input
            value={current.signal}
            onChange={(event) => onChange({...current, signal: event.target.value})}
            disabled={disabled}
          />
          <SizableText size="xs" color="muted">
            Delivered to a run parked on <code>ctx.waitForEvent({'{signal}'})</code>; the event is its payload.
          </SizableText>
        </label>
      ) : null}
      {current.kind === 'tool' || current.kind === 'script' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.onFailure === 'thread'}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? {...current, onFailure: 'thread'}
                  : (({onFailure: _omit, ...rest}) => rest)(current),
              )
            }
          />
          If it fails, start a session from the prompt so a model can recover
        </label>
      ) : null}
    </div>
  )
}

function JsonTemplateField({
  label,
  value,
  placeholder,
  hint,
  onChange,
  disabled,
}: {
  label: string
  value: unknown
  placeholder: string
  hint: string
  onChange: (value: unknown | undefined) => void
  disabled: boolean
}) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)))
  const [error, setError] = useState<string | null>(null)
  // Adopt an outside change (a different trigger loaded) unless the draft is what produced it.
  useEffect(() => {
    const serialized = value === undefined ? '' : JSON.stringify(value, null, 2)
    let draftValue: unknown = undefined
    try {
      draftValue = text.trim() ? JSON.parse(text) : undefined
    } catch {
      return
    }
    if (JSON.stringify(draftValue) !== JSON.stringify(value)) setText(serialized)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <label className="flex flex-col gap-1">
      <SizableText size="sm" weight="bold">
        {label}
      </SizableText>
      <Textarea
        className="min-h-20 font-mono text-xs"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          if (!next.trim()) {
            setError(null)
            onChange(undefined)
            return
          }
          try {
            onChange(JSON.parse(next))
            setError(null)
          } catch {
            setError('Not valid JSON yet — the last valid value is kept.')
          }
        }}
      />
      <SizableText size="xs" color={error ? undefined : 'muted'} className={error ? 'text-destructive' : undefined}>
        {error ?? hint}
      </SizableText>
    </label>
  )
}
