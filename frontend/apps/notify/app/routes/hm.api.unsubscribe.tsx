import {setEmailUnsubscribed} from '@/db'
import {ActionFunction, LoaderFunction, json} from '@remix-run/node'

/**
 * RFC 8058 one-click unsubscribe endpoint.
 *
 * Mail clients send a POST to the List-Unsubscribe URL.
 * We also support GET for manual browser clicks -- redirects to the settings page.
 */
export const action: ActionFunction = async ({request}) => {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return json({error: 'Missing token'}, {status: 400})
  }

  setEmailUnsubscribed(token, true)
  return json({ok: true}, {status: 200})
}

export const loader: LoaderFunction = async ({request}) => {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return json({error: 'Missing token'}, {status: 400})
  }

  // For browser clicks, unsubscribe and redirect to the settings page
  setEmailUnsubscribed(token, true)
  return new Response(null, {
    status: 302,
    headers: {Location: `/hm/email-notifications?token=${encodeURIComponent(token)}`},
  })
}
