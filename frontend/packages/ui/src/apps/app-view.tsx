import {
  appChildKind,
  appEmbeddedChildren,
  HM_TOOL_TYPE,
  hostToolReferences,
  isAppChildId,
  removeToolReferenceOps,
  setToolReferenceOps,
  type AppChildKind,
} from '@seed-hypermedia/client/apps'
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
import {useMemo, useState, type ReactNode} from 'react'
import {Button} from '../button'
import {DocumentPageView, documentPageCid} from '../document-page'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useAppDialog} from '../universal-dialog'
import {CreateToolDialog} from './create-dialogs'
import {useAppsPublisher, type AppRef} from './publish'
import {AddExistingToolDialog, SpaceName} from './use-tool-dialogs'
import {AppSettingsTab, HostToolSecrets, HostToolSettings, useAppMissingConfig} from './app-settings'
import {AppRunStatus, useAppRun, useAppServerUrl, useHostTriggers, type HostTriggersInfo} from './running'
import {TriggerSourceSummary} from '../agents/trigger-types'

/** One of an app's children, as its tabs list them. */
export type AppChildItem = {id: UnpackedHypermediaId; kind: AppChildKind | null; metadata?: HMMetadata}

/**
 * A tool an app uses by reference: it lives somewhere else and stays its author's. `pinned` is the
 * version the app runs, or null when it follows the tool's latest. `latestVersion` is the newest
 * version known here, to say when a pinned tool has moved on.
 */
export type ReferencedToolItem = {
  id: UnpackedHypermediaId
  pinned: string | null
  latestVersion?: string
  metadata?: HMMetadata
}

/**
 * The children an app lists (its card embeds, in order), the documents under it that it does not
 * list, so they can be added back, and the tools it references from elsewhere.
 */
export function useAppChildren(appId: UnpackedHypermediaId, document: HMDocument) {
  const embedded = useMemo(() => appEmbeddedChildren(appId, document.content), [appId, document.content])
  const resources = useResources(embedded.map((child) => child.id))
  const references = useMemo(() => hostToolReferences(appId, document.content), [appId, document.content])
  const referenceResources = useResources(references.map((reference) => reference.id))
  const directory = useDirectory(appId)
  return useMemo(() => {
    // A card of a document that is not a tool is content of the app's document, not a tool of it.
    const referenced: ReferencedToolItem[] = references.flatMap((reference, index) => {
      const data = referenceResources[index]?.data
      const tool = data?.type === 'document' ? data.document : undefined
      if (tool?.metadata.type !== HM_TOOL_TYPE) return []
      return [{id: reference.id, pinned: reference.version, latestVersion: tool.version, metadata: tool.metadata}]
    })
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
    return {
      listed,
      strays,
      referenced,
      isLoading: [...resources, ...referenceResources].some((resource) => resource.isInitialLoading),
    }
  }, [embedded, resources, references, referenceResources, directory.data, appId])
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
  const tools = children.listed.filter((item) => item.kind === 'tool').length + children.referenced.length
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
  const referenced = kind === 'tool' ? children.referenced : []
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
  const createTool = useAppDialog(CreateToolDialog)
  const addExistingTool = useAppDialog(AddExistingToolDialog, {className: 'w-full max-w-lg'})
  return (
    <TabColumn>
      {kind === 'tool' && canEdit ? (
        <div className="flex items-center justify-end gap-2" data-testid="add-tool-actions">
          <Button size="sm" variant="outline" onClick={() => createTool.open({app})}>
            New tool
          </Button>
          <Button size="sm" variant="outline" onClick={() => addExistingTool.open({host: app})}>
            Add existing tool
          </Button>
          {createTool.content}
          {addExistingTool.content}
        </div>
      ) : null}
      {!children.isLoading && !listed.length && !referenced.length ? (
        <div className="border-border flex flex-col gap-2 rounded-xl border border-dashed p-6">
          <SizableText weight="bold">No {noun}s yet.</SizableText>
          <SizableText size="sm" color="muted">
            {kind === 'tool'
              ? `A tool is one function of this ${host}: what it takes, what it returns, and its code. Make one with New tool, or use one that lives elsewhere with Add existing tool.`
              : kind === 'trigger'
                ? host === 'agent'
                  ? 'A trigger starts a session with this agent, or calls one of its tools, when something happens: on a schedule, when a webhook is posted, or on activity in Hypermedia. Add one with New in the toolbar.'
                  : 'A trigger calls one of this app’s tools when something happens: on a schedule, when a webhook is posted, or on activity in Hypermedia. Triggers fire while the app runs. Add one with New in the toolbar.'
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
      {kind === 'tool' ? <ReferencedTools app={app} host={host} tools={referenced} canEdit={canEdit} /> : null}
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

/**
 * The tools a host uses by reference. A referenced tool lives elsewhere and stays its author's:
 * the host only points at it, at one version or at the latest. One is added with
 * {@link AddExistingToolDialog}, from the buttons above the list.
 */
function ReferencedTools({
  app,
  host,
  tools,
  canEdit,
}: {
  app: AppRef
  host: 'app' | 'agent'
  tools: ReferencedToolItem[]
  canEdit: boolean
}) {
  const navigate = useNavigate()
  const publisher = useAppsPublisher()
  const [busy, setBusy] = useState(false)
  const run = (step: () => Promise<void>) => {
    setBusy(true)
    step()
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }
  const setVersion = (tool: UnpackedHypermediaId, version: string | null) =>
    run(() => publisher.update(app.id, setToolReferenceOps(app.id, app.document.content, tool, version)))
  if (!tools.length) return null
  return (
    <div className="mt-4 flex flex-col gap-1" data-testid="referenced-tools">
      <SizableText size="sm" weight="bold" color="muted">
        From elsewhere
      </SizableText>
      <SizableText size="xs" color="muted">
        Tools this {host} uses without holding them. They stay their authors’. A pinned tool runs the version you chose.
        One that follows the latest runs whatever its author publishes, with the secrets it declares.
      </SizableText>
      {tools.map((tool) => {
        const outdated = !!tool.pinned && !!tool.latestVersion && tool.latestVersion !== tool.pinned
        return (
          <AppChildRow
            key={tool.id.id}
            item={{id: tool.id, kind: 'tool', metadata: tool.metadata}}
            onOpen={() =>
              navigate({
                key: 'document',
                id: tool.pinned ? {...tool.id, version: tool.pinned, latest: false} : tool.id,
              })
            }
            detail={
              <SizableText size="xs" color="muted">
                From <SpaceName uid={tool.id.uid} /> ·{' '}
                {tool.pinned
                  ? outdated
                    ? 'Pinned to an earlier version. A newer one is published.'
                    : 'Pinned to this version.'
                  : 'Follows the latest version.'}
              </SizableText>
            }
            action={
              canEdit ? (
                <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                  {outdated ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setVersion(tool.id, tool.latestVersion!)}
                    >
                      Update
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || (!tool.pinned && !tool.latestVersion)}
                    onClick={() => setVersion(tool.id, tool.pinned ? null : tool.latestVersion!)}
                  >
                    {tool.pinned ? 'Follow latest' : 'Pin'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Remove ${tool.metadata?.name || tool.id.path?.at(-1)}`}
                    onClick={() =>
                      run(() => publisher.update(app.id, removeToolReferenceOps(app.id, app.document.content, tool.id)))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ) : null
            }
          />
        )
      })}
    </div>
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
  const missing = useAppMissingConfig(app)
  const notSet = [...missing.public, ...missing.private]
  return (
    <button
      type="button"
      className="flex w-fit flex-col text-left"
      onClick={() => navigate({key: 'document', id: app.id, appView: 'settings'})}
    >
      <AppRunStatus
        serverUrl={server.serverUrl}
        run={status.data}
        loading={server.isLoading || status.isInitialLoading}
        error={status.isError ? status.error : undefined}
      />
      {/* Required config that is not set stops the tools that need it: say so where the app is seen. */}
      {notSet.length ? (
        <SizableText size="sm" className="text-destructive" role="alert">
          Config missing: {notSet.join(', ')}. Set it in Settings.
        </SizableText>
      ) : null}
    </button>
  )
}

/**
 * An agent's tool documents: the tools it holds and the ones it references from elsewhere, listed
 * as an app's are. What those tools need from the agent is set in its settings ({@link AgentToolConfig}).
 */
export function AgentToolDocumentsTab({host, canEdit}: {host: AppRef; canEdit: boolean}) {
  const children = useAppChildren(host.id, host.document)
  return (
    <div className="flex flex-col" data-testid="agent-tool-documents">
      <AppChildrenTab app={host} kind="tool" appChildren={children} canEdit={canEdit} />
    </div>
  )
}

/**
 * What an agent's tools need from it, in the agent's settings: the secrets they declare, kept by
 * the server that runs the agent, and their settings, saved on the agent. An app has both in its
 * own Settings. Nothing shows for an agent whose tools declare neither.
 */
export function AgentToolConfig({host, canEdit}: {host: AppRef; canEdit: boolean}) {
  return (
    <div className="flex flex-col gap-4 empty:hidden" data-testid="agent-tool-config">
      <HostToolSecrets host={host} canEdit={canEdit} />
      <HostToolSettings host={host} canEdit={canEdit} />
    </div>
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
          {tool ? `calls ${tool}` : 'starts a session'}
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
