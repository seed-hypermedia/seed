// we import configDotenv first so that it gets applied before contants.ts in shared
import configDotenv from './config-dotenv'

import {PassThrough} from 'node:stream'

import type {AppLoadContext, EntryContext} from '@remix-run/node'
import {createReadableStreamFromReadable, redirect} from '@remix-run/node'
import {RemixServer} from '@remix-run/react'
import {HMDocument} from '@seed-hypermedia/client/hm-types'
import {commentIdToHmId, getCommentTargetId, hmId} from '@shm/shared'
import {
  DAEMON_HTTP_URL,
  SITE_BASE_URL,
  WEB_IDENTITY_ENABLED,
  WEB_IDENTITY_ORIGIN,
  WEB_SIGNING_ENABLED,
} from '@shm/shared/constants'
import * as isbotModule from 'isbot'
import {renderToPipeableStream} from 'react-dom/server'
import {grpcClient} from './client.server'
import {getDaemonAuthToken, withDaemonAuthToken} from './daemon-auth.server'
import {
  clearRequestInstrumentationContext,
  endSpan,
  getRequestInstrumentationContext,
  printInstrumentationSummary,
  startSpan,
} from './instrumentation.server'
import {createResourceMetadata, metadataToHeaders} from './hypermedia-metadata'
import {getComment, resolveResource} from './loaders'
import {logDebug} from './logger'
import {ParsedRequest, parseRequest} from './request'
import {getOrCreateServerSignerAccountUid} from './server-signing'
import {applyConfigSubscriptions, getConfig} from './site-config.server'

configDotenv() // we need this so dotenv config stays in the imports.

const ABORT_DELAY = 5_000

async function initializeServer() {
  if (WEB_SIGNING_ENABLED) {
    await getOrCreateServerSignerAccountUid()
      .then((signerAccountUid) => {
        console.log('Web signing key ready', signerAccountUid)
      })
      .catch((e) => {
        console.error('Failed to initialize web signing key', e)
      })
  }
  await applyConfigSubscriptions()
    .then(() => {
      console.log('Config subscriptions applied')
    })
    .catch((e) => {
      console.error('Error applying config subscriptions', e)
    })
  console.log('Connecting to the WEB_IDENTITY_ORIGIN server')
  await connectToWebIdentityOrigin()
  setInterval(connectToWebIdentityOrigin, 1000 * 60 * 5) // every 5 minutes, make sure we are connected to the WEB_IDENTITY_ORIGIN server
}

// if we are configured for web identity, we rely on another server to sign content.
// this is to ensure that we are connected to the WEB_IDENTITY_ORIGIN server
async function connectToWebIdentityOrigin() {
  if (WEB_SIGNING_ENABLED || !WEB_IDENTITY_ENABLED) {
    // We are only expected to connect if we have identity enabled and if we don't have our own signing enabled
    return
  }
  try {
    const peers = (await grpcClient.networking.listPeers({})).peers
    const identityOriginInfoReq = await fetch(`${WEB_IDENTITY_ORIGIN}/hm/api/config`)
    if (identityOriginInfoReq.status !== 200) {
      throw new Error('Connection failed to the WEB_IDENTITY_ORIGIN server at ' + WEB_IDENTITY_ORIGIN)
    }
    const identityOriginInfo = await identityOriginInfoReq.json()
    const identityOriginPeerId = identityOriginInfo.peerId
    if (!identityOriginPeerId) {
      throw new Error('WEB_IDENTITY_ORIGIN server at ' + WEB_IDENTITY_ORIGIN + ' did not return a peerId')
    }
    const alreadyConnectedPeer = peers.find((peer) => peer.id === identityOriginPeerId)
    if (alreadyConnectedPeer) {
      // we are already connected, great!
      console.log('Already connected to the WEB_IDENTITY_ORIGIN server')
      return
    }
    console.log(
      'Connecting to the WEB_IDENTITY_ORIGIN server ' + WEB_IDENTITY_ORIGIN + ' Peer ID: ' + identityOriginPeerId,
    )
    await grpcClient.networking.connect({
      addrs: identityOriginInfo.addrs,
    })
  } catch (e) {
    console.error('Failed to connect to the WEB_IDENTITY_ORIGIN server', e)
  }
}

function logDebugRequest(path: string) {
  if (!process.env.LOG_LEVEL) return () => {}
  const startTime = Date.now()
  return (msg: string) => {
    const endTime = Date.now()
    logDebug(`${path} - ${msg} - ${endTime - startTime}ms`)
  }
}

initializeServer()
  .then(() => {
    console.log('Server initialized')
  })
  .catch((e) => {
    console.error('Error initializing server', e)
  })

const COMMENT_VIEW_TERMS = [':comments', ':comment', ':discussions']

function extractCommentId(pathParts: string[]): string | null {
  if (pathParts.length >= 3) {
    const thirdToLast = pathParts[pathParts.length - 3]!
    if (COMMENT_VIEW_TERMS.includes(thirdToLast)) {
      return `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`
    }
  }
  if (pathParts.length >= 2) {
    const secondToLast = pathParts[pathParts.length - 2]!
    if (COMMENT_VIEW_TERMS.includes(secondToLast)) {
      return pathParts[pathParts.length - 1]!
    }
  }
  return null
}

function stripInspectPrefix(pathParts: string[]): string[] {
  if (pathParts[0] === 'hm' && pathParts[1] === 'inspect') {
    return ['hm', ...pathParts.slice(2)]
  }
  if (pathParts[0] === 'inspect') {
    return pathParts.slice(1)
  }
  return pathParts
}

function getHmIdOfRequest({pathParts, url}: ParsedRequest, originAccountId: string | undefined) {
  const effectivePathParts = stripInspectPrefix(pathParts)
  const version = url.searchParams.get('v')
  const latest = url.searchParams.get('l') === '' || !version
  if (effectivePathParts.length === 0) {
    if (!originAccountId) return null
    return hmId(originAccountId, {path: [], version, latest})
  }
  if (effectivePathParts[0] === 'hm') {
    return hmId(effectivePathParts[1], {path: effectivePathParts.slice(2), version, latest})
  }
  if (!originAccountId) return null
  return hmId(originAccountId, {path: effectivePathParts, version, latest})
}

async function handleOptionsRequest(request: Request) {
  const parsedRequest = parseRequest(request)
  const {hostname, pathParts} = parsedRequest
  const serviceConfig = await getConfig(hostname)
  const originAccountId = serviceConfig?.registeredAccountUid

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers':
      'X-Hypermedia-Id, X-Hypermedia-Version, X-Hypermedia-Title, X-Hypermedia-Target, X-Hypermedia-Authors, X-Hypermedia-Type',
  }

  try {
    // Check for comment URL pattern first
    const commentRawId = extractCommentId(pathParts[0] === 'hm' ? pathParts.slice(2) : pathParts)
    if (commentRawId) {
      const comment = await getComment(commentRawId)
      if (comment) {
        const commentId = commentIdToHmId(commentRawId)
        const targetId = getCommentTargetId(comment)
        let targetDocument: HMDocument | undefined
        if (targetId) {
          const target = await resolveResource(targetId)
          if (target.type === 'document') targetDocument = target.document
        }
        let commentAuthorTitle: string | undefined
        if (comment.author) {
          try {
            const author = await resolveResource(hmId(comment.author))
            if (author.type === 'document' && author.document.metadata.name) {
              commentAuthorTitle = author.document.metadata.name
            }
          } catch (e) {}
        }
        Object.assign(
          headers,
          metadataToHeaders(
            createResourceMetadata({
              id: commentId,
              document: targetDocument,
              comment,
              commentAuthorTitle,
            }),
          ),
        )
        return new Response(null, {status: 200, headers})
      }
    }

    // Document URL
    const resourceId = getHmIdOfRequest(parsedRequest, originAccountId)
    if (resourceId) {
      const resource = await resolveResource(resourceId)
      if (resource.type === 'document') {
        Object.assign(headers, metadataToHeaders(createResourceMetadata({id: resourceId, document: resource.document})))
      }
      return new Response(null, {status: 200, headers})
    }
  } catch (e) {
    console.error('Error handling options request', e)
  }
  return new Response(null, {status: 200, headers})
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext,
) {
  const authToken = await getDaemonAuthToken(request)
  return withDaemonAuthToken(authToken, () =>
    handleRequestWithAuth(request, responseStatusCode, responseHeaders, remixContext, loadContext, authToken),
  )
}

async function handleRequestWithAuth(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext,
  authToken: string | null,
) {
  if (request.method === 'OPTIONS') {
    return await handleOptionsRequest(request)
  }
  const parsedRequest = parseRequest(request)
  const {url, pathParts} = parsedRequest
  if (pathParts.length === 1 && pathParts[0] === 'favicon.ico') {
    return new Response('Not Found', {
      status: 404,
    })
  }
  if (url.pathname.startsWith('/hm/embed/')) {
    // allowed to embed anywhere
  } else {
    responseHeaders.set('Content-Security-Policy', "frame-ancestors 'none';")
    responseHeaders.set('X-Frame-Options', 'DENY')
  }
  responseHeaders.set('Permissions-Policy', 'storage-access=*')
  responseHeaders.set('Cache-Control', 'private, no-cache')
  const sendPerfLog = logDebugRequest(url.pathname)

  if (url.pathname.startsWith('/ipfs/')) {
    try {
      const daemonResponse = await fetch(`${DAEMON_HTTP_URL}${url.pathname}`, {
        headers: authToken ? {Authorization: `Bearer ${authToken}`} : undefined,
      })
      return new Response(daemonResponse.body, {
        status: daemonResponse.status,
        headers: {
          'Content-Type': daemonResponse.headers.get('Content-Type') || 'application/octet-stream',
          'Cache-Control': daemonResponse.headers.get('Cache-Control') || 'private, max-age=29030400, immutable',
        },
      })
    } catch {
      return new Response('Not Found', {status: 404})
    }
  }
  if (url.pathname.startsWith('/.well-known/')) {
    return new Response('Not Found', {status: 404})
  }
  if (parsedRequest.pathParts.length > 1 && parsedRequest.pathParts.find((part) => part === '') == '') {
    // This block handles redirecting from trailing slash requests
    const newPathParts = parsedRequest.pathParts.filter((part) => part !== '')
    const newUrl = new URL(SITE_BASE_URL + '/' + newPathParts.join('/'))
    for (const [key, value] of parsedRequest.url.searchParams.entries()) {
      newUrl.searchParams.set(key, value)
    }
    return redirect(newUrl.toString())
  }

  sendPerfLog('requested full')
  return handleFullRequest(request, responseStatusCode, responseHeaders, remixContext, loadContext, sendPerfLog)
}

export function handleFullRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext,
  onComplete: (msg: string) => void,
) {
  ensureByteServerHandoffStream(remixContext)
  let prohibitOutOfOrderStreaming = isBotRequest(request.headers.get('user-agent')) || remixContext.isSpaMode

  return prohibitOutOfOrderStreaming
    ? handleBotRequest(request, responseStatusCode, responseHeaders, remixContext, onComplete)
    : handleBrowserRequest(request, responseStatusCode, responseHeaders, remixContext, onComplete)
}

function ensureByteServerHandoffStream(remixContext: EntryContext) {
  const serverHandoffStream = remixContext.serverHandoffStream as ReadableStream<Uint8Array | string> | undefined
  if (!serverHandoffStream) return

  const reader = serverHandoffStream.getReader()
  const encoder = new TextEncoder()

  remixContext.serverHandoffStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const {done, value} = await reader.read()
      if (done) {
        controller.close()
        return
      }
      controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

// We have some Remix apps in the wild already running with isbot@3 so we need
// to maintain backwards compatibility even though we want new apps to use
// isbot@4.  That way, we can ship this as a minor Semver update to @remix-run/dev.
function isBotRequest(userAgent: string | null) {
  if (!userAgent) {
    return false
  }

  // isbot >= 3.8.0, >4
  if ('isbot' in isbotModule && typeof isbotModule.isbot === 'function') {
    return isbotModule.isbot(userAgent)
  }

  // isbot < 3.8.0
  if ('default' in isbotModule && typeof isbotModule.default === 'function') {
    // @ts-expect-error
    return isbotModule.default(userAgent)
  }

  return false
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  onComplete: (msg: string) => void,
) {
  // Get instrumentation context from loader phase
  const ctx = getRequestInstrumentationContext(request.url)
  if (ctx) {
    startSpan(ctx, 'reactSSR')
  }
  const renderStartTime = performance.now()

  return new Promise((resolve, reject) => {
    let shellRendered = false
    const {pipe, abort} = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} abortDelay={ABORT_DELAY} />,
      {
        onAllReady() {
          shellRendered = true
          if (ctx) {
            // Record shell rendering time
            startSpan(ctx, 'shellRendering')
            ctx.current.start = renderStartTime
            endSpan(ctx)
          }

          const body = new PassThrough()
          const stream = createReadableStreamFromReadable(body)

          responseHeaders.set('Content-Type', 'text/html')

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          )

          if (ctx) {
            startSpan(ctx, 'streamToClient')
          }
          pipe(body)
          body.on('end', () => {
            if (ctx) {
              endSpan(ctx) // end streamToClient
              endSpan(ctx) // end reactSSR
              printInstrumentationSummary(ctx)
              clearRequestInstrumentationContext(request.url)
            }
            onComplete('handleBotRequest full load sent')
          })
        },
        onShellError(error: unknown) {
          if (ctx) {
            endSpan(ctx) // end reactSSR
            clearRequestInstrumentationContext(request.url)
          }
          reject(error)
        },
        onError(error: unknown) {
          responseStatusCode = 500
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error)
          }
        },
      },
    )

    setTimeout(abort, ABORT_DELAY)
  })
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  onComplete: (msg: string) => void,
) {
  // Get instrumentation context from loader phase
  const ctx = getRequestInstrumentationContext(request.url)
  if (ctx) {
    startSpan(ctx, 'reactSSR')
  }
  const renderStartTime = performance.now()

  return new Promise((resolve, reject) => {
    let shellRendered = false
    const {pipe, abort} = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} abortDelay={ABORT_DELAY} />,
      {
        onShellReady() {
          shellRendered = true
          if (ctx) {
            // Record shell rendering time
            startSpan(ctx, 'shellRendering')
            ctx.current.start = renderStartTime
            endSpan(ctx)
          }

          const body = new PassThrough()
          const stream = createReadableStreamFromReadable(body)

          responseHeaders.set('Content-Type', 'text/html')

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          )

          if (ctx) {
            startSpan(ctx, 'streamToClient')
          }
          body.on('end', () => {
            if (ctx) {
              endSpan(ctx) // end streamToClient
              endSpan(ctx) // end reactSSR
              printInstrumentationSummary(ctx)
              clearRequestInstrumentationContext(request.url)
            }
            onComplete('handleBrowserRequest full load sent')
          })
          pipe(body)
        },
        onShellError(error: unknown) {
          if (ctx) {
            endSpan(ctx) // end reactSSR
            clearRequestInstrumentationContext(request.url)
          }
          reject(error)
        },
        onError(error: unknown) {
          responseStatusCode = 500
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error)
          }
        },
      },
    )

    setTimeout(abort, ABORT_DELAY)
  })
}
