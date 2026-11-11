import {appChildKind, appEmbeddedChildren, isAppChildId, type AppChildKind} from '@seed-hypermedia/client/apps'
import {
  packHmId,
  unpackHmId,
  type HMDocument,
  type HMMetadata,
  type UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {useDirectory, useResource, useResources} from '@shm/shared/models/entity'
import type {DocumentRoute} from '@shm/shared/routes'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Blocks, FileCode2, Plus, Wrench} from 'lucide-react'
import {useEffect, useMemo, useState, type ReactNode} from 'react'
import {Button} from '../button'
import {Input} from '../components/input'
import {Label} from '../components/label'
import {Textarea} from '../components/textarea'
import {DocumentPageView, documentPageCid} from '../document-page'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useAppDialog} from '../universal-dialog'
import {CreateToolDialog} from './create-dialogs'
import {setAttribute, useAppsPublisher, type AppRef} from './publish'

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
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  appView: DocumentRoute['appView']
  canEdit: boolean
}) {
  const app: AppRef = useMemo(() => ({id: docId, document}), [docId, document])
  const children = useAppChildren(docId, document)
  if (appView === 'tools') return <AppChildrenTab app={app} kind="tool" appChildren={children} canEdit={canEdit} />
  if (appView === 'pages') return <AppChildrenTab app={app} kind="page" appChildren={children} canEdit={canEdit} />
  if (appView === 'settings') return <AppSettingsTab app={app} pages={children.listed} canEdit={canEdit} />
  return <AppHomeTab app={app} appChildren={children} />
}

function TabColumn({children}: {children: ReactNode}) {
  return (
    <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto p-4">
      {children}
    </section>
  )
}

function AppHomeTab({app, appChildren: children}: {app: AppRef; appChildren: ReturnType<typeof useAppChildren>}) {
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
        <DocumentPageView docId={homeId} document={homeDocument} cid={homeCid} fill />
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
  const createTool = useAppDialog(CreateToolDialog)
  const listed = children.listed.filter((item) => item.kind === kind)
  const strays = children.strays.filter((item) => item.kind === kind)
  const noun = kind === 'tool' ? 'tool' : 'page'
  return (
    <TabColumn>
      {createTool.content}
      {kind === 'tool' && canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" variant="default" onClick={() => createTool.open({app})}>
            <Plus className="size-4" /> New tool
          </Button>
        </div>
      ) : null}
      {!children.isLoading && !listed.length ? (
        <div className="border-border flex flex-col gap-2 rounded-xl border border-dashed p-6">
          <SizableText weight="bold">No {noun}s yet.</SizableText>
          <SizableText size="sm" color="muted">
            {kind === 'tool'
              ? 'A tool is one function of this app: what it takes, what it returns, and its code.'
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
  const Icon = item.kind === 'tool' ? Wrench : Blocks
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

function AppSettingsTab({app, pages, canEdit}: {app: AppRef; pages: AppChildItem[]; canEdit: boolean}) {
  const publisher = useAppsPublisher()
  const navigate = useNavigate()
  const saved = app.document.metadata
  const [name, setName] = useState(saved.name ?? '')
  const [summary, setSummary] = useState(saved.summary ?? '')
  const [homePage, setHomePage] = useState(saved.homePage ?? '')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    setName(saved.name ?? '')
    setSummary(saved.summary ?? '')
    setHomePage(saved.homePage ?? '')
  }, [saved.name, saved.summary, saved.homePage])
  const dirty = name !== (saved.name ?? '') || summary !== (saved.summary ?? '') || homePage !== (saved.homePage ?? '')
  const pageChoices = pages.filter((item) => item.kind === 'page')
  async function save() {
    setBusy(true)
    try {
      const ops = []
      if (name !== (saved.name ?? '')) ops.push(setAttribute('name', name.trim()))
      if (summary !== (saved.summary ?? '')) ops.push(setAttribute('summary', summary.trim() || null))
      if (homePage !== (saved.homePage ?? '')) ops.push(setAttribute('homePage', homePage || null))
      await publisher.update(app.id, ops)
      toast.success('App saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <TabColumn>
      <div className="grid gap-1">
        <Label htmlFor="app-settings-name">Name</Label>
        <Input id="app-settings-name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="app-settings-summary">Description</Label>
        <Textarea
          id="app-settings-summary"
          value={summary}
          disabled={!canEdit}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="app-settings-home">Home page</Label>
        <select
          id="app-settings-home"
          className="border-border bg-background h-9 rounded-md border px-2 text-sm"
          value={homePage}
          disabled={!canEdit}
          onChange={(e) => setHomePage(e.target.value)}
        >
          <option value="">App overview</option>
          {pageChoices.map((item) => (
            <option key={item.id.id} value={item.id.id}>
              {item.metadata?.name || item.id.path?.at(-1)}
            </option>
          ))}
        </select>
        <SizableText size="xs" color="muted">
          The Home tab shows this page, or an overview of the app.
        </SizableText>
      </div>
      {canEdit ? (
        <div className="flex items-center justify-between gap-2 pt-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <SizableText size="sm">Delete this app? Its tools and pages stay.</SizableText>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  publisher
                    .remove(app.id, app.document)
                    .then(() => navigate({key: 'document', id: hmId(app.id.uid, {path: app.id.path?.slice(0, -1)})}))
                    .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
                    .finally(() => setBusy(false))
                }}
              >
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
              Delete app
            </Button>
          )}
          <Button variant="default" disabled={!dirty || !name.trim() || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ) : null}
    </TabColumn>
  )
}
