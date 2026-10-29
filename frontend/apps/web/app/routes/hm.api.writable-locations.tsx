import {grpcClient} from '@/client.server'
import {json, type LoaderFunctionArgs} from '@remix-run/node'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {BIG_INT} from '@shm/shared/constants'

/** Lists public capability grants so the destination picker includes shared spaces. */
export async function loader({request}: LoaderFunctionArgs) {
  const account = new URL(request.url).searchParams.get('account')
  if (!account) throw new Response('Account required', {status: 400})
  const result = await grpcClient.accessControl.listCapabilitiesForDelegate({delegate: account, pageSize: BIG_INT})
  return json([
    hmId(account),
    ...result.capabilities
      .filter((cap) => (cap.role === 2 || cap.role === 3) && !cap.isExact)
      .map((cap) => hmId(cap.account, {path: cap.path.split('/').filter(Boolean)})),
  ])
}
