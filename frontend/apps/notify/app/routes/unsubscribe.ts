import {setEmailUnsubscribed} from '@/db'
import {corsJson, withCors} from '@/utils/cors'

/**
 * RFC 8058 one-click unsubscribe endpoint.
 *
 * Mail clients send a POST to the List-Unsubscribe URL.
 * We also support GET for manual browser clicks -- redirects to the settings page.
 */
export async function POST(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return corsJson({error: 'Missing token'}, {status: 400})
  }

  setEmailUnsubscribed(token, true)
  return corsJson({ok: true}, {status: 200})
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return corsJson({error: 'Missing token'}, {status: 400})
  }

  // For browser clicks, unsubscribe and redirect to the settings page, which the web app serves on
  // this same origin.
  setEmailUnsubscribed(token, true)
  return withCors(
    new Response(null, {
      status: 302,
      headers: {Location: `/hm/email-notifications?token=${encodeURIComponent(token)}`},
    }),
  )
}
