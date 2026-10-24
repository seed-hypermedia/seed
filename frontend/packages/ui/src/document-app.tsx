import {useQuery, useQueryClient} from '@tanstack/react-query'
import React from 'react'
import {cn} from './utils'
import {Button} from './button'
import {toast} from './toast'
import {queryKeys} from '@shm/shared/models/query-keys'
import {documentAppContent, createDocumentAppAccess} from '@shm/shared/document-app-content'
import {DocumentAppPermissionPrompt, DocumentAppPermissionSettings} from './document-app-permissions'
import {
  appPermissionStorageKey,
  readAppPermissionGrants,
  type AppPermissionRequest,
  type AppPermissionDecision,
  type AppPermissionGrant,
} from '@shm/shared/document-app-permissions'
import {useSelectedAccountContacts} from '@shm/shared/models/contacts'
import {documentAppStorage, mountDocumentApp} from '@shm/shared/document-app-sandbox'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {DocumentAppPlatform} from '@shm/shared/document-app'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryAccount} from '@shm/shared/models/queries'
import {useUniversalClient, useOpenUrl, useUniversalAppContext} from '@shm/shared/routing'
import {useResource, useSelectedAccountId} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {
  documentAppRuntime,
  parseDocumentAppLink,
  createDocumentAppMessageListener,
  documentAppOrigin,
  getDocumentAppPlatform,
  parseDocumentAppReference,
  type DocumentAppContext,
  type DocumentAppRequest,
} from '@shm/shared/document-app'

/** The folder CID of a document's app, when the document is one. */
export function documentAppCid(document: Pick<HMDocument, 'metadata'> | null | undefined): string | null {
  return parseDocumentAppReference(document?.metadata?.app)
}

/**
 * A document app in place of the document body. Each platform isolates its frame and
 * answers SDK calls through the host with independent read, signing and publication approvals.
 */
type DocumentAppViewProps = {
  docId: UnpackedHypermediaId
  document: HMDocument
  cid: string
  perspectiveAccountUid?: string | null
  /** Fill the main view without a border or document margins. */
  fill?: boolean
  /** Put the permission manager in host navigation instead of the inline toolbar. */
  onAccountAccessChange?: (manage: (() => void) | null) => void
}

type AppContentHandler = (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>
type AppRuntimeProps = DocumentAppViewProps & {content: AppContentHandler}

/** Render only approved launches, then gate each data or signing capability independently. */
export function DocumentAppView(props: DocumentAppViewProps) {
  const account = useSelectedAccountId()
  return (
    <DocumentAppLaunch key={JSON.stringify([props.docId.id, props.document.version, props.cid, account])} {...props} />
  )
}

function DocumentAppLaunch(props: DocumentAppViewProps) {
  const account = useSelectedAccountId()
  const contacts = useSelectedAccountContacts()
  const {originHomeId} = useUniversalAppContext()
  const platform = getDocumentAppPlatform()
  const [accepted, setAccepted] = React.useState(false)
  const known =
    props.docId.uid === account ||
    contacts.data?.some((contact) => contact.subject === props.docId.uid && contact.subscribe?.site) ||
    (platform && 'loadAppHtml' in platform && originHomeId?.uid === props.docId.uid)
  if (known || accepted) return <DocumentAppSession {...props} />
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="border-border bg-background flex max-w-md flex-col gap-4 rounded-xl border p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Run {props.document.metadata?.name || 'this app'}?</h2>
        <p className="text-muted-foreground text-sm">
          This app is from a site you haven’t joined. Apps can show misleading screens, use device resources and open
          links.
        </p>
        <p className="text-sm">
          Seed will ask before sharing your account identity, reading content or saved app data, or signing anything.
          Joining is optional.
        </p>
        <Button onClick={() => setAccepted(true)}>Run app</Button>
      </div>
    </div>
  )
}

function DocumentAppSession(props: DocumentAppViewProps) {
  const account = useSelectedAccountId()
  const client = useUniversalClient()
  const openUrl = useOpenUrl()
  const queryClient = useQueryClient()
  const profile = useQuery(queryAccount(client, account))
  const documentId = hmId(props.docId.uid, {path: props.docId.path}).id
  const key = appPermissionStorageKey(account, documentId)
  const source = React.useRef(Symbol())
  const initial = React.useMemo(() => {
    try {
      return readAppPermissionGrants(window.localStorage, key)
    } catch {
      return []
    }
  }, [key])
  const [grants, setGrants] = React.useState<AppPermissionGrant[]>(initial)
  const [settings, setSettings] = React.useState(false)
  const [approval, setApproval] = React.useState<{
    id: string
    request: AppPermissionRequest
    finish: (decision: AppPermissionDecision) => void
  } | null>(null)
  const access = React.useMemo(
    () =>
      createDocumentAppAccess(
        (request, signal) =>
          new Promise<AppPermissionDecision>((resolve) => {
            signal.throwIfAborted()
            let finished = false
            const finish = (decision: AppPermissionDecision) => {
              if (finished) return
              finished = true
              signal.removeEventListener('abort', cancel)
              setApproval(null)
              resolve(decision)
            }
            const cancel = () => finish('deny')
            signal.addEventListener('abort', cancel, {once: true})
            setApproval({id: crypto.randomUUID(), request, finish})
          }),
        (saved) => {
          setGrants(saved)
          try {
            window.localStorage.setItem(key, JSON.stringify(saved))
            window.dispatchEvent(
              new CustomEvent('seed-app-permissions-changed', {detail: {key, source: source.current}}),
            )
          } catch {
            toast.error('Could not save this permission. It will last only while this app is open.')
          }
        },
        initial,
      ),
    [key, initial],
  )
  React.useLayoutEffect(() => {
    access.start()
    return () => access.close()
  }, [access])
  React.useEffect(() => {
    const refresh = (event: Event) => {
      if (
        event instanceof StorageEvent
          ? event.key !== key && event.key !== null
          : (event as CustomEvent).detail?.key !== key || (event as CustomEvent).detail?.source === source.current
      )
        return
      let saved: AppPermissionGrant[] = []
      try {
        saved = readAppPermissionGrants(window.localStorage, key)
      } catch {}
      access.replace(saved)
      setGrants(saved)
    }
    window.addEventListener('storage', refresh)
    window.addEventListener('seed-app-permissions-changed', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('seed-app-permissions-changed', refresh)
    }
  }, [key, access])
  React.useEffect(() => {
    props.onAccountAccessChange?.(() => setSettings(true))
    return () => props.onAccountAccessChange?.(null)
  }, [props.onAccountAccessChange])
  const content = React.useCallback<AppContentHandler>(
    async (method, params, signal) => {
      signal.throwIfAborted()
      const context: DocumentAppContext = {
        protocol: 1,
        document: documentId,
        version: props.document.version,
        account,
        app: props.cid,
      }
      if (method === 'storage.get' || method === 'storage.set') {
        const authorized = access.signal(signal)
        if (method === 'storage.get')
          await access.authorize(
            {
              kind: 'read',
              type: 'AppState',
              title: 'Read this app’s saved data',
              resource: `${documentId}#app-state`,
              details: {key: (params as {key?: unknown})?.key},
              warning: 'Saved data may contain information shared during earlier visits.',
            },
            authorized,
          )
        authorized.throwIfAborted()
        return documentAppStorage(window.localStorage, context, method, params as Record<string, unknown>)
      }
      if (method === 'open') {
        try {
          const link = parseDocumentAppLink(params)
          if (link.url.startsWith('hm://')) await openUrl(link.url, link.newWindow)
          else {
            const platform = getDocumentAppPlatform()
            if (!platform?.openExternalUrl) throw new Error('This host cannot open web links. Update Seed.')
            await platform.openExternalUrl(link.url, link.newWindow)
          }
          return null
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Unable to open link')
          throw error
        }
      }
      const result = await documentAppContent({
        method,
        params,
        signal,
        client,
        access,
        visibility: props.document.visibility,
        context,
      })
      if (
        ['comments.create', 'publish', 'publishDocument'].includes(method) ||
        (method === 'request' && (params as {key?: string})?.key === 'PublishBlobs')
      ) {
        void queryClient.invalidateQueries({queryKey: [queryKeys.DOCUMENT_COMMENTS]})
        void queryClient.invalidateQueries({queryKey: [queryKeys.DOCUMENT_DISCUSSION]})
        void queryClient.invalidateQueries({queryKey: [queryKeys.ENTITY]})
      }
      return result
    },
    [account, client, queryClient, access, documentId, props.document, props.cid, openUrl],
  )
  const platform = getDocumentAppPlatform()
  const name = props.document.metadata?.name || 'This app'
  return (
    <div className={cn('flex flex-col', props.fill ? 'h-full min-h-0' : 'gap-2')}>
      {!props.onAccountAccessChange && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setSettings(true)}>
            App permissions
          </Button>
        </div>
      )}
      <div className={cn(props.fill && 'min-h-0 flex-1')}>
        {platform && 'loadAppHtml' in platform ? (
          <SandboxDocumentAppView {...props} platform={platform} content={content} />
        ) : (
          <LegacyDocumentAppView {...props} content={content} />
        )}
      </div>
      {approval && (
        <DocumentAppPermissionPrompt
          key={approval.id}
          request={approval.request}
          appName={name}
          accountName={profile.data?.metadata?.name || (account ? 'your selected account' : 'a signed-out visitor')}
          onDecision={approval.finish}
        />
      )}
      <DocumentAppPermissionSettings
        open={settings}
        onOpenChange={setSettings}
        appName={name}
        grants={grants}
        onRemove={(index) => access.remove(index)}
        onReset={() => access.revoke()}
      />
    </div>
  )
}

function SandboxDocumentAppView({
  docId,
  document: resourceDocument,
  cid,
  fill,
  platform,
  content,
}: AppRuntimeProps & {
  platform: Extract<DocumentAppPlatform, {loadAppHtml: unknown}>
}) {
  const container = React.useRef<HTMLDivElement>(null)
  const account = useSelectedAccountId()
  const client = useUniversalClient()
  const queryClient = useQueryClient()
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  // Canonical resource identity excludes version, block fragment and the site's pretty URL.
  const id = hmId(docId.uid, {path: docId.path}).id
  const version = resourceDocument.version
  React.useEffect(() => {
    const controller = new AbortController()
    let session: ReturnType<typeof mountDocumentApp> | undefined
    setError('')
    setLoading(true)
    platform
      .loadAppHtml({id, cid, version}, controller.signal)
      .then(async (html) => {
        if (controller.signal.aborted || !container.current) return
        session = mountDocumentApp({
          container: container.current,
          html,
          context: {protocol: 1, document: id, version, account, app: cid},
          storage: window.localStorage,
          content,
          hostHandlesReads: true,
          onClose: (reason) => {
            if (!controller.signal.aborted) setError(reason)
          },
        })
        await session.ready
        if (!controller.signal.aborted) setLoading(false)
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      controller.abort()
      session?.destroy()
    }
  }, [platform, id, cid, version, account, resourceDocument, client, queryClient, content])
  return (
    <section
      aria-label={resourceDocument.metadata?.name || 'App'}
      className={cn('relative overflow-hidden', fill ? 'h-full' : 'border-border rounded-lg border')}
    >
      {error ? (
        <p role="alert" className="text-destructive p-3 text-sm">
          {error}
        </p>
      ) : loading ? (
        <p className="text-muted-foreground p-3 text-sm">Loading app…</p>
      ) : null}
      <div ref={container} style={fill ? {height: '100%'} : {height: 'calc(100vh - 12rem)', minHeight: 480}} />
    </section>
  )
}

function LegacyDocumentAppView({docId, document, cid, fill = false, content}: AppRuntimeProps) {
  const account = useSelectedAccountId()
  const client = useUniversalClient()
  const queryClient = useQueryClient()
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [navigation, setNavigation] = React.useState(0)
  const [url, setUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const configuredPlatform = getDocumentAppPlatform()
  const platform = configuredPlatform && 'resolveAppUrl' in configuredPlatform ? configuredPlatform : null
  const title = document.metadata?.name || 'App'

  React.useEffect(() => {
    if (!platform) return
    let cancelled = false
    let launchUrl: string | undefined
    setUrl(null)
    setError('')
    platform
      .resolveAppUrl({id: docId.id, cid, account})
      .then((resolved) => {
        launchUrl = resolved
        if (!cancelled) setUrl(resolved)
        else void platform.closeAppUrl?.(resolved)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
      if (launchUrl) void platform.closeAppUrl?.(launchUrl)
    }
  }, [platform, docId.id, cid, account])

  React.useLayoutEffect(() => {
    if (!url) return
    const controller = new AbortController()
    const origin = documentAppOrigin(url)
    const handle = async (request: DocumentAppRequest): Promise<unknown> => {
      const params = (request.params ?? {}) as Record<string, unknown>
      if (request.method === 'runtime') return documentAppRuntime('desktop')
      return content(request.method, params, controller.signal)
    }
    const listener = createDocumentAppMessageListener({frame: () => frame.current, origin, handle})
    window.addEventListener('message', listener)
    return () => {
      controller.abort()
      window.removeEventListener('message', listener)
    }
  }, [url, client, queryClient, content, navigation])

  if (!platform) {
    return (
      <div className="text-muted-foreground border-border rounded-lg border p-6 text-sm">
        This document is an app. Open it in the Seed desktop app to run it.
      </div>
    )
  }
  if (error) {
    return (
      <p role="alert" className="text-destructive p-3 text-sm">
        {error}
      </p>
    )
  }
  return (
    <section
      aria-label={title}
      className={cn('bg-background relative overflow-hidden', fill ? 'h-full' : 'border-border rounded-lg border')}
    >
      {url ? (
        <iframe
          key={`${docId.id}:${cid}:${account ?? 'anonymous'}`}
          ref={frame}
          onLoad={() => setNavigation((value) => value + 1)}
          title={title}
          src={url}
          // Fresh native origin per launch; persistent state is gated through seed.storage.
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerPolicy="no-referrer"
          className={cn('block w-full border-0 bg-white', fill && 'h-full')}
          style={fill ? undefined : {height: 'calc(100vh - 12rem)', minHeight: 480}}
        />
      ) : (
        <div
          className={cn('text-muted-foreground flex items-center justify-center text-xs', fill && 'h-full')}
          style={fill ? undefined : {minHeight: 480}}
        >
          Loading app…
        </div>
      )}
    </section>
  )
}

/**
 * A document app inside an agent's reply: the ```seed-app fence names the document by its hm://
 * URL, and the app runs here in the same sandbox, with the same bridge, as on the document page.
 */
export function DocumentAppEmbed({url, height = 420}: {url: string; height?: number}) {
  const id = React.useMemo(() => unpackHmId(url.trim()), [url])
  const resource = useResource(id, {subscribed: true})
  const viewer = useSelectedAccountId()
  const document = resource.data?.type === 'document' ? resource.data.document : null
  const cid = document ? documentAppCid(document) : null
  if (!id) return <p className="text-destructive text-xs">Not an hm:// URL: {url}</p>
  if (!document || !cid) {
    return (
      <div className="text-muted-foreground border-border my-2 rounded-lg border p-3 text-xs">
        {resource.isLoading ? 'Loading app…' : document ? 'This document is not an app.' : `Document not found: ${url}`}
      </div>
    )
  }
  return (
    <div className="my-2" style={{height}}>
      <DocumentAppView docId={id} document={document} cid={cid} perspectiveAccountUid={viewer} fill />
    </div>
  )
}
