import React from 'react'
import {useListKeys, useVaultStatus} from '@/models/daemon'
import {useRemoteVaultReminderPreference} from '@/models/app-settings'
import {useNavigate} from '@/utils/useNavigate'
import {VaultBackendMode, VaultConnectionStatus} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'

const REMIND_LATER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Shows a non-blocking remote-vault reminder for local-only desktop users.
 */
export function RemoteVaultReminder() {
  const navigate = useNavigate()
  const vaultStatus = useVaultStatus()
  const keys = useListKeys()
  const reminder = useRemoteVaultReminderPreference()

  const hasKeys = (keys.data?.length || 0) > 0
  const isLocalOnly =
    vaultStatus.data?.backendMode === VaultBackendMode.LOCAL &&
    vaultStatus.data?.connectionStatus !== VaultConnectionStatus.CONNECTED
  const isDismissedPermanently = reminder.value.data?.dontRemindAgain === true
  const remindLaterUntil = reminder.value.data?.remindLaterUntilMs ?? null
  const isSnoozed = remindLaterUntil !== null && remindLaterUntil > Date.now()

  if (!hasKeys || !isLocalOnly || isDismissedPermanently || isSnoozed) {
    return null
  }

  return (
    <div className="border-border bg-background mb-4 flex flex-col gap-3 rounded-lg border p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <SizableText size="lg" weight="bold">
          Connect a Remote Vault
        </SizableText>
        <SizableText className="text-muted-foreground">
          Remote Vault lets you continue using your Hypermedia accounts across devices and on the Web. All data is
          end-to-end encrypted.
        </SizableText>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={() => {
            navigate({key: 'settings'})
          }}
        >
          Open Settings
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            reminder.setPreference({
              remindLaterUntilMs: Date.now() + REMIND_LATER_MS,
              dontRemindAgain: false,
            })
          }}
        >
          Remind Me Later
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            reminder.setPreference({
              remindLaterUntilMs: null,
              dontRemindAgain: true,
            })
          }}
        >
          Don&apos;t Remind Again
        </Button>
      </div>
    </div>
  )
}
