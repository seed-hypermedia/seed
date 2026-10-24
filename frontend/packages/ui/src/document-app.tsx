import {useQuery, useQueryClient} from '@tanstack/react-query'
import React from 'react'
import {cn} from './utils'
import {Button} from './button'
import {queryKeys} from '@shm/shared/models/query-keys'
import {documentAppContent, createDocumentAppAccess} from '@shm/shared/document-app-content'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from './components/alert-dialog'
import {documentAppStorage, mountDocumentApp} from '@shm/shared/document-app-sandbox'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {DocumentAppPlatform} from '@shm/shared/document-app'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryAccount, queryResource} from '@shm/shared/models/queries'
import {useUniversalClient} from '@shm/shared/routing'
import {useResource, useSelectedAccountId} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {
  DOCUMENT_APP_PROTOCOL,
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
 * answers SDK calls through the host. Full viewer authority requires an app-session grant.
 */
type DocumentAppViewProps = {
  docId: UnpackedHypermediaId
  document: HMDocument
  cid: string
  perspectiveAccountUid?: string | null
  /** Fill the main view without a border or document margins. */
  fill?: boolean
  /** Delegate the revoke control to the host navigation instead of an inline toolbar. */
  onAccountAccessChange?: (revoke: (() => void) | null) => void
}

type AppContentHandler = (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>
type AppRuntimeProps = DocumentAppViewProps & {content: AppContentHandler}

/** Render a document app with the platform's isolated runtime. */
export function DocumentAppView(props: DocumentAppViewProps) {
  const account = useSelectedAccountId()
  return (
    <DocumentAppSession key={JSON.stringify([props.docId.id, props.document.version, props.cid, account])} {...props} />
  )
}

function DocumentAppSession(props: DocumentAppViewProps) {
  const account = useSelectedAccountId()
  const client = useUniversalClient()
  const queryClient = useQueryClient()
  const profile = useQuery(queryAccount(client, account))
  const [approval, setApproval] = React.useState(false)
  const [granted, setGranted] = React.useState(false)
  const finishApproval = React.useRef<((accepted: boolean) => void) | null>(null)
  const access = React.useMemo(
    () =>
      createDocumentAppAccess(
        (signal) =>
          new Promise<boolean>((resolve) => {
            signal.throwIfAborted()
            const finish = (accepted: boolean) => {
              signal.removeEventListener('abort', cancel)
              finishApproval.current = null
              setApproval(false)
              resolve(accepted)
            }
            const cancel = () => finish(false)
            finishApproval.current = finish
            signal.addEventListener('abort', cancel, {once: true})
            setApproval(true)
          }),
        setGranted,
      ),
    [],
  )
  React.useLayoutEffect(() => () => access.revoke(), [access])
  React.useEffect(() => {
    props.onAccountAccessChange?.(granted ? access.revoke : null)
    return () => props.onAccountAccessChange?.(null)
  }, [props.onAccountAccessChange, granted, access])
  const content = React.useCallback<AppContentHandler>(
    async (method, params, signal) => {
      const result = await documentAppContent({
        method,
        params,
        signal,
        client,
        access,
        visibility: props.document.visibility,
        context: {
          protocol: 1,
          document: hmId(props.docId.uid, {path: props.docId.path}).id,
          version: props.document.version,
          account,
          app: props.cid,
        },
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
    [account, client, queryClient, access, props.docId, props.document, props.cid],
  )
  const platform = getDocumentAppPlatform()
  return (
    <div className={cn('flex flex-col', props.fill ? 'h-full min-h-0' : 'gap-2')}>
      {granted && !props.onAccountAccessChange && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>Account access enabled</span>
          <Button variant="outline" size="sm" onClick={() => access.revoke()}>
            Revoke access
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
      <AlertDialog
        open={approval}
        onOpenChange={(open) => {
          if (!open) finishApproval.current?.(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Give this app full account access?</AlertDialogTitle>
            <AlertDialogDescription>
              {props.document.metadata?.name || 'This app'} will act as{' '}
              {profile.data?.metadata?.name || 'your selected account'}. It can read everything this account can access,
              create, edit and delete content, grant permissions, and sign any data without asking again while this app
              is open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm">
            Only allow apps you trust. Access ends when you revoke it, close the app, switch accounts, or load a
            different app revision. Signing keys stay in Seed.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => finishApproval.current?.(false)}>Deny</AlertDialogCancel>
            <AlertDialogAction onClick={() => finishApproval.current?.(true)}>Allow full access</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          profile: async () => {
            const profile = await queryClient.fetchQuery(queryAccount(client, account))
            return account ? {id: account, name: profile?.metadata?.name || null} : null
          },
          resource: async () => ({
            type: 'document',
            id: hmId(docId.uid, {path: docId.path, version}),
            document: resourceDocument,
          }),
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
    setUrl(null)
    setError('')
    platform
      .resolveAppUrl({id: docId.id, cid})
      .then((resolved) => {
        if (!cancelled) setUrl(resolved)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [platform, docId.id, cid])

  const context = React.useMemo<DocumentAppContext>(
    () => ({
      protocol: DOCUMENT_APP_PROTOCOL,
      document: docId.id,
      version: document.version ?? null,
      account,
      app: cid,
    }),
    [docId.id, document.version, account, cid],
  )
  const contextRef = React.useRef(context)
  contextRef.current = context

  React.useLayoutEffect(() => {
    if (!url) return
    const controller = new AbortController()
    const origin = documentAppOrigin(url)
    const handle = async (request: DocumentAppRequest): Promise<unknown> => {
      const params = (request.params ?? {}) as Record<string, unknown>
      switch (request.method) {
        case 'hm.parseMarkdown':
        case 'hm.validateContent':
        case 'comments.create':
          return content(request.method, params, controller.signal)
        case 'context':
          return contextRef.current
        case 'storage.get':
        case 'storage.set':
          return documentAppStorage(window.localStorage, contextRef.current, request.method, params)
        case 'profile': {
          const uid = contextRef.current.account
          const profile = await queryClient.fetchQuery(queryAccount(client, uid))
          return uid ? {id: uid, name: profile?.metadata?.name || null} : null
        }
        case 'resource': {
          const id = requireHmId(params.url)
          if (id.path?.length === 1 && id.path[0] === ':profile' && id.uid === contextRef.current.account) {
            const profile = await queryClient.fetchQuery(queryAccount(client, id.uid))
            return {id: id.uid, name: profile?.metadata?.name || null}
          }
          if (id.id === docId.id) return queryClient.fetchQuery(queryResource(client, id))
          return content(request.method, params, controller.signal)
        }
        default:
          return content(request.method, params, controller.signal)
      }
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
          // Its own origin, so storage is the app's; scripts and forms, nothing that reaches outside.
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

function requireHmId(value: unknown): UnpackedHypermediaId {
  const id = typeof value === 'string' ? unpackHmId(value) : null
  if (!id) throw new Error('Expected an hm:// URL')
  return id
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
