import {
  HM_APP_TYPE,
  HM_TOOL_TYPE,
  HM_TRIGGER_TYPE,
  TOOL_CODE_TEMPLATE,
  triggerDocumentOps,
} from '@seed-hypermedia/client/apps'
import type {DocumentOperation} from '@seed-hypermedia/client/change'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useUniversalClient} from '@shm/shared'
import {useNavigate} from '@shm/shared/utils/navigation'
import {pathNameify} from '@shm/shared/utils/path'
import {useState, type ReactNode} from 'react'
import {useAgentServerOptions, useRememberAgentServer} from '../agents/models'
import {CreateServerChoice, useCreateServerChoice} from '../agents/server-picker'
import {Button} from '../button'
import {DialogDescription, DialogTitle} from '../components/dialog'
import {Input} from '../components/input'
import {Label} from '../components/label'
import {Textarea} from '../components/textarea'
import {SizableText} from '../text'
import {toast} from '../toast'
import {toolCodeFolder, useAppsPublisher, type AppRef} from './publish'
import {DEFAULT_TRIGGER_SOURCE} from './trigger-view'

function attrs(values: Record<string, string>): DocumentOperation {
  return {
    type: 'SetAttributes',
    attrs: Object.entries(values)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => ({key: [key], value})),
  }
}

/** The free path for `name` under `parent`: its slug, or the slug with a number when taken. */
async function freeChildId(
  client: ReturnType<typeof useUniversalClient>,
  parent: UnpackedHypermediaId,
  name: string,
): Promise<UnpackedHypermediaId> {
  const slug = pathNameify(name) || 'untitled'
  for (let attempt = 1; attempt < 50; attempt++) {
    const path = [...(parent.path ?? []), attempt === 1 ? slug : `${slug}-${attempt}`]
    const id = hmId(parent.uid, {path})
    const existing = await client.request('Resource', id).catch(() => null)
    if (existing?.type !== 'document') return id
  }
  throw new Error('Choose a different name')
}

function NameAndSummaryForm({
  title,
  description,
  namePlaceholder,
  summaryPlaceholder,
  submitLabel,
  extra,
  onSubmit,
  onClose,
}: {
  title: string
  description: string
  namePlaceholder: string
  summaryPlaceholder: string
  submitLabel: string
  /** Further fields, shown under the description. */
  extra?: ReactNode
  onSubmit: (values: {name: string; summary: string}) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim() || busy) return
        setBusy(true)
        setError(null)
        onSubmit({name: name.trim(), summary: summary.trim()})
          .then(onClose)
          .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => setBusy(false))
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <div className="grid gap-1">
        <Label htmlFor="app-create-name">Name</Label>
        <Input
          id="app-create-name"
          autoFocus
          value={name}
          placeholder={namePlaceholder}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="app-create-summary">Description</Label>
        <Textarea
          id="app-create-summary"
          value={summary}
          placeholder={summaryPlaceholder}
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>
      {extra}
      {error ? (
        <SizableText size="sm" className="text-destructive" role="alert">
          {error}
        </SizableText>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="default" disabled={!name.trim() || busy}>
          {busy ? 'Creating…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}

/**
 * Creates an app under `location` and opens it. The app document names the app environment it runs
 * on (`appEnvironmentUrl`), chosen here the way an agent's server is.
 */
export function CreateAppDialog({input, onClose}: {input: {location: UnpackedHypermediaId}; onClose: () => void}) {
  const client = useUniversalClient()
  const publisher = useAppsPublisher()
  const navigate = useNavigate()
  const serverOptions = useAgentServerOptions()
  const {serverUrl, setServerUrl} = useCreateServerChoice(serverOptions)
  const rememberServer = useRememberAgentServer()
  return (
    <NameAndSummaryForm
      title="New app"
      description="An app collects tools and pages. It is a document you can share like any other."
      namePlaceholder="Weather"
      summaryPlaceholder="What the app is for"
      submitLabel="Create app"
      extra={<CreateServerChoice options={serverOptions ?? []} value={serverUrl} onChange={setServerUrl} />}
      onClose={onClose}
      onSubmit={async ({name, summary}) => {
        const id = await freeChildId(client, input.location, name)
        await publisher.create(id, [attrs({name, summary, type: HM_APP_TYPE, appEnvironmentUrl: serverUrl})])
        if (serverUrl) rememberServer.mutate(serverUrl)
        toast.success(`Created ${name}`)
        navigate({key: 'document', id})
      }}
    />
  )
}

/** Creates a tool inside `app`, lists it on the app and opens it. */
export function CreateToolDialog({input, onClose}: {input: {app: AppRef}; onClose: () => void}) {
  const client = useUniversalClient()
  const publisher = useAppsPublisher()
  const navigate = useNavigate()
  return (
    <NameAndSummaryForm
      title="New tool"
      description="A tool is one function of this app: an input schema, an output schema and its code."
      namePlaceholder="forecast"
      summaryPlaceholder="What the tool does"
      submitLabel="Create tool"
      onClose={onClose}
      onSubmit={async ({name, summary}) => {
        const id = await freeChildId(client, input.app.id, name)
        const folder = await toolCodeFolder(TOOL_CODE_TEMPLATE)
        await publisher.create(
          id,
          [attrs({name, summary, type: HM_TOOL_TYPE, code: folder.code})],
          input.app,
          folder.blobs,
        )
        toast.success(`Created ${name}`)
        navigate({key: 'document', id})
      }}
    />
  )
}

/**
 * Creates a trigger inside an app or agent, lists it there and opens it, like a new tool. It starts
 * on, as an hourly schedule, and does nothing until its page says what it does.
 */
export function CreateTriggerDialog({input, onClose}: {input: {host: AppRef}; onClose: () => void}) {
  const client = useUniversalClient()
  const publisher = useAppsPublisher()
  const navigate = useNavigate()
  const isAgent = input.host.document.metadata.type === 'hm://hyper.media/agent'
  return (
    <NameAndSummaryForm
      title="New trigger"
      description={
        isAgent
          ? 'A trigger starts a session with this agent, or calls one of its tools, when something happens: on a schedule, a webhook, or activity in Hypermedia.'
          : 'A trigger does something for this app when something happens (on a schedule, a webhook, or activity in Hypermedia): it calls one of the app’s tools, or has an agent do the work. It fires while the app runs.'
      }
      namePlaceholder="morning-forecast"
      summaryPlaceholder="What the trigger is for"
      submitLabel="Create trigger"
      onClose={onClose}
      onSubmit={async ({name, summary}) => {
        const id = await freeChildId(client, input.host.id, name)
        const fields = await triggerDocumentOps({source: DEFAULT_TRIGGER_SOURCE})
        await publisher.create(
          id,
          [attrs({name, summary, type: HM_TRIGGER_TYPE}), ...fields.ops],
          input.host,
          fields.blobs,
        )
        toast.success(`Created ${name}`)
        navigate({key: 'document', id})
      }}
    />
  )
}
