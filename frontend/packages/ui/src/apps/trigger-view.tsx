import type {AgentTriggerSource, TriggerFiringInfo} from '@seed-hypermedia/apps-protocol'
import {blocksToMarkdown, markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client'
import {
  appEmbeddedChildren,
  HM_AGENT_TYPE,
  HM_TOOL_TYPE,
  ipfsRefCid,
  parentDocumentId,
  triggerDocumentOps,
  triggerDocumentRefs,
} from '@seed-hypermedia/client/apps'
import type {DocumentOperation} from '@seed-hypermedia/client/change'
import {
  unpackHmId,
  type HMBlockNode,
  type HMDocument,
  type UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {useUniversalClient} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import {useNavigate} from '@shm/shared/utils/navigation'
import {useQuery} from '@tanstack/react-query'
import {Copy} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {AgentSubpageHeader} from '../agents/header'
import {getAgentWebhookUrl} from '../agents/client'
import {useLocalAgentServerUrl} from '../agents/models'
import {describeHostServer} from '../server-host-card'
import {TriggerSourceFields, TriggerSourceSummary} from '../agents/trigger-types'
import {Button} from '../button'
import {CodeTextArea} from '../code-text-area'
import {Switch} from '../components/switch'
import {Textarea} from '../components/textarea'
import {copyTextToClipboard} from '../copy-to-clipboard'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useResourceDraft} from './resource-draft'
import {appServerErrorMessage, useAppServerUrl, useHostTriggers} from './running'

/** A new trigger's source: an hourly schedule, edited before it matters (it does nothing until it names an action). */
export const DEFAULT_TRIGGER_SOURCE: AgentTriggerSource = {
  type: 'schedule',
  schedule: {kind: 'interval', every: 1, unit: 'hours'},
}

/**
 * A trigger document, opened inside its app or agent: when it fires (its source), what it does
 * (call one of the host's tools with an input template, or, under an agent, start a session with a
 * message), whether it is on, and its recent firings as the host's server reports them. Edits stage
 * into the document's draft like any document's: it saves itself, the top bar's Publish button
 * appears once there are changes, and Discard Changes drops them. The server picks up what is
 * published.
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
  const draft = useResourceDraft(document)
  const hostId = parentDocumentId(docId)
  const hostResource = useResource(hostId)
  const host = hostResource.data?.type === 'document' ? hostResource.data.document : null
  const hostIsAgent = host?.metadata.type === HM_AGENT_TYPE
  const server = useAppServerUrl(hostId ?? docId, host ?? ({metadata: {}} as HMDocument))
  const hostTriggers = useHostTriggers(server.serverUrl, hostId?.id ?? '')
  const refs = triggerDocumentRefs(draft.metadata as Record<string, unknown>)
  const stored = useQuery({
    queryKey: ['trigger-document-blobs', refs.sourceCid, refs.inputCid],
    queryFn: async () => {
      const read = async (cid: string | null) =>
        cid ? ((await client.request('GetCID', {cid})).value as unknown) : undefined
      return {source: (await read(refs.sourceCid)) as AgentTriggerSource | undefined, input: await read(refs.inputCid)}
    },
  })
  const tools = useHostTools(hostId, host)

  // The source editor and the two text fields hold what is typed; the draft follows them.
  const [source, setSource] = useState<AgentTriggerSource | null>(null)
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [chosenAction, setChosenAction] = useState<'tool' | 'session' | null>(null)
  const written = useRef<{inputCid: string | null; content: HMBlockNode[] | null}>({inputCid: null, content: null})
  const action: 'tool' | 'session' = !hostIsAgent ? 'tool' : chosenAction ?? (refs.tool ? 'tool' : 'session')

  // What the draft says (a new version, a discarded draft) replaces what the fields hold, unless the
  // fields wrote it themselves.
  useEffect(() => {
    if (!stored.data) return
    setSource(stored.data.source ?? null)
    if (refs.inputCid !== written.current.inputCid) {
      setInput(stored.data.input === undefined ? '' : JSON.stringify(stored.data.input, null, 2))
      setInputError(null)
      written.current.inputCid = refs.inputCid
    }
  }, [stored.data])
  useEffect(() => {
    if (draft.content === written.current.content) return
    setMessage(draft.content.length ? blocksToMarkdown({metadata: {}, content: draft.content} as HMDocument) : '')
    written.current.content = draft.content
  }, [draft.content])
  useEffect(() => setChosenAction(null), [document.version])

  async function changeSource(next: AgentTriggerSource) {
    setSource(next)
    const fields = await triggerDocumentOps({source: next})
    await draft.storeBlobs(fields.blobs)
    draft.change(attributesOf(fields.ops))
  }

  // Typing in the input or the message stages a new draft after a pause.
  const inputTimer = useRef<ReturnType<typeof setTimeout>>()
  function changeInput(text: string) {
    setInput(text)
    clearTimeout(inputTimer.current)
    inputTimer.current = setTimeout(async () => {
      if (!text.trim()) {
        setInputError(null)
        written.current.inputCid = null
        draft.change({input: null})
        return
      }
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        setInputError('Not valid JSON yet: the draft keeps the last valid input.')
        return
      }
      setInputError(null)
      const fields = await triggerDocumentOps({input: value})
      await draft.storeBlobs(fields.blobs)
      const attrs = attributesOf(fields.ops)
      written.current.inputCid = ipfsRefCid(attrs.input)
      draft.change(attrs)
    }, 400)
  }
  const messageTimer = useRef<ReturnType<typeof setTimeout>>()
  function changeMessage(text: string) {
    setMessage(text)
    clearTimeout(messageTimer.current)
    messageTimer.current = setTimeout(() => {
      const blocks = text.trim()
        ? markdownBlockNodesToHMBlockNodes(parseMarkdown(text, {strictFrontmatter: false}).tree)
        : []
      written.current.content = blocks
      draft.change({}, blocks)
    }, 300)
  }
  function changeAction(next: 'tool' | 'session') {
    setChosenAction(next)
    // A session trigger calls no tool; a tool trigger has no message.
    if (next === 'session') draft.change({tool: null, input: null})
    else if (draft.content.length) {
      written.current.content = []
      setMessage('')
      draft.change({}, [])
    }
  }

  const state = hostTriggers.data?.triggers.find((entry) => entry.trigger.documentId === docId.id)
  const problem = hostTriggers.data?.errors.find((entry) => entry.documentId === docId.id)?.error
  const name = typeof draft.metadata.name === 'string' ? draft.metadata.name : ''
  const summary = typeof draft.metadata.summary === 'string' ? draft.metadata.summary : ''

  const backRoute = hostId
    ? hostIsAgent
      ? ({key: 'document', id: hostId, agentView: 'triggers'} as const)
      : ({key: 'document', id: hostId, appView: 'triggers'} as const)
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AgentSubpageHeader
        title={name || (canEdit ? '' : docId.path?.at(-1) || '')}
        placeholder="Trigger name"
        onTitleChange={canEdit ? (next) => draft.change({name: next}) : undefined}
        backLabel={hostIsAgent ? 'Back to agent triggers' : 'Back to app triggers'}
        onBack={() => backRoute && navigate(backRoute)}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {canEdit ? (
            <Textarea
              value={summary}
              onChange={(event) => draft.change({summary: event.target.value || null})}
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
            enabled={refs.enabled}
            canEdit={canEdit}
            onEnabledChange={(enabled) => draft.change({enabled})}
            onOpenSettings={() =>
              hostId && !hostIsAgent && navigate({key: 'document', id: hostId, appView: 'settings'})
            }
          />

          <section className="flex flex-col gap-2">
            <SizableText weight="bold">When</SizableText>
            {source ? (
              canEdit ? (
                <TriggerSourceFields source={source} onChange={(next) => void changeSource(next)} />
              ) : (
                <SizableText size="sm">
                  <TriggerSourceSummary source={source} />
                </SizableText>
              )
            ) : stored.isLoading ? null : canEdit ? (
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => void changeSource(DEFAULT_TRIGGER_SOURCE)}
              >
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
                  onClick={() => changeAction('session')}
                >
                  Start a session
                </Button>
                <Button
                  size="sm"
                  variant={action === 'tool' ? 'default' : 'outline'}
                  disabled={!canEdit}
                  onClick={() => changeAction('tool')}
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
                  onChange={(event) => changeMessage(event.target.value)}
                  placeholder="Someone mentioned you. Read the comment and answer it."
                  rows={5}
                />
              </>
            ) : (
              <>
                <select
                  aria-label="Tool to call"
                  value={refs.tool ?? ''}
                  disabled={!canEdit}
                  onChange={(event) => draft.change({tool: event.currentTarget.value || null})}
                  className="border-border bg-background text-foreground w-fit rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">Choose a tool…</option>
                  {tools.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                  {refs.tool && !tools.some((entry) => entry.id === refs.tool) ? (
                    <option value={refs.tool}>{refs.tool}</option>
                  ) : null}
                </select>
                <SizableText size="sm" color="muted">
                  {source?.type === 'schedule'
                    ? 'Input for the tool, as JSON (optional).'
                    : source?.type === 'webhook'
                      ? 'Input for the tool, as JSON. "$event.payload" is the posted JSON; leave it empty to pass the whole event.'
                      : 'Input for the tool, as JSON. "$event" and "$event.<field>" are filled from what happened; leave it empty to pass the whole event.'}
                </SizableText>
                <CodeTextArea
                  value={input}
                  readOnly={!canEdit}
                  onChange={(event) => changeInput(event.target.value)}
                  rows={5}
                  placeholder='{"text": "$event.payload.message"}'
                />
                {inputError ? (
                  <SizableText size="xs" color="destructive">
                    {inputError}
                  </SizableText>
                ) : null}
              </>
            )}
          </section>

          {state?.trigger.source.type === 'webhook' ? (
            <WebhookSection serverUrl={server.serverUrl} triggerId={state.trigger.id} secret={state.webhookSecret} />
          ) : null}

          <FiringsSection
            firings={state?.firings ?? []}
            hostId={hostId}
            toolId={refs.tool ?? ''}
            hostIsAgent={hostIsAgent}
          />
        </div>
      </div>
    </div>
  )
}

/** The attributes a `SetAttributes` op list sets, as a metadata patch. */
function attributesOf(ops: DocumentOperation[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const op of ops) if (op.type === 'SetAttributes') for (const attr of op.attrs) patch[attr.key[0]!] = attr.value
  return patch
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
  const localServerUrl = useLocalAgentServerUrl()
  const where = describeHostServer(serverUrl, localServerUrl.data)
  const host = where === 'This computer' ? 'this computer' : where
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
