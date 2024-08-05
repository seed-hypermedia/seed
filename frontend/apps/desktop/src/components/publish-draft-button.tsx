import {DraftStatus, draftStatus} from '@/draft-status'
import {useMyAccounts} from '@/models/daemon'
import {useEntity} from '@/models/entities'
import {trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {DraftRoute} from '@/utils/routes'
import {useNavigate} from '@/utils/useNavigate'
import {PlainMessage} from '@bufbuild/protobuf'
import {Document, HMEntityContent, hmId, packHmId} from '@shm/shared'
import {
  AlertCircle,
  Button,
  Spinner,
  Tooltip,
  XGroup,
  YStack,
  YStackProps,
} from '@shm/ui'
import {Check, ChevronDown} from '@tamagui/lucide-icons'
import {PropsWithChildren, useEffect, useState} from 'react'
import {createMachine} from 'xstate'
import {useGRPCClient, useQueryInvalidator} from '../app-context'
import {useDraft} from '../models/accounts'
import {draftDispatch, usePublishDraft} from '../models/documents'
import {OptionsDropdown} from './options-dropdown'
import {Thumbnail} from './thumbnail'

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
  const [signingAccount, setSigningAccount] = useState<HMEntityContent | null>(
    null,
  )
  const deleteDraft = trpc.drafts.delete.useMutation({
    onSuccess: () => {
      invalidate(['trpc.drafts.get'])
    },
  })
  const accts = useMyAccounts()
  const publish = usePublishDraft(grpcClient, packedDraftId)

  useEffect(() => {
    if (signingAccount) {
      draftDispatch({type: 'CHANGE', signingAccount: signingAccount.id.uid})
    }
  }, [signingAccount])

  useEffect(() => {
    if (accts.length == 1 && accts[0].data) {
      setSigningAccount(accts[0].data)
    }
  }, [accts])

  useEffect(() => {
    if (draft.data?.signingAccount) {
      const acc = accts.find((c) => c.data?.id.uid == draft.data.signingAccount)
      if (acc?.data) {
        setSigningAccount(acc.data)
      }
    }
  }, [draft.data])

  function handlePublish() {
    if (!draftId) throw new Error('No Draft ID?!')

    if (draft.data) {
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
    navigate({key: 'document', id: draftId})
  }

  return (
    <>
      <SaveIndicatorStatus />
      <XGroup borderRadius="$2" overflow="hidden">
        <XGroup.Item>
          <Tooltip
            content={`publish as ${signingAccount?.document?.metadata.name}`}
          >
            <Button
              size="$2"
              onPress={handlePublish}
              borderRadius={0}
              // disabled={!hassigningKeySelected}
              // opacity={hassigningKeySelected ? 1 : 0.3}
              icon={
                signingAccount ? (
                  <Thumbnail
                    id={signingAccount.id}
                    document={signingAccount.document}
                    size={20}
                  />
                ) : null
              }
            >
              Publish
            </Button>
          </Tooltip>
        </XGroup.Item>
        <XGroup.Item>
          <OptionsDropdown
            button={<Button borderRadius={0} size="$2" icon={ChevronDown} />}
            menuItems={accts.map((acc) => {
              if (acc.data) {
                return {
                  key: acc.data.id.uid,
                  label: acc.data.document?.metadata.name || acc.data?.id.uid,
                  icon: (
                    <Thumbnail
                      size={20}
                      id={acc.data.id}
                      document={acc.data.document}
                    />
                  ),
                  onPress: () => {
                    if (acc.data?.id.uid) {
                      setSigningAccount(acc.data)
                    }
                  },
                }
              } else {
                return null
              }
            })}
          />
        </XGroup.Item>
      </XGroup>
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
