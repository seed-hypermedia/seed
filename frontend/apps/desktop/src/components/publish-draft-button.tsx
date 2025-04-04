import {DraftStatus, draftStatus} from '@/draft-status'
import {useMyAccountsWithWriteAccess} from '@/models/access-control'
import {useGatewayUrl, usePushOnPublish} from '@/models/gateway-settings'
import {trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {HMEntityContent, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {DraftRoute} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {AlertCircle, Check, ChevronDown} from '@shm/ui/icons'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {
  ErrorToastDecoration,
  Hostname,
  SuccessToastDecoration,
  toast,
} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useStream} from '@shm/ui/use-stream'
import {PropsWithChildren, ReactNode, useEffect, useRef, useState} from 'react'
import {
  SizableText,
  Spinner,
  XGroup,
  XStack,
  YStack,
  YStackProps,
} from 'tamagui'
import {useDraft} from '../models/accounts'
import {
  draftDispatch,
  usePublishDraft,
  usePublishToSite,
} from '../models/documents'
import {DialogTitle} from './dialog'
import {LocationPicker} from './location-picker'

export default function PublishDraftButton() {
  const route = useNavRoute()
  const navigate = useNavigate('replace')
  const draftRoute: DraftRoute | null = route.key === 'draft' ? route : null
  if (!draftRoute)
    throw new Error('DraftPublicationButtons requires draft route')
  const draftId = draftRoute.id
  const draft = useDraft(draftId)
  console.log('~~ draft', draft.data)
  const pushOnPublish = usePushOnPublish()
  const prevId = draftRoute.editUid
    ? hmId('d', draftRoute.editUid, {path: draftRoute.editPath})
    : draft.data?.editId
    ? draft.data?.editId
    : null
  // const prevEntity = useEntity(prevId)
  const [signingAccount, setSigningAccount] = useState<HMEntityContent | null>(
    null,
  )
  const deleteDraft = trpc.drafts.delete.useMutation({
    onSuccess: () => {
      invalidateQueries(['trpc.drafts.get'])
    },
  })
  const recentSigners = trpc.recentSigners.get.useQuery()
  const accts = useMyAccountsWithWriteAccess(prevId)
  const rootDraftUid = prevId?.uid
  const rootEntity = useEntity(
    rootDraftUid ? hmId('d', rootDraftUid) : undefined,
  )
  const siteUrl = rootEntity.data?.document?.metadata.siteUrl
  const gatewayUrl = useGatewayUrl()
  const publishToSite = usePublishToSite()
  const publishSiteUrl = siteUrl || gatewayUrl.data || DEFAULT_GATEWAY_URL
  const publish = usePublishDraft(
    draft.data?.editId
      ? {
          ...draft.data?.editId,
          version: draft.data?.deps[0] || null,
        }
      : undefined,
    {
      onSuccess: (resultDoc, input) => {
        if (pushOnPublish.data === 'never') return
        const {draft} = input
        const [setIsPushed, isPushed] = writeableStateStream<boolean | null>(
          null,
        )
        const {close} = toast.custom(
          <PublishedToast host={publishSiteUrl} isPushed={isPushed} />,
          {waitForClose: true, duration: 4000},
        )
        if (draft.id && resultDoc.version) {
          const resultPath = entityQueryPathToHmIdPath(resultDoc.path)
          publishToSite(
            hmId('d', resultDoc.account, {
              path: resultPath,
              version: resultDoc.version,
            }),
            publishSiteUrl,
          )
            .then(() => {
              setIsPushed(true)
            })
            .catch((e) => {
              setIsPushed(false)
            })
            .finally(() => {
              close()
            })
        } else {
          setIsPushed(false)
          close()
        }
      },
    },
  )

  useEffect(() => {
    if (signingAccount && signingAccount.id.uid) {
      console.log(
        '~~ signingAccount inside publish-draft-button',
        signingAccount,
      )
      draftDispatch({type: 'change', signingAccount: signingAccount.id.uid})
    }
  }, [signingAccount])

  useEffect(() => {
    let defaultSigner = null
    if (recentSigners.data) {
      const defaultSignerUid = recentSigners.data.recentSigners.find(
        (s) => !!accts.find((c) => c.data?.id.uid == s),
      )
      defaultSigner = defaultSignerUid
        ? accts.find((c) => c.data?.id.uid == defaultSignerUid)
        : accts[0]
    }
    if (
      draft.data?.signingAccount &&
      signingAccount == null &&
      draft.data?.signingAccount != signingAccount
    ) {
      const acc = accts.find(
        (c) => c.data?.id.uid == draft.data?.signingAccount,
      )
      if (acc?.data) {
        setSigningAccount(acc.data)
      }
    } else if (
      defaultSigner?.data &&
      !draft.data?.signingAccount &&
      signingAccount == null &&
      signingAccount != defaultSigner.data
    ) {
      setSigningAccount(defaultSigner.data)
    }
  }, [accts, draft.data])

  const firstPublishDialog = useFirstPublishDialog()

  function handlePublishPress() {
    if (!draftId) throw new Error('No Draft ID?!')

    if (!draft.data) {
      throw new Error('Draft not loaded')
    }

    console.log(draft.data)

    function handlePublish(
      destinationId: UnpackedHypermediaId,
      accountId: string,
    ) {
      if (!draft.data) {
        toast.error('Draft not loaded')
        throw new Error('Draft not loaded')
      }
      publish
        .mutateAsync({
          draft: draft.data,
          destinationId,
          accountId,
        })
        .then(async (res) => {
          const resultDocId = hmId('d', res.account, {
            path: entityQueryPathToHmIdPath(res.path),
          })
          if (resultDocId && draftId)
            await deleteDraft
              .mutateAsync(draftId)
              .catch((e) => {
                console.error('Failed to delete draft', e)
              })
              .then(() => {
                invalidateQueries(['trpc.drafts.get']) // todo, invalidate the specific draft id
                invalidateQueries(['trpc.drafts.list'])
                invalidateQueries(['trpc.drafts.listAccount'])
              })
          if (resultDocId) {
            navigate({
              key: 'document',
              accessory:
                route.key == 'draft' && route.accessory?.key == 'versions'
                  ? route.accessory
                  : null,
              id: resultDocId,
            })
          } else {
            console.error(`can't navigate to document`)
          }
        })
    }
    console.log('~~ draft editId', draft.data.editId)
    if (draft.data.editId) {
      handlePublish(draft.data.editId, draft.data.signingAccount)
    } else {
      firstPublishDialog.open({
        newDefaultName: pathNameify(
          draft.data.metadata.name || 'Untitled Document',
        ),
        onSelectDestination: (location, account) => {
          handlePublish(location, account)
        },
      })
    }
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
              onPress={handlePublishPress}
              borderRadius={0}
              hoverStyle={{cursor: 'default'}}
              // disabled={!hassigningKeySelected}
              // opacity={hassigningKeySelected ? 1 : 0.3}
              icon={
                signingAccount ? (
                  <HMIcon
                    id={signingAccount.id}
                    metadata={signingAccount.document?.metadata}
                    size={20}
                  />
                ) : null
              }
            >
              Publish
            </Button>
          </Tooltip>
        </XGroup.Item>
        {accts.length > 1 ? (
          <XGroup.Item>
            <OptionsDropdown
              button={<Button borderRadius={0} size="$2" icon={ChevronDown} />}
              menuItems={accts.map((acc) => {
                if (acc.data) {
                  return {
                    key: acc.data.id.uid,
                    label: acc.data.document?.metadata.name || acc.data?.id.uid,
                    icon: (
                      <HMIcon
                        size={20}
                        id={acc.data.id}
                        metadata={acc.data.document?.metadata}
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
        ) : null}
      </XGroup>
      {firstPublishDialog.content}
    </>
  )
}

function FirstPublishDialog({
  input,
  onClose,
}: {
  input: {
    newDefaultName: string
    onSelectDestination: (
      location: UnpackedHypermediaId,
      account: string,
    ) => void
  }
  onClose: () => void
}) {
  const [account, setAccount] = useState<string | null>(null)
  // const navigate = useNavigate()
  const [location, setLocation] = useState<UnpackedHypermediaId | null>(null)
  const isAvailable = useRef(true)
  return (
    <YStack>
      <DialogTitle>Publish Document</DialogTitle>
      <LocationPicker
        newName={input.newDefaultName}
        location={location}
        setLocation={setLocation}
        account={account}
        setAccount={setAccount}
        actionLabel="publish"
        onAvailable={(isAvail) => {
          isAvailable.current = isAvail
        }}
      />
      <Button
        onPress={() => {
          if (!isAvailable.current) {
            toast.error('This location is unavailable. Create a new path name.')
            return
          }
          if (location && account) {
            input.onSelectDestination(location, account)
          }
        }}
      >
        Publish
      </Button>
    </YStack>
  )
}

function useFirstPublishDialog() {
  return useAppDialog(FirstPublishDialog)
}

function StatusWrapper({children, ...props}: PropsWithChildren<YStackProps>) {
  return (
    <YStack space="$2" opacity={0.6}>
      {children}
    </YStack>
  )
}

function PublishedToast({
  isPushed,
  host,
}: {
  isPushed: StateStream<boolean | null>
  host: string
}) {
  const pushed = useStream(isPushed)
  let indicator: ReactNode = null
  let message: ReactNode = ''
  if (pushed === null) {
    indicator = <Spinner />
    message = (
      <>
        Published. Pushing to <Hostname host={host} />
      </>
    )
  } else if (pushed === true) {
    indicator = <SuccessToastDecoration />
    message = (
      <>
        Published to <Hostname host={host} />
      </>
    )
  } else if (pushed === false) {
    indicator = <ErrorToastDecoration />
    message = (
      <>
        Published locally. Could not push to <Hostname host={host} />
      </>
    )
  }
  return (
    <YStack f={1} gap="$3">
      <XStack gap="$4" ai="center">
        {indicator}
        <SizableText flexWrap="wrap">{message}</SizableText>
      </XStack>
    </YStack>
  )
}

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
