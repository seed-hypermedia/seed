import {grpcClient} from '@/client.server'
import {daemonAuthClearCookie, daemonAuthSetCookie} from '@/daemon-auth.server'
import {requireSignInEnabled} from '@/require-sign-in.server'
import {resolveMemberAccount} from '@/site-membership.server'
import {withCors} from '@/utils/cors'
import {signWebSession, webSessionClearCookie, webSessionSecret, webSessionSetCookie} from '@/web-session.server'
import {principalToString} from '@shm/shared/blobs'
import {AuthenticateRequest} from '@shm/shared/client/grpc-types'
import {Code, ConnectError} from '@connectrpc/connect'
import {ActionFunctionArgs} from '@remix-run/node'

function authErrorStatus(error: unknown): number {
  if (!(error instanceof ConnectError)) return 500

  switch (error.code) {
    case Code.InvalidArgument:
      return 400
    case Code.Unauthenticated:
      return 401
    case Code.PermissionDenied:
      return 403
    case Code.NotFound:
      return 404
    case Code.Unavailable:
      return 503
    case Code.DeadlineExceeded:
      return 504
    default:
      return 502
  }
}

export async function action({request}: ActionFunctionArgs) {
  try {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, {status: 204}))
    }

    if (request.method === 'DELETE') {
      const headers = new Headers()
      headers.append('Set-Cookie', await daemonAuthClearCookie())
      headers.append('Set-Cookie', webSessionClearCookie())
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
    const expiresAt = Math.floor(expireTime.getTime() / 1000)
    const headers = new Headers()
    if (requireSignInEnabled()) {
      // The daemon mints a token for any key it has seen a blob from, so
      // membership is decided here, before any cookie leaves the server.
      const secret = webSessionSecret()
      if (!secret) {
        return withCors(new Response('Sign-in is not configured on this site', {status: 503}))
      }
      const account = await resolveMemberAccount(principalToString(authRequest.account))
      if (!account) {
        return withCors(new Response('This account is not a member of this site', {status: 403}))
      }
      headers.append('Set-Cookie', webSessionSetCookie(signWebSession({account, exp: expiresAt}, secret), expiresAt))
    }
    headers.append('Set-Cookie', await daemonAuthSetCookie(result.bearerToken, expiresAt))

    return withCors(new Response(null, {status: 204, headers}))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return withCors(new Response(message, {status: authErrorStatus(error)}))
  }
}
