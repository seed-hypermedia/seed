import {decode as cborDecode} from '@ipld/dag-cbor'
import {corsJson} from './utils/cors'

export class APIError extends Error {
  constructor(
    message: string,
    public status: number = 500,
  ) {
    super(message)
  }
}

export class NotFoundError extends APIError {
  constructor(message?: string) {
    super(message ?? 'Not found', 404)
  }
}

export class BadRequestError extends APIError {
  constructor(message?: string) {
    super(message ?? 'Bad request', 400)
  }
}

/** A route handler: a standard Request in, a Response out. */
export type Handler = (request: Request) => Response | Promise<Response>

/** Wraps a handler for a signed CBOR POST body; the result is returned as JSON, errors as `{error}`. */
export function cborApiAction<RequestType, ResultType>(handler: (data: RequestType) => ResultType): Handler {
  return async (request) => {
    let action: string | undefined
    try {
      const cborData = await request.arrayBuffer()
      const data: RequestType = cborDecode(new Uint8Array(cborData))
      action = typeof (data as {action?: unknown})?.action === 'string' ? (data as {action: string}).action : undefined
      const result = await handler(data)
      return corsJson(result)
    } catch (e: unknown) {
      const status = e instanceof APIError ? e.status : 500
      const message = e instanceof Error ? e.message : 'Unknown error'
      // One line per failed request: clients swallow these errors, so this is the only trace of them.
      console.warn('[notify][api] request failed', {path: new URL(request.url).pathname, action, status, message})
      if (e instanceof APIError) {
        return corsJson({error: e.message}, {status: e.status})
      }
      return corsJson({error: message}, {status: 500})
    }
  }
}
