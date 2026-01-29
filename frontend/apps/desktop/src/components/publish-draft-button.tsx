import {DraftStatus, draftStatus} from '@/draft-status'
import {draftEditId, draftLocationId} from '@/models/drafts'
import {useGatewayUrl, usePushOnPublish} from '@/models/gateway-settings'
import {useSelectedAccount} from '@/selected-account'
import {client} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {DraftRoute} from '@shm/shared/routes'
import {validatePath} from '@shm/shared/utils/document-path'
import {
  createSiteUrl,
  createWebHMUrl,
  hmId,
} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {
  entityQueryPathToHmIdPath,
  hmIdPathToEntityQueryPath,
} from '@shm/shared/utils/path-api'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {CopyUrlField} from '@shm/ui/copy-url-field'
import {AlertCircle, Check, Document, Pencil, Share} from '@shm/ui/icons'
import {PublishedToast, PushResourceStatus} from '@shm/ui/push-toast'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {useMutation} from '@tanstack/react-query'
import {
  HTMLAttributes,
  PropsWithChildren,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {useDraft} from '../models/accounts'
import {usePublishResource, usePushResource} from '../models/documents'
import {LocationPicker} from './location-picker'

export default function PublishDraftButton() {
  const route = useNavRoute()
  const navigate = useNavigate('replace')
  const draftRoute: DraftRoute | null = route.key === 'draft' ? route : null
  if (!draftRoute) throw new Error('PublishDraftButton requires draft route')
  const draftId = draftRoute.id
  const draft = useDraft(draftId)
  const pushOnPublish = usePushOnPublish()
  const editId = draftRoute.editUid
    ? hmId(draftRoute.editUid, {path: draftRoute.editPath})
    : draftEditId(draft.data)

  const deleteDraft = useMutation({
    mutationFn: (draftId: string) => client.drafts.delete.mutate(draftId),
    onSuccess: () => {
      invalidateQueries([queryKeys.DRAFT])
    },
  })
  const pushResource = usePushResource()
  const publish = usePublishResource(
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
        const [setPushStatus, pushStatus] =
          writeableStateStream<PushResourceStatus | null>(null)
        if (draft.id && resultDoc.version) {
          const resultPath = entityQueryPathToHmIdPath(resultDoc.path)
          const publishPromise = pushResource(
            hmId(resultDoc.account, {
              path: resultPath,
              version: resultDoc.version,
            }),
            undefined,
            setPushStatus,
          )
          toast.promise(publishPromise, {
            loading: (
              <PublishedToast pushStatus={pushStatus} status="loading" />
            ),
            success: (
              <PublishedToast pushStatus={pushStatus} status="success" />
            ),
            error: (err) => (
              <PublishedToast
                pushStatus={pushStatus}
                status="error"
                errorMessage={err.message}
              />
            ),
          })
        } else {
          toast.error('Failed to publish')
        }
      },
    },
  )

  const firstPublishDialog = useFirstPublishDialog()

  const signingAccount = useSelectedAccount()
  const signingAccountId = signingAccount?.id.uid

  // Determine if this is an edit (existing doc) or first publish (new doc)
  const isFirstPublish = !editId
  const defaultLocationId = draftLocationId(draft.data)

  // For first publish, we need editable location state
  const [editableLocation, setEditableLocation] =
    useState<UnpackedHypermediaId | null>(null)
  const [isEditingPath, setIsEditingPath] = useState(false)

  // Track if location is available (not already taken)
  const isLocationAvailable = useRef(true)

  // Initialize editable location when signingAccountId becomes available
  useEffect(() => {
    if (!isFirstPublish || editableLocation) return
    if (!signingAccountId) return

    // For first publish, use the draft's location if available, otherwise use the signing account
    const baseUid = defaultLocationId?.uid || signingAccountId
    const basePath = defaultLocationId?.path || []
    const docName = pathNameify(
      draft.data?.metadata.name || 'Untitled Document',
    )

    setEditableLocation(
      hmId(baseUid, {
        path: [...basePath, docName],
      }),
    )
  }, [
    isFirstPublish,
    signingAccountId,
    defaultLocationId,
    draft.data?.metadata.name,
    editableLocation,
  ])

  // Use editable location for first publish, otherwise use editId
  const locationId = isFirstPublish ? editableLocation : editId

  const gatewayUrl = useGatewayUrl()
  const {data: siteResource} = useResource(
    locationId ? hmId(locationId.uid, {latest: true}) : undefined,
  )
  const siteDocument =
    siteResource?.type === 'document' ? siteResource.document : undefined

  // Compute parent URL (site root or parent path)
  const parentUrl = useMemo(() => {
    if (!locationId || !gatewayUrl.data) return null
    const siteUrl = siteDocument?.metadata?.siteUrl
    const parentPath = locationId.path?.slice(0, -1) || []
    if (siteUrl) {
      return createSiteUrl({
        path: parentPath,
        hostname: siteUrl,
      })
    }
    return createWebHMUrl(locationId.uid, {
      path: parentPath,
      hostname: gatewayUrl.data,
    })
  }, [locationId, gatewayUrl.data, siteDocument?.metadata?.siteUrl])

  const documentUrl = useMemo(() => {
    if (!locationId || !gatewayUrl.data) return null
    const siteUrl = siteDocument?.metadata?.siteUrl
    if (siteUrl) {
      return createSiteUrl({
        path: locationId.path,
        hostname: siteUrl,
      })
    }
    return createWebHMUrl(locationId.uid, {
      path: locationId.path,
      hostname: gatewayUrl.data,
    })
  }, [locationId, gatewayUrl.data, siteDocument?.metadata?.siteUrl])

  // Get the editable path segment (last part of the path)
  const editablePath = editableLocation?.path?.at(-1) || ''

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
                invalidateQueries([queryKeys.DRAFT]) // todo, invalidate the specific draft id
                invalidateQueries([queryKeys.DRAFTS_LIST])
                invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
              })
          if (resultDocId) {
            const hasAlreadyPrompted =
              await client.prompting.getPromptedKey.query(
                `account-email-notifs-${resultDocId.uid}`,
              )
            navigate({
              key: 'document',
              panel:
                route.key == 'draft' && route.panel?.key == 'activity'
                  ? route.panel
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
      // Editing existing document
      handlePublish(editId, signingAccountId)
    } else if (editableLocation && signingAccountId) {
      // First publish with editable location from popover
      if (!isLocationAvailable.current) {
        toast.error('This location is unavailable. Create a new path name.')
        return
      }
      const pathInvalid = validatePath(
        hmIdPathToEntityQueryPath(editableLocation.path),
      )
      if (pathInvalid) {
        toast.error(pathInvalid.error)
        return
      }
      handlePublish(editableLocation, signingAccountId)
    } else {
      toast.error('Cannot publish: missing location or account')
    }
  }

  const popoverState = usePopoverState()

  return (
    <>
      <SaveIndicatorStatus />
      <Popover {...popoverState}>
        <Tooltip
          content={
            signingAccount
              ? `Publish as ${signingAccount?.document?.metadata.name}`
              : 'Publish Document...'
          }
        >
          <PopoverTrigger asChild>
            <Button size="sm" className="px-2">
              <Share className="size-4" />
              Publish
            </Button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent
          align="end"
          className="w-96"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement)?.focus()
          }}
        >
          <div className="flex flex-col gap-4">
            {/* You are publishing section */}
            <div className="flex flex-col gap-2">
              <p className="text-lg font-medium">You are publishing</p>
              {documentUrl && (
                <div className="flex items-center gap-2">
                  <Document size={16} color="currentColor" />
                  <span
                    className="text-sm"
                    style={{
                      direction: 'rtl',
                      textAlign: 'left',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {documentUrl}
                  </span>
                </div>
              )}
            </div>

            <Separator />

            {/* Your page will be available at section */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-lg font-medium">
                  Your page will be available at
                </p>
                {isFirstPublish && editableLocation && (
                  <Tooltip
                    content={isEditingPath ? 'Done editing' : 'Edit path'}
                  >
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setIsEditingPath(!isEditingPath)}
                    >
                      <Pencil size={14} />
                    </Button>
                  </Tooltip>
                )}
              </div>
              {/* Full document URL shown smaller above input */}
              {documentUrl && (
                <span
                  className="text-muted-foreground text-xs"
                  style={{
                    direction: 'rtl',
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {documentUrl}
                </span>
              )}
              {isEditingPath && isFirstPublish && editableLocation ? (
                <Input
                  value={editablePath}
                  onChange={(e) => {
                    if (!editableLocation) return
                    const newPath = [
                      ...(editableLocation.path?.slice(0, -1) || []),
                      pathNameify(e.target.value),
                    ]
                    setEditableLocation(
                      hmId(editableLocation.uid, {path: newPath}),
                    )
                  }}
                  onKeyDown={(e) => {
                    // ENTER toggles edit state
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      setIsEditingPath(false)
                    }
                    // Cmd/Ctrl+A selects all text in input, prevents global select-all
                    if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
                      e.stopPropagation()
                      ;(e.target as HTMLInputElement).select()
                    }
                  }}
                  placeholder="document-path"
                  className="text-sm"
                  autoFocus
                />
              ) : documentUrl ? (
                <CopyUrlField size="sm" url={documentUrl} label="Document" />
              ) : (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Spinner className="size-4" />
                  <span>Loading...</span>
                </div>
              )}
            </div>
            <Separator />
            <div className="flex flex-col gap-1">
              {/* Action buttons */}
              <Button size="sm" variant="default" onClick={handlePublishPress}>
                Publish: Make it live now
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  client.createAppWindow.mutate({
                    routes: [{key: 'preview', draftId}],
                    sidebarLocked: false,
                    sidebarWidth: 0,
                    accessoryWidth: 0,
                  })
                }}
              >
                Preview: View before publishing
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => popoverState.onOpenChange(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
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
