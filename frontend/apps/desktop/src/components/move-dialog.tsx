import {useListSite, useMoveDocument} from '@/models/documents'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmIdPathToEntityQueryPath} from '@shm/shared'
import {getMetadataName} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {validatePath} from '@shm/shared/utils/document-path'
import {Button} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useEffect, useMemo, useRef, useState} from 'react'
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
  const sourceId = resource?.type === 'document' ? resource.id : input.id
  const moveDoc = useMoveDocument()
  const list = useListSite(sourceId)
  const navigate = useNavigate()
  const selectedAccount = useSelectedAccount()
  const [location, setLocation] = useState<UnpackedHypermediaId | null>(sourceId)
  const isAvailable = useRef(true)
  const pathInvalid = useMemo(
    () => location && validatePath(hmIdPathToEntityQueryPath(location.path)),
    [location?.path],
  )
  useEffect(() => {
    setLocation((current) => (current?.id === input.id.id && sourceId.id !== input.id.id ? sourceId : current))
  }, [input.id.id, sourceId])
  const childDocs = useMemo(() => {
    const parentPath = sourceId.path || []
    return (
      list.data?.filter((item) => {
        if (!item.path?.length || item.redirectInfo) return false
        return (
          item.path.length > parentPath.length && parentPath.every((segment, index) => item.path[index] === segment)
        )
      }) || []
    )
  }, [list.data, sourceId.path])
  if (!selectedAccount) {
    return <div>No account selected</div>
  }
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
            account={selectedAccount.id?.uid}
            actionLabel="move"
            onAvailable={(isAvail) => {
              isAvailable.current = isAvail
            }}
          />
          {childDocs.length ? (
            <>
              <Text className="text-muted-foreground text-sm">
                You will move {childDocs.length} {childDocs.length === 1 ? 'child document' : 'children documents'}.
              </Text>
              <div className="my-4 flex flex-col gap-3">
                {childDocs.map((item) => (
                  <MoveListItem key={item.path?.join('/')} metadata={item.metadata} path={item.path} />
                ))}
              </div>
            </>
          ) : null}
          <div className="flex gap-2">
            <Spinner hide={!moveDoc.isLoading} />

            {location ? (
              <Button
                onClick={() => {
                  if (!isAvailable.current) {
                    toast.error('This location is unavailable. Create a new path name.')
                    return
                  }
                  if (pathInvalid) {
                    toast.error(pathInvalid.error)
                    return
                  }
                  moveDoc
                    .mutateAsync({
                      from: sourceId,
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
                  name={selectedAccount.metadata?.name}
                  icon={selectedAccount.metadata?.icon}
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

function MoveListItem({metadata, path}: {metadata: HMMetadata; path: string[] | null}) {
  return (
    <div className="flex justify-between gap-3">
      <Text>{getMetadataName(metadata)}</Text>
      <Text className="text-muted-foreground">{path?.join('/') || '?'}</Text>
    </div>
  )
}
