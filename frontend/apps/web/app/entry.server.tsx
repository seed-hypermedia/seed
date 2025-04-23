// we import configDotenv first so that it gets applied before contants.ts in shared
import configDotenv from './config-dotenv'

import {PassThrough} from 'node:stream'

import type {AppLoadContext, EntryContext} from '@remix-run/node'
import {createReadableStreamFromReadable, redirect} from '@remix-run/node'
import {RemixServer} from '@remix-run/react'
import {
  hmId,
  SITE_BASE_URL,
  WEB_IDENTITY_ENABLED,
  WEB_IDENTITY_ORIGIN,
  WEB_SIGNING_ENABLED,
} from '@shm/shared'
import fs from 'fs'
import {mkdir, readFile, stat, writeFile} from 'fs/promises'
import * as isbotModule from 'isbot'
import {dirname, join, resolve} from 'path'
import {renderToPipeableStream} from 'react-dom/server'
import {ENABLE_HTML_CACHE, useFullRender} from './cache-policy'
import {queryClient} from './client'
import {initDatabase} from './db'
import {initEmailNotifier} from './email-notifier'
import {getHMDocument} from './loaders'
import {logDebug} from './logger'
import {ParsedRequest, parseRequest} from './request'
import {applyConfigSubscriptions, getConfig, getHostnames} from './site-config'

configDotenv() // we need this so dotenv config stays in the imports.

const ABORT_DELAY = 5_000

const CACHE_PATH = resolve(join(process.env.DATA_DIR || process.cwd(), 'cache'))

function recursiveRm(targetPath: string) {
  if (!fs.existsSync(targetPath)) return
  if (fs.lstatSync(targetPath).isDirectory()) {
    fs.readdirSync(targetPath).forEach((file) => {
      recursiveRm(join(targetPath, file))
    })
    fs.rmdirSync(targetPath)
  } else {
    fs.unlinkSync(targetPath)
  }
}

let nextWarm: Promise<void> | undefined = undefined

async function warmAllCaches() {
  const hostnames = getHostnames()
  console.log('WARMING CACHES FOR', hostnames)
  await Promise.all(hostnames.map((hostname) => warmFullCache(hostname)))
}

const CACHE_WARM_INTERVAL = process.env.CACHE_WARM_INTERVAL
  ? parseInt(process.env.CACHE_WARM_INTERVAL) * 1000
  : 45_000

async function initializeServer() {
  recursiveRm(CACHE_PATH)
  if (ENABLE_HTML_CACHE) {
    await mkdir(CACHE_PATH, {recursive: true})
    await applyConfigSubscriptions()
      .then(() => {
        console.log('Config subscriptions applied')
      })
      .catch((e) => {
        console.error('Error applying config subscriptions', e)
      })
    if (CACHE_WARM_INTERVAL !== 0) {
      await warmAllCaches()

      // warm full cache 45 seconds, but only if the next warm is not already in progress
      setInterval(() => {
        if (nextWarm === undefined) {
          nextWarm = warmAllCaches().finally(() => {
            nextWarm = undefined
          })
        }
      }, CACHE_WARM_INTERVAL)
    }
  }
  await connectToWebIdentityOrigin()
  setInterval(connectToWebIdentityOrigin, 1000 * 60 * 5) // every 5 minutes, make sure we are connected to the WEB_IDENTITY_ORIGIN server
  await initDatabase()
  await initEmailNotifier()
}

// if we are configured for web identity, we rely on another server to sign content.
// this is to ensure that we are connected to the WEB_IDENTITY_ORIGIN server
async function connectToWebIdentityOrigin() {
  if (WEB_SIGNING_ENABLED || !WEB_IDENTITY_ENABLED) {
    // We are only expected to connect if we have identity enabled and if we don't have our own signing enabled
    return
  }
  try {
    const peers = (await queryClient.networking.listPeers({})).peers
    const identityOriginInfoReq = await fetch(
      `${WEB_IDENTITY_ORIGIN}/hm/api/config`,
    )
    if (identityOriginInfoReq.status !== 200) {
      throw new Error(
        'Connection failed to the WEB_IDENTITY_ORIGIN server at ' +
          WEB_IDENTITY_ORIGIN,
      )
    }
    const identityOriginInfo = await identityOriginInfoReq.json()
    const identityOriginPeerId = identityOriginInfo.peerId
    if (!identityOriginPeerId) {
      throw new Error(
        'WEB_IDENTITY_ORIGIN server at ' +
          WEB_IDENTITY_ORIGIN +
          ' did not return a peerId',
      )
    }
    const alreadyConnectedPeer = peers.find(
      (peer) => peer.id === identityOriginPeerId,
    )
    if (alreadyConnectedPeer) {
      // we are already connected, great!
      return
    }
    console.log(
      'Connecting to the WEB_IDENTITY_ORIGIN server ' +
        WEB_IDENTITY_ORIGIN +
        ' Peer ID: ' +
        identityOriginPeerId,
    )
    await queryClient.networking.connect({
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
    console.log('Server initialized and cache warmed')
  })
  .catch((e) => {
    console.error('Error initializing server', e)
  })

async function warmCachePath(
  hostname: string,
  path: string,
  version?: string | null,
) {
  const resp = await fetch(
    `http://localhost:${process.env.PORT || '3000'}${path}${
      version ? `?v=${version}` : ''
    }`,
    {
      headers: {
        'x-full-render': 'true',
        'x-forwarded-host': hostname,
      },
    },
  )
  const respHtml = await resp.text()
  const links = new Set<string>()
  const matches = respHtml.match(/href="\/[^"]*"/g) || []
  for (const match of matches) {
    const url = match.slice(6, -1) // Remove href=" and ending "
    if (url.startsWith('/')) {
      links.add(url)
    }
  }
  // save html to CACHE_PATH with every path is index.html and the path is a directory
  const cachePath = join(
    CACHE_PATH,
    hostname,
    path,
    version ? `.versions/${version}/` : '',
    'index.html',
  )
  if (!respHtml) {
    console.error('respHtml is empty for path', path)
    throw new Error('respHtml is empty for path ' + path)
  }
  if (resp.status === 200) {
    // create the directory if it doesn't exist
    await mkdir(dirname(cachePath), {recursive: true})
    await writeFile(cachePath, respHtml)
  }
  const contentLinks = new Set(
    Array.from(links).filter((link) => !link.startsWith('/assets')),
  )
  return {
    html: respHtml,
    status: resp.status,
    contentLinks,
  }
}

async function fileExists(path: string) {
  try {
    await stat(path)
    return true
  } catch (e) {
    return false
  }
}

async function warmFullCache(hostname: string) {
  const pathsToWarm = new Set<string>(['/'])
  const warmedPaths = new Set<string>()
  // warm paths until we've warmed all paths
  while (pathsToWarm.size > 0) {
    const path = pathsToWarm.values().next().value
    const {html, status, contentLinks} = await warmCachePath(hostname, path)
    pathsToWarm.delete(path)
    warmedPaths.add(path)
    for (const link of contentLinks) {
      if (!warmedPaths.has(link)) {
        pathsToWarm.add(link)
      }
    }
  }
}

function getHmIdOfRequest(
  {pathParts, url}: ParsedRequest,
  originAccountId: string | undefined,
) {
  const version = url.searchParams.get('v')
  const latest = url.searchParams.get('l') === ''
  if (pathParts.length === 0) {
    if (!originAccountId) return null
    return hmId('d', originAccountId, {path: [], version, latest})
  }
  if (pathParts[0] === 'hm') {
    return hmId('d', pathParts[1], {path: pathParts.slice(2), version, latest})
  }
  if (!originAccountId) return null
  return hmId('d', originAccountId, {path: pathParts, version, latest})
}

async function handleOptionsRequest(request: Request) {
  const parsedRequest = parseRequest(request)
  const {hostname} = parsedRequest
  const serviceConfig = await getConfig(hostname)
  const originAccountId = serviceConfig?.registeredAccountUid

  console.log('handleOptionsRequest', parsedRequest, originAccountId)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers':
      'X-Hypermedia-Id, X-Hypermedia-Version, X-Hypermedia-Title',
  }

  try {
    const hmId = getHmIdOfRequest(parsedRequest, originAccountId)
    if (hmId) {
      console.log('hmId', hmId)
      const doc = await getHMDocument(hmId)
      if (doc) {
        headers['X-Hypermedia-Id'] = hmId.id
        headers['X-Hypermedia-Version'] = doc.version
        headers['X-Hypermedia-Title'] = doc.metadata.name || ''
      }
      return new Response(null, {
        status: 200,
        headers,
      })
    }
  } catch (e) {
    console.error('Error handling options request', e)
  }
  return new Response(null, {
    status: 200,
    headers,
  })
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext,
) {
  if (request.method === 'OPTIONS') {
    return await handleOptionsRequest(request)
  }
  const parsedRequest = parseRequest(request)
  const {url, hostname, pathParts} = parsedRequest
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
  const sendPerfLog = logDebugRequest(url.pathname)

  if (url.pathname.startsWith('/ipfs')) {
    return new Response('Not Found', {
      status: 404,
    })
  }
  if (
    parsedRequest.pathParts.length > 1 &&
    parsedRequest.pathParts.find((part) => part === '') == ''
  ) {
    // This block handles redirecting from trailing slash requests
    const newPathParts = parsedRequest.pathParts.filter((part) => part !== '')
    const newUrl = new URL(SITE_BASE_URL + '/' + newPathParts.join('/'))
    for (const [key, value] of parsedRequest.url.searchParams.entries()) {
      newUrl.searchParams.set(key, value)
    }
    return redirect(newUrl.toString())
  }

  const serviceConfig = await getConfig(hostname)
  const originAccountId = serviceConfig?.registeredAccountUid

  if (!ENABLE_HTML_CACHE || useFullRender(parsedRequest)) {
    sendPerfLog('requested full')
    return handleFullRequest(
      request,
      responseStatusCode,
      responseHeaders,
      remixContext,
      loadContext,
      sendPerfLog,
    )
  }

  const queryVersion = url.searchParams.get('v')
  const cachePath = join(
    CACHE_PATH,
    `${hostname}/${url.pathname}/${
      queryVersion ? `.versions/${queryVersion}/` : ''
    }index.html`,
  )
  if (await fileExists(cachePath)) {
    const html = await readFile(cachePath, 'utf8')
    responseHeaders.set('Content-Type', 'text/html')
    sendPerfLog('cache hit')
    return new Response(html, {
      headers: responseHeaders,
      status: responseStatusCode,
    })
  }
  // return warm cache path html
  const {html} = await warmCachePath(hostname, url.pathname, queryVersion)
  responseHeaders.set('Content-Type', 'text/html')
  sendPerfLog('cache miss and loaded')
  return new Response(html, {
    headers: responseHeaders,
    status: responseStatusCode,
  })
}

export function handleFullRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext,
  onComplete: (msg: string) => void,
) {
  let prohibitOutOfOrderStreaming =
    isBotRequest(request.headers.get('user-agent')) || remixContext.isSpaMode

  return prohibitOutOfOrderStreaming
    ? handleBotRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext,
        onComplete,
      )
    : handleBrowserRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext,
        onComplete,
      )
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
  return new Promise((resolve, reject) => {
    let shellRendered = false
    const {pipe, abort} = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onAllReady() {
          shellRendered = true
          const body = new PassThrough()
          const stream = createReadableStreamFromReadable(body)

          responseHeaders.set('Content-Type', 'text/html')

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          )

          pipe(body)
          body.on('end', () => {
            onComplete('handleBotRequest full load sent')
          })
        },
        onShellError(error: unknown) {
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
  return new Promise((resolve, reject) => {
    let shellRendered = false
    const {pipe, abort} = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onShellReady() {
          shellRendered = true
          const body = new PassThrough()
          const stream = createReadableStreamFromReadable(body)

          responseHeaders.set('Content-Type', 'text/html')

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          )
          body.on('end', () => {
            onComplete('handleBrowserRequest full load sent')
          })
          pipe(body)
        },
        onShellError(error: unknown) {
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
