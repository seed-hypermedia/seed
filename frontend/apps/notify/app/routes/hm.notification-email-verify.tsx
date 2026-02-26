import {applyNotificationEmailVerificationFromEmailLink} from '@/notification-email-verification'
import {LoaderFunction, redirect} from '@remix-run/node'

function buildRedirectUrl(token: string | undefined, status: string) {
  if (!token) {
    return `/hm/email-notifications?verification=${encodeURIComponent(status)}`
  }
  return `/hm/email-notifications?token=${encodeURIComponent(token)}&verification=${encodeURIComponent(status)}`
}

export const loader: LoaderFunction = async ({request}) => {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  console.log('[notification-email-verify] request received', {
    hasToken: Boolean(token),
  })

  if (!token) {
    console.warn('[notification-email-verify] missing token')
    return redirect(buildRedirectUrl(undefined, 'invalid-token'))
  }

  const result = applyNotificationEmailVerificationFromEmailLink({token})
  if (!result.applied) {
    console.warn('[notification-email-verify] verification not applied', {
      reason: result.reason,
      accountId: 'accountId' in result ? result.accountId : undefined,
      email: 'email' in result ? result.email : undefined,
    })
    return redirect(buildRedirectUrl('adminToken' in result ? result.adminToken : undefined, result.reason))
  }

  console.info('[notification-email-verify] verification completed', {
    accountId: result.accountId,
    email: result.email,
    verifiedTime: result.verifiedTime,
  })
  return redirect(buildRedirectUrl(result.adminToken, 'verified'))
}
