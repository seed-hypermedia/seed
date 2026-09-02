import {
  createService,
  getService,
  getServiceLogs,
  listServices,
  removeService,
  restartService,
  startService,
  stopService,
  updateService,
} from './app-services'

/**
 * Local HTTP API for the service manager, served by the desktop API server on
 * `http://localhost:<API_HTTP_PORT>/api/services`. Everything is JSON.
 *
 *   GET    /api/services                 list services
 *   POST   /api/services                 create {name, command, cwd?, env?, autoStart?, start?}
 *   GET    /api/services/:id             one service
 *   PATCH  /api/services/:id             update any of {name, command, cwd, env, autoStart}
 *   DELETE /api/services/:id             stop and remove
 *   POST   /api/services/:id/start       start
 *   POST   /api/services/:id/stop        stop (resolves once the process has exited)
 *   POST   /api/services/:id/restart     restart
 *   GET    /api/services/:id/logs?limit  recent output, oldest first
 *
 * Example:
 *   curl -X POST localhost:56004/api/services -H 'content-type: application/json' \
 *     -d '{"name":"web","command":"pnpm dev","cwd":"/path/to/app","start":true}'
 */

export type ServicesHttpResult = {status: number; body: unknown}

export const SERVICES_HTTP_PREFIX = '/api/services'

/** Returns true when the path belongs to the services API. */
export function isServicesHttpPath(pathname: string): boolean {
  return pathname === SERVICES_HTTP_PREFIX || pathname.startsWith(`${SERVICES_HTTP_PREFIX}/`)
}

function json(status: number, body: unknown): ServicesHttpResult {
  return {status, body}
}

function errorResult(error: unknown): ServicesHttpResult {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('Unknown service')) return json(404, {error: message})
  return json(400, {error: message})
}

async function readObject(readJson: () => Promise<unknown>): Promise<Record<string, unknown>> {
  const body = await readJson()
  if (body === undefined || body === null) return {}
  if (typeof body !== 'object' || Array.isArray(body)) throw new Error('Request body must be a JSON object')
  return body as Record<string, unknown>
}

/**
 * Dispatches one services API request. `readJson` is called only for methods that carry a body and
 * must resolve to the parsed JSON body (or undefined for an empty body).
 */
export async function handleServicesHttpRequest(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  readJson: () => Promise<unknown>,
): Promise<ServicesHttpResult> {
  const parts = pathname.slice(SERVICES_HTTP_PREFIX.length).split('/').filter(Boolean).map(decodeURIComponent)
  const [id, action, ...rest] = parts
  if (rest.length) return json(404, {error: 'Not found'})

  try {
    if (!id) {
      if (method === 'GET') return json(200, {services: listServices()})
      if (method === 'POST') {
        const body = await readObject(readJson)
        const service = createService(body as any)
        if (body.start === true) return json(201, {service: startService(service.id)})
        return json(201, {service})
      }
      return json(405, {error: 'Method not allowed'})
    }

    if (!action) {
      if (method === 'GET') return json(200, {service: getService(id)})
      if (method === 'PATCH' || method === 'PUT') {
        const body = await readObject(readJson)
        return json(200, {service: updateService(id, body as any)})
      }
      if (method === 'DELETE') {
        await removeService(id)
        return json(200, {ok: true})
      }
      return json(405, {error: 'Method not allowed'})
    }

    if (action === 'logs') {
      if (method !== 'GET') return json(405, {error: 'Method not allowed'})
      const limitParam = Number(searchParams.get('limit'))
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 5000) : undefined
      return json(200, {lines: getServiceLogs(id, limit)})
    }

    if (method !== 'POST') return json(405, {error: 'Method not allowed'})
    if (action === 'start') return json(200, {service: startService(id)})
    if (action === 'stop') return json(200, {service: await stopService(id)})
    if (action === 'restart') return json(200, {service: await restartService(id)})
    return json(404, {error: 'Not found'})
  } catch (error) {
    return errorResult(error)
  }
}
