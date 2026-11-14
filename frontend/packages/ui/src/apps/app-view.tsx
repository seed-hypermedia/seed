import {appChildKind, appEmbeddedChildren, isAppChildId, type AppChildKind} from '@seed-hypermedia/client/apps'
import {
  packHmId,
  unpackHmId,
  type HMDocument,
  type HMMetadata,
  type UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {useDirectory, useResource, useResources} from '@shm/shared/models/entity'
import type {DocumentRoute} from '@shm/shared/routes'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Blocks, FileCode2, Wrench, Zap} from 'lucide-react'
import {useMemo, type ReactNode} from 'react'
import {Button} from '../button'
import {DocumentPageView, documentPageCid} from '../document-page'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useAppsPublisher, type AppRef} from './publish'
import {AppSettingsTab} from './app-settings'
import {AppRunStatus, useAppRun, useAppServerUrl, useHostTriggers, type HostTriggersInfo} from './running'
import {TriggerSourceSummary} from '../agents/trigger-types'

/** One of an app's children, as its tabs list them. */
export type AppChildItem = {id: UnpackedHypermediaId; kind: AppChildKind | null; metadata?: HMMetadata}

/**
 * The children an app lists (its card embeds, in order) and the documents under it that it does
 * not list, so they can be added back.
 */
export function useAppChildren(appId: UnpackedHypermediaId, document: HMDocument) {
  const embedded = useMemo(() => appEmbeddedChildren(appId, document.content), [appId, document.content])
  const resources = useResources(embedded.map((child) => child.id))
  const directory = useDirectory(appId)
  return useMemo(() => {
    const listed: AppChildItem[] = embedded.map((child, index) => {
      const data = resources[index]?.data
      const childDocument = data?.type === 'document' ? data.document : undefined
      return {id: child.id, kind: appChildKind(childDocument?.metadata.type), metadata: childDocument?.metadata}
    })
    const listedIds = new Set(listed.map((item) => item.id.id))
    const strays: AppChildItem[] = (directory.data ?? [])
      .filter((info) => isAppChildId(appId, info.id) && !listedIds.has(packHmId({...info.id, version: null})))
      .map((info) => ({id: info.id, kind: appChildKind(info.metadata.type), metadata: info.metadata}))
      .filter((item) => item.kind !== null)
    return {listed, strays, isLoading: resources.some((resource) => resource.isInitialLoading)}
  }, [embedded, resources, directory.data, appId])
}

/** An app document's tabs: Home, Tools, Pages and Settings. */
export function AppDocumentView({
  docId,
  document,
  appView,
  canEdit,
  onPageAccessChange,
  onPageParametersChange,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  appView: DocumentRoute['appView']
  canEdit: boolean
  /** Hands the home page's permission manager to the host's options menu, as a page document does. */
  onPageAccessChange?: (manage: (() => void) | null) => void
  /** Hands the home page's parameter editor to the host's options menu. */
  onPageParametersChange?: (edit: (() => void) | null) => void
}) {
  const app: AppRef = useMemo(() => ({id: docId, document}), [docId, document])
  const children = useAppChildren(docId, document)
  if (appView === 'tools') return <AppChildrenTab app={app} kind="tool" appChildren={children} canEdit={canEdit} />
  if (appView === 'pages') return <AppChildrenTab app={app} kind="page" appChildren={children} canEdit={canEdit} />
  if (appView === 'triggers')
    return <AppChildrenTab app={app} kind="trigger" appChildren={children} canEdit={canEdit} />
  if (appView === 'settings') return <AppSettingsTab app={app} canEdit={canEdit} />
  return (
    <AppHomeTab
      app={app}
      appChildren={children}
      onPageAccessChange={onPageAccessChange}
      onPageParametersChange={onPageParametersChange}
    />
  )
}

function TabColumn({children}: {children: ReactNode}) {
  return (
    <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto p-4">
      {children}
    </section>
  )
}

function AppHomeTab({
  app,
  appChildren: children,
  onPageAccessChange,
  onPageParametersChange,
}: {
  app: AppRef
  appChildren: ReturnType<typeof useAppChildren>
  onPageAccessChange?: (manage: (() => void) | null) => void
  onPageParametersChange?: (edit: (() => void) | null) => void
}) {
  const navigate = useNavigate()
  const homeId = useMemo(() => {
    const id = app.document.metadata.homePage ? unpackHmId(app.document.metadata.homePage) : null
    return id && isAppChildId(app.id, id) ? id : null
  }, [app])
  const home = useResource(homeId)
  const homeDocument = home.data?.type === 'document' ? home.data.document : null
  const homeCid = documentPageCid(homeDocument)
  if (homeId && homeDocument && homeCid)
    return (
      <div data-app-home-page className="min-h-0 flex-1">
        <DocumentPageView
          docId={homeId}
          document={homeDocument}
          cid={homeCid}
          fill
          onAccountAccessChange={onPageAccessChange}
          onParametersChange={onPageParametersChange}
        />
      </div>
    )
  const tools = children.listed.filter((item) => item.kind === 'tool').length
  const pages = children.listed.filter((item) => item.kind === 'page').length
  const triggers = children.listed.filter((item) => item.kind === 'trigger').length
  const updated = app.document.updateTime ? new Date(String(app.document.updateTime)) : null
  return (
    <TabColumn>
      <div className="flex flex-col gap-2 py-4">
        <SizableText size="3xl" weight="bold">
          {app.document.metadata.name || 'Untitled app'}
        </SizableText>
        {app.document.metadata.summary ? (
          <SizableText color="muted">{app.document.metadata.summary}</SizableText>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => navigate({key: 'document', id: app.id, appView: 'tools'})}>
          <Wrench className="size-4" /> {tools} {tools === 1 ? 'tool' : 'tools'}
        </Button>
        <Button variant="outline" onClick={() => navigate({key: 'document', id: app.id, appView: 'pages'})}>
          <FileCode2 className="size-4" /> {pages} {pages === 1 ? 'page' : 'pages'}
        </Button>
        <Button variant="outline" onClick={() => navigate({key: 'document', id: app.id, appView: 'triggers'})}>
          <Zap className="size-4" /> {triggers} {triggers === 1 ? 'trigger' : 'triggers'}
        </Button>
      </div>
      <AppHomeRunStatus app={app} />
      {updated && !Number.isNaN(updated.getTime()) ? (
        <SizableText size="xs" color="muted">
          Updated {updated.toLocaleString()}
        </SizableText>
      ) : null}
    </TabColumn>
  )
}

/** An app's or agent's Tools, Pages or Triggers tab: its listed children of one kind. */
export function AppChildrenTab({
  app,
  kind,
  appChildren: children,
  canEdit,
}: {
  app: AppRef
  kind: AppChildKind
  appChildren: ReturnType<typeof useAppChildren>
  canEdit: boolean
}) {
  const navigate = useNavigate()
  const publisher = useAppsPublisher()
  const listed = children.listed.filter((item) => item.kind === kind)
  const strays = children.strays.filter((item) => item.kind === kind)
  const noun = kind
  const host = app.document.metadata.type === 'hm://hyper.media/agent' ? 'agent' : 'app'
  // A trigger row says when it fires, what it does and whether it can, as the host's server holds it.
  const server = useAppServerUrl(app.id, app.document)
  const hostTriggers = useHostTriggers(kind === 'trigger' ? server.serverUrl : '', app.id.id)
  const triggerStates: TriggerStates = {
    active: hostTriggers.data?.active,
    loading: server.isLoading || hostTriggers.isInitialLoading,
    triggers: hostTriggers.data?.triggers ?? [],
    errors: hostTriggers.data?.errors ?? [],
    host,
  }
  return (
    <TabColumn>
      {!children.isLoading && !listed.length ? (
        <div className="border-border flex flex-col gap-2 rounded-xl border border-dashed p-6">
          <SizableText weight="bold">No {noun}s yet.</SizableText>
          <SizableText size="sm" color="muted">
            {kind === 'tool'
              ? `A tool is one function of this ${host}: what it takes, what it returns, and its code. Add one with New in the toolbar.`
              : kind === 'trigger'
                ? host === 'agent'
                  ? 'A trigger starts a session with this agent, or calls one of its tools, when something happens: on a schedule, when a webhook is posted, or on activity in Hypermedia. Add one with New in the toolbar.'
                  : 'A trigger does something for this app when something happens (on a schedule, when a webhook is posted, or on activity in Hypermedia): it calls one of the app’s tools, or has an agent do the work. Triggers fire while the app runs. Add one with New in the toolbar.'
                : `Pages are built by agents for now. Ask an agent to add a page to this ${host}.`}
          </SizableText>
        </div>
      ) : null}
      {listed.map((item) => (
        <AppChildRow
          key={item.id.id}
          item={item}
          onOpen={() => navigate({key: 'document', id: item.id})}
          detail={kind === 'trigger' ? <TriggerRowDetail item={item} state={triggerStates} /> : undefined}
        />
      ))}
      {strays.length ? (
        <div className="mt-4 flex flex-col gap-1">
          <SizableText size="sm" weight="bold" color="muted">
            Not in this {host}
          </SizableText>
          <SizableText size="xs" color="muted">
            These are under this {host} but it does not list them, so it does not use them. Add lists one.
          </SizableText>
          {strays.map((item) => (
            <AppChildRow
              key={item.id.id}
              item={item}
              muted
              onOpen={() => navigate({key: 'document', id: item.id})}
              action={
                canEdit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation()
                      publisher
                        .addToApp(app, item.id)
                        .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
                    }}
                  >
                    Add
                  </Button>
                ) : null
              }
            />
          ))}
        </div>
      ) : null}
    </TabColumn>
  )
}

function AppChildRow({
  item,
  onOpen,
  muted,
  action,
  detail,
}: {
  item: AppChildItem
  onOpen: () => void
  muted?: boolean
  action?: ReactNode
  detail?: ReactNode
}) {
  const Icon = item.kind === 'tool' ? Wrench : item.kind === 'trigger' ? Zap : Blocks
  return (
    <div
      role="button"
      tabIndex={0}
      className="hover:bg-muted/60 flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen()
      }}
    >
      <Icon className="text-muted-foreground mt-1 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <SizableText weight="bold" color={muted ? 'muted' : undefined} className="truncate">
          {item.metadata?.name || item.id.path?.at(-1)}
        </SizableText>
        {item.metadata?.summary ? (
          <SizableText size="sm" color="muted" className="line-clamp-2">
            {item.metadata.summary}
          </SizableText>
        ) : null}
        {detail}
      </div>
      {action}
    </div>
  )
}

/** Home's one line about running, linking to Settings where it is managed. */
function AppHomeRunStatus({app}: {app: AppRef}) {
  const navigate = useNavigate()
  const server = useAppServerUrl(app.id, app.document)
  const {status} = useAppRun(server.serverUrl, app.id.id)
  return (
    <button
      type="button"
      className="w-fit text-left"
      onClick={() => navigate({key: 'document', id: app.id, appView: 'settings'})}
    >
      <AppRunStatus
        serverUrl={server.serverUrl}
        run={status.data}
        loading={server.isLoading || status.isInitialLoading}
        error={status.isError ? status.error : undefined}
      />
    </button>
  )
}

/** An agent's Triggers tab: its trigger documents, listed and created like an app's. */
export function AgentTriggerDocumentsTab({host, canEdit}: {host: AppRef; canEdit: boolean}) {
  const children = useAppChildren(host.id, host.document)
  return <AppChildrenTab app={host} kind="trigger" appChildren={children} canEdit={canEdit} />
}

type TriggerStates = {
  active: boolean | undefined
  loading: boolean
  triggers: HostTriggersInfo['triggers']
  errors: HostTriggersInfo['errors']
  host: 'app' | 'agent'
}

/** A trigger's row: when it fires, what it does, and whether it is on and able to fire. */
function TriggerRowDetail({item, state}: {item: AppChildItem; state: TriggerStates}) {
  const entry = state.triggers.find((candidate) => candidate.trigger.documentId === item.id.id)
  const problem = state.errors.find((candidate) => candidate.documentId === item.id.id)?.error
  const enabled =
    item.metadata?.enabled !== false && (item.metadata as {enabled?: unknown} | undefined)?.enabled !== 'false'
  const toolUrl = (item.metadata as {tool?: unknown} | undefined)?.tool
  const toolResource = useResource(typeof toolUrl === 'string' ? unpackHmId(toolUrl) : null)
  const tool =
    typeof toolUrl === 'string'
      ? (toolResource.data?.type === 'document' && toolResource.data.document.metadata.name) ||
        toolUrl.split('/').at(-1)
      : null
  // An app's trigger without a tool hands its work to the agent it names.
  const agentUrl = (item.metadata as {agent?: unknown} | undefined)?.agent
  const agentResource = useResource(typeof agentUrl === 'string' ? unpackHmId(agentUrl) : null)
  const agent =
    typeof agentUrl === 'string'
      ? (agentResource.data?.type === 'document' && agentResource.data.document.metadata.name) ||
        agentUrl.split('/').at(-1)
      : null
  const status = !enabled
    ? {label: 'Off', tone: 'muted' as const}
    : problem
      ? {label: `Can’t fire: ${problem}`, tone: 'destructive' as const}
      : state.active === false
        ? {label: state.host === 'app' ? 'Not running' : 'Not on its server', tone: 'muted' as const}
        : entry
          ? {label: 'On', tone: 'success' as const}
          : state.loading
            ? null
            : {label: 'Not active yet', tone: 'muted' as const}
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {entry ? (
        <SizableText size="xs" color="muted">
          <TriggerSourceSummary source={entry.trigger.source} />
          {' · '}
          {tool ? `calls ${tool}` : agent ? `${agent} does the work` : 'starts a session'}
        </SizableText>
      ) : null}
      {status ? (
        <SizableText
          size="xs"
          weight="medium"
          className={
            status.tone === 'destructive'
              ? 'text-destructive'
              : status.tone === 'success'
                ? 'text-green-700 dark:text-green-400'
                : 'text-muted-foreground'
          }
        >
          {status.label}
        </SizableText>
      ) : null}
    </div>
  )
}
