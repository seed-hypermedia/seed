import {grpcClient} from '@/client.server'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {withCors} from '@/utils/cors'
import {ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {handleApiAction, handleApiRequest} from '@shm/shared/api-server'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {QueryDocumentsRequest} from '@shm/shared/client/grpc-types'
import type {JsonValue} from '@bufbuild/protobuf'

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
    return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}

function getBearerAuthorization(request: Request): string | null {
  const authorization = request.headers.get('Authorization')
  return authorization?.startsWith('Bearer ') ? authorization : null
}

function withAuthorizationHeader<T extends object>(client: T, authorization: string | null): T {
  if (!authorization) return client
  return new Proxy(client, {
    get(target, serviceName, receiver) {
      const service = Reflect.get(target, serviceName, receiver)
      if (!service || typeof service !== 'object') return service
      return new Proxy(service, {
        get(serviceTarget, methodName, serviceReceiver) {
          const method = Reflect.get(serviceTarget, methodName, serviceReceiver)
          if (typeof method !== 'function') return method
          return (input: unknown, options?: {headers?: HeadersInit}) => {
            const headers = new Headers(options?.headers)
            headers.set('Authorization', authorization)
            return method.call(serviceTarget, input, {
              ...options,
              headers,
            })
          }
        },
      })
    },
  })
}

async function queryDaemon<T>(pathAndQuery: string, authorization?: string | null): Promise<T> {
  const daemonHost = DAEMON_HTTP_URL
  const response = await fetch(`${daemonHost}${pathAndQuery}`, {
    headers: authorization ? {Authorization: authorization} : undefined,
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${pathAndQuery}: ${response.statusText}`)
  }
  return (await response.json()) as T
}

function corsOptions() {
  return withCors(new Response(null, {status: 204}))
}

export async function loader({request}: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') return corsOptions()
  const cookieToken = await getDaemonAuthToken(request)
  const headerAuth = getBearerAuthorization(request)
  const authorization = headerAuth || (cookieToken ? `Bearer ${cookieToken}` : null)
  return withDaemonAuthToken(cookieToken, async () => {
    const url = new URL(request.url)
    const result = await handleApiRequest(url, withAuthorizationHeader(grpcClient, authorization), (pathAndQuery) =>
      queryDaemon(pathAndQuery, authorization),
    )
    return withCors(
      new Response(result.body, {
        status: result.status,
        headers: result.headers,
      }),
    )
  })
}

export async function action({request, params}: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') return corsOptions()
  const cookieToken = await getDaemonAuthToken(request)
  const headerAuth = getBearerAuthorization(request)
  const authorization = headerAuth || (cookieToken ? `Bearer ${cookieToken}` : null)
  return withDaemonAuthToken(cookieToken, async () => {
    const key = (params['*']?.split('/') || [])[0] || ''
    const body = new Uint8Array(await request.arrayBuffer())
    if (key === 'QueryDocuments') {
      try {
        const decoded = cborDecode(body)
        if (!isJsonValue(decoded)) throw new Error('Invalid QueryDocuments request payload.')
        const query = QueryDocumentsRequest.fromJson(decoded)
        const result = await withAuthorizationHeader(grpcClient, authorization).documents.queryDocuments(query)
        return withCors(
          new Response(JSON.stringify(result.toJson()), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
          }),
        )
      } catch (error) {
        return withCors(
          new Response(JSON.stringify({error: error instanceof Error ? error.message : 'QueryDocuments failed'}), {
            status: 500,
            headers: {'Content-Type': 'application/json'},
          }),
        )
      }
    }
    const result = await handleApiAction(
      key,
      body,
      withAuthorizationHeader(grpcClient, authorization),
      (pathAndQuery) => queryDaemon(pathAndQuery, authorization),
    )
    return withCors(
      new Response(result.body, {
        status: result.status,
        headers: result.headers,
      }),
    )
  })
}
