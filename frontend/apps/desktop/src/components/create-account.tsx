import {desktopUniversalClient} from '@/desktop-universal-client'
import {grpcClient} from '@/grpc-client'
import {useRegisterKey} from '@/models/daemon'
import {postAccountCreateAction, useUniversalAppContext} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {toast} from '@shm/ui/toast'
import {useCallback, useState} from 'react'

/** Creates a local Seed account without showing onboarding UI. */
export function useCreateAccount() {
  const register = useRegisterKey()
  const {setSelectedIdentity} = useUniversalAppContext()
  const [isCreating, setIsCreating] = useState(false)

  const createAccount = useCallback(async () => {
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

      await grpcClient.documents.updateProfile({
        account: createdAccount.accountId,
        profile: {name: '', icon: ''},
        signingKeyName: createdAccount.publicKey,
      })

      const id = hmId(createdAccount.accountId)
      invalidateQueries([queryKeys.ACCOUNT, id.uid])
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
  }, [isCreating, register, setSelectedIdentity])

  return {createAccount, isCreating}
}
