import {grpcClient} from '@/client.server'
import {ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {handleApiAction, handleApiRequest} from '@shm/shared/api-server'

async function queryDaemon<T>(pathAndQuery: string): Promise<T> {
  const daemonHost = DAEMON_HTTP_URL
  const response = await fetch(`${daemonHost}${pathAndQuery}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${pathAndQuery}: ${response.statusText}`)
  }
  return (await response.json()) as T
}

export async function loader({request}: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const result = await handleApiRequest(url, grpcClient, queryDaemon)
  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  })
}

export async function action({request, params}: ActionFunctionArgs) {
  const key = (params['*']?.split('/') || [])[0] || ''
  const body = new Uint8Array(await request.arrayBuffer())
  const result = await handleApiAction(key, body, grpcClient, queryDaemon)
  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  })
}
