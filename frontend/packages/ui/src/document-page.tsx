import type {SchemaFetchClient} from '@seed-hypermedia/client/schema-resolve'
import {createDocumentPageInput, type DocumentPageInputState} from '@shm/shared/document-page-input'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import React from 'react'
import {cn} from './utils'
import {Button} from './button'
import {DocumentPageParameters} from './document-page-parameters'
import {toast} from './toast'
import {queryKeys} from '@shm/shared/models/query-keys'
import {documentPageContent, createDocumentPageAccess} from '@shm/shared/document-page-content'
import {DocumentPagePermissionPrompt, DocumentPagePermissionSettings} from './document-page-permissions'
import {
  pagePermissionStorageKey,
  readPagePermissionGrants,
  type PagePermissionRequest,
  type PagePermissionDecision,
  type PagePermissionGrant,
} from '@shm/shared/document-page-permissions'
import {useSelectedAccountContacts} from '@shm/shared/models/contacts'
import {documentPageStorage, mountDocumentPage} from '@shm/shared/document-page-sandbox'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {DocumentPagePlatform} from '@shm/shared/document-page'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryAccount} from '@shm/shared/models/queries'
import {useUniversalClient, useOpenUrl, useUniversalAppContext} from '@shm/shared/routing'
import {useResource, useSelectedAccountId} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {
  documentPageRuntime,
  parseDocumentPageLink,
  createDocumentPageMessageListener,
  documentPageOrigin,
  getDocumentPagePlatform,
  parseDocumentPageReference,
  type DocumentPageContext,
  type DocumentPageRequest,
} from '@shm/shared/document-page'

/** The folder CID of a document's page, when the document is one. */
export function documentPageCid(document: Pick<HMDocument, 'metadata'> | null | undefined): string | null {
  return document?.metadata?.type === 'hm://hyper.media/page'
    ? parseDocumentPageReference(document.metadata.html)
    : null
}

/**
 * A document page in place of the document body. Each platform isolates its frame and
 * answers SDK calls through the host with independent read, signing and publication approvals.
 */
type DocumentPageViewProps = {
  docId: UnpackedHypermediaId
  document: HMDocument
  cid: string
  perspectiveAccountUid?: string | null
  inputParams?: Record<string, string>
  onInputNavigate?: (params: Record<string, string>, mode: 'push' | 'replace') => void
  /** Fill the main view without a border or document margins. */
  fill?: boolean
  /** Put the parameter editor in host navigation instead of the inline toolbar. */
  onParametersChange?: (edit: (() => void) | null) => void
  /** Put the permission manager in host navigation instead of the inline toolbar. */
  onAccountAccessChange?: (manage: (() => void) | null) => void
}

type PageContentHandler = (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>
type PageRuntimeProps = DocumentPageViewProps & {
  content: PageContentHandler
  subscribeInput: (listener: (state: DocumentPageInputState) => void) => () => void
}

/** Render only approved launches, then gate each data or signing capability independently. */
export function DocumentPageView(props: DocumentPageViewProps) {
  const account = useSelectedAccountId()
  return (
    <DocumentPageLaunch key={JSON.stringify([props.docId.id, props.document.version, props.cid, account])} {...props} />
  )
}

function DocumentPageLaunch(props: DocumentPageViewProps) {
  const account = useSelectedAccountId()
  const contacts = useSelectedAccountContacts()
  const {originHomeId} = useUniversalAppContext()
  const platform = getDocumentPagePlatform()
  const [accepted, setAccepted] = React.useState(false)
  const known =
    props.docId.uid === account ||
    contacts.data?.some((contact) => contact.subject === props.docId.uid && contact.subscribe?.site) ||
    (platform && 'loadPageHtml' in platform && originHomeId?.uid === props.docId.uid)
  if (known || accepted) return <DocumentPageSession {...props} />
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="border-border bg-background flex max-w-md flex-col gap-4 rounded-xl border p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Run {props.document.metadata?.name || 'this page'}?</h2>
        <p className="text-muted-foreground text-sm">
          This page is from a site you haven’t joined. Pages can show misleading screens, use device resources and open
          links.
        </p>
        <p className="text-sm">
          This page can read content in its own space that you can access. Seed will ask before reading other spaces,
          sharing your account identity or saved page data, or signing anything. Joining is optional.
        </p>
        <Button onClick={() => setAccepted(true)}>Run page</Button>
      </div>
    </div>
  )
}

function DocumentPageSession(props: DocumentPageViewProps) {
  const account = useSelectedAccountId()
  const client = useUniversalClient()
  const openUrl = useOpenUrl()
  const queryClient = useQueryClient()
  const profile = useQuery(queryAccount(client, account))
  const documentId = hmId(props.docId.uid, {path: props.docId.path}).id
  const version = props.document.version
  const visibility = props.document.visibility
  const inputSchema =
    typeof props.document.metadata.inputSchema === 'string'
      ? props.document.metadata.inputSchema
      : 'hm://hyper.media/page-input'
  const key = pagePermissionStorageKey(account, documentId)
  const source = React.useRef(Symbol())
  const initial = React.useMemo(() => {
    try {
      return readPagePermissionGrants(window.localStorage, key)
    } catch {
      return []
    }
  }, [key])
  const [grants, setGrants] = React.useState<PagePermissionGrant[]>(initial)
  const [parameters, setParameters] = React.useState(false)
  const [settings, setSettings] = React.useState(false)
  const [approval, setApproval] = React.useState<{
    id: string
    request: PagePermissionRequest
    finish: (decision: PagePermissionDecision) => void
  } | null>(null)
  const access = React.useMemo(
    () =>
      createDocumentPageAccess(
        (request, signal) =>
          new Promise<PagePermissionDecision>((resolve) => {
            signal.throwIfAborted()
            let finished = false
            const finish = (decision: PagePermissionDecision) => {
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
              new CustomEvent('seed-page-permissions-changed', {detail: {key, source: source.current}}),
            )
          } catch {
            toast.error('Could not save this permission. It will last only while this page is open.')
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
      let saved: PagePermissionGrant[] = []
      try {
        saved = readPagePermissionGrants(window.localStorage, key)
      } catch {}
      access.replace(saved)
      setGrants(saved)
    }
    window.addEventListener('storage', refresh)
    window.addEventListener('seed-page-permissions-changed', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('seed-page-permissions-changed', refresh)
    }
  }, [key, access])
  React.useEffect(() => {
    props.onAccountAccessChange?.(() => setSettings(true))
    return () => props.onAccountAccessChange?.(null)
  }, [props.onAccountAccessChange])
  const canNavigateInput = !!props.onInputNavigate
  React.useEffect(() => {
    props.onParametersChange?.(canNavigateInput ? () => setParameters(true) : null)
    return () => props.onParametersChange?.(null)
  }, [props.onParametersChange, canNavigateInput])
  const inputNavigation = React.useRef(props.onInputNavigate)
  inputNavigation.current = props.onInputNavigate
  const input = React.useMemo(
    () =>
      createDocumentPageInput({
        schema: inputSchema,
        params: props.inputParams,
        client: (signal) => ({
          request: ((key, requestInput) =>
            documentPageContent({
              method: 'request',
              params: {key, input: requestInput},
              signal: access.signal(signal),
              client,
              access,
              visibility,
              context: {protocol: 1, document: documentId, version, account, page: props.cid},
            })) as SchemaFetchClient['request'],
        }),
        navigate: (params, mode) => {
          if (!inputNavigation.current) throw new Error('Page URL navigation is unavailable in this view.')
          inputNavigation.current(params, mode)
        },
      }),
    [access, client, documentId, version, visibility, inputSchema, props.cid, account],
  )
  React.useLayoutEffect(() => {
    input.start()
    return () => input.close()
  }, [input])
  React.useLayoutEffect(() => {
    input.update(props.inputParams)
  }, [input, props.inputParams])
  const content = React.useCallback<PageContentHandler>(
    async (method, params, signal) => {
      signal.throwIfAborted()
      if (method === 'input.get') return input.read(undefined, signal)
      if (method === 'input.push' || method === 'input.replace') {
        if (
          !params ||
          typeof params !== 'object' ||
          Array.isArray(params) ||
          Object.keys(params).some((key) => key !== 'values')
        )
          throw new Error('Invalid page input request')
        return input.write((params as {values?: unknown}).values, method === 'input.push' ? 'push' : 'replace', signal)
      }
      const context: DocumentPageContext = {
        protocol: 1,
        document: documentId,
        version,
        account,
        page: props.cid,
      }
      if (method === 'storage.get' || method === 'storage.set') {
        const authorized = access.signal(signal)
        if (method === 'storage.get')
          await access.authorize(
            {
              kind: 'read',
              type: 'PageState',
              title: 'Read this page’s saved data',
              resource: `${documentId}#page-state`,
              details: {key: (params as {key?: unknown})?.key},
              warning: 'Saved data may contain information shared during earlier visits.',
            },
            authorized,
          )
        authorized.throwIfAborted()
        return documentPageStorage(window.localStorage, context, method, params as Record<string, unknown>)
      }
      if (method === 'open') {
        try {
          const link = parseDocumentPageLink(params)
          if (link.url.startsWith('hm://')) await openUrl(link.url, link.newWindow)
          else {
            const platform = getDocumentPagePlatform()
            if (!platform?.openExternalUrl) throw new Error('This host cannot open web links. Update Seed.')
            await platform.openExternalUrl(link.url, link.newWindow)
          }
          return null
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Unable to open link')
          throw error
        }
      }
      const result = await documentPageContent({
        method,
        params,
        signal,
        client,
        access,
        visibility,
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
    [account, client, queryClient, access, documentId, version, visibility, props.cid, openUrl, input],
  )
  const platform = getDocumentPagePlatform()
  const name = props.document.metadata?.name || 'This page'
  return (
    <div className={cn('flex flex-col', props.fill ? 'h-full min-h-0' : 'gap-2')}>
      {(!props.onAccountAccessChange || (!props.onParametersChange && canNavigateInput)) && (
        <div className="flex justify-end gap-2">
          {!props.onParametersChange && canNavigateInput && (
            <Button variant="ghost" size="sm" onClick={() => setParameters(true)}>
              Page parameters
            </Button>
          )}
          {!props.onAccountAccessChange && (
            <Button variant="ghost" size="sm" onClick={() => setSettings(true)}>
              Page permissions
            </Button>
          )}
        </div>
      )}
      <div className={cn(props.fill && 'min-h-0 flex-1')}>
        {platform && 'loadPageHtml' in platform ? (
          <SandboxDocumentPageView {...props} platform={platform} content={content} subscribeInput={input.subscribe} />
        ) : (
          <LegacyDocumentPageView {...props} content={content} subscribeInput={input.subscribe} />
        )}
      </div>
      {parameters && <DocumentPageParameters input={input} onClose={() => setParameters(false)} />}
      {approval && (
        <DocumentPagePermissionPrompt
          key={approval.id}
          request={approval.request}
          pageName={name}
          accountName={profile.data?.metadata?.name || (account ? 'your selected account' : 'a signed-out visitor')}
          onDecision={approval.finish}
        />
      )}
      <DocumentPagePermissionSettings
        open={settings}
        onOpenChange={setSettings}
        pageName={name}
        grants={grants}
        onRemove={(index) => access.remove(index)}
        onReset={() => access.revoke()}
      />
    </div>
  )
}

function SandboxDocumentPageView({
  docId,
  document: resourceDocument,
  cid,
  fill,
  platform,
  content,
  subscribeInput,
}: PageRuntimeProps & {
  platform: Extract<DocumentPagePlatform, {loadPageHtml: unknown}>
}) {
  const container = React.useRef<HTMLDivElement>(null)
  const account = useSelectedAccountId()
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  // Canonical resource identity excludes version, block fragment and the site's pretty URL.
  const id = hmId(docId.uid, {path: docId.path}).id
  const version = resourceDocument.version
  React.useEffect(() => {
    const controller = new AbortController()
    let session: ReturnType<typeof mountDocumentPage> | undefined
    let unsubscribe: (() => void) | undefined
    setError('')
    setLoading(true)
    platform
      .loadPageHtml({id, cid, version}, controller.signal)
      .then(async (html) => {
        if (controller.signal.aborted || !container.current) return
        session = mountDocumentPage({
          container: container.current,
          html,
          context: {protocol: 1, document: id, version, account, page: cid},
          storage: window.localStorage,
          content,
          hostHandlesReads: true,
          onClose: (reason) => {
            if (!controller.signal.aborted) setError(reason)
          },
        })
        unsubscribe = subscribeInput(session.inputChanged)
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
      unsubscribe?.()
      session?.destroy()
    }
  }, [platform, id, cid, version, account, content, subscribeInput])
  return (
    <section
      aria-label={resourceDocument.metadata?.name || 'Page'}
      className={cn('relative overflow-hidden', fill ? 'h-full' : 'border-border rounded-lg border')}
    >
      {error ? (
        <p role="alert" className="text-destructive p-3 text-sm">
          {error}
        </p>
      ) : loading ? (
        <p className="text-muted-foreground p-3 text-sm">Loading page…</p>
      ) : null}
      <div ref={container} style={fill ? {height: '100%'} : {height: 'calc(100vh - 12rem)', minHeight: 480}} />
    </section>
  )
}

function LegacyDocumentPageView({docId, document, cid, fill = false, content, subscribeInput}: PageRuntimeProps) {
  const account = useSelectedAccountId()
  const client = useUniversalClient()
  const queryClient = useQueryClient()
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [navigation, setNavigation] = React.useState(0)
  const [url, setUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const configuredPlatform = getDocumentPagePlatform()
  const platform = configuredPlatform && 'resolvePageUrl' in configuredPlatform ? configuredPlatform : null
  const title = document.metadata?.name || 'Page'

  React.useEffect(() => {
    if (!platform) return
    let cancelled = false
    let launchUrl: string | undefined
    setUrl(null)
    setNavigation(0)
    setError('')
    platform
      .resolvePageUrl({id: docId.id, cid, account})
      .then((resolved) => {
        launchUrl = resolved
        if (!cancelled) setUrl(resolved)
        else void platform.closePageUrl?.(resolved)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
      if (launchUrl) void platform.closePageUrl?.(launchUrl)
    }
  }, [platform, docId.id, cid, account])

  React.useLayoutEffect(() => {
    if (!url) return
    const controller = new AbortController()
    const origin = documentPageOrigin(url)
    const handle = async (request: DocumentPageRequest): Promise<unknown> => {
      const params = (request.params ?? {}) as Record<string, unknown>
      if (request.method === 'runtime') return documentPageRuntime('desktop')
      return content(request.method, params, controller.signal)
    }
    const listener = createDocumentPageMessageListener({frame: () => frame.current, origin, handle})
    window.addEventListener('message', listener)
    const unsubscribe = subscribeInput(
      (state) => frame.current?.contentWindow?.postMessage({seedPage: 1, type: 'seed-input', state}, origin),
    )
    // Inline scripts run before iframe load. Release their queued SDK calls only after
    // installing this navigation's controller, so load cannot cancel initialization.
    if (navigation) frame.current?.contentWindow?.postMessage({seedPage: 1, type: 'seed-ready'}, origin)
    return () => {
      unsubscribe()
      controller.abort()
      window.removeEventListener('message', listener)
    }
  }, [url, client, queryClient, content, navigation, subscribeInput])

  if (!platform) {
    return (
      <div className="text-muted-foreground border-border rounded-lg border p-6 text-sm">
        This document is a page. Open it in the Seed desktop application to run it.
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
          Loading page…
        </div>
      )}
    </section>
  )
}

/**
 * A document page inside an agent's reply: the ```seed-page fence names the document by its hm://
 * URL, and the page runs here in the same sandbox, with the same bridge, as on the document page.
 */
export function DocumentPageEmbed({url, height = 420}: {url: string; height?: number}) {
  const id = React.useMemo(() => unpackHmId(url.trim()), [url])
  const resource = useResource(id, {subscribed: true})
  const viewer = useSelectedAccountId()
  const document = resource.data?.type === 'document' ? resource.data.document : null
  const cid = document ? documentPageCid(document) : null
  if (!id) return <p className="text-destructive text-xs">Not an hm:// URL: {url}</p>
  if (!document || !cid) {
    return (
      <div className="text-muted-foreground border-border my-2 rounded-lg border p-3 text-xs">
        {resource.isLoading
          ? 'Loading page…'
          : document
            ? 'This document is not a page.'
            : `Document not found: ${url}`}
      </div>
    )
  }
  return (
    <div className="my-2" style={{height}}>
      <DocumentPageView docId={id} document={document} cid={cid} perspectiveAccountUid={viewer} fill />
    </div>
  )
}
