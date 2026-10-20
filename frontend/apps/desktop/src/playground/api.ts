/**
 * The HTTP surface of the HM26 playground, mounted on the desktop app's API server:
 *
 *   GET  /hm/playground/            the page and its assets
 *   GET  /api/playground            the current snapshot (world, derived facts, use case, sync run)
 *   POST /api/playground/actions    one action, answered with the new snapshot
 *   GET  /api/playground/export     the world as a downloadable JSON file
 *
 * The handler is pure over its request shape so it can be tested without a socket.
 */
import * as fs from 'fs'
import * as path from 'path'
import {playgroundAssets} from './assets'
import {PlaygroundError, PlaygroundSession, PlaygroundStorage} from './session'

export const PLAYGROUND_PAGE_PATH = '/hm/playground'
export const PLAYGROUND_API_PATH = '/api/playground'

const MAX_BODY_BYTES = 2 * 1024 * 1024

export type PlaygroundRequest = {method: string; pathname: string; body?: string}
export type PlaygroundResponse = {status: number; headers: Record<string, string>; body: string}

export function isPlaygroundPath(pathname: string): boolean {
  return (
    pathname === PLAYGROUND_PAGE_PATH ||
    pathname.startsWith(PLAYGROUND_PAGE_PATH + '/') ||
    pathname === PLAYGROUND_API_PATH ||
    pathname.startsWith(PLAYGROUND_API_PATH + '/')
  )
}

/** Keeps the world in one JSON file, written atomically so a crash never leaves half a lab. */
export function createFilePlaygroundStorage(dir: string): PlaygroundStorage {
  const file = path.join(dir, 'world.json')
  return {
    load() {
      try {
        return fs.readFileSync(file, 'utf8')
      } catch {
        return null
      }
    },
    save(text) {
      fs.mkdirSync(dir, {recursive: true})
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, text)
      fs.renameSync(tmp, file)
    },
  }
}

const JSON_HEADERS = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}

function json(status: number, value: unknown): PlaygroundResponse {
  return {status, headers: JSON_HEADERS, body: JSON.stringify(value)}
}

function parseBody(body: string | undefined): unknown {
  if (!body) throw new PlaygroundError('The request body must be JSON.')
  if (body.length > MAX_BODY_BYTES) throw new PlaygroundError('The request body is too large.', 413)
  try {
    return JSON.parse(body)
  } catch {
    throw new PlaygroundError('The request body must be JSON.')
  }
}

export function createPlaygroundHandler(options: {storage?: PlaygroundStorage} = {}) {
  const session = new PlaygroundSession(options.storage)

  function handle(req: PlaygroundRequest): PlaygroundResponse {
    const {method, pathname} = req
    if (pathname === PLAYGROUND_PAGE_PATH || pathname.startsWith(PLAYGROUND_PAGE_PATH + '/')) {
      if (method !== 'GET' && method !== 'HEAD') return json(405, {error: 'Method not allowed'})
      let file = pathname.slice(PLAYGROUND_PAGE_PATH.length).replace(/^\//, '')
      if (!file) file = 'index.html'
      const asset = playgroundAssets[file]
      if (!asset) return {status: 404, headers: {'Content-Type': 'text/plain; charset=utf-8'}, body: 'Not found'}
      return {
        status: 200,
        headers: {'Content-Type': asset.contentType, 'Cache-Control': 'no-cache'},
        body: method === 'HEAD' ? '' : asset.body,
      }
    }

    const route = pathname.slice(PLAYGROUND_API_PATH.length).replace(/^\//, '').replace(/\/$/, '')
    try {
      if (route === '') {
        if (method !== 'GET') return json(405, {error: 'Method not allowed'})
        return json(200, {ok: true, snapshot: session.snapshot()})
      }
      if (route === 'export') {
        if (method !== 'GET') return json(405, {error: 'Method not allowed'})
        return {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="hm26-lab.json"',
            'Cache-Control': 'no-store',
          },
          body: session.exportJSON(),
        }
      }
      if (route === 'actions') {
        if (method !== 'POST') return json(405, {error: 'Method not allowed'})
        const result = session.dispatch(parseBody(req.body))
        return json(200, {ok: true, ...result})
      }
      return json(404, {ok: false, error: 'Not found'})
    } catch (e) {
      if (e instanceof PlaygroundError) return json(e.status, {ok: false, error: e.message})
      return json(500, {ok: false, error: e instanceof Error ? e.message : 'Unknown error'})
    }
  }

  return {session, handle}
}

export type PlaygroundHandler = ReturnType<typeof createPlaygroundHandler>
