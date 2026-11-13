import {
  appChildKind,
  appEmbeddedChildren,
  HM_TRIGGER_TYPE,
  isAppChildId,
  triggerDocumentOps,
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
import {Blocks, FileCode2, Plus, Wrench, Zap} from 'lucide-react'
import {useMemo, useState, type ReactNode} from 'react'
import {useUniversalClient} from '@shm/shared'
import {Button} from '../button'
import {DocumentPageView, documentPageCid} from '../document-page'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useAppsPublisher, type AppRef} from './publish'
import {AppSettingsTab} from './app-settings'
import {AppRunStatus, useAppRun, useAppServerUrl} from './running'
import {freeChildId} from './create-dialogs'
import {DEFAULT_TRIGGER_SOURCE} from './trigger-view'

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

function AppChildrenTab({
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
  return (
    <TabColumn>
      {kind === 'trigger' && canEdit ? <NewTriggerButton host={app} /> : null}
      {!children.isLoading && !listed.length ? (
        <div className="border-border flex flex-col gap-2 rounded-xl border border-dashed p-6">
          <SizableText weight="bold">No {noun}s yet.</SizableText>
          <SizableText size="sm" color="muted">
            {kind === 'tool'
              ? 'A tool is one function of this app: what it takes, what it returns, and its code. Add one with New in the toolbar.'
              : kind === 'trigger'
                ? 'A trigger calls one of this app’s tools when something happens: on a schedule, when a webhook is posted, or on activity in Hypermedia. Triggers fire while the app runs.'
                : 'Pages are built by agents for now. Ask an agent to add a page to this app.'}
          </SizableText>
        </div>
      ) : null}
      {listed.map((item) => (
        <AppChildRow key={item.id.id} item={item} onOpen={() => navigate({key: 'document', id: item.id})} />
      ))}
      {strays.length ? (
        <div className="mt-4 flex flex-col gap-1">
          <SizableText size="sm" weight="bold" color="muted">
            Not in this app
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
}: {
  item: AppChildItem
  onOpen: () => void
  muted?: boolean
  action?: ReactNode
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

/** Creates a trigger under an app or agent (listed on it in the same publish) and opens it. */
export function useCreateTriggerDocument(host: AppRef | null) {
  const client = useUniversalClient()
  const publisher = useAppsPublisher()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  async function create() {
    if (!host) return
    setCreating(true)
    try {
      const id = await freeChildId(client, host.id, 'New trigger')
      // It starts off, as an hourly schedule, until its page says what it does.
      const fields = await triggerDocumentOps({source: DEFAULT_TRIGGER_SOURCE, enabled: false})
      await publisher.create(
        id,
        [
          {
            type: 'SetAttributes',
            attrs: [
              {key: ['name'], value: 'New trigger'},
              {key: ['type'], value: HM_TRIGGER_TYPE},
            ],
          },
          ...fields.ops,
        ],
        host,
        fields.blobs,
      )
      navigate({key: 'document', id})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setCreating(false)
    }
  }
  return {create, creating}
}

/** The New trigger button of an app's or agent's Triggers tab. */
export function NewTriggerButton({host}: {host: AppRef}) {
  const {create, creating} = useCreateTriggerDocument(host)
  return (
    <Button size="sm" variant="outline" className="w-fit" disabled={creating} onClick={() => void create()}>
      <Plus className="size-4" /> New trigger
    </Button>
  )
}
