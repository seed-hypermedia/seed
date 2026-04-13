import {AccountNotificationsSection} from '@/frontend/components/AccountNotificationsSection'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {getProfileAvatarImageSrc, getProfileDisplayName} from '@/frontend/profile'
import {Separator} from '@/frontend/components/ui/separator'
import {useAppState} from '@/frontend/store'
import * as blobs from '@shm/shared/blobs'

/**
 * Notifications tab showing notification email settings for all vault accounts.
 * Allows users to set/remove notification email per account.
 */
export function NotificationsView() {
  const {vaultData, session, profiles, profileLoadStates, notificationServerUrl, loading, error, backendHttpBaseUrl} =
    useAppState()
  const accounts = vaultData?.accounts ?? []
  const sessionEmail = session?.email?.trim() || ''
  const effectiveNotificationServerUrl = vaultData?.notificationServerUrl?.trim() || notificationServerUrl

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        {sessionEmail ? (
          <p className="text-muted-foreground text-sm">For: {sessionEmail}</p>
        ) : (
          <p className="text-muted-foreground text-sm">Manage notification emails for your accounts</p>
        )}
      </div>

      <ErrorMessage message={error} />

      {accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No accounts yet. Create an account to configure notifications.</p>
      ) : (
        <div className="space-y-6">
          {accounts.map((account, index) => {
            const kp = blobs.nobleKeyPairFromSeed(account.seed)
            const principal = blobs.principalToString(kp.principal)
            const profile = profiles[principal]
            const profileLoadState = profileLoadStates[principal]
            const name = getProfileDisplayName(profile, profileLoadState)
            const avatarSrc = profile?.avatar
              ? getProfileAvatarImageSrc(backendHttpBaseUrl, profile.avatar)
              : undefined

            return (
              <div key={principal}>
                {index > 0 && <Separator className="mb-6" />}
                <div className="mb-4 flex items-center gap-3">
                  {avatarSrc ? (
                    <img src={avatarSrc} alt="" className="size-8 rounded-full object-cover" />
                  ) : (
                    <div className="bg-muted flex size-8 items-center justify-center rounded-full text-xs font-medium">
                      {(name || '?')[0]?.toUpperCase()}
                    </div>
                  )}
                  <p className="text-sm font-semibold">{name}</p>
                </div>
                <AccountNotificationsSection
                  seed={account.seed}
                  accountCreateTime={account.createTime}
                  notificationServerUrl={effectiveNotificationServerUrl}
                  sessionEmail={sessionEmail}
                  disabled={loading}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
