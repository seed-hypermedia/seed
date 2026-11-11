import {fileToIpfsBlobs} from '@seed-hypermedia/client'
import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {encodeDagCbor} from '@seed-hypermedia/client/signed-blob'
import type {AgentToolInfo} from '@seed-hypermedia/apps-protocol'
import {hmId, useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {Button} from '@shm/ui/button'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import type {MenuItemType} from '@shm/ui/options-dropdown'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Package} from 'lucide-react'
import {useState, type ReactNode} from 'react'
import {APP_TOOL_TYPE, APP_TYPE} from './apps'
import {APP_SLUG_PATTERN, appSlugFromName} from './create-app-dialog'
import {mountedAgentServerUrl} from './delete-mounted-agent'
import {signDocumentAttributes, type PreparedAgentMount} from './mount'
import {useAgentDetail, useAgentTools, useDeleteAgentTool, useRefreshApps} from './models'
import {useNavigate} from './navigation'
import {getAgentsPlatform} from './platform'

/** A page of the app this publishes, with the paragraphs of its body. */
export type PublishedAppPage = {
  id: UnpackedHypermediaId
  attrs: {key: string[]; value: string}[]
  paragraphs: {id: string; text: string}[]
}

/** The pages and the content blobs that turn an agent's authored tools into an app. */
export type PublishAppPlan = {
  pages: PublishedAppPage[]
  blobs: {cid: string; data: Uint8Array}[]
}

/** An authored lambda: the tools Publish as app offers. An app's own tools are not the agent's to publish. */
export function authoredLambdas(tools: AgentToolInfo[] | undefined): AgentToolInfo[] {
  return (tools ?? []).filter((tool) => tool.kind === 'lambda' && !tool.app && typeof tool.source === 'string')
}

/** The body of a tool page: the lambda's description, a paragraph per blank-line-separated run. */
export function descriptionParagraphs(description: string, prefix: string): {id: string; text: string}[] {
  return description
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((text, index) => ({id: `${prefix}${index + 1}`, text}))
}

/**
 * Plans the app: the app page beside the agent in its space, published in the copy form so it is
 * installed for the space the moment it exists, the typed `tools` folder, and one tool page per
 * lambda whose contract and code become content-addressed blobs. A lambda's source is one file,
 * within the size the environment accepts as a single raw block.
 */
export async function planAppFromTools(
  parent: UnpackedHypermediaId,
  {name, slug, summary}: {name: string; slug: string; summary: string},
  tools: AgentToolInfo[],
): Promise<PublishAppPlan> {
  const appPath = [...(parent.path ?? []), slug]
  const blobs: PublishAppPlan['blobs'] = []
  const pages: PublishedAppPage[] = [
    {
      id: hmId(parent.uid, {path: appPath}),
      attrs: [
        {key: ['name'], value: name},
        {key: ['summary'], value: summary},
        {key: ['attributesSchema'], value: APP_TYPE},
        {key: ['slug'], value: slug},
        {key: ['install', 'scope'], value: 'space'},
        {key: ['install', 'enabled'], value: 'true'},
      ],
      paragraphs: descriptionParagraphs(
        `${name} is an app published from an agent's own tools. Its tools, listed under this page, run in the sandbox of the app environment for every agent of the space.`,
        'intro-',
      ),
    },
    {
      id: hmId(parent.uid, {path: [...appPath, 'tools']}),
      attrs: [
        {key: ['name'], value: 'Tools'},
        {key: ['summary'], value: `The tools of ${name}: one page per tool, with its contract and its code.`},
        {key: ['childAttributesSchema'], value: APP_TOOL_TYPE},
      ],
      paragraphs: [],
    },
  ]
  for (const tool of tools) {
    const code = await fileToIpfsBlobs(new TextEncoder().encode(tool.source ?? ''))
    blobs.push(...code.blobs)
    const input = await encodeDagCbor(tool.input)
    blobs.push(input)
    const output = tool.output ? await encodeDagCbor(tool.output) : null
    if (output) blobs.push(output)
    pages.push({
      id: hmId(parent.uid, {path: [...appPath, 'tools', tool.name]}),
      attrs: [
        {key: ['name'], value: tool.name},
        {key: ['summary'], value: tool.summary || tool.description.split(/[.\n]/)[0] || tool.name},
        {key: ['attributesSchema'], value: APP_TOOL_TYPE},
        {key: ['tool'], value: tool.name},
        {key: ['runtime'], value: tool.runtime === 'python' ? 'python' : 'ts'},
        {key: ['inputSchema'], value: `ipfs://${input.cid}`},
        ...(output ? [{key: ['outputSchema'], value: `ipfs://${output.cid}`}] : []),
        {key: ['code'], value: `ipfs://${code.cid}`},
      ],
      paragraphs: descriptionParagraphs(tool.description, `${tool.name}-`),
    })
  }
  return {pages, blobs}
}

/** Signs every page of the plan, parents first. */
export async function preparePublishedApp({
  client,
  accountUid,
  plan,
}: {
  client: ReturnType<typeof useUniversalClient>
  accountUid: string
  plan: PublishAppPlan
}): Promise<PreparedAgentMount[]> {
  const prepared: PreparedAgentMount[] = []
  for (const page of plan.pages) {
    prepared.push(
      await signDocumentAttributes({client, accountUid, to: page.id, attrs: page.attrs, paragraphs: page.paragraphs}),
    )
  }
  return prepared
}

/**
 * Publish as app: the agent's authored tools become an app page with a tools folder, beside the
 * agent in its space and installed there at once, signed by the person. The agent's own copies of
 * the tools go unless kept, since a lambda of the same name would keep shadowing the app's tool.
 */
export function PublishAppDialog({
  input,
  onClose,
}: {
  input: {serverUrl: string; accountUid: string; agentId: string; parent: UnpackedHypermediaId; agentName: string}
  onClose: () => void
}) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const {onPushPublished} = useUniversalAppContext()
  const agentTools = useAgentTools(input.serverUrl, input.accountUid, input.agentId)
  const deleteTool = useDeleteAgentTool(input.serverUrl, input.accountUid)
  const refreshApps = useRefreshApps(input.serverUrl, input.accountUid)
  const lambdas = authoredLambdas(agentTools.data?.tools)
  const [excluded, setExcluded] = useState<string[]>([])
  const [name, setName] = useState(`${input.agentName} tools`)
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [summary, setSummary] = useState('')
  const [removeCopies, setRemoveCopies] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = lambdas.filter((tool) => !excluded.includes(tool.name))
  const effectiveSlug = slugEdited ? slug : appSlugFromName(name)
  const ready =
    selected.length > 0 && name.trim().length > 0 && summary.trim().length > 0 && APP_SLUG_PATTERN.test(effectiveSlug)

  async function publish() {
    if (!ready || publishing) return
    setPublishing(true)
    setError(null)
    try {
      const plan = await planAppFromTools(
        input.parent,
        {name: name.trim(), slug: effectiveSlug, summary: summary.trim()},
        selected,
      )
      const pages = await preparePublishedApp({client, accountUid: input.accountUid, plan})
      await client.publish({blobs: [...plan.blobs, ...pages.flatMap((page) => page.blobs)]})
      if (removeCopies) {
        for (const tool of selected) await deleteTool.mutateAsync({agentId: input.agentId, name: tool.name})
      }
      await refreshApps.mutateAsync().catch(() => undefined)
      for (const page of plan.pages) invalidateQueries([queryKeys.ENTITY, page.id.id])
      invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, input.parent.uid])
      const appId = plan.pages[0]!.id
      onPushPublished?.(appId)
      toast.success(`${name.trim()} is published and installed`)
      onClose()
      navigate({key: 'document', id: appId})
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not publish the app')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void publish()
      }}
    >
      <DialogTitle>Publish as app</DialogTitle>
      <DialogDescription>
        The tools this agent wrote for itself become an app: a page with a tools folder, installed in this space, that
        every agent here can use and any space can install. The prompt and the memory stay the agent's.
      </DialogDescription>
      <div className="flex flex-col gap-2">
        <SizableText size="sm" weight="bold">
          Tools
        </SizableText>
        {agentTools.isLoading ? (
          <SizableText size="sm" color="muted">
            Loading the agent's tools…
          </SizableText>
        ) : lambdas.length === 0 ? (
          <SizableText size="sm" color="muted">
            This agent has no tools of its own yet. Ask it to write one, or add one on its permissions page.
          </SizableText>
        ) : (
          lambdas.map((tool) => (
            <label key={tool.name} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={!excluded.includes(tool.name)}
                onChange={(event) =>
                  setExcluded((current) =>
                    event.target.checked ? current.filter((item) => item !== tool.name) : [...current, tool.name],
                  )
                }
              />
              <SizableText size="sm" weight="bold" className="font-mono">
                {tool.name}
              </SizableText>
              <SizableText size="sm" color="muted" className="truncate">
                {tool.summary}
              </SizableText>
            </label>
          ))
        )}
      </div>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Name
        </SizableText>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Slug
        </SizableText>
        <Input
          value={effectiveSlug}
          onChange={(event) => {
            setSlugEdited(true)
            setSlug(event.target.value)
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Summary
        </SizableText>
        <Input
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="What the app does, in one sentence"
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4"
          checked={removeCopies}
          onChange={(event) => setRemoveCopies(event.target.checked)}
        />
        <SizableText size="sm">Remove the agent's own copies once the app is installed</SizableText>
      </label>
      {error ? (
        <SizableText size="sm" className="text-destructive">
          {error}
        </SizableText>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready || publishing}>
          {publishing ? 'Publishing…' : 'Publish app'}
        </Button>
      </div>
    </form>
  )
}

/**
 * "Publish as app…" for a mounted agent document's options menu, offered to the agent's owner once
 * its tools have loaded and at least one is its own.
 */
export function usePublishAgentAsAppMenu(
  docId: UnpackedHypermediaId,
  metadata: HMMetadata | undefined,
): {item: MenuItemType | null; content: ReactNode} {
  const serverUrl = mountedAgentServerUrl(metadata)
  const accountUid = getAgentsPlatform().useAccountUid()
  const agentId = hmId(docId.uid, {path: docId.path}).id
  const agent = useAgentDetail(serverUrl, accountUid, agentId)
  const tools = useAgentTools(serverUrl, accountUid, agentId)
  const dialog = useAppDialog(PublishAppDialog, {className: 'w-full max-w-xl'})
  const lambdas = authoredLambdas(tools.data?.tools)
  const canPublish =
    !!serverUrl &&
    !!accountUid &&
    agent.data?.agent.id === agentId &&
    agent.data.agent.accessRole === 'owner' &&
    lambdas.length > 0
  const parent = hmId(docId.uid, {path: (docId.path ?? []).slice(0, -1)})
  return {
    item: canPublish
      ? {
          key: 'publish-agent-as-app',
          label: 'Publish as app…',
          icon: <Package className="size-4" />,
          onClick: () =>
            dialog.open({
              serverUrl,
              accountUid,
              agentId,
              parent,
              agentName: agent.data?.agent.definition.name ?? 'Agent',
            }),
        }
      : null,
    content: dialog.content,
  }
}
