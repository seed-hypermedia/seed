import {useMoveDocument} from '@/models/documents'
import {useNavigate} from '@/utils/useNavigate'
import {hmIdPathToEntityQueryPath, UnpackedHypermediaId} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {validatePath} from '@shm/shared/utils/document-path'
import {Button} from '@shm/ui/button'
import {toast} from '@shm/ui/toast'
import {useMemo, useRef, useState} from 'react'
import {Spinner, XStack, YStack} from 'tamagui'
import {DialogTitle} from './dialog'
import {LocationPicker} from './location-picker'
export function MoveDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {
    id: UnpackedHypermediaId
    accountsWhoCanMove: string[]
  }
}) {
  const {data: entity} = useEntity(input.id)
  const moveDoc = useMoveDocument()
  const [account, setAccount] = useState<string | null>(null)
  const navigate = useNavigate()
  const [location, setLocation] = useState<UnpackedHypermediaId | null>(
    input.id,
  )
  const isAvailable = useRef(true)
  const pathInvalid = useMemo(
    () => location && validatePath(hmIdPathToEntityQueryPath(location.path)),
    [location?.path],
  )
  if (!entity) return <Spinner />
  return (
    <YStack>
      <DialogTitle>Move "{entity?.document?.metadata.name}"</DialogTitle>
      {entity ? (
        <>
          <LocationPicker
            location={location}
            setLocation={setLocation}
            newName={entity?.document?.metadata.name || 'Untitled'}
            account={account}
            setAccount={setAccount}
            actionLabel="move"
            onAvailable={(isAvail) => {
              isAvailable.current = isAvail
            }}
            allowedAccounts={input.accountsWhoCanMove}
          />
          <XStack gap="$2">
            <Spinner opacity={moveDoc.isLoading ? 1 : 0} />

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
                  moveDoc
                    .mutateAsync({
                      from: input.id,
                      to: location,
                      signingAccountId: account,
                    })
                    .then(() => {
                      onClose()
                      navigate({key: 'document', id: location})
                    })
                }}
              >
                Move
              </Button>
            ) : null}
          </XStack>
        </>
      ) : (
        <Spinner />
      )}
    </YStack>
  )
}
