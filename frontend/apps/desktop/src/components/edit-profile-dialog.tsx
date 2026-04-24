import {grpcClient} from '@/grpc-client'
import {fileUpload} from '@/utils/file-upload'
import {queryKeys} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {DialogTitle} from '@shm/ui/components/dialog'
import {EditProfileForm, SiteMetaFields} from '@shm/ui/edit-profile-form'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'

export function useEditProfileDialog() {
  return useAppDialog<{accountUid: string}>(EditProfileDialog)
}

export function EditProfileDialog({onClose, input}: {onClose: () => void; input: {accountUid: string}}) {
  const {accountUid} = input
  const account = useAccount(accountUid)
  const metadata = account.data?.metadata ?? undefined

  async function handleSubmit(updates: SiteMetaFields) {
    let iconUri = ''
    if (updates.icon instanceof Blob) {
      const cid = await fileUpload(new File([updates.icon], 'icon'))
      iconUri = `ipfs://${cid}`
    } else if (typeof updates.icon === 'string' && updates.icon) {
      iconUri = updates.icon
    }

    await grpcClient.documents.updateProfile({
      account: accountUid,
      profile: {
        name: updates.name ?? '',
        icon: iconUri,
        description: metadata?.summary ?? '',
      },
      signingKeyName: accountUid,
    })

    invalidateQueries([queryKeys.ACCOUNT, accountUid])
    invalidateQueries([queryKeys.LIST_ACCOUNTS])

    toast.success('Profile updated')
    onClose()
  }

  if (account.isLoading) {
    return (
      <>
        <DialogTitle>Edit Profile</DialogTitle>
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      </>
    )
  }

  return (
    <>
      <DialogTitle>Edit Profile</DialogTitle>
      <EditProfileForm
        defaultValues={{
          name: metadata?.name || '',
          icon: metadata?.icon || null,
        }}
        onSubmit={handleSubmit}
      />
    </>
  )
}
