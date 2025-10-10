import {DraftStatus, draftStatus} from '@/draft-status'
import {draftEditId, draftLocationId} from '@/models/drafts'
import {useGatewayUrl, usePushOnPublish} from '@/models/gateway-settings'
import {useSelectedAccount} from '@/selected-account'
import {client, trpc} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {DraftRoute} from '@shm/shared/routes'
import {useStream} from '@shm/shared/use-stream'
import {validatePath} from '@shm/shared/utils/document-path'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {
  entityQueryPathToHmIdPath,
  hmIdPathToEntityQueryPath,
} from '@shm/shared/utils/path-api'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {HMIcon} from '@shm/ui/hm-icon'
import {AlertCircle, Check} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
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
import {usePublishDraft, usePublishToSite} from '../models/documents'
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
  const editId = draftRoute.editUid
    ? hmId(draftRoute.editUid, {path: draftRoute.editPath})
    : draftEditId(draft.data)

  const deleteDraft = trpc.drafts.delete.useMutation({
    onSuccess: () => {
      invalidateQueries(['trpc.drafts.get'])
    },
  })
  const editingResource = useResource(editId)
  const editDocument =
    editingResource.data?.type === 'document'
      ? editingResource.data.document
      : undefined
  const siteUrl = editDocument?.metadata.siteUrl
  const gatewayUrl = useGatewayUrl()
  const publishToSite = usePublishToSite()
  const publishSiteUrl = siteUrl || gatewayUrl.data || DEFAULT_GATEWAY_URL
  const publish = usePublishDraft(
    editId
      ? {
          ...editId,
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
            hmId(resultDoc.account, {
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

  const firstPublishDialog = useFirstPublishDialog()

  const signingAccount = useSelectedAccount()
  const signingAccountId = signingAccount?.id.uid

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
          const resultDocId = hmId(res.account, {
            path: entityQueryPathToHmIdPath(res.path),
            latest: true,
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
                route.key == 'draft' && route.accessory?.key == 'activity'
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

    if (editId && signingAccountId) {
      handlePublish(editId, signingAccountId)
    } else {
      firstPublishDialog.open({
        newDefaultName: pathNameify(
          draft.data.metadata.name || 'Untitled Document',
        ),
        onSelectDestination: (location, account) => {
          handlePublish(location, account)
        },
        defaultLocation: draftLocationId(draft.data),
        defaultAccount: signingAccountId,
      })
    }
  }

  return (
    <>
      <SaveIndicatorStatus />
      <Tooltip
        content={
          signingAccount
            ? `Publish as ${signingAccount?.document?.metadata.name}`
            : 'Publish Document...'
        }
      >
        <Button
          size="sm"
          className="px-2"
          onClick={handlePublishPress}
          variant="outline"
        >
          {signingAccount ? (
            <HMIcon
              id={signingAccount.id}
              name={signingAccount.document?.metadata?.name}
              icon={signingAccount.document?.metadata?.icon}
              size={18}
            />
          ) : null}
          Publish
        </Button>
      </Tooltip>
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
      ? hmId(input.defaultLocation.uid, {
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
