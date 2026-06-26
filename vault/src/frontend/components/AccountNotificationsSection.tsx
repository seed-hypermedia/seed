import * as notificationApi from '@/frontend/notification-api'
import * as blobs from '@shm/shared/blobs'
import {NotificationEmailSettings} from '@shm/ui/components/notification-email-settings'
import {useEffect, useState} from 'react'

type AccountNotificationsSectionProps = {
  seed: Uint8Array
  accountCreateTime: number
  notificationServerUrl: string
  sessionEmail: string
  disabled?: boolean
}

function getNotificationServerLabel(notificationServerUrl: string) {
  return notificationServerUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function isNotificationSetupVisible(config: notificationApi.NotificationConfigResponse | null) {
  if (!config) {
    return false
  }

  if (!config.isRegistered && !config.email) {
    return false
  }

  return true
}

const PENDING_VERIFICATION_POLL_MS = 1_000
const REGISTRATION_SYNC_POLL_MS = 250
const REGISTRATION_SYNC_WINDOW_MS = 15_000

/**
 * Displays account notification registration and email settings for a single vault account.
 */
export function AccountNotificationsSection({
  seed,
  accountCreateTime,
  notificationServerUrl,
  sessionEmail,
  disabled = false,
}: AccountNotificationsSectionProps) {
  const kp = blobs.nobleKeyPairFromSeed(seed)
  const principal = blobs.principalToString(kp.principal)
  const normalizedSessionEmail = sessionEmail.trim()
  const [notificationConfig, setNotificationConfig] = useState<notificationApi.NotificationConfigResponse | null>(null)
  const [notificationStatus, setNotificationStatus] = useState<
    'hidden' | 'loading' | 'ready' | 'registering' | 'saving-email' | 'removing-email' | 'error'
  >('hidden')
  const [notificationError, setNotificationError] = useState('')
  const [registrationSyncDeadline, setRegistrationSyncDeadline] = useState(0)
  const hasNotificationServer = Boolean(notificationServerUrl)
  const hasNotificationRegistration = Boolean(notificationConfig?.isRegistered || notificationConfig?.email)
  const hasPendingVerification = Boolean(notificationConfig?.email && !notificationConfig?.verifiedTime)
  const isRegisteringNotificationSetup = notificationStatus === 'registering'
  const notificationServerLabel = getNotificationServerLabel(notificationServerUrl)
  const notificationStatusMessage =
    notificationStatus === 'loading'
      ? 'Checking notification status...'
      : notificationStatus === 'registering'
        ? `Registering this account with ${notificationServerLabel}...`
        : notificationStatus === 'saving-email'
          ? 'Saving notification email...'
          : notificationStatus === 'removing-email'
            ? 'Removing notification email...'
            : ''

  useEffect(() => {
    let cancelled = false
    const shouldSyncRecentAccount =
      accountCreateTime > 0 && Date.now() - accountCreateTime < REGISTRATION_SYNC_WINDOW_MS
    setNotificationConfig(null)

    if (!notificationServerUrl) {
      setNotificationError('')
      setNotificationStatus('hidden')
      return
    }

    setRegistrationSyncDeadline(shouldSyncRecentAccount ? accountCreateTime + REGISTRATION_SYNC_WINDOW_MS : 0)
    setNotificationStatus(shouldSyncRecentAccount ? 'registering' : 'loading')
    setNotificationError('')

    notificationApi
      .getNotificationConfig(notificationServerUrl, kp)
      .then((config) => {
        if (cancelled) return
        setNotificationConfig(config)
        if (isNotificationSetupVisible(config) || !shouldSyncRecentAccount) {
          setNotificationStatus('ready')
          setRegistrationSyncDeadline(0)
        }
      })
      .catch((loadError) => {
        if (cancelled) return
        console.error('Failed to load notification config:', loadError)
        setNotificationConfig(null)
        setNotificationStatus('error')
        setNotificationError((loadError as Error).message || 'Failed to load notification status')
      })

    return () => {
      cancelled = true
    }
  }, [accountCreateTime, notificationServerUrl, principal])

  useEffect(() => {
    if (!notificationServerUrl || notificationStatus !== 'registering') {
      return
    }

    let cancelled = false

    const intervalId = window.setInterval(() => {
      notificationApi
        .getNotificationConfig(notificationServerUrl, kp)
        .then((config) => {
          if (cancelled) return
          setNotificationConfig(config)
          if (isNotificationSetupVisible(config)) {
            setNotificationStatus('ready')
            setRegistrationSyncDeadline(0)
            return
          }
          if (registrationSyncDeadline > 0 && Date.now() >= registrationSyncDeadline) {
            setNotificationStatus('ready')
            setRegistrationSyncDeadline(0)
          }
        })
        .catch((pollError) => {
          if (cancelled) return
          console.error('Failed to refresh notification registration state:', pollError)
        })
    }, REGISTRATION_SYNC_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [notificationServerUrl, principal, notificationStatus, registrationSyncDeadline])

  useEffect(() => {
    if (!notificationServerUrl || !hasPendingVerification || notificationStatus !== 'ready') {
      return
    }

    let cancelled = false

    const intervalId = window.setInterval(() => {
      notificationApi
        .getNotificationConfig(notificationServerUrl, kp)
        .then((config) => {
          if (cancelled) return
          setNotificationConfig(config)
        })
        .catch((pollError) => {
          if (cancelled) return
          console.error('Failed to refresh notification verification state:', pollError)
        })
    }, PENDING_VERIFICATION_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [notificationServerUrl, principal, hasPendingVerification, notificationStatus])

  async function handleRegister() {
    if (!notificationServerUrl) {
      return
    }

    setNotificationStatus('registering')
    setRegistrationSyncDeadline(Date.now() + REGISTRATION_SYNC_WINDOW_MS)
    setNotificationError('')

    try {
      await notificationApi.registerNotificationInbox(notificationServerUrl, kp)
      const config = await notificationApi.getNotificationConfig(notificationServerUrl, kp)
      setNotificationConfig(config)
      if (isNotificationSetupVisible(config)) {
        setNotificationStatus('ready')
        setRegistrationSyncDeadline(0)
      }
    } catch (registerError) {
      console.error('Failed to register notification inbox:', registerError)
      setNotificationStatus('error')
      setRegistrationSyncDeadline(0)
      setNotificationError((registerError as Error).message || 'Failed to register this account for notifications')
    }
  }

  async function handleSetEmail(targetEmail: string) {
    const nextEmail = targetEmail.trim()
    if (!notificationServerUrl || !nextEmail) {
      return
    }

    setNotificationStatus('saving-email')
    setNotificationError('')

    try {
      if (!notificationConfig?.isRegistered) {
        await notificationApi.registerNotificationInbox(notificationServerUrl, kp)
      }
      const config = await notificationApi.setNotificationConfig(notificationServerUrl, kp, nextEmail)
      setNotificationConfig(config)
      setNotificationStatus('ready')
      setRegistrationSyncDeadline(0)
    } catch (saveError) {
      console.error('Failed to save notification email:', saveError)
      setNotificationStatus('error')
      setNotificationError((saveError as Error).message || 'Failed to save notification email')
    }
  }

  async function handleRemoveEmail() {
    if (!notificationServerUrl || !notificationConfig?.email) {
      return
    }

    setNotificationStatus('removing-email')
    setNotificationError('')

    try {
      const config = await notificationApi.removeNotificationConfig(notificationServerUrl, kp)
      setNotificationConfig(config)
      setNotificationStatus('ready')
      setRegistrationSyncDeadline(0)
    } catch (removeError) {
      console.error('Failed to remove notification email:', removeError)
      setNotificationStatus('error')
      setNotificationError((removeError as Error).message || 'Failed to remove notification email')
    }
  }

  return (
    <NotificationEmailSettings
      serverLabel={hasNotificationServer ? notificationServerLabel : null}
      isRegistered={hasNotificationRegistration}
      email={notificationConfig?.email ?? null}
      isVerified={Boolean(notificationConfig?.verifiedTime)}
      needsVerification={hasPendingVerification}
      statusMessage={hasNotificationServer && notificationStatusMessage ? notificationStatusMessage : undefined}
      error={notificationError || null}
      defaultEmail={normalizedSessionEmail}
      disabled={disabled}
      registering={isRegisteringNotificationSetup}
      saving={notificationStatus === 'saving-email'}
      removing={notificationStatus === 'removing-email'}
      onRegister={handleRegister}
      onSetEmail={handleSetEmail}
      onRemoveEmail={handleRemoveEmail}
    />
  )
}
