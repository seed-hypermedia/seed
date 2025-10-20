// import this first so everybody has correct process.env
import {initDotenvConfig} from './config'

import {PassThrough} from 'node:stream'

import type {AppLoadContext, EntryContext} from '@remix-run/node'
import {createReadableStreamFromReadable, redirect} from '@remix-run/node'
import {RemixServer} from '@remix-run/react'
import {SITE_BASE_URL} from '@shm/shared/constants'
import * as isbotModule from 'isbot'
import {renderToPipeableStream} from 'react-dom/server'
import {initDatabase} from './db'
import {initEmailNotifier} from './email-notifier'
import {parseRequest} from './request'

const ABORT_DELAY = 5_000

async function initializeServer() {
  initDotenvConfig() // this function is called just to make sure the import organizer doesn't remove the import
  await initDatabase()
  await initEmailNotifier()
}

initializeServer()
  .then(() => {
    console.log('Server initialized and cache warmed')
  })
  .catch((e) => {
    console.error('Error initializing server', e)
  })

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext,
) {
  const parsedRequest = parseRequest(request)
  const {url, pathParts} = parsedRequest

  // Handle specific static routes
  if (pathParts.length === 1 && pathParts[0] === 'favicon.ico') {
    return new Response('Not Found', {
      status: 404,
    })
  }

  if (url.pathname.startsWith('/ipfs')) {
    return new Response('Not Found', {
      status: 404,
    })
  }

  // Handle trailing slash redirects
  if (
    parsedRequest.pathParts.length > 1 &&
    parsedRequest.pathParts.find((part) => part === '') == ''
  ) {
    const newPathParts = parsedRequest.pathParts.filter((part) => part !== '')
    const newUrl = new URL(SITE_BASE_URL + '/' + newPathParts.join('/'))
    for (const [key, value] of parsedRequest.url.searchParams.entries()) {
      newUrl.searchParams.set(key, value)
    }
    return redirect(newUrl.toString())
  }

  // Set security headers
  if (url.pathname.startsWith('/hm/embed/')) {
    // allowed to embed anywhere
  } else {
    responseHeaders.set('Content-Security-Policy', "frame-ancestors 'none';")
    responseHeaders.set('X-Frame-Options', 'DENY')
  }
  responseHeaders.set('Permissions-Policy', 'storage-access=*')

  // Always use full render for notify app (no caching like web app)
  return handleFullRequest(
    request,
    responseStatusCode,
    responseHeaders,
    remixContext,
    loadContext,
  )
}

export function handleFullRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext,
) {
  let prohibitOutOfOrderStreaming =
    isBotRequest(request.headers.get('user-agent')) || remixContext.isSpaMode

  return prohibitOutOfOrderStreaming
    ? handleBotRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext,
      )
    : handleBrowserRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext,
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
          body.on('end', () => {})
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
          body.on('end', () => {})
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
