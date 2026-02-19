import {DraftStatus, draftStatus} from '@/draft-status'
import {draftEditId, draftLocationId} from '@/models/drafts'
import {useGatewayUrl, usePushOnPublish} from '@/models/gateway-settings'
import {useSelectedAccount} from '@/selected-account'
import {client} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {computePublishPath, shouldAutoLinkParent, validatePublishPath} from '@/utils/publish-utils'
import {useNavigate} from '@/utils/useNavigate'
import {HMDocument, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {DraftRoute} from '@shm/shared/routes'
import {validatePath} from '@shm/shared/utils/document-path'
import {createSiteUrl, createWebHMUrl, hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {AlertCircle, Check, Copy, Document, Share} from '@shm/ui/icons'
import {PublishedToast, PushResourceStatus} from '@shm/ui/push-toast'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {useMutation, useQuery} from '@tanstack/react-query'
import {HTMLAttributes, PropsWithChildren, useEffect, useMemo, useRef, useState} from 'react'
import {useDraft} from '../models/accounts'
import {
  addLinkToParentDraft,
  publishLinkToParentDocument,
  usePublishResource,
  usePushResource,
} from '../models/documents'

export default function PublishDraftButton() {
  const route = useNavRoute()
  const navigate = useNavigate('replace')
  const draftRoute: DraftRoute | null = route.key === 'draft' ? route : null
  if (!draftRoute) throw new Error('PublishDraftButton requires draft route')
  const draftId = draftRoute.id
  const draft = useDraft(draftId)
  const pushOnPublish = usePushOnPublish()
  const editId = draftRoute.editUid ? hmId(draftRoute.editUid, {path: draftRoute.editPath}) : draftEditId(draft.data)

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
  )

  const signingAccount = useSelectedAccount()
  const signingAccountId = signingAccount?.id.uid

  // Determine if this is an edit (existing doc) or first publish (new doc)
  const isFirstPublish = !editId
  const isPrivate = draftRoute.visibility === 'PRIVATE' || draft.data?.visibility === 'PRIVATE'
  const defaultLocationId = draftLocationId(draft.data)

  // For first publish, we need editable location state
  const [editableLocation, setEditableLocation] = useState<UnpackedHypermediaId | null>(null)

  // Track if location is available (not already taken)
  const isLocationAvailable = useRef(true)

  // Parent auto-link state for first publish
  type ParentPublishInfo = {
    parentId: UnpackedHypermediaId
    parentDocument: HMDocument | null
    hasDraft: boolean
    draftId?: string
    willAddLink: boolean
  }
  const [parentPublishInfo, setParentPublishInfo] = useState<ParentPublishInfo | null>(null)

  // Compute parent ID from the destination location
  const parentId = useMemo(() => {
    if (!isFirstPublish) return null
    const destLocation = editableLocation
    if (!destLocation) return null
    // Parent path is everything except the last segment
    const parentPath = destLocation.path?.slice(0, -1) || []
    return hmId(destLocation.uid, {path: parentPath})
  }, [isFirstPublish, editableLocation])

  // Fetch parent document resource
  const {data: parentResource, refetch: refetchParentResource} = useResource(
    parentId ? hmId(parentId.uid, {path: parentId.path, latest: true}) : undefined,
    {staleTime: 0}, // Always fetch fresh data
  )
  const parentDocument = parentResource?.type === 'document' ? parentResource.document : null

  // Check if parent has an existing draft
  const {data: parentDraft, refetch: refetchParentDraft} = useQuery({
    queryKey: [queryKeys.DRAFT, 'findByEdit', parentId?.uid, parentId?.path],
    queryFn: () =>
      parentId
        ? client.drafts.findByEdit.query({
            editUid: parentId.uid,
            editPath: parentId.path || [],
          })
        : null,
    enabled: isFirstPublish && !!parentId,
    staleTime: 0, // Always fetch fresh data
  })

  // Compute parent publish info when dependencies change
  useEffect(() => {
    if (!isFirstPublish || !parentId || !editableLocation) {
      setParentPublishInfo(null)
      return
    }

    const willAddLink = shouldAutoLinkParent(!!isPrivate, parentDocument, editableLocation, parentId)

    setParentPublishInfo({
      parentId,
      parentDocument,
      hasDraft: !!parentDraft,
      draftId: parentDraft?.id,
      willAddLink,
    })
  }, [isFirstPublish, isPrivate, parentId, editableLocation, parentDocument, parentDraft])

  // Track initialization params to avoid redundant updates
  const initializedWith = useRef<{
    name: string
    locationUid: string | undefined
  } | null>(null)

  // Initialize editable location when signingAccountId becomes available
  useEffect(() => {
    if (!isFirstPublish) return
    if (!signingAccountId) return

    const docName = draft.data?.metadata.name || ''
    const locationUid = defaultLocationId?.uid

    // Skip if we already initialized with these exact values
    if (initializedWith.current?.name === docName && initializedWith.current?.locationUid === locationUid) {
      return
    }

    // For first publish, use the draft's location if available, otherwise use the signing account
    const baseUid = locationUid || signingAccountId
    const basePath = defaultLocationId?.path || []

    initializedWith.current = {name: docName, locationUid}
    setEditableLocation(
      hmId(baseUid, {
        path: computePublishPath(!!isPrivate, basePath, docName),
      }),
    )
  }, [isFirstPublish, signingAccountId, defaultLocationId, draft.data?.metadata.name])

  // Use editable location for first publish, otherwise use editId
  const locationId = isFirstPublish ? editableLocation : editId

  const gatewayUrl = useGatewayUrl()
  const {data: siteResource} = useResource(locationId ? hmId(locationId.uid, {latest: true}) : undefined)
  const siteDocument = siteResource?.type === 'document' ? siteResource.document : undefined

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

    async function handlePublish(destinationId: UnpackedHypermediaId, accountId: string) {
      if (!draft.data) {
        toast.error('Draft not loaded')
        throw new Error('Draft not loaded')
      }

      // Step 1: Publish the child document
      const res = await publish.mutateAsync({
        draft: draft.data,
        destinationId,
        accountId,
      })

      const resultPath = entityQueryPathToHmIdPath(res.path)
      const childResultId = hmId(res.account, {
        path: resultPath,
        version: res.version,
      })
      const resultDocId = hmId(res.account, {
        path: resultPath,
        latest: true,
      })

      // Step 2: Handle parent auto-link BEFORE anything else
      let parentResultDoc: HMDocument | null = null
      const shouldAddLinkToParent = parentPublishInfo?.willAddLink

      if (shouldAddLinkToParent && accountId) {
        try {
          const navigateToParent = () => {
            navigate({
              key: 'document',
              id: hmId(parentPublishInfo.parentId.uid, {
                path: parentPublishInfo.parentId.path,
                latest: true,
              }),
            })
          }

          if (parentPublishInfo.hasDraft && parentPublishInfo.draftId) {
            // Add to draft - no push needed for parent
            await addLinkToParentDraft(parentPublishInfo.draftId, childResultId)
            // Show success toast for draft update
            toast.success(<ParentUpdateToast message="Link added to parent draft" onViewParent={navigateToParent} />)
          } else if (parentPublishInfo.parentDocument) {
            // Publish to parent document
            parentResultDoc = await publishLinkToParentDocument(
              parentPublishInfo.parentId,
              parentPublishInfo.parentDocument,
              childResultId,
              accountId,
            )
            // Show success toast for parent publish
            toast.success(<ParentUpdateToast message="Parent document updated" onViewParent={navigateToParent} />)
          }
        } catch (error) {
          console.error('Failed to add link to parent:', error)
          toast.error('Published document, but failed to add link to parent')
        }
      }

      // Step 3: Delete the draft
      if (resultDocId && draftId) {
        await deleteDraft.mutateAsync(draftId).catch((e) => {
          console.error('Failed to delete draft', e)
        })
        invalidateQueries([queryKeys.DRAFT])
        invalidateQueries([queryKeys.DRAFTS_LIST])
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
      }

      // Step 4: Navigate to the published document
      if (resultDocId) {
        const hasAlreadyPrompted = await client.prompting.getPromptedKey.query(
          `account-email-notifs-${resultDocId.uid}`,
        )
        navigate({
          key: 'document',
          panel: route.key == 'draft' && route.panel?.key == 'activity' ? route.panel : null,
          id: resultDocId,
          immediatelyPromptNotifs: !hasAlreadyPrompted,
        })
      }

      // Step 5: Handle push workflow (in background, after navigation)
      if (pushOnPublish.data !== 'never' && res.version) {
        const [setPushStatus, pushStatus] = writeableStateStream<PushResourceStatus | null>(null)

        // Push child document
        const childPushPromise = pushResource(childResultId, undefined, setPushStatus)

        // Push parent document if we published changes to it
        if (parentResultDoc) {
          const parentResultId = hmId(parentResultDoc.account, {
            path: entityQueryPathToHmIdPath(parentResultDoc.path),
            version: parentResultDoc.version,
          })
          pushResource(parentResultId).catch((err) => {
            console.error('Failed to push parent document:', err)
          })
        }

        toast.promise(childPushPromise, {
          loading: <PublishedToast pushStatus={pushStatus} status="loading" />,
          success: <PublishedToast pushStatus={pushStatus} status="success" />,
          error: (err) => <PublishedToast pushStatus={pushStatus} status="error" errorMessage={err.message} />,
        })
      }
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
      const pathError = validatePublishPath(!!isPrivate, editableLocation.path, validatePath)
      if (pathError) {
        toast.error(pathError)
        return
      }
      handlePublish(editableLocation, signingAccountId)
    } else {
      toast.error('Cannot publish: missing location or account')
    }
  }

  // Refetch parent data when popover opens to handle edge case where
  // parent state changes between creating the draft and publishing
  const popoverState = usePopoverState(false, (isOpen) => {
    if (isOpen && isFirstPublish && parentId) {
      refetchParentResource()
      refetchParentDraft()
    }
  })

  return (
    <>
      <SaveIndicatorStatus />
      <Popover {...popoverState}>
        <Tooltip
          content={signingAccount ? `Publish as ${signingAccount?.document?.metadata.name}` : 'Publish Document...'}
        >
          <PopoverTrigger asChild>
            <Button size="sm" className="hover:bg-hover dark:bg-background bg-white px-2">
              <Share className="size-4" />
              Publish
            </Button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent
          align="end"
          className="w-80"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement)?.focus()
          }}
        >
          <div className="flex flex-col gap-3">
            {/* Header - first publish only */}
            {isFirstPublish && <p className="text-base font-semibold">Ready to publish?</p>}

            {/* You are publishing section */}
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">You are publishing</p>
              <div className="flex items-center gap-1.5">
                <span className="shrink-0">
                  <Document size={12} color="currentColor" />
                </span>
                <span className="truncate text-sm">{draft.data?.metadata.name || 'Untitled'}</span>
              </div>
              {isFirstPublish && (
                <p className="text-muted-foreground text-xs">
                  Publishing means your document will be public and live on the URL below.
                </p>
              )}
            </div>

            <Separator />

            {/* Your document will be available at section */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Your document will be available at</p>
              {documentUrl ? (
                <div className="flex items-center gap-2">
                  <span
                    className="text-muted-foreground min-w-0 flex-1 text-xs"
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
                  <Tooltip content="Copy URL">
                    <Button
                      size="iconSm"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => {
                        copyTextToClipboard(documentUrl).then(() => {
                          toast.success('Copied document URL')
                        })
                      }}
                    >
                      <Copy size={14} />
                    </Button>
                  </Tooltip>
                </div>
              ) : (
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Spinner className="size-3" />
                  <span>Loading...</span>
                </div>
              )}
              {/* Permalink editor - first publish only */}
              {isFirstPublish && editableLocation && (
                <div className="flex flex-col gap-1">
                  <p className="text-muted-foreground text-xs">Edit your permalink</p>
                  <Input
                    value={`/${editablePath}`}
                    onChange={(e) => {
                      if (!editableLocation) return
                      const raw = e.target.value.replace(/^\//, '')
                      const newPath = [...(editableLocation.path?.slice(0, -1) || []), pathNameify(raw)]
                      setEditableLocation(hmId(editableLocation.uid, {path: newPath}))
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
                        e.stopPropagation()
                        ;(e.target as HTMLInputElement).select()
                      }
                    }}
                    placeholder="/document-path"
                    className="h-8 text-xs"
                  />
                </div>
              )}
            </div>

            <Separator />
            <div className="flex flex-col gap-1">
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
              <Button size="sm" variant="ghost" onClick={() => popoverState.onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

function StatusWrapper({children, className, ...props}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={`flex flex-col gap-2 opacity-60 ${className || ''}`} {...props}>
      {children}
    </div>
  )
}

function SaveIndicatorStatus() {
  const [status, setStatus] = useState('idle' as DraftStatus)

  useEffect(() => {
    return draftStatus.subscribe((current) => {
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

function ParentUpdateToast({message, onViewParent}: {message: string; onViewParent: () => void}) {
  return (
    <div className="flex items-center gap-2">
      <span>{message}</span>
      <Button size="xs" variant="link" className="h-auto p-0" onClick={onViewParent}>
        View parent
      </Button>
    </div>
  )
}
