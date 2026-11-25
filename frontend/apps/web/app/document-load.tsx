import {isRouteErrorResponse, useRouteError} from '@remix-run/react'
import {captureRemixErrorBoundaryError} from '@sentry/remix'
import * as Sentry from '@sentry/remix'
import {useTx} from '@shm/shared/translation'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'

/** Waits between attempts to load a document route's data, in milliseconds. */
export const DOCUMENT_LOAD_RETRY_DELAYS_MS = [300, 1000, 2500]

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timeout = setTimeout(done, ms)
    function done() {
      clearTimeout(timeout)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}

/**
 * Loads a route's server data, trying again when the request fails before reaching a usable answer.
 *
 * Moving to another document fetches that document's loader data. Remix throws a plain `Error` when
 * the request fails on the network or is answered by something in front of the app (the proxy
 * answers 429 when a page has too many requests in flight), and with no handler that error replaces
 * the whole app with the root error page. Those failures are transient, so a later attempt usually
 * succeeds. Redirects and route responses are thrown as `Response` and pass straight through, and
 * nothing is retried once the navigation has been cancelled.
 */
export async function loadDocumentRouteData<T>(
  load: () => Promise<T>,
  signal: AbortSignal,
  options: {delays?: number[]; wait?: (ms: number, signal: AbortSignal) => Promise<void>} = {},
): Promise<T> {
  const {delays = DOCUMENT_LOAD_RETRY_DELAYS_MS, wait = sleep} = options
  for (let attempt = 0; ; attempt++) {
    try {
      return await load()
    } catch (error) {
      const delay = delays[attempt]
      if (signal.aborted || !(error instanceof Error) || delay === undefined) throw error
      await wait(delay, signal)
      if (signal.aborted) throw error
    }
  }
}

/**
 * Shown in place of a document that failed to load or render. It sits inside the app's layout, so
 * the failure stays on this page and the reader can try again.
 */
export function DocumentLoadErrorBoundary() {
  const error = useRouteError()
  const tx = useTx()

  Sentry.withScope((scope) => {
    scope.setTag('boundary', 'document')
    if (isRouteErrorResponse(error)) scope.setTag('http.status', String(error.status))
    captureRemixErrorBoundaryError(error)
  })

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="border-border dark:bg-background flex w-full max-w-lg flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
          <SizableText size="2xl" weight="bold">
            {tx('document_load_error_title', "This page didn't load")}
          </SizableText>
          <SizableText asChild>
            <p>{tx('document_load_error_description', 'The server was busy or the connection dropped.')}</p>
          </SizableText>
          <div>
            <Button variant="default" onClick={() => window.location.reload()}>
              {tx('Try Again')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
