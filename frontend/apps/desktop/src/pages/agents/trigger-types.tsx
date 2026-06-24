import {type AgentSessionTriggerContext, type AgentTriggerSource} from '@/agents-client'
import {useNavigate} from '@/utils/useNavigate'
import {AccountSearchInput, type SearchResult} from '@shm/ui/collaborators-page'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import type {LoadedEvent} from '@shm/shared/models/activity-service'
import {useSearch} from '@shm/shared/models/search'
import type {NavRoute} from '@shm/shared/routes'
import {getEventRoute} from '@shm/ui/feed'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {hmId, packHmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {AtSign, CalendarClock, ChevronDown, ChevronRight, FileText, MessageSquare} from 'lucide-react'
import React, {useMemo, useState} from 'react'

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
  {value: 'site-update', label: 'Site update'},
  {value: 'schedule', label: 'Schedule'},
]

export function defaultSourceForType(type: AgentTriggerSource['type']): AgentTriggerSource {
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
}: {
  source: AgentTriggerSource
  onChange: (source: AgentTriggerSource) => void
}) {
  return (
    <div className="grid gap-3">
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Trigger Session on:
        </SizableText>
        <select
          className="border-border bg-input rounded-md border px-3 py-2 text-sm"
          value={source.type}
          onChange={(event) => onChange(defaultSourceForType(event.target.value as AgentTriggerSource['type']))}
        >
          {TRIGGER_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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
            label="Resource/site prefix"
            value={source.resourcePrefix}
            onChange={(value) => onChange({...source, resourcePrefix: value})}
            placeholder="Search site/account or enter hm:// prefix"
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
        <select
          className="border-border bg-input rounded-md border px-3 py-2 text-sm"
          value={schedule.kind}
          onChange={(event) => {
            const kind = event.target.value
            if (kind === 'weekly') setSchedule({kind, daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: '09:00', timezone})
            else if (kind === 'once') setSchedule({kind, runAt: Date.now() + 60 * 60 * 1000, timezone})
            else setSchedule({kind: 'interval', every: 1, unit: 'hours'})
          }}
        >
          <option value="interval">Every interval</option>
          <option value="weekly">Days of week</option>
          <option value="once">One time</option>
        </select>
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
            <select
              className="border-border bg-input rounded-md border px-3 py-2 text-sm"
              value={schedule.unit}
              onChange={(event) => setSchedule({...schedule, unit: event.target.value as 'minutes' | 'hours'})}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
            </select>
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
      {context.error ? <div className="text-destructive mt-1">{context.error}</div> : null}
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
