import {useMoveDocument} from '@/models/documents'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {hmIdPathToEntityQueryPath, UnpackedHypermediaId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {validatePath} from '@shm/shared/utils/document-path'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useMemo, useRef, useState} from 'react'
import {DialogTitle} from './dialog'
import {LocationPicker} from './location-picker'
export function MoveDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {
    id: UnpackedHypermediaId
  }
}) {
  const {data: resource} = useResource(input.id)
  const document = resource?.type === 'document' ? resource.document : undefined
  const moveDoc = useMoveDocument()
  const navigate = useNavigate()
  const selectedAccount = useSelectedAccount()
  if (!selectedAccount) {
    return <div>No account selected</div>
  }
  const [location, setLocation] = useState<UnpackedHypermediaId | null>(
    input.id,
  )
  const isAvailable = useRef(true)
  const pathInvalid = useMemo(
    () => location && validatePath(hmIdPathToEntityQueryPath(location.path)),
    [location?.path],
  )
  if (!document)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  return (
    <div className="flex flex-col">
      <DialogTitle>Move "{document?.metadata.name}"</DialogTitle>
      {document ? (
        <>
          <LocationPicker
            location={location}
            setLocation={setLocation}
            newName={document?.metadata.name || 'Untitled'}
            account={selectedAccount.id.uid}
            actionLabel="move"
            onAvailable={(isAvail) => {
              isAvailable.current = isAvail
            }}
          />
          <div className="flex gap-2">
            <Spinner hide={!moveDoc.isLoading} />

            {location ? (
              <Button
                onClick={() => {
                  if (!isAvailable.current) {
                    toast.error(
                      'This location is unavailable. Create a new path name.',
                    )
                    return
                  }
                  if (pathInvalid) {
                    toast.error(pathInvalid.error)
                    return
                  }
                  moveDoc
                    .mutateAsync({
                      from: input.id,
                      to: location,
                      signingAccountId: selectedAccount.id.uid,
                    })
                    .then(() => {
                      onClose()
                      navigate({key: 'document', id: location})
                    })
                }}
              >
                <HMIcon
                  id={selectedAccount.id}
                  metadata={selectedAccount.document?.metadata}
                  size={24}
                />
                Move
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      )}
    </div>
  )
}
