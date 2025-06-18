import {useForkDocument} from '@/models/documents'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {hmIdPathToEntityQueryPath, UnpackedHypermediaId} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {validatePath} from '@shm/shared/utils/document-path'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useMemo, useRef, useState} from 'react'
import {XStack, YStack} from 'tamagui'
import {DialogTitle} from './dialog'
import {LocationPicker} from './location-picker'

export function BranchDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: UnpackedHypermediaId
}) {
  const {data: entity} = useEntity(input)
  const forkDoc = useForkDocument()
  const navigate = useNavigate()
  const [location, setLocation] = useState<UnpackedHypermediaId | null>(null)
  const isAvailable = useRef(true)
  const pathInvalid = useMemo(
    () => location && validatePath(hmIdPathToEntityQueryPath(location.path)),
    [location?.path],
  )
  const selectedAccount = useSelectedAccount()
  if (!selectedAccount) {
    return <div>No account selected</div>
  }
  if (!entity)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  return (
    <YStack>
      <DialogTitle>Branch from "{entity?.document?.metadata.name}"</DialogTitle>
      {entity ? (
        <>
          <LocationPicker
            location={location}
            setLocation={setLocation}
            newName={entity?.document?.metadata.name || 'Untitled'}
            account={selectedAccount.id.uid}
            actionLabel="branch"
            onAvailable={(isAvail) => {
              isAvailable.current = isAvail
            }}
          />
          <XStack gap="$2">
            <Spinner hide={!forkDoc.isLoading} />

            {location && selectedAccount ? (
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
                  forkDoc
                    .mutateAsync({
                      from: input,
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
                Create Document Branch
              </Button>
            ) : null}
          </XStack>
        </>
      ) : (
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      )}
    </YStack>
  )
}
