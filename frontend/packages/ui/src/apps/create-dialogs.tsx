import {
  HM_APP_TYPE,
  HM_TOOL_TYPE,
  HM_TRIGGER_TYPE,
  TOOL_CODE_TEMPLATE,
  triggerDocumentOps,
} from '@seed-hypermedia/client/apps'
import type {DocumentOperation} from '@seed-hypermedia/client/change'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalClient} from '@shm/shared'
import {useNavigate} from '@shm/shared/utils/navigation'
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
import {freeChildId, toolCodeFolder, useAppsPublisher, type AppRef} from './publish'
import {DEFAULT_TRIGGER_SOURCE} from './trigger-view'

function attrs(values: Record<string, string>): DocumentOperation {
  return {
    type: 'SetAttributes',
    attrs: Object.entries(values)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => ({key: [key], value})),
  }
}

function NameAndSummaryForm({
  title,
  description,
  namePlaceholder,
  summaryPlaceholder,
  summaryHint,
  submitLabel,
  extra,
  onSubmit,
  onClose,
}: {
  title: string
  description: string
  namePlaceholder: string
  summaryPlaceholder: string
  /** What the description is used for, said under its field when that is worth knowing. */
  summaryHint?: string
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
        {summaryHint ? (
          <SizableText size="xs" color="muted">
            {summaryHint}
          </SizableText>
        ) : null}
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
  const serverOptions = useAgentServerOptions('apps')
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

/**
 * Why a tool's description deserves care, said wherever one is written. An agent that has the tool
 * is shown its name and this description, and nothing else, until it decides to read the tool.
 */
export const TOOL_DESCRIPTION_HINT =
  'Be precise: this is all an agent knows about the tool when it decides whether to use it. Say what the tool does, what it takes and gives back, and when to use it. How to use it goes in the documentation.'

/**
 * Creates a tool and opens it. Inside `app` the tool joins the app's list and runs with the app.
 * At a `location` that is no app, the tool stands on its own. It names no server: the app or agent
 * that later takes it says where it runs, and until then its author runs it on their own.
 */
export function CreateToolDialog({
  input,
  onClose,
}: {
  input: {app: AppRef} | {location: UnpackedHypermediaId}
  onClose: () => void
}) {
  const client = useUniversalClient()
  const publisher = useAppsPublisher()
  const navigate = useNavigate()
  const app = 'app' in input ? input.app : undefined
  return (
    <NameAndSummaryForm
      title="New tool"
      description={
        app
          ? 'A tool is one function of this app: an input schema, an output schema and its code.'
          : 'A tool is one function: an input schema, an output schema and its code. On its own it is a document you can try and share. An app or an agent uses it by linking to it.'
      }
      namePlaceholder="forecast"
      summaryPlaceholder="What the tool does, with what, and when to use it"
      summaryHint={TOOL_DESCRIPTION_HINT}
      submitLabel="Create tool"
      onClose={onClose}
      onSubmit={async ({name, summary}) => {
        const id = await freeChildId(client, app ? app.id : (input as {location: UnpackedHypermediaId}).location, name)
        const folder = await toolCodeFolder(TOOL_CODE_TEMPLATE)
        await publisher.create(id, [attrs({name, summary, type: HM_TOOL_TYPE, code: folder.code})], app, folder.blobs)
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
          : 'A trigger calls one of this app’s tools when something happens: on a schedule, a webhook, or activity in Hypermedia. It fires while the app runs.'
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
