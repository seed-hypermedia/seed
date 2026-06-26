import {Bell, Key, Mail, Shield} from 'lucide-react'
import {useState} from 'react'
import {Button} from '../button'
import {Separator} from '../separator'
import {SettingsRow, SettingsSection} from '../settings-list'
import {ChangeEmailDialog} from './change-email-dialog'
import {NotificationServerDialog} from './notification-server-dialog'
import {SetMasterPasswordDialog} from './set-master-password-dialog'

export type VaultSecurityPasskey = {
  description: string
  /** Omit to hide the action button (e.g. passkeys aren't supported here). */
  actionLabel?: string
  onAction?: () => void
  busy?: boolean
}

export type VaultSecurityPassword = {
  isSet: boolean
  onSet: (password: string) => Promise<void>
}

export type VaultSecurityNotify = {
  /** The current override URL ('' means use the default). */
  url: string
  defaultUrl: string
  onSave: (url: string) => Promise<void>
}

export type VaultSecurityEmail = {
  address?: string
  onStart: (newEmail: string) => Promise<{expireTimeMs?: number} | void>
  onVerify: (code: string) => Promise<void>
}

/**
 * Shared vault security/settings rows used by both the web vault and the desktop
 * app, so the two stay visually and behaviorally identical. Each section is
 * rendered only when its data is provided, and the matching change dialog
 * (master password / email / notify server) is owned here. Platforms inject the
 * data and the persistence callbacks.
 */
export function VaultSecuritySettings({
  passkey,
  password,
  notify,
  email,
  disabled,
}: {
  passkey?: VaultSecurityPasskey
  password?: VaultSecurityPassword
  notify?: VaultSecurityNotify
  email?: VaultSecurityEmail
  disabled?: boolean
}) {
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [notifyOpen, setNotifyOpen] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      {passkey || password ? (
        <SettingsSection label="AUTHENTICATION">
          {passkey ? (
            <SettingsRow
              icon={<Key />}
              label="Passkeys"
              description={passkey.description}
              action={
                passkey.actionLabel ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={passkey.onAction}
                    loading={passkey.busy}
                    disabled={disabled}
                  >
                    {passkey.actionLabel}
                  </Button>
                ) : null
              }
            />
          ) : null}
          {passkey && password ? <Separator /> : null}
          {password ? (
            <SettingsRow
              icon={<Shield />}
              label="Master Password"
              description={password.isSet ? 'Password is set' : 'No password set'}
              action={
                <Button variant="secondary" size="sm" onClick={() => setPasswordOpen(true)} disabled={disabled}>
                  {password.isSet ? 'Change' : 'Add Password'}
                </Button>
              }
            />
          ) : null}
        </SettingsSection>
      ) : null}

      {notify ? (
        <SettingsSection label="NOTIFICATIONS">
          <SettingsRow
            icon={<Bell />}
            label="Notify Server URL"
            description={notify.url || notify.defaultUrl}
            action={
              <Button variant="secondary" size="sm" onClick={() => setNotifyOpen(true)} disabled={disabled}>
                Change
              </Button>
            }
          />
        </SettingsSection>
      ) : null}

      {email ? (
        <SettingsSection label="ACCOUNT">
          <SettingsRow
            icon={<Mail />}
            label="Email address"
            description={email.address}
            action={
              <Button variant="secondary" size="sm" onClick={() => setEmailOpen(true)} disabled={disabled}>
                Change
              </Button>
            }
          />
        </SettingsSection>
      ) : null}

      {password ? (
        <SetMasterPasswordDialog
          open={passwordOpen}
          onOpenChange={setPasswordOpen}
          mode={password.isSet ? 'change' : 'set'}
          onSubmit={password.onSet}
        />
      ) : null}
      {email ? (
        <ChangeEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          currentEmail={email.address}
          onStart={email.onStart}
          onVerify={email.onVerify}
        />
      ) : null}
      {notify ? (
        <NotificationServerDialog
          open={notifyOpen}
          onOpenChange={setNotifyOpen}
          currentUrl={notify.url}
          defaultUrl={notify.defaultUrl}
          onSave={notify.onSave}
        />
      ) : null}
    </div>
  )
}
