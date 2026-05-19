import {grpcClient} from '@/client.server'
import {daemonAuthClearCookie, daemonAuthSetCookie} from '@/daemon-auth.server'
import {withCors} from '@/utils/cors'
import {AuthenticateRequest} from '@shm/shared/client/grpc-types'
import {ActionFunctionArgs} from '@remix-run/node'

export async function action({request}: ActionFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, {status: 204}))
  }

  if (request.method === 'DELETE') {
    const headers = new Headers()
    headers.append('Set-Cookie', await daemonAuthClearCookie())
    return withCors(new Response(null, {status: 204, headers}))
  }

  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.includes('application/protobuf')) {
    return withCors(new Response('Expected application/protobuf', {status: 415}))
  }

  const authRequest = AuthenticateRequest.fromBinary(new Uint8Array(await request.arrayBuffer()))
  const result = await grpcClient.daemon.authenticate(authRequest)
  const expireTime = result.expireTime?.toDate()
  if (!expireTime) {
    return withCors(new Response('Authenticate response missing expire_time', {status: 502}))
  }
  const headers = new Headers()
  headers.append('Set-Cookie', await daemonAuthSetCookie(result.bearerToken, Math.floor(expireTime.getTime() / 1000)))

  return withCors(new Response(null, {status: 204, headers}))
}
