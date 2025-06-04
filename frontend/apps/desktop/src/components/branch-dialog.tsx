import {useForkDocument} from '@/models/documents'
import {useNavigate} from '@/utils/useNavigate'
import {hmIdPathToEntityQueryPath, UnpackedHypermediaId} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {validatePath} from '@shm/shared/utils/document-path'
import {Button} from '@shm/ui/button'
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
  const [account, setAccount] = useState<string | null>(null)
  const navigate = useNavigate()
  const [location, setLocation] = useState<UnpackedHypermediaId | null>(null)
  const isAvailable = useRef(true)
  const pathInvalid = useMemo(
    () => location && validatePath(hmIdPathToEntityQueryPath(location.path)),
    [location?.path],
  )
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
            account={account}
            setAccount={setAccount}
            actionLabel="branch"
            onAvailable={(isAvail) => {
              console.log('~~ isAvail', isAvail)
              isAvailable.current = isAvail
            }}
          />
          <XStack gap="$2">
            <Spinner hide={!forkDoc.isLoading} />

            {location && account ? (
              <Button
                onPress={() => {
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
                      signingAccountId: account,
                    })
                    .then(() => {
                      onClose()
                      navigate({key: 'document', id: location})
                    })
                }}
              >
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
