import {grpcClient} from '@/grpc-client'
import {fileUpload} from '@/utils/file-upload'
import {queryKeys} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {AccountProfileForm, type AccountProfileFormValues} from '@shm/ui/components/account-profile-form'
import {DialogTitle} from '@shm/ui/components/dialog'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
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

  async function handleSubmit({name, imageFile}: AccountProfileFormValues) {
    let iconUri = metadata?.icon || ''
    if (imageFile) {
      const cid = await fileUpload(imageFile)
      iconUri = `ipfs://${cid}`
    }

    await grpcClient.documents.updateProfile({
      account: accountUid,
      profile: {
        name,
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
      <AccountProfileForm
        initialName={metadata?.name || ''}
        initialImageUrl={metadata?.icon ? getDaemonFileUrl(metadata.icon) : ''}
        showDescription={false}
        submitLabel="Save"
        onSubmit={handleSubmit}
      />
    </>
  )
}
