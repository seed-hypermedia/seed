import {DraftStatus, draftStatus} from '@/draft-status'
import {useMyAccountsWithWriteAccess} from '@/models/access-control'
import {useGatewayUrl, usePushOnPublish} from '@/models/gateway-settings'
import {useSelectedAccount} from '@/selected-account'
import {client, trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {HMEntityContent, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {DraftRoute} from '@shm/shared/routes'
import {validatePath} from '@shm/shared/utils/document-path'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {
  entityQueryPathToHmIdPath,
  hmIdPathToEntityQueryPath,
} from '@shm/shared/utils/path-api'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {AlertCircle, Check, ChevronDown} from '@shm/ui/icons'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {DialogTitle, useAppDialog} from '@shm/ui/universal-dialog'
import {useStream} from '@shm/ui/use-stream'
import {
  HTMLAttributes,
  PropsWithChildren,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {useDraft} from '../models/accounts'
import {
  draftDispatch,
  usePublishDraft,
  usePublishToSite,
} from '../models/documents'
import {LocationPicker} from './location-picker'

export default function PublishDraftButton() {
  const route = useNavRoute()
  const navigate = useNavigate('replace')
  const draftRoute: DraftRoute | null = route.key === 'draft' ? route : null
  if (!draftRoute)
    throw new Error('DraftPublicationButtons requires draft route')
  const draftId = draftRoute.id
  const draft = useDraft(draftId)
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

        if (draft.id && resultDoc.version) {
          const resultPath = entityQueryPathToHmIdPath(resultDoc.path)
          let publishPromise = publishToSite(
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
              // toast.dismiss(toastId)
            })

          toast.promise(publishPromise, {
            loading: `Pushing to ${publishSiteUrl}`,
            success: (
              <PublishedToast host={publishSiteUrl} isPushed={isPushed} />
            ),
            error: <PublishedToast host={publishSiteUrl} isPushed={isPushed} />,
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
            const hasAlreadyPrompted =
              await client.prompting.getPromptedKey.query(
                `account-email-notifs-${resultDocId.uid}`,
              )
            navigate({
              key: 'document',
              accessory:
                route.key == 'draft' && route.accessory?.key == 'versions'
                  ? route.accessory
                  : null,
              id: resultDocId,
              immediatelyPromptNotifs: !hasAlreadyPrompted,
            })
          } else {
            console.error(`can't navigate to document`)
          }
        })
    }
    if (draft.data.editId && draft.data.signingAccount) {
      handlePublish(draft.data.editId, draft.data.signingAccount)
    } else {
      firstPublishDialog.open({
        newDefaultName: pathNameify(
          draft.data.metadata.name || 'Untitled Document',
        ),
        onSelectDestination: (location, account) => {
          handlePublish(location, account)
        },
        defaultLocation: draft.data.locationId,
        defaultAccount: draft.data.signingAccount,
      })
    }
  }

  return (
    <>
      <SaveIndicatorStatus />
      <div className="flex overflow-hidden rounded-md">
        <div>
          <Tooltip
            content={
              signingAccount
                ? `Publish as ${signingAccount?.document?.metadata.name}`
                : 'Publish Document...'
            }
          >
            <Button size="xs" onClick={handlePublishPress} variant="outline">
              {signingAccount ? (
                <HMIcon
                  id={signingAccount.id}
                  metadata={signingAccount.document?.metadata}
                  size={20}
                />
              ) : null}
              Publish
            </Button>
          </Tooltip>
        </div>
        {accts.length > 1 ? (
          <div>
            <OptionsDropdown
              button={
                <Button size="xs">
                  <ChevronDown className="size-2" />
                </Button>
              }
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
          </div>
        ) : null}
      </div>
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
    defaultLocation: UnpackedHypermediaId | null | undefined
    defaultAccount: string | null | undefined
    onSelectDestination: (
      location: UnpackedHypermediaId,
      account: string,
    ) => void
  }
  onClose: () => void
}) {
  const [location, setLocation] = useState<UnpackedHypermediaId | null>(
    input.defaultLocation
      ? hmId('d', input.defaultLocation.uid, {
          path: [
            ...(input.defaultLocation.path || []),
            pathNameify(input.newDefaultName),
          ],
        })
      : null,
  )
  const isAvailable = useRef(true)
  const pathInvalid = useMemo(
    () => location && validatePath(hmIdPathToEntityQueryPath(location.path)),
    [location?.path],
  )
  const selectedAccount = useSelectedAccount()
  if (!selectedAccount?.id.uid) return null
  return (
    <>
      <DialogTitle>Publish Document</DialogTitle>
      <LocationPicker
        newName={input.newDefaultName}
        location={location}
        setLocation={setLocation}
        account={selectedAccount?.id.uid}
        actionLabel="publish"
        onAvailable={(isAvail) => {
          isAvailable.current = isAvail
        }}
      />
      <Button
        variant="default"
        onClick={() => {
          if (!isAvailable.current) {
            toast.error('This location is unavailable. Create a new path name.')
            return
          }
          if (pathInvalid) {
            toast.error(pathInvalid.error)
            return
          }
          if (location) {
            input.onSelectDestination(location, selectedAccount.id.uid)
          }
        }}
      >
        Publish
      </Button>
    </>
  )
}

function useFirstPublishDialog() {
  return useAppDialog(FirstPublishDialog)
}

function StatusWrapper({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      className={`flex flex-col gap-2 opacity-60 ${className || ''}`}
      {...props}
    >
      {children}
    </div>
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
  let message: ReactNode = ''
  if (pushed === null) {
    message = (
      <>
        Published. Pushing to <b>{host}</b>
      </>
    )
  } else if (pushed === true) {
    message = (
      <>
        Published to <b>{host}</b>
      </>
    )
  } else if (pushed === false) {
    message = (
      <>
        Published locally. Could not push to <b>{host}</b>
      </>
    )
  }
  return message
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
        <Button variant="ghost" size="xs">
          <Spinner />
          saving...
        </Button>
      </StatusWrapper>
    )
  }

  if (status == 'saved') {
    return (
      <StatusWrapper>
        <Button variant="ghost" size="xs" disabled>
          <Check />
          saved
        </Button>
      </StatusWrapper>
    )
  }

  if (status == 'error') {
    return (
      <StatusWrapper className="items-end">
        <Tooltip content="An error ocurred while trying to save the latest changes.">
          <Button variant="destructive" size="xs">
            <AlertCircle className="size-2" />
            Error
          </Button>
        </Tooltip>
      </StatusWrapper>
    )
  }

  return null
}
