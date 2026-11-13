import type {AgentTriggerSource, TriggerFiringInfo} from '@seed-hypermedia/apps-protocol'
import {blocksToMarkdown, markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client'
import {
  appEmbeddedChildren,
  HM_AGENT_TYPE,
  HM_TOOL_TYPE,
  parentDocumentId,
  replaceContentOps,
  triggerDocumentOps,
  triggerDocumentRefs,
} from '@seed-hypermedia/client/apps'
import {unpackHmId, type HMDocument, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalClient} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import {useNavigate} from '@shm/shared/utils/navigation'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {Copy, Save} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import {AgentSubpageHeader} from '../agents/header'
import {getAgentWebhookUrl} from '../agents/client'
import {TriggerSourceFields, TriggerSourceSummary} from '../agents/trigger-types'
import {Button} from '../button'
import {CodeTextArea} from '../code-text-area'
import {Switch} from '../components/switch'
import {Textarea} from '../components/textarea'
import {copyTextToClipboard} from '../copy-to-clipboard'
import {SizableText} from '../text'
import {toast} from '../toast'
import {setAttribute, useAppsPublisher} from './publish'
import {appServerErrorMessage, useAppServerUrl, useHostTriggers} from './running'

/** A new trigger's source: an hourly schedule, edited before it matters (it does nothing until it names an action). */
export const DEFAULT_TRIGGER_SOURCE: AgentTriggerSource = {
  type: 'schedule',
  schedule: {kind: 'interval', every: 1, unit: 'hours'},
}

/**
 * A trigger document, opened inside its app or agent: when it fires (its source), what it does
 * (call one of the host's tools with an input template, or, under an agent, start a session with a
 * message), whether it is on, and its recent firings as the host's server reports them. Save
 * publishes every change as one new version of the document; the server picks it up at once.
 */
export function TriggerDocumentView({
  docId,
  document,
  canEdit,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  canEdit: boolean
}) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const publisher = useAppsPublisher()
  const queryClient = useQueryClient()
  const hostId = parentDocumentId(docId)
  const hostResource = useResource(hostId)
  const host = hostResource.data?.type === 'document' ? hostResource.data.document : null
  const hostIsAgent = host?.metadata.type === HM_AGENT_TYPE
  const server = useAppServerUrl(hostId ?? docId, host ?? ({metadata: {}} as HMDocument))
  const hostTriggers = useHostTriggers(server.serverUrl, hostId?.id ?? '')
  const refs = triggerDocumentRefs(document.metadata as Record<string, unknown>)
  const stored = useQuery({
    queryKey: ['trigger-document-blobs', refs.sourceCid, refs.inputCid],
    queryFn: async () => {
      const read = async (cid: string | null) =>
        cid ? ((await client.request('GetCID', {cid})).value as unknown) : undefined
      return {source: (await read(refs.sourceCid)) as AgentTriggerSource | undefined, input: await read(refs.inputCid)}
    },
  })
  const tools = useHostTools(hostId, host)
  const savedMessage = useMemo(
    () => (document.content?.length ? blocksToMarkdown({metadata: {}, content: document.content} as HMDocument) : ''),
    [document.content],
  )

  const [name, setName] = useState(document.metadata.name ?? '')
  const [summary, setSummary] = useState(document.metadata.summary ?? '')
  const [source, setSource] = useState<AgentTriggerSource | null>(null)
  const [action, setAction] = useState<'tool' | 'session'>(refs.tool || !hostIsAgent ? 'tool' : 'session')
  const [tool, setTool] = useState(refs.tool ?? '')
  const [input, setInput] = useState('')
  const [message, setMessage] = useState(savedMessage)
  const [enabled, setEnabled] = useState(refs.enabled)
  const [saving, setSaving] = useState(false)

  // A new version (saved here or elsewhere) resets the form to what it says.
  useEffect(() => {
    setName(document.metadata.name ?? '')
    setSummary(document.metadata.summary ?? '')
    setTool(refs.tool ?? '')
    setEnabled(refs.enabled)
    setMessage(savedMessage)
    setAction(refs.tool || !hostIsAgent ? 'tool' : 'session')
  }, [document.version, hostIsAgent])
  useEffect(() => {
    if (!stored.data) return
    setSource(stored.data.source ?? null)
    setInput(stored.data.input === undefined ? '' : JSON.stringify(stored.data.input, null, 2))
  }, [stored.data])

  const savedInput = stored.data?.input === undefined ? '' : JSON.stringify(stored.data.input, null, 2)
  const sourceDirty = !!source && JSON.stringify(source) !== JSON.stringify(stored.data?.source ?? null)
  const toolValue = action === 'tool' ? tool : ''
  const dirty =
    name !== (document.metadata.name ?? '') ||
    summary !== (document.metadata.summary ?? '') ||
    sourceDirty ||
    toolValue !== (refs.tool ?? '') ||
    (action === 'tool' && input.trim() !== savedInput.trim()) ||
    (action === 'session' && message !== savedMessage) ||
    enabled !== refs.enabled

  const state = hostTriggers.data?.triggers.find((entry) => entry.trigger.documentId === docId.id)
  const problem = hostTriggers.data?.errors.find((entry) => entry.documentId === docId.id)?.error

  async function save() {
    setSaving(true)
    try {
      let parsedInput: unknown = null
      if (action === 'tool' && input.trim()) {
        try {
          parsedInput = JSON.parse(input)
        } catch {
          throw new Error('The input is not valid JSON')
        }
      }
      if (action === 'tool' && !tool) throw new Error('Choose the tool this trigger calls')
      if (action === 'session' && !message.trim()) throw new Error('Write the message the session starts with')
      const fields = await triggerDocumentOps({
        ...(sourceDirty || !refs.sourceCid ? {source: source ?? DEFAULT_TRIGGER_SOURCE} : {}),
        ...(toolValue !== (refs.tool ?? '') ? {tool: toolValue || null} : {}),
        ...(action === 'tool' && input.trim() !== savedInput.trim() ? {input: parsedInput} : {}),
        ...(action === 'session' && refs.inputCid ? {input: null} : {}),
        ...(enabled !== refs.enabled ? {enabled} : {}),
      })
      const ops = [...fields.ops]
      if (name !== (document.metadata.name ?? '')) ops.push(setAttribute('name', name.trim()))
      if (summary !== (document.metadata.summary ?? '')) ops.push(setAttribute('summary', summary.trim() || null))
      // The body is a session trigger's message; a tool trigger has none.
      const nextContent =
        action === 'session'
          ? markdownBlockNodesToHMBlockNodes(parseMarkdown(message, {strictFrontmatter: false}).tree)
          : []
      if ((action === 'session' && message !== savedMessage) || (action === 'tool' && document.content?.length))
        ops.push(...replaceContentOps(document.content, nextContent))
      await publisher.update(docId, ops, fields.blobs)
      void queryClient.invalidateQueries({queryKey: ['host-triggers']})
      toast.success('Trigger saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const backRoute = hostId
    ? hostIsAgent
      ? ({key: 'document', id: hostId, agentView: 'triggers'} as const)
      : ({key: 'document', id: hostId, appView: 'triggers'} as const)
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AgentSubpageHeader
        title={canEdit ? name : document.metadata.name || docId.path?.at(-1) || ''}
        placeholder="Trigger name"
        onTitleChange={canEdit ? setName : undefined}
        backLabel={hostIsAgent ? 'Back to agent triggers' : 'Back to app triggers'}
        onBack={() => backRoute && navigate(backRoute)}
        actions={
          canEdit && dirty ? (
            <Button size="sm" variant="default" disabled={saving || !name.trim()} onClick={() => void save()}>
              <Save className="size-3.5" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          ) : null
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {canEdit ? (
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What this trigger is for"
              rows={2}
            />
          ) : summary ? (
            <SizableText color="muted">{summary}</SizableText>
          ) : null}

          <TriggerStatus
            serverUrl={server.serverUrl}
            hostIsAgent={hostIsAgent}
            active={hostTriggers.data?.active}
            loading={server.isLoading || hostTriggers.isInitialLoading}
            error={hostTriggers.isError ? appServerErrorMessage(hostTriggers.error) : problem}
            enabled={enabled}
            canEdit={canEdit}
            onEnabledChange={setEnabled}
            onOpenSettings={() =>
              hostId && !hostIsAgent && navigate({key: 'document', id: hostId, appView: 'settings'})
            }
          />

          <section className="flex flex-col gap-2">
            <SizableText weight="bold">When</SizableText>
            {source ? (
              canEdit ? (
                <TriggerSourceFields source={source} onChange={setSource} />
              ) : (
                <SizableText size="sm">
                  <TriggerSourceSummary source={source} />
                </SizableText>
              )
            ) : stored.isLoading ? null : canEdit ? (
              <Button variant="outline" size="sm" className="w-fit" onClick={() => setSource(DEFAULT_TRIGGER_SOURCE)}>
                Set when it fires
              </Button>
            ) : (
              <SizableText size="sm" color="muted">
                Not set.
              </SizableText>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <SizableText weight="bold">Then</SizableText>
            {hostIsAgent ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={action === 'session' ? 'default' : 'outline'}
                  disabled={!canEdit}
                  onClick={() => setAction('session')}
                >
                  Start a session
                </Button>
                <Button
                  size="sm"
                  variant={action === 'tool' ? 'default' : 'outline'}
                  disabled={!canEdit}
                  onClick={() => setAction('tool')}
                >
                  Call a tool
                </Button>
              </div>
            ) : null}
            {action === 'session' ? (
              <>
                <SizableText size="sm" color="muted">
                  The agent starts a new session with this message, and the event that fired it.
                </SizableText>
                <Textarea
                  value={message}
                  readOnly={!canEdit}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Someone mentioned you. Read the comment and answer it."
                  rows={5}
                />
              </>
            ) : (
              <>
                <select
                  aria-label="Tool to call"
                  value={tool}
                  disabled={!canEdit}
                  onChange={(event) => setTool(event.currentTarget.value)}
                  className="border-border bg-background text-foreground w-fit rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">Choose a tool…</option>
                  {tools.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                  {tool && !tools.some((entry) => entry.id === tool) ? <option value={tool}>{tool}</option> : null}
                </select>
                <SizableText size="sm" color="muted">
                  Input, as JSON. String values <code>"$event"</code> and <code>"$event.path"</code> are filled from the
                  event (a webhook's posted JSON is <code>"$event.payload"</code>). Leave it empty to pass the event.
                </SizableText>
                <CodeTextArea
                  value={input}
                  readOnly={!canEdit}
                  onChange={(event) => setInput(event.target.value)}
                  rows={5}
                  placeholder='{"text": "$event.payload.message"}'
                />
              </>
            )}
          </section>

          {state?.trigger.source.type === 'webhook' ? (
            <WebhookSection serverUrl={server.serverUrl} triggerId={state.trigger.id} secret={state.webhookSecret} />
          ) : null}

          <FiringsSection firings={state?.firings ?? []} hostId={hostId} toolId={tool} hostIsAgent={hostIsAgent} />
        </div>
      </div>
    </div>
  )
}

/** The tools a host lists, by URL and name, for choosing what a trigger calls. */
function useHostTools(hostId: UnpackedHypermediaId | null, host: HMDocument | null) {
  const children = useMemo(
    () => (hostId && host ? appEmbeddedChildren(hostId, host.content).map((child) => child.id) : []),
    [hostId, host],
  )
  const resources = useResources(children)
  return children.flatMap((id, index) => {
    const data = resources[index]?.data
    if (data?.type !== 'document' || data.document.metadata.type !== HM_TOOL_TYPE) return []
    return [{id: id.id, name: data.document.metadata.name || id.path?.at(-1) || id.id}]
  })
}

function TriggerStatus({
  serverUrl,
  hostIsAgent,
  active,
  loading,
  error,
  enabled,
  canEdit,
  onEnabledChange,
  onOpenSettings,
}: {
  serverUrl: string
  hostIsAgent: boolean
  active: boolean | undefined
  loading: boolean
  error?: string
  enabled: boolean
  canEdit: boolean
  onEnabledChange: (enabled: boolean) => void
  onOpenSettings: () => void
}) {
  const host = serverUrl ? new URL(serverUrl).host : null
  const line = loading
    ? 'Checking its server…'
    : error
      ? error
      : !serverUrl
        ? hostIsAgent
          ? 'This agent names no server, so the trigger never fires.'
          : 'This app names no server. Run it from its Settings, and its triggers fire while it runs.'
        : active === false
          ? hostIsAgent
            ? `The agent is not on ${host}.`
            : `The app is not running on ${host}: its triggers fire only while it runs.`
          : !enabled
            ? `Off. It does not fire.`
            : `Active on ${host}.`
  return (
    <div className="border-border flex items-center gap-3 rounded-lg border px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <SizableText size="sm" color={error ? 'destructive' : undefined}>
          {line}
        </SizableText>
        {active === false && !hostIsAgent && !error ? (
          <button type="button" className="text-primary w-fit text-left text-xs" onClick={onOpenSettings}>
            Open the app’s settings
          </button>
        ) : null}
      </div>
      <SizableText size="xs" color="muted">
        {enabled ? 'On' : 'Off'}
      </SizableText>
      <Switch aria-label="Trigger on" checked={enabled} disabled={!canEdit} onCheckedChange={onEnabledChange} />
    </div>
  )
}

function WebhookSection({serverUrl, triggerId, secret}: {serverUrl: string; triggerId: string; secret?: string}) {
  const url = secret
    ? getAgentWebhookUrl(serverUrl, triggerId, secret)
    : `${getAgentWebhookUrl(serverUrl, triggerId)}/<secret>`
  return (
    <section className="flex flex-col gap-2">
      <SizableText weight="bold">Webhook</SizableText>
      <div className="border-border flex items-center gap-2 rounded-lg border px-3 py-2">
        <SizableText size="sm" className="min-w-0 flex-1 font-mono break-all">
          {url}
        </SizableText>
        {secret ? (
          <Button
            size="iconSm"
            variant="ghost"
            aria-label="Copy webhook URL"
            onClick={() => {
              copyTextToClipboard(url)
              toast.success('Webhook URL copied')
            }}
          >
            <Copy className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <SizableText size="xs" color="muted">
        {secret
          ? 'POST JSON to this URL. The last segment is a secret: share the URL only with the sender.'
          : 'The secret is shown only to people who can write this space.'}
      </SizableText>
    </section>
  )
}

const FIRING_LABELS: Record<string, string> = {
  created: 'Started a session',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  error: 'Failed',
  delivered: 'Delivered',
  'no-listener': 'Nobody listening',
  escalated: 'Escalated',
}

function FiringsSection({
  firings,
  hostId,
  toolId,
  hostIsAgent,
}: {
  firings: TriggerFiringInfo[]
  hostId: UnpackedHypermediaId | null
  toolId: string
  hostIsAgent: boolean
}) {
  const navigate = useNavigate()
  return (
    <section className="flex flex-col gap-2">
      <SizableText weight="bold">Firings</SizableText>
      {!firings.length ? (
        <SizableText size="sm" color="muted">
          It has not fired yet.
        </SizableText>
      ) : null}
      {firings.map((firing) => {
        const open = firing.toolCallId
          ? () => {
              const id = toolId ? unpackHmId(toolId) : null
              if (id) navigate({key: 'document', id, toolCallId: firing.toolCallId})
            }
          : firing.sessionId && hostId && hostIsAgent
            ? () => navigate({key: 'document', id: hostId, agentView: 'session', agentSessionId: firing.sessionId})
            : null
        return (
          <div
            key={firing.id}
            role={open ? 'button' : undefined}
            tabIndex={open ? 0 : undefined}
            onClick={open ?? undefined}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2 ${
              open ? 'hover:bg-muted/60 cursor-pointer' : ''
            }`}
          >
            <SizableText
              size="xs"
              weight="bold"
              color={firing.status === 'failed' || firing.status === 'error' ? 'destructive' : undefined}
            >
              {FIRING_LABELS[firing.status] ?? firing.status}
            </SizableText>
            <SizableText size="sm" className="min-w-0 flex-1 truncate">
              {firing.error || firing.activitySummary}
            </SizableText>
            <SizableText size="xs" color="muted">
              {new Date(firing.createdAt).toLocaleString()}
            </SizableText>
          </div>
        )
      })}
    </section>
  )
}
