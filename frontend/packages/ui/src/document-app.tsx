import {useQueryClient} from '@tanstack/react-query'
import React from 'react'
import {cn} from './utils'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryDirectory, queryResource} from '@shm/shared/models/queries'
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
 * A document app in place of the document body. The folder is served by the host platform under
 * an origin of the document's own, inside a sandboxed frame; the frame's `window.seed` calls land
 * here and are answered with the viewer's client, so the app reads what the viewer can read.
 */
export function DocumentAppView({
  docId,
  document,
  cid,
  perspectiveAccountUid,
  fill = false,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  cid: string
  perspectiveAccountUid?: string | null
  /** Fill the parent's height instead of the page's viewport share (chat embeds). */
  fill?: boolean
}) {
  const client = useUniversalClient()
  const queryClient = useQueryClient()
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [url, setUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const platform = getDocumentAppPlatform()
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
      account: perspectiveAccountUid ?? null,
      app: cid,
    }),
    [docId.id, document.version, perspectiveAccountUid, cid],
  )
  const contextRef = React.useRef(context)
  contextRef.current = context

  React.useEffect(() => {
    if (!url) return
    const origin = documentAppOrigin(url)
    const handle = async (request: DocumentAppRequest): Promise<unknown> => {
      const params = (request.params ?? {}) as Record<string, unknown>
      switch (request.method) {
        case 'context':
          return contextRef.current
        case 'resource': {
          const id = requireHmId(params.url)
          return queryClient.fetchQuery(queryResource(client, id))
        }
        case 'directory': {
          const id = requireHmId(params.url)
          return queryClient.fetchQuery(queryDirectory(client, id, params.all === true ? 'AllDescendants' : 'Children'))
        }
      }
    }
    const listener = createDocumentAppMessageListener({frame: () => frame.current, origin, handle})
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [url, client, queryClient])

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
      className={cn('border-border bg-background relative overflow-hidden rounded-lg border', fill && 'h-full')}
    >
      {url ? (
        <iframe
          key={`${docId.id}:${cid}`}
          ref={frame}
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
