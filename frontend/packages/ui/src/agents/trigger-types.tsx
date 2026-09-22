import {type AgentSessionTriggerContext, type AgentTriggerSource, type TriggerContinuation} from './client'
import {activityConditions, type AgentActivitySource, type AgentToolInfo} from '@seed-hypermedia/agents-protocol'
import {Button} from '@shm/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogTitle} from '@shm/ui/components/dialog'
import {Textarea} from '@shm/ui/components/textarea'
import {useNavigate} from './navigation'
import {useAccount, useResource, useSelectedAccountId} from '@shm/shared/models/entity'
import {useInlineMentions} from '@shm/shared/models/inline-mentions'
import {mentionCandidateSubtitle} from '@shm/shared/models/mention-ranking'
import {Input} from '@shm/ui/components/input'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Notice} from '@shm/ui/notice'
import {SizableText} from '@shm/ui/text'
import type {LoadedEvent} from '@shm/shared/models/activity-service'
import {useSearch} from '@shm/shared/models/search'
import {EntityKindFilter} from '@shm/shared/client/.generated/entities/v1alpha/entities_pb'
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
  Pencil,
  Reply,
  Plus,
  X,
  Webhook,
  Workflow,
} from 'lucide-react'
import React, {createContext, useCallback, useContext, useEffect, useId, useMemo, useState} from 'react'

/**
 * Canonical per-trigger-type frontend definitions.
 *
 * Each trigger type (`AgentTriggerSource['type']`) keeps its option label, default config, summary,
 * configuration form, and triggered-session context rendering in one place so the four trigger types
 * stay in sync. The session UI renders {@link TriggerContextView} instead of the raw `<trigger_context>`
 * block that is sent to the model.
 */

export const TRIGGER_TYPE_OPTIONS: {value: string; label: string}[] = [
  {value: 'document-comment', label: 'Comment posted'},
  {value: 'user-mention', label: 'User mention'},
  {value: 'comment-reply', label: 'Reply to account'},
  {value: 'document-author-comment', label: "Comment on account's document"},
  {value: 'site-event:doc-update', label: 'Document updated'},
  {value: 'site-event:citation', label: 'Reference added'},
  {value: 'site-event:capability', label: 'Access granted'},
  {value: 'site-event:contact', label: 'Contact updated'},
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
  if (type === 'comment-reply') return {type, repliedToAccounts: []}
  if (type === 'document-author-comment') return {type, documentAuthors: []}
  if (type === 'site-update') return {type, resourcePrefix: '', eventTypes: ['doc-update']}
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
  if (source.type === 'activity')
    return source.conditions.map(({source}) => summarizeTriggerSource(source)).join(' OR ')
  if (source.type === 'webhook') return 'Incoming webhook request'
  if (source.type === 'document-comment') {
    return `Comment in ${source.resource}${source.author ? ` by ${source.author}` : ''}`
  }
  if (source.type === 'user-mention') {
    const accounts = mentionedAccountsOf(source)
    const mention = accounts.length ? accounts.map(abbreviateUid).join(', ') : 'anyone'
    return `Mention of ${mention}${source.resourcePrefix ? ` in ${source.resourcePrefix}` : ''}`
  }
  if (source.type === 'comment-reply') {
    const accounts = source.repliedToAccounts.map(abbreviateUid).join(', ')
    return `Reply to ${accounts}${source.resourcePrefix ? ` in ${source.resourcePrefix}` : ''}`
  }
  if (source.type === 'document-author-comment') {
    const accounts = source.documentAuthors.map(abbreviateUid).join(', ')
    return `Comment on a document by ${accounts}${source.resourcePrefix ? ` in ${source.resourcePrefix}` : ''}`
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

/** Whether a source has enough configuration to commit from the editor. */
export function isTriggerSourceReady(source: AgentTriggerSource): boolean {
  if (source.type === 'activity')
    return source.conditions.length > 0 && source.conditions.every(({source}) => isTriggerSourceReady(source))
  if (source.type === 'document-comment') return isTriggerResource(source.resource)
  if (source.type === 'user-mention')
    return (
      mentionedAccountsOf(source).some((account) => account.trim()) &&
      (!source.resourcePrefix || isTriggerResource(source.resourcePrefix))
    )
  if (source.type === 'comment-reply')
    return (
      source.repliedToAccounts.some((account) => account.trim()) &&
      (!source.resourcePrefix || isTriggerResource(source.resourcePrefix))
    )
  if (source.type === 'document-author-comment')
    return (
      source.documentAuthors.some((account) => account.trim()) &&
      (!source.resourcePrefix || isTriggerResource(source.resourcePrefix))
    )
  if (source.type === 'site-update') return isTriggerResource(source.resourcePrefix)
  return true
}

const PendingConditionFields = createContext<(id: string, pending: boolean) => void>(() => {})

// Project old multi-event filters without writing on read or changing their matching semantics.
function editableActivityConditions(source: AgentTriggerSource) {
  const conditions = activityConditions(source)
  const ids = new Set(conditions.map(({id}) => id))
  return conditions.flatMap((condition) => {
    const source = condition.source
    if (source.type !== 'site-update' || !source.eventTypes?.length) return [condition]
    return source.eventTypes.map((eventType, index) => {
      let id = condition.id
      if (index) {
        id = `${condition.id}:event:${index}`
        while (ids.has(id)) id += ':split'
        ids.add(id)
      }
      return {id, source: {...source, eventTypes: [eventType]}}
    })
  })
}

function siteEventLabel(eventType?: string) {
  if (!eventType) return 'Any activity'
  const labels: Record<string, string> = {
    'doc-update': 'Document updated',
    'document-update': 'Document updated',
    ref: 'Document updated',
    change: 'Document updated',
    comment: 'Comment posted',
    citation: 'Reference added',
    capability: 'Access granted',
    contact: 'Contact updated',
  }
  return labels[eventType.toLowerCase()] || `${eventType} event`
}

/**
 * Edits what starts a trigger. A lone condition edits in place like any other source; several
 * conditions list as summaries, any of which fires the shared action. Adding or editing a condition
 * opens a dialog, and nothing is committed until it is saved.
 */
export function TriggerSourceFields({
  source,
  onChange,
  trailing,
  lockSourceType = false,
  allowWebhook = true,
  onDraftChange,
}: {
  source: AgentTriggerSource
  onChange: (source: AgentTriggerSource) => void
  trailing?: React.ReactNode
  lockSourceType?: boolean
  allowWebhook?: boolean
  onDraftChange?: (editing: boolean) => void
}) {
  const conditions = editableActivityConditions(source)
  const [editing, setEditing] = useState<{id: string; draft: AgentActivitySource; isNew: boolean} | null>(null)
  const [pendingFields, setPendingFields] = useState<Set<string>>(() => new Set())
  const onPendingField = useCallback((id: string, pending: boolean) => {
    setPendingFields((previous) => {
      if (previous.has(id) === pending) return previous
      const next = new Set(previous)
      if (pending) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const isEditing = editing !== null
  useEffect(() => onDraftChange?.(isEditing), [isEditing, onDraftChange])

  const addButton =
    conditions.length && conditions.length < 32 ? (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground justify-self-start"
        disabled={isEditing || !isTriggerSourceReady(source)}
        onClick={() =>
          setEditing({id: crypto.randomUUID(), draft: {type: 'document-comment', resource: ''}, isNew: true})
        }
      >
        <Plus className="size-3.5" />
        Add condition
      </Button>
    ) : null

  function save() {
    if (!editing || !isTriggerSourceReady(editing.draft) || pendingFields.size) return
    const next = editing.isNew
      ? [...conditions, {id: editing.id, source: editing.draft}]
      : conditions.map((condition) => (condition.id === editing.id ? {...condition, source: editing.draft} : condition))
    onChange({type: 'activity', conditions: next})
    setEditing(null)
  }

  // Adding or editing one of several conditions happens in a dialog; the list keeps showing what is saved.
  const dialog = (
    <Dialog
      open={isEditing}
      onOpenChange={(open) => {
        if (!open) setEditing(null)
      }}
    >
      <DialogContent
        contentClassName="gap-5 p-6"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          // Escape first closes an open search list; only a second press dismisses the dialog.
          if (event.target instanceof HTMLInputElement && event.target.getAttribute('aria-expanded') === 'true') {
            event.preventDefault()
          }
        }}
      >
        <DialogTitle>{editing?.isNew ? 'Add condition' : 'Edit condition'}</DialogTitle>
        {editing ? (
          <PendingConditionFields.Provider value={onPendingField}>
            <SingleTriggerSourceFields
              key={editing.id}
              source={editing.draft}
              activityOnly
              onChange={(draft) => setEditing({...editing, draft: draft as AgentActivitySource})}
            />
          </PendingConditionFields.Provider>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!editing || !isTriggerSourceReady(editing.draft) || pendingFields.size > 0}>
            {editing?.isNew ? 'Add condition' : 'Save condition'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  if (conditions.length <= 1) {
    const only = conditions[0]
    return (
      <div className="grid gap-2">
        <SingleTriggerSourceFields
          source={only?.source ?? source}
          trailing={trailing}
          lockSourceType={lockSourceType}
          allowWebhook={allowWebhook}
          onChange={(next) => {
            // A compound trigger trimmed to one condition keeps that condition's identity.
            if (source.type === 'activity' && only && activityConditions(next).length) {
              onChange({type: 'activity', conditions: [{id: only.id, source: next as AgentActivitySource}]})
            } else onChange(next)
          }}
        />
        {addButton}
        {dialog}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-end justify-between gap-3">
        <SizableText size="sm" weight="bold">
          When any of these happen
        </SizableText>
        {trailing}
      </div>
      <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
        {conditions.map((condition) => {
          const Icon =
            condition.source.type === 'site-update' && condition.source.eventTypes?.[0] === 'comment'
              ? MessageSquare
              : TRIGGER_TYPE_ICONS[condition.source.type]
          return (
            <div key={condition.id} className="flex items-center gap-3 py-1 pr-1 pl-3">
              <Icon className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1 py-1.5 text-sm break-words">
                <TriggerSourceSummary source={condition.source} />
              </span>
              <Button
                variant="ghost"
                size="iconSm"
                className="text-muted-foreground hover:text-foreground"
                title="Edit condition"
                disabled={isEditing}
                onClick={() => setEditing({id: condition.id, draft: condition.source, isNew: false})}
              >
                <Pencil className="size-3.5" />
                <span className="sr-only">Edit</span>
              </Button>
              <Button
                variant="ghost"
                size="iconSm"
                className="text-muted-foreground hover:text-destructive"
                title="Remove condition"
                disabled={isEditing || conditions.length < 2}
                onClick={() =>
                  onChange({type: 'activity', conditions: conditions.filter(({id}) => id !== condition.id)})
                }
              >
                <X className="size-3.5" />
                <span className="sr-only">Remove</span>
              </Button>
            </div>
          )
        })}
      </div>
      {addButton}
      {dialog}
    </div>
  )
}

function SingleTriggerSourceFields({
  source,
  onChange,
  trailing,
  lockSourceType = false,
  allowWebhook = true,
  activityOnly = false,
}: {
  source: AgentTriggerSource
  onChange: (source: AgentTriggerSource) => void
  trailing?: React.ReactNode
  lockSourceType?: boolean
  allowWebhook?: boolean
  activityOnly?: boolean
}) {
  const conditionType =
    source.type === 'site-update'
      ? source.eventTypes?.[0] === 'comment'
        ? 'document-comment'
        : `site-event:${source.eventTypes?.[0] ?? 'any'}`
      : source.type
  const options = TRIGGER_TYPE_OPTIONS.filter((option) =>
    activityOnly
      ? !['schedule', 'webhook'].includes(option.value)
      : allowWebhook || source.type === 'webhook' || option.value !== 'webhook',
  )
  if (source.type === 'site-update' && !options.some(({value}) => value === conditionType)) {
    options.push({value: conditionType, label: siteEventLabel(source.eventTypes?.[0])})
  }
  if (source.type === 'run-completed') options.push({value: conditionType, label: 'Run completed'})
  return (
    <div className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <SizableText size="sm" weight="bold">
            {activityOnly ? 'Event' : 'When'}
          </SizableText>
          <SelectDropdown
            options={options}
            className="h-10 rounded-lg shadow-none"
            value={conditionType}
            onValue={(value) => {
              const resource =
                source.type === 'document-comment'
                  ? source.resource
                  : source.type === 'site-update' ||
                      source.type === 'user-mention' ||
                      source.type === 'comment-reply' ||
                      source.type === 'document-author-comment'
                    ? source.resourcePrefix ?? ''
                    : ''
              // Mentions, replies, and comments on documents all target accounts, so switching between
              // them keeps who and where.
              const accounts =
                source.type === 'user-mention'
                  ? mentionedAccountsOf(source)
                  : source.type === 'comment-reply'
                    ? source.repliedToAccounts
                    : source.type === 'document-author-comment'
                      ? source.documentAuthors
                      : null
              const scope = resource ? {resourcePrefix: resource} : {}
              if (value === 'user-mention' && accounts) {
                onChange({type: 'user-mention', mentionedAccounts: accounts, ...scope})
              } else if (value === 'comment-reply' && accounts) {
                onChange({type: 'comment-reply', repliedToAccounts: accounts, ...scope})
              } else if (value === 'document-author-comment' && accounts) {
                onChange({type: 'document-author-comment', documentAuthors: accounts, ...scope})
              } else if (value.startsWith('site-event:')) {
                onChange({
                  type: 'site-update',
                  resourcePrefix: resource,
                  eventTypes: [value.slice('site-event:'.length)],
                })
              } else if (value === 'document-comment') {
                onChange({type: 'document-comment', resource})
              } else onChange(defaultSourceForType(value as AgentTriggerSource['type']))
            }}
            disabled={lockSourceType}
          />
        </label>
        {trailing}
      </div>
      {source.type === 'document-comment' ? (
        <div className="grid gap-4">
          <TriggerEntityPicker
            label="Document or space"
            value={source.resource}
            onChange={(value) => onChange({...source, resource: value})}
            kind="document"
          />
          <TriggerEntityPicker
            label="Author"
            value={source.author || ''}
            onChange={(value) => onChange({...source, author: value || undefined})}
            kind="account"
            optional
          />
        </div>
      ) : null}
      {source.type === 'user-mention' ? (
        <div className="grid gap-4">
          <MentionedAccountsField
            accounts={mentionedAccountsOf(source)}
            onChange={(accounts) => onChange({...source, mentionedAccounts: accounts})}
          />
          <TriggerEntityPicker
            label="In document or space"
            value={source.resourcePrefix ?? ''}
            onChange={(value) => onChange({...source, resourcePrefix: value || undefined})}
            kind="document"
            optional
          />
        </div>
      ) : null}
      {source.type === 'comment-reply' ? (
        <div className="grid gap-4">
          <MentionedAccountsField
            label="Replies to"
            accounts={source.repliedToAccounts}
            onChange={(accounts) => onChange({...source, repliedToAccounts: accounts})}
          />
          <TriggerEntityPicker
            label="In document or space"
            value={source.resourcePrefix ?? ''}
            onChange={(value) => onChange({...source, resourcePrefix: value || undefined})}
            kind="document"
            optional
          />
        </div>
      ) : null}
      {source.type === 'document-author-comment' ? (
        <div className="grid gap-4">
          <MentionedAccountsField
            label="Documents by"
            accounts={source.documentAuthors}
            onChange={(accounts) => onChange({...source, documentAuthors: accounts})}
          />
          <TriggerEntityPicker
            label="In document or space"
            value={source.resourcePrefix ?? ''}
            onChange={(value) => onChange({...source, resourcePrefix: value || undefined})}
            kind="document"
            optional
          />
        </div>
      ) : null}
      {source.type === 'site-update' ? (
        <div className="grid gap-4">
          <TriggerEntityPicker
            label="Document or space"
            value={source.resourcePrefix}
            onChange={(value) => onChange({...source, resourcePrefix: value})}
            kind="document"
          />
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

/**
 * Resolves a stored account or document ID to its live name. Until the name arrives, or when it never
 * does, the label is a short readable form of the ID rather than a loading message or a raw URL. A
 * document value that names no account (such as a bare `hm://`) is flagged as invalid.
 */
function useTriggerEntityName(value: string, kind: 'document' | 'account') {
  const id = value ? (kind === 'account' ? hmId(value) : unpackHmId(value)) : null
  const invalid = kind === 'document' && !!value && !id?.uid
  const account = useAccount(kind === 'account' ? id?.uid : undefined, {subscribe: true})
  const resource = useResource(kind === 'document' && !invalid ? id : undefined, {subscribed: true})
  const name = invalid
    ? undefined
    : kind === 'account'
      ? account.data?.metadata?.name
      : resource.data?.type === 'document'
        ? resource.data.document.metadata?.name
        : undefined
  const fallback = invalid
    ? 'an invalid document'
    : id?.uid
      ? id.path?.length
        ? id.path[id.path.length - 1]!
        : abbreviateUid(id.uid)
      : value
  return {name, label: name || fallback, resolved: !!name, invalid}
}

function TriggerEntityName({value, kind}: {value: string; kind: 'document' | 'account'}) {
  const {label, resolved, invalid} = useTriggerEntityName(value, kind)
  if (invalid) return <span className="text-destructive">{label}</span>
  return resolved ? <>{label}</> : <span className="text-muted-foreground">{label}</span>
}

/** Whether a stored document filter names an account or document; a bare `hm://` names nothing. */
function isTriggerResource(value: string | undefined): boolean {
  return !!unpackHmId(value?.trim())?.uid
}

/** Describes a condition using live document and account names rather than stored identifiers. */
export function TriggerSourceSummary({source}: {source: AgentTriggerSource}) {
  if (source.type === 'activity')
    return (
      <>
        {source.conditions.map((condition, index) => (
          <React.Fragment key={condition.id}>
            {index ? ' OR ' : null}
            <TriggerSourceSummary source={condition.source} />
          </React.Fragment>
        ))}
      </>
    )
  if (source.type === 'document-comment')
    return (
      <>
        Comment in <TriggerEntityName value={source.resource} kind="document" />
        {source.author ? (
          <>
            {' '}
            by <TriggerEntityName value={source.author} kind="account" />
          </>
        ) : null}
      </>
    )
  if (source.type === 'user-mention')
    return (
      <>
        Mention of {!mentionedAccountsOf(source).length ? 'anyone' : null}
        {mentionedAccountsOf(source).map((uid, index) => (
          <React.Fragment key={uid}>
            {index ? ', ' : null}
            <TriggerEntityName value={uid} kind="account" />
          </React.Fragment>
        ))}
        {source.resourcePrefix ? (
          <>
            {' '}
            in <TriggerEntityName value={source.resourcePrefix} kind="document" />
          </>
        ) : null}
      </>
    )
  if (source.type === 'comment-reply')
    return (
      <>
        Reply to{' '}
        {source.repliedToAccounts.map((uid, index) => (
          <React.Fragment key={uid}>
            {index ? ', ' : null}
            <TriggerEntityName value={uid} kind="account" />
          </React.Fragment>
        ))}
        {source.resourcePrefix ? (
          <>
            {' '}
            in <TriggerEntityName value={source.resourcePrefix} kind="document" />
          </>
        ) : null}
      </>
    )
  if (source.type === 'document-author-comment')
    return (
      <>
        Comment on a document by{' '}
        {source.documentAuthors.map((uid, index) => (
          <React.Fragment key={uid}>
            {index ? ', ' : null}
            <TriggerEntityName value={uid} kind="account" />
          </React.Fragment>
        ))}
        {source.resourcePrefix ? (
          <>
            {' '}
            in <TriggerEntityName value={source.resourcePrefix} kind="document" />
          </>
        ) : null}
      </>
    )
  if (source.type === 'site-update')
    return (
      <>
        {(source.eventTypes?.length ? source.eventTypes : [undefined]).map((eventType, index) => (
          <React.Fragment key={index}>
            {index ? ' OR ' : null}
            {siteEventLabel(eventType)} in <TriggerEntityName value={source.resourcePrefix} kind="document" />
          </React.Fragment>
        ))}
      </>
    )
  return <>{summarizeTriggerSource(source)}</>
}

function TriggerEntityPicker({
  label,
  value,
  onChange,
  kind,
  optional = false,
  exclude = [],
}: {
  label: string
  value: string
  onChange: (value: string) => void
  kind: 'document' | 'account'
  optional?: boolean
  exclude?: string[]
}) {
  const inputId = useId()
  const listId = `${inputId}-results`
  const [query, setQuery] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedName, setSelectedName] = useState<{value: string; name: string}>()
  const resolved = useTriggerEntityName(value, kind)
  const pending = query !== null && query.length > 0
  const onPendingField = useContext(PendingConditionFields)
  useEffect(() => {
    onPendingField(inputId, pending)
    return () => onPendingField(inputId, false)
  }, [inputId, pending, onPendingField])
  const displayName = value
    ? resolved.name || (selectedName?.value === value && selectedName.name) || resolved.label
    : ''
  // Accounts come from the same ranked search as @mentions and invites; documents from full-text search.
  const selectedAccountId = useSelectedAccountId()
  const accountSearch = useInlineMentions(query ?? '', {
    mode: 'account',
    enabled: focused && kind === 'account',
    perspectiveAccountUid: selectedAccountId,
  })
  const documentSearch = useSearch(query ?? '', {
    enabled: focused && kind === 'document',
    pageSize: 12,
    entityKindFilter: [EntityKindFilter.ENTITY_KIND_DOCUMENT, EntityKindFilter.ENTITY_KIND_SPACE],
  })
  const search =
    kind === 'account'
      ? {isFetching: accountSearch.isFetching, isError: accountSearch.isError}
      : {isFetching: documentSearch.isFetching, isError: documentSearch.isError}
  const pastedId = query?.trim().startsWith('hm://') ? unpackHmId(query.trim()) : null
  const pasted = pastedId?.uid ? pastedId : null
  const candidates: {value: string; title?: string; subtitle?: string}[] =
    kind === 'account'
      ? [
          ...(pasted ? [{value: pasted.uid}] : []),
          ...accountSearch.suggestions.flatMap((candidate) =>
            candidate.type === 'account'
              ? [
                  {
                    value: candidate.id.uid,
                    title: candidate.petname || candidate.publicName || candidate.title,
                    subtitle: mentionCandidateSubtitle(candidate),
                  },
                ]
              : [],
          ),
        ]
      : [
          ...(pasted ? [{value: packHmId(pasted)}] : []),
          ...(documentSearch.data?.entities ?? []).flatMap((item) =>
            item.type === 'document'
              ? [{value: packHmId(item.id), title: item.title, subtitle: item.parentNames?.join(' / ')}]
              : [],
          ),
        ]
  const results = candidates
    .filter((item) => !exclude.includes(item.value))
    .filter((item, index, items) => items.findIndex((other) => other.value === item.value) === index)
    .slice(0, 8)
  const open = focused && (query !== null || results.length > 0 || search.isFetching)
  const active = Math.min(activeIndex, Math.max(0, results.length - 1))
  function select(index: number) {
    const item = results[index]
    if (!item) return
    if (item.title) setSelectedName({value: item.value, name: item.title})
    onChange(item.value)
    setQuery(null)
    setFocused(false)
  }
  return (
    <div className="grid gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
        {optional ? <span className="text-muted-foreground font-normal"> (optional)</span> : null}
      </label>
      <div className="relative">
        <Input
          id={inputId}
          className="h-10 rounded-lg shadow-none"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && results.length ? `${listId}-${active}` : undefined}
          value={query ?? displayName}
          placeholder={kind === 'account' ? 'Search accounts…' : 'Search documents and spaces…'}
          onFocus={(event) => {
            setFocused(true)
            if (query === null) event.currentTarget.select()
          }}
          onClick={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setQuery(event.target.value)
            if (!event.target.value) onChange('')
            setActiveIndex(0)
            setFocused(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setFocused(true)
              setActiveIndex(Math.max(0, Math.min(results.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))))
            } else if (event.key === 'Enter' && open) {
              event.preventDefault()
              select(active)
            } else if (event.key === 'Escape' && open) {
              event.preventDefault()
              event.stopPropagation()
              setQuery(null)
              setFocused(false)
            }
          }}
        />
        {open ? (
          <div
            className="border-border bg-popover z-20 mt-1 max-h-48 overflow-auto rounded-md border p-1 shadow-sm"
            id={listId}
            role="listbox"
            aria-label={label}
            aria-busy={search.isFetching}
          >
            {results.map((item, index) => (
              <button
                key={item.value}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                className="hover:bg-muted aria-selected:bg-muted flex w-full flex-col gap-1 rounded px-3 py-2 text-left text-sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(index)}
              >
                <span className="font-medium">
                  {item.title || <TriggerEntityName value={item.value} kind={kind} />}
                </span>
                {item.subtitle ? <span className="text-muted-foreground text-xs">{item.subtitle}</span> : null}
              </button>
            ))}
            {!results.length ? (
              <p role="status" className="text-muted-foreground p-3 text-sm">
                {search.isFetching
                  ? 'Searching…'
                  : search.isError
                    ? 'Search unavailable. Try again.'
                    : query
                      ? 'No results found.'
                      : 'Type a name to search.'}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function MentionedAccountsField({
  accounts,
  onChange,
  label = 'Mentioned accounts',
}: {
  accounts: string[]
  onChange: (accounts: string[]) => void
  label?: string
}) {
  return (
    <div className="grid gap-2">
      {accounts.map((uid) => (
        <div
          key={uid}
          className="border-border bg-muted/40 flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
        >
          <TriggerEntityName value={uid} kind="account" />
          <Button variant="ghost" size="sm" onClick={() => onChange(accounts.filter((account) => account !== uid))}>
            Remove
          </Button>
        </div>
      ))}
      <TriggerEntityPicker
        label={label}
        kind="account"
        value=""
        exclude={accounts}
        onChange={(uid) => {
          if (uid) onChange([...accounts, uid])
        }}
      />
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
  activity: Workflow,
  'document-comment': MessageSquare,
  'user-mention': AtSign,
  'comment-reply': Reply,
  'document-author-comment': MessageSquare,
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
    <div className="bg-muted/40 mb-3 flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <span className="shrink-0">Triggered by</span>
        <ContextLink
          route={triggerRoute}
          onNavigate={navigate}
          title="Open this trigger"
          className="min-w-0 font-medium break-words"
        >
          {context.triggerName}
        </ContextLink>
        <ContextLink
          route={activityRoute}
          onNavigate={navigate}
          title="Open the comment, document, or update that started this session"
          className="text-muted-foreground w-full break-words"
        >
          {context.activitySummary}
        </ContextLink>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 break-words">{<TriggerSourceSummary source={context.source} />}</span>
        <span>Fired {formattedDateMedium(new Date(context.firedAt))}</span>
        {context.status && context.status !== 'fired' ? <span>Status: {context.status}</span> : null}
      </div>
      {context.error ? (
        <Notice size="sm" title="Trigger error" className="mt-2">
          {context.error}
        </Notice>
      ) : null}
      {context.matchedConditions?.length ? (
        <div className="text-muted-foreground flex flex-wrap gap-2">
          <span>Matched:</span>
          {context.matchedConditions.map(({id, source}) => (
            <span key={id} className="bg-background rounded border px-2 py-1">
              {<TriggerSourceSummary source={source} />}
            </span>
          ))}
        </div>
      ) : null}
      {context.prompt ? (
        <TriggerDisclosure label="Trigger prompt">
          <p className="bg-background/60 text-foreground rounded-md border p-2 text-xs break-words whitespace-pre-wrap">
            {context.prompt}
          </p>
        </TriggerDisclosure>
      ) : null}
      <TriggerDisclosure label="Activity details">
        <dl className="mb-2 grid min-w-0 gap-2">
          <div>
            <dt className="text-muted-foreground">Activity key</dt>
            <dd className="font-mono break-all">{context.activityKey}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Firing ID</dt>
            <dd className="font-mono break-all">{context.firingId}</dd>
          </div>
        </dl>
        <pre className="bg-background/60 text-foreground max-h-72 overflow-auto rounded-md border p-2 text-xs whitespace-pre-wrap">
          {JSON.stringify(context.activity, null, 2)}
        </pre>
      </TriggerDisclosure>
      {instructions ? (
        <TriggerDisclosure label="Trigger instructions">
          <p className="bg-background/60 text-foreground rounded-md border p-2 text-xs break-words whitespace-pre-wrap">
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
      className={`hover:text-foreground focus-visible:ring-ring rounded-sm text-left hover:underline focus-visible:ring-2 focus-visible:outline-none active:opacity-70 ${
        className ?? ''
      }`}
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
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none active:opacity-70"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
      </button>
      {open ? <div className="min-w-0">{children}</div> : null}
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
          Then
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
