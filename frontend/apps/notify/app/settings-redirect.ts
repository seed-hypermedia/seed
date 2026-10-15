/** Path of the email notification settings page, served by the web app on the same origin as notify. */
export const EMAIL_SETTINGS_PAGE_PATH = '/hm/email-notifications'

/**
 * Redirects a browser that followed an email link to the settings page. The Location is relative so
 * it resolves against the public origin the email link pointed at, whatever host the proxy forwards.
 */
export function settingsPageRedirect(params: {token?: string | null; verification?: string}) {
  const query = new URLSearchParams()
  if (params.token) query.set('token', params.token)
  if (params.verification) query.set('verification', params.verification)
  const search = query.toString()
  return new Response(null, {
    status: 302,
    headers: {Location: search ? `${EMAIL_SETTINGS_PAGE_PATH}?${search}` : EMAIL_SETTINGS_PAGE_PATH},
  })
}
