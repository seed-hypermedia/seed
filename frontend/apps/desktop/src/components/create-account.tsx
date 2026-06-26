import {desktopUniversalClient} from '@/desktop-universal-client'
import {grpcClient} from '@/grpc-client'
import {useRegisterKey, useVaultEmail} from '@/models/daemon'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {client} from '@/trpc'
import {fileUpload} from '@/utils/file-upload'
import {postAccountCreateAction, useUniversalAppContext} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {DialogTitle} from '@shm/ui/components/dialog'
import {EditProfileForm, SiteMetaFields} from '@shm/ui/edit-profile-form'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useCallback, useState} from 'react'

/** Creates a local Seed account without showing onboarding UI. */
export function useCreateAccount() {
  const register = useRegisterKey()
  const {setSelectedIdentity} = useUniversalAppContext()
  const [isCreating, setIsCreating] = useState(false)

  const createAccount = useCallback(
    async (profile: SiteMetaFields) => {
      if (isCreating) return null

      setIsCreating(true)
      try {
        const mnemonicResponse = await grpcClient.daemon.genMnemonic({})
        if (!mnemonicResponse.mnemonic.length) {
          throw new Error('Mnemonic generation failed')
        }

        const createdAccount = await register.mutateAsync({
          mnemonic: [...mnemonicResponse.mnemonic],
        })

        let iconUri = ''
        if (profile.icon instanceof Blob) {
          const cid = await fileUpload(new File([profile.icon], 'icon'))
          iconUri = `ipfs://${cid}`
        } else if (typeof profile.icon === 'string' && profile.icon) {
          iconUri = profile.icon
        }

        await grpcClient.documents.updateProfile({
          account: createdAccount.accountId,
          profile: {name: profile.name, icon: iconUri, description: profile.description ?? ''},
          signingKeyName: createdAccount.publicKey,
        })

        const id = hmId(createdAccount.accountId)
        invalidateQueries([queryKeys.ACCOUNT, id.uid])
        invalidateQueries([queryKeys.LIST_ACCOUNTS])
        invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])

        await postAccountCreateAction(
          {accountUid: createdAccount.accountId},
          {
            getSigner: desktopUniversalClient.getSigner!,
            publish: desktopUniversalClient.publish,
          },
        )

        setSelectedIdentity?.(createdAccount.publicKey || createdAccount.accountId)
        toast.success('Account created')
        return createdAccount
      } catch (error) {
        toast.error('Account creation failed: ' + (error instanceof Error ? error.message : String(error)))
        return null
      } finally {
        setIsCreating(false)
      }
    },
    [isCreating, register, setSelectedIdentity],
  )

  return {createAccount, isCreating}
}

/** Opens the desktop account creation dialog. */
export function useCreateAccountDialog() {
  return useAppDialog(CreateAccountDialog)
}

function CreateAccountDialog({onClose}: {onClose: () => void}) {
  const {createAccount, isCreating} = useCreateAccount()
  const notifyServiceHost = useNotifyServiceHost() || 'https://notify.seed.hyper.media'
  const {data: vaultEmail} = useVaultEmail()
  const email = vaultEmail?.trim() || ''
  const [shareEmailWithNotificationServer, setShareEmailWithNotificationServer] = useState(true)

  async function handleSubmit(profile: SiteMetaFields) {
    const createdAccount = await createAccount(profile)
    if (!createdAccount) return

    if (shareEmailWithNotificationServer && email) {
      try {
        await client.notificationConfig.setConfig.mutate({
          accountUid: createdAccount.accountId,
          notifyServiceHost,
          email,
        })
        invalidateQueries([queryKeys.NOTIFICATION_CONFIG, notifyServiceHost, createdAccount.accountId])
      } catch (error) {
        toast.error(
          'Account created, but notification setup failed: ' + (error instanceof Error ? error.message : String(error)),
        )
      }
    }

    onClose()
  }

  return (
    <>
      <DialogTitle>Create Account</DialogTitle>
      <EditProfileForm
        onSubmit={handleSubmit}
        submitLabel={isCreating ? 'Creating…' : 'Create Account'}
        notificationOption={
          email
            ? {
                label: `Notify me at ${email}`,
                description:
                  'Leave this on to register notifications with that email. If you turn it off, the account will still be created without an email address.',
                checked: shareEmailWithNotificationServer,
                onCheckedChange: setShareEmailWithNotificationServer,
              }
            : undefined
        }
      />
    </>
  )
}
