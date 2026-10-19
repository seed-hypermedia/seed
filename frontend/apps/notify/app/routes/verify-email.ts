import {applyNotificationEmailVerificationFromEmailLink} from '@/notification-email-verification'
import {settingsPageRedirect} from '@/settings-redirect'

/** Email link: marks the notification email verified, then redirects to the email settings page. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  console.log('[notification-email-verify] request received', {
    hasToken: Boolean(token),
  })

  if (!token) {
    console.warn('[notification-email-verify] missing token')
    return settingsPageRedirect({verification: 'invalid-token'})
  }

  const result = applyNotificationEmailVerificationFromEmailLink({token})
  if (!result.applied) {
    console.warn('[notification-email-verify] verification not applied', {
      reason: result.reason,
      accountId: 'accountId' in result ? result.accountId : undefined,
      email: 'email' in result ? result.email : undefined,
    })
    return settingsPageRedirect({
      token: 'adminToken' in result ? result.adminToken : undefined,
      verification: result.reason,
    })
  }

  console.info('[notification-email-verify] verification completed', {
    accountId: result.accountId,
    email: result.email,
    verifiedTime: result.verifiedTime,
  })
  return settingsPageRedirect({token: result.adminToken, verification: 'verified'})
}
