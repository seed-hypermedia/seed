import {useQueryClient} from '@tanstack/react-query'
import React from 'react'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryDirectory, queryResource} from '@shm/shared/models/queries'
import {useUniversalClient} from '@shm/shared/routing'
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
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  cid: string
  perspectiveAccountUid?: string | null
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
    <section aria-label={title} className="border-border bg-background relative overflow-hidden rounded-lg border">
      {url ? (
        <iframe
          key={`${docId.id}:${cid}`}
          ref={frame}
          title={title}
          src={url}
          // Its own origin, so storage is the app's; scripts and forms, nothing that reaches outside.
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerPolicy="no-referrer"
          className="block w-full border-0 bg-white"
          style={{height: 'calc(100vh - 12rem)', minHeight: 480}}
        />
      ) : (
        <div className="text-muted-foreground flex items-center justify-center text-xs" style={{minHeight: 480}}>
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
