import {desktopUniversalClient} from '@/desktop-universal-client'
import {fileUpload} from '@/utils/file-upload'
import {HMPrepareDocumentChangeInput} from '@seed-hypermedia/client/hm-types'
import {hmId, queryKeys} from '@shm/shared'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {DialogTitle} from '@shm/ui/components/dialog'
import {EditProfileForm, SiteMetaFields} from '@shm/ui/edit-profile-form'
import {Spinner} from '@shm/ui/spinner'
import {useAppDialog} from '@shm/ui/universal-dialog'

export function useEditProfileDialog() {
  return useAppDialog<{accountUid: string}>(EditProfileDialog)
}

function EditProfileDialog({onClose, input}: {onClose: () => void; input: {accountUid: string}}) {
  const {accountUid} = input
  const account = useAccount(accountUid)
  const accountDocument = useResource(account.data?.id)
  const document = accountDocument?.data?.type === 'document' ? accountDocument.data.document : undefined

  async function handleSubmit(updates: SiteMetaFields) {
    const changes: HMPrepareDocumentChangeInput['changes'] = []

    if (updates.name && updates.name !== document?.metadata?.name) {
      changes.push({op: {case: 'setMetadata', value: {key: 'name', value: updates.name}}})
    }

    if (updates.icon && typeof updates.icon !== 'string') {
      const cid = await fileUpload(new File([updates.icon], 'icon'))
      changes.push({op: {case: 'setMetadata', value: {key: 'icon', value: `ipfs://${cid}`}}})
    }

    if (changes.length === 0) {
      onClose()
      return
    }

    await desktopUniversalClient.publishDocument!({
      signerAccountUid: accountUid,
      account: accountUid,
      changes,
    })

    const id = hmId(accountUid)
    invalidateQueries([queryKeys.ENTITY, id.id])
    invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
    invalidateQueries([queryKeys.ACCOUNT, id.uid])
    invalidateQueries([queryKeys.DOCUMENT_ACTIVITY])

    onClose()
  }

  if (account.isLoading || accountDocument?.isLoading) {
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
          name: account.data?.metadata?.name || '',
          icon: account.data?.metadata?.icon || null,
        }}
        onSubmit={handleSubmit}
      />
    </>
  )
}
