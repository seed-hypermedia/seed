import {DraftStatus, draftStatus} from '@/draft-status'
import {useEntity} from '@/models/entities'
import {trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {DraftRoute} from '@/utils/routes'
import {useNavigate} from '@/utils/useNavigate'
import {PlainMessage} from '@bufbuild/protobuf'
import {Document, hmId, packHmId} from '@shm/shared'
import {
  AlertCircle,
  Button,
  Spinner,
  Tooltip,
  YStack,
  YStackProps,
} from '@shm/ui'
import {Check} from '@tamagui/lucide-icons'
import {PropsWithChildren, useEffect, useState} from 'react'
import {createMachine} from 'xstate'
import {useGRPCClient, useQueryInvalidator} from '../app-context'
import {useDraft} from '../models/accounts'
import {usePublishDraft} from '../models/documents'

export default function PublishDraftButton() {
  const route = useNavRoute()
  const navigate = useNavigate('replace')
  const grpcClient = useGRPCClient()
  const draftRoute: DraftRoute | null = route.key === 'draft' ? route : null
  if (!draftRoute)
    throw new Error('DraftPublicationButtons requires draft route')
  const draftId = draftRoute.id
  const packedDraftId = draftId ? packHmId(draftId) : undefined
  const draft = useDraft(packedDraftId)
  const prevEntity = useEntity(draftId?.type !== 'draft' ? draftId : undefined)
  const invalidate = useQueryInvalidator()
  const deleteDraft = trpc.drafts.delete.useMutation({
    onSuccess: () => {
      invalidate(['trpc.drafts.get'])
    },
  })
  const publish = usePublishDraft(grpcClient, packedDraftId)
  function handlePublish() {
    if (draft.data && draftId) {
      publish
        .mutateAsync({
          draft: draft.data,
          previous: prevEntity.data?.document as
            | PlainMessage<Document>
            | undefined,
          id: draftId.type === 'draft' ? undefined : draftId,
        })
        .then(async (res) => {
          const resultDocId = hmId('d', draftId.uid, {path: draftId.path})
          if (draftId)
            await deleteDraft
              .mutateAsync(packHmId(draftId))
              .catch((e) => {
                console.error('Failed to delete draft', e)
              })
              .then(() => {
                invalidate(['trpc.drafts.get']) // todo, invalidate the specific draft id
                invalidate(['trpc.drafts.list'])
              })
          if (resultDocId) {
            navigate({key: 'document', id: resultDocId})
          } else {
            console.error(`can't navigate to document`)
          }
        })
    }
  }

  return (
    <>
      <SaveIndicatorStatus />
      <Button size="$2" onPress={handlePublish}>
        Publish
      </Button>
    </>
  )
}

function StatusWrapper({children, ...props}: PropsWithChildren<YStackProps>) {
  return (
    <YStack space="$2" opacity={0.6}>
      {children}
    </YStack>
  )
}

const dummyMachine = createMachine({initial: 'demo', states: {demo: {}}})

function SaveIndicatorStatus() {
  const [status, setStatus] = useState('idle' as DraftStatus)

  useEffect(() => {
    draftStatus.subscribe((current) => {
      if (current == 'saved') {
        setTimeout(() => {
          setStatus('idle')
        }, 1000)
      }
      setStatus(current)
    })
  }, [])

  if (status == 'saving') {
    return (
      <StatusWrapper>
        <Button chromeless size="$1" icon={<Spinner />}>
          saving...
        </Button>
      </StatusWrapper>
    )
  }

  if (status == 'saved') {
    return (
      <StatusWrapper>
        <Button chromeless size="$1" icon={<Check />} disabled>
          saved
        </Button>
      </StatusWrapper>
    )
  }

  if (status == 'error') {
    return (
      <StatusWrapper alignItems="flex-end">
        <Tooltip content="An error ocurred while trying to save the latest changes.">
          <Button theme="red" size="$2" icon={<AlertCircle />} disabled>
            Error
          </Button>
        </Tooltip>
      </StatusWrapper>
    )
  }

  return null
}
