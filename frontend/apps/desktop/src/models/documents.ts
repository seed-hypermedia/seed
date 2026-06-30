import {desktopUniversalClient} from '@/desktop-universal-client'
import {reportError} from '@/errors'
import {grpcClient} from '@/grpc-client'
import {useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {Timestamp, toPlainMessage} from '@bufbuild/protobuf'
import {Code, ConnectError} from '@connectrpc/connect'
import {createRedirectRef, createVersionRef} from '@seed-hypermedia/client'
import {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {
  HMAnnotation,
  HMBlock,
  HMBlockNode,
  HMDocument,
  HMDocumentMetadataSchema,
  HMPublishBlobsInput,
  HMSigner,
  HMDraft,
  HMDraftContent,
  HMDraftMeta,
  HMListedDraft,
  HMResourceFetchResult,
  HMResourceVisibility,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {BlockNoteEditor} from '@shm/editor/blocknote/core'
import {getCommentTargetId, getParentPaths, UniversalClient, useUniversalClient} from '@shm/shared'
import {ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {AnnounceBlobsProgress} from '@shm/shared/client/.generated/p2p/v1alpha/syncing_pb'
import {BIG_INT, DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {extractRefs, getAnnotations} from '@shm/shared/content'
import {prepareHMDocument} from '@shm/shared/document-utils'
import {prepareHMDocumentInfo, useResource, useResources} from '@shm/shared/models/entity'
import {invalidateAfterPublish} from '@shm/shared/models/post-publish-cache'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {rememberDraftReturnParentId, rememberReservedLazyDraftId} from '@shm/shared/utils/reserved-draft-ids'
import {
  compareBlocksWithMap,
  createBlocksMap,
  extractDeletes,
  getDocAttributeChanges,
} from '@shm/shared/utils/document-changes'
import {filterChildDrafts} from '@shm/shared/utils/draft-children'
import {buildInlineDraftWrite} from '@shm/shared/utils/inline-draft'
export {filterChildDrafts}
import {hmId, hmIdToURL, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath, hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {DocNavigationItem} from '@shm/ui/navigation'
import {PushResourceStatus} from '@shm/ui/push-toast'
import {useMutation, UseMutationOptions, useQuery, UseQueryOptions} from '@tanstack/react-query'
import {findParentNode} from '@tiptap/core'
import {nanoid} from 'nanoid'
import {useEffect, useMemo} from 'react'
import {hmBlockSchema} from '../editor'
import {pathNameify} from '../utils/path'
import {computeNewDraftParams, resolvePublishPath} from '../utils/publish-utils'
import {useNavigate} from '../utils/useNavigate'
import {useBroadcastWindowEvent} from '../utils/window-events'
import {updateParentCardsAfterDocumentRelocation} from './auto-link-parent'
import type {ParentCardsAfterRelocationResult} from './auto-link-parent'
import {useMyAccountIds} from './daemon'
import {useGatewayUrl} from './gateway-settings'
import {getNavigationChanges} from './navigation'
import type {DocumentCardActionOrigin} from '@shm/shared/utils/document-actions'
import {
  createRepublishRefOperation,
  getDocumentCardReconciliationInputForRepublish,
  getDocumentCardReconciliationInputsForMove,
  getMovedChildPath,
  isChildDocumentPath,
} from './document-relocation'

/**
 * Extended draft type returned by app-drafts.ts listAccount/list endpoints.
 * These endpoints compute locationId/editId from the raw uid+path fields.
 *
 * Re-exported from `@shm/shared/draft-breadcrumb-context` so platform
 * providers and shared UI agree on the shape.
 */
import type {HMListedDraftWithLocation} from '@shm/shared/draft-breadcrumb-context'
export type {HMListedDraftWithLocation}

export function useDraftList() {
  return useQuery({
    queryKey: [queryKeys.DRAFTS_LIST],
    queryFn: () => client.drafts.list.query(),
  })
}

export function useAccountDraftList(accountUid?: string) {
  return useQuery({
    queryKey: [queryKeys.DRAFTS_LIST_ACCOUNT, accountUid],
    queryFn: () => client.drafts.listAccount.query(accountUid),
    enabled: !!accountUid,
  })
}

export function useDeleteDraft(opts?: UseMutationOptions<void, unknown, string>) {
  const deleteDraft = useMutation({
    mutationFn: (draftId: string) => client.drafts.delete.mutate(draftId),
    onSuccess: (data, input, ctx) => {
      invalidateQueries([queryKeys.DRAFT, input])
      invalidateQueries([queryKeys.DRAFTS_LIST])
      invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
      opts?.onSuccess?.(data, input, ctx)
    },
    ...opts,
  })
  return deleteDraft
}

export function useChildDrafts(parentId?: UnpackedHypermediaId) {
  const drafts = useAccountDraftList(parentId?.uid)
  return useMemo(() => {
    if (!drafts.data || !parentId) return []
    return filterChildDrafts(drafts.data, parentId)
  }, [drafts.data, parentId])
}

/** Preserve existing draft anchors when autosave rewrites a draft index entry. */
export function resolveDraftWriteAnchors(
  existingDraft: Pick<HMDraft, 'locationUid' | 'locationPath' | 'editUid' | 'editPath'> | null | undefined,
  input: {
    locationUid?: string
    locationPath?: string[]
    editUid?: string
    editPath?: string[]
  },
): {
  locationUid?: string
  locationPath?: string[]
  editUid?: string
  editPath?: string[]
} {
  const locationUid = existingDraft?.locationUid || input.locationUid || undefined
  const locationPath = locationUid
    ? existingDraft?.locationUid
      ? existingDraft.locationPath ?? []
      : input.locationPath ?? []
    : undefined
  const editUid = input.editUid || existingDraft?.editUid || undefined
  const editPath = editUid ? (input.editUid ? input.editPath ?? [] : existingDraft?.editPath ?? []) : undefined
  return {locationUid, locationPath, editUid, editPath}
}

export function useCreateInlineDraft(parentId: UnpackedHypermediaId | undefined) {
  return useMutation({
    mutationFn: async ({visibility}: {visibility?: HMResourceVisibility} = {}) => {
      if (!parentId) throw new Error('No parent ID')
      const writeParams = buildInlineDraftWrite({
        parentId,
        draftId: nanoid(10),
        visibility: visibility ?? 'PUBLIC',
      })
      await client.drafts.write.mutate(writeParams)
      return {draftId: writeParams.id, draftPath: writeParams.editPath}
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT, parentId?.uid])
      invalidateQueries([queryKeys.DRAFTS_LIST])
    },
  })
}

export function useUpdateDraftMetadata() {
  return useMutation({
    mutationFn: async ({draftId, metadata}: {draftId: string; metadata: Partial<HMDraft['metadata']>}) => {
      const draft = await client.drafts.get.query(draftId)
      if (!draft) throw new Error(`Draft ${draftId} not found`)
      await client.drafts.write.mutate({
        id: draft.id,
        locationUid: draft.locationUid,
        locationPath: draft.locationPath,
        editUid: draft.editUid,
        editPath: draft.editPath,
        metadata: {...draft.metadata, ...metadata},
        content: draft.content,
        deps: draft.deps,
        navigation: draft.navigation,
        visibility: draft.visibility,
      })
      invalidateQueries([queryKeys.DRAFT, draftId])
      invalidateQueries([queryKeys.DRAFTS_LIST])
      invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
    },
  })
}

export type EmbedsContent = HMResourceFetchResult[]

export function useDocumentEmbeds(
  doc: HMDocument | undefined | null,
  enabled?: boolean,
  opts?: {skipCards: boolean},
): EmbedsContent {
  // todo: query for comments here as well
  const docRefs = useMemo(() => {
    return extractRefs(doc?.content || [], opts?.skipCards)
  }, [doc, enabled])
  const entities = useResources(docRefs.map((r) => r.refId))
  return entities
    .map((entity) => {
      return entity.data
    })
    .filter((e) => !!e)
}

// TODO: Duplicate (apps/site/server/routers/_app.ts#~187)
export function sortDocuments(a?: Timestamp, b?: Timestamp) {
  let dateA = a ? a.toDate().getTime() : 0
  let dateB = b ? b.toDate().getTime() : 1

  return dateB - dateA
}

export function getDefaultShortname(docTitle: string | undefined, docId: string) {
  const unpackedId = unpackHmId(docId)
  const idShortname = unpackedId ? unpackedId.uid.slice(0, 5).toLowerCase() : ''
  const kebabName = docTitle ? pathNameify(docTitle) : idShortname
  const shortName = kebabName.length > 40 ? kebabName.substring(0, 40) : kebabName
  return shortName
}

function useDraftDiagnosis() {
  const appendDraft = useMutation({
    mutationFn: (input: {draftId: string; event: unknown}) => client.diagnosis.appendDraftLog.mutate(input),
  })
  const completeDraft = useMutation({
    mutationFn: (input: {draftId: string; event: unknown}) => client.diagnosis.completeDraftLog.mutate(input),
  })
  return {
    append(draftId: string, event: unknown) {
      return appendDraft.mutateAsync({draftId, event})
    },
    complete(draftId: string, event: unknown) {
      return completeDraft.mutateAsync({draftId, event})
    },
  }
}

type PublishDraftInput = {
  draft: HMDraft
  destinationId: UnpackedHypermediaId
  accountId: string
  /**
   * Optional explicit path the user picked in the publish popover. When set,
   * it wins over the inline first-publish slug rename below.
   */
  pathOverride?: string[]
}
export function usePublishResource(
  editId: UnpackedHypermediaId | undefined | null,
  opts?: UseMutationOptions<HMDocument, unknown, PublishDraftInput>,
) {
  const accts = useMyAccountIds()
  const editEntity = useResource(editId)
  const editDocument = editEntity.data?.type === 'document' ? editEntity.data.document : undefined
  const writeRecentSigner = useMutation({
    mutationFn: (signingKeyName: string) => client.recentSigners.writeRecentSigner.mutate(signingKeyName),
  })
  return useMutation<HMDocument, any, PublishDraftInput>({
    mutationFn: async ({draft, destinationId, accountId, pathOverride}: PublishDraftInput): Promise<HMDocument> => {
      const blocksMap = editId ? createBlocksMap(editDocument?.content || [], '') : {}
      let newContent = removeTrailingBlocks(draft.content || [])

      // Fill query blocks for new documents
      if (!editId) {
        newContent = fillEmptyQueryBlocks(newContent, destinationId)
      }

      const changes = compareBlocksWithMap(blocksMap, newContent, '')

      const deleteChanges = extractDeletes(blocksMap, changes.touchedBlocks)

      const navigationChanges = getNavigationChanges(draft.navigation, editDocument?.detachedBlocks?.navigation)

      if (accts.data?.length == 0) {
        throw new Error('Create an account before publishing')
      }

      try {
        if (accountId && draft.id) {
          // Probe whether a doc already exists at the original destination.
          // The result drives two things:
          //  1. Whether to apply the inline-first-publish slug rename below.
          //  2. Fallback base version for legacy drafts that have no deps.
          // Skipped for legacy first-publishes (no `editId` outer arg) because
          // there is no doc to fetch yet.
          let existingDocVersion: string | null = null
          if (editId) {
            try {
              const latestDoc = await grpcClient.documents.getDocument({
                account: destinationId.uid,
                path: hmIdPathToEntityQueryPath(destinationId.path || []),
              })
              if (latestDoc?.version) {
                existingDocVersion = latestDoc.version
              }
            } catch (err) {
              // Doc doesn't exist yet (first publish) — leave existingDoc null.
              console.log('[publish] getDocument(latest) failed — treating as first publish', err)
            }
          }

          // Resolve the actual destination (slug rename for inline
          // first-publish, plus any explicit pathOverride from the publish
          // popover). See `resolvePublishPath` for the precedence rules.
          const resolvedPath = resolvePublishPath({
            currentPath: destinationId.path ?? [],
            draftId: draft.id,
            draftName: draft.metadata?.name || '',
            isPrivate: draft.visibility === 'PRIVATE',
            existsAtDestination: !!existingDocVersion,
            pathOverride,
          })
          const resolvedDestinationId =
            resolvedPath === destinationId.path ? destinationId : hmId(destinationId.uid, {path: resolvedPath})
          if (resolvedDestinationId !== destinationId) {
            console.log('[publish] resolved destination path', {
              from: destinationId.path,
              to: resolvedDestinationId.path,
              name: draft.metadata?.name,
              pathOverride,
            })
          }

          const allChanges = [
            ...navigationChanges,
            ...getDocAttributeChanges(draft.metadata),
            ...changes.changes,
            ...deleteChanges,
          ]

          let capabilityId = ''
          if (accountId !== resolvedDestinationId.uid) {
            const capabilities = await grpcClient.accessControl.listCapabilities({
              account: resolvedDestinationId.uid,
              path: hmIdPathToEntityQueryPath(resolvedDestinationId.path || []),
            })

            const capability = capabilities.capabilities.find((cap) => cap.delegate === accountId)
            if (!capability) throw new Error('Could not find capability for this draft signing account')
            capabilityId = capability.id
          }
          writeRecentSigner.mutateAsync(accountId).then(() => {
            invalidateQueries([queryKeys.RECENT_SIGNERS])
          })

          let visibility = ResourceVisibility.UNSPECIFIED

          // We only care to set the visibility if it's private.
          if (draft.visibility === 'PRIVATE') {
            visibility = ResourceVisibility.PRIVATE
          }

          // We must only specify the visibility if this is a first publish.
          // For subsequent publishes we set it to unspecified, to let the server decide.
          if (draft.deps?.length > 0) {
            visibility = ResourceVisibility.UNSPECIFIED
          }

          const docPath = hmIdPathToEntityQueryPath(resolvedDestinationId.path || [])

          // Publish from the draft's persisted base deps. Remote updates are
          // handled by the document-machine rebase flow; do not silently bump
          // deps to the newest head here, especially after a conflict was
          // ignored to keep the user's local editor content stable.
          let latestVersion = ''
          if (existingDocVersion) {
            latestVersion = existingDocVersion
            // console.log('[publish] using existing latest heads', {
            //   account: resolvedDestinationId.uid,
            //   path: docPath,
            //   latestVersion,
            // })
          }
          const draftDeps = draft.deps ?? []
          const baseVersion = draftDeps.length ? draftDeps.join('.') : latestVersion

          // console.log('[publish] computed baseVersion', {
          //   draftDeps,
          //   baseVersion,
          // })

          const publishInput = {
            signerAccountUid: accountId,
            account: resolvedDestinationId.uid,
            baseVersion,
            path: docPath,
            // allChanges is DocumentChange[] from shared helpers; structurally compatible with plain change objects
            changes: allChanges as any,
            capability: capabilityId,
            visibility,
            genesis: baseVersion ? editDocument?.genesis : undefined,
            generation: baseVersion ? editDocument?.generationInfo?.generation : undefined,
          }
          await desktopUniversalClient.publishDocument!(publishInput)

          const updatedDoc = await grpcClient.documents.getDocument({
            account: resolvedDestinationId.uid,
            path: docPath,
          })
          // console.log('[publish] result', {
          //   requestedBaseVersion: baseVersion,
          //   resultVersion: updatedDoc.version,
          // })

          // Inspect the Change blob the server produced to verify deps.
          try {
            const changesResp = await grpcClient.documents.listDocumentChanges({
              account: resolvedDestinationId.uid,
              path: docPath,
              version: updatedDoc.version,
              pageSize: 10,
            })
            const newChange = changesResp.changes.find((c) => c.id === updatedDoc.version)
            // console.log('[publish] new change deps', {
            //   newChangeId: newChange?.id,
            //   deps: newChange?.deps,
            //   author: newChange?.author,
            //   expectedDeps: draftDeps,
            //   allChanges: changesResp.changes.map((c) => ({id: c.id, deps: c.deps})),
            // })
          } catch (err) {
            console.log('[publish] listDocumentChanges failed', err)
          }
          const resultDoc: HMDocument = prepareHMDocument(updatedDoc)
          return resultDoc
        } else {
          throw Error('PUBLISH ERROR: Please select an account to sign first')
        }
      } catch (error) {
        const connectErr = ConnectError.from(error)
        const msg = connectErr.rawMessage.toLowerCase()
        const isDuplicatePath =
          (connectErr.code === Code.FailedPrecondition && msg.includes('path already exists')) ||
          msg.includes('preparedocumentchange')
        if (isDuplicatePath) {
          throw new Error(
            'A document already exists at this path. Please choose a different path name before publishing.',
          )
        }
        throw new Error(`Failed to publish: ${connectErr.rawMessage}`)
      }
      throw new Error('Unhandled publish')
    },
    onSuccess: (result: HMDocument, variables: PublishDraftInput, context: unknown) => {
      const resultDocId = hmId(result.account, {
        path: entityQueryPathToHmIdPath(result.path),
      })
      opts?.onSuccess?.(result, variables, context)
      if (resultDocId) {
        // Shared core: setQueriesDataByKey + invalidate ENTITY/ACCOUNT/RESOLVED_ENTITY
        invalidateAfterPublish(resultDocId, result)
        // Desktop-specific: directory lists, citations, interaction summaries
        getParentPaths(resultDocId.path).forEach((path) => {
          const parentId = hmId(resultDocId.uid, {path})
          invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
        })
        invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
        invalidateQueries([queryKeys.SITE_LIBRARY, resultDocId.uid])
        invalidateQueries([queryKeys.LIST_ACCOUNTS])
        invalidateQueries([queryKeys.DOC_CITATIONS])
        invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, resultDocId.id])
        getParentPaths(resultDocId.path).forEach((path) => {
          const parentId = hmId(resultDocId.uid, {path})
          invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentId.id])
        })
      }
    },
  })
}

export function useDocumentRead(id: UnpackedHypermediaId | undefined | false) {
  useEffect(() => {
    if (!id) return
    grpcClient.documents
      .updateDocumentReadStatus({
        account: id.uid,
        path: hmIdPathToEntityQueryPath(id.path),
        isRead: true,
      })
      .then(() => {
        invalidateQueries([queryKeys.SITE_LIBRARY, id.uid])
        invalidateQueries([queryKeys.LIST_ACCOUNTS])
      })
      .catch((error) => {
        console.error('Error updating document read status', error)
      })
  }, [id])
}

export function useMarkAsRead() {
  return async (ids: UnpackedHypermediaId[]) => {
    await Promise.all(
      ids.map(async (id) => {
        const path = hmIdPathToEntityQueryPath(id.path)
        await grpcClient.documents.updateDocumentReadStatus({
          account: id.uid,
          path,
          isRecursive: true,
          isRead: true,
        })
        invalidateQueries([queryKeys.SITE_LIBRARY, id.uid])
        invalidateQueries([queryKeys.LIST_ACCOUNTS])
      }),
    )
  }
}

export type EditorDraftState = {
  id: string
  children: Array<HMBlock>
  name: string
  changes: DraftChangesState
  webUrl: string
  updatedAt: any
}

type DraftChangesState = {
  moves: MoveBlockAction[]
  changed: Set<string>
  deleted: Set<string>
  webUrl?: string
}

type MoveBlockAction = {
  blockId: string
  leftSibling: string
  parent: string
}

export function queryDraft({
  draftId,
  diagnosis,
  ...options
}: {
  draftId?: string
  diagnosis?: ReturnType<typeof useDraftDiagnosis>
} & UseQueryOptions<HMDocument | null>): UseQueryOptions<HMDocument | null> {
  return {
    enabled: !!draftId,
    queryKey: [queryKeys.DRAFT, draftId],
    useErrorBoundary: false,
    queryFn: async () => {
      try {
        let serverDraft = null
        // const doc = serverDraft
        const doc = serverDraft ? toPlainMessage(serverDraft) : null

        diagnosis?.append(draftId!, {
          key: 'getDraft',
          value: doc,
        })

        return doc
      } catch (error) {
        diagnosis?.append(draftId!, {
          key: 'getDraftError',
          value: JSON.stringify(error),
        })
        return null
      }
    },
    ...options,
  }
}

export const findBlock = findParentNode((node) => node.type.name === 'blockContainer')

export function useDocTextContent(doc?: HMDocument | null) {
  return useMemo(() => {
    let res = ''
    function extractContent(blocks: Array<HMBlockNode>) {
      blocks.forEach((bn) => {
        if (res.length < 300) {
          res += extractBlockText(bn)
        }
      })

      return res
    }

    function extractBlockText({block, children}: HMBlockNode) {
      let content = ''
      if (!block) return content
      // @ts-expect-error
      if (block.text) content += block.text

      if (children?.length) {
        let nc = extractContent(children)
        content += nc
      }

      return content
    }

    if (doc?.content?.length) {
      res = extractContent(doc.content)
    }

    return res
  }, [doc])
}

export type BlocksMap = Record<string, BlocksMapItem>

export type BlocksMapItem = {
  parent: string
  left: string
  block: HMBlock
}

export async function pushResource(
  universalClient: UniversalClient,
  gwUrl: string,
  id: UnpackedHypermediaId,
  onlyPushToHost?: string,
  onStatusChange?: (status: PushResourceStatus) => void,
): Promise<boolean> {
  const resource = await universalClient.request('Resource', id)
  // step 1. find all the site IDs that will be affected by this resource.
  // console.log('== publish 1', id, resource, gwUrl)
  let destinationSiteUids = new Set<string>()

  function extractBNReferences(blockNodes: HMBlockNode[]) {
    blockNodes.forEach(async (node) => {
      node.children && extractBNReferences(node.children || [])
      if (node.block.type === 'Query') {
        const query = node.block.attributes.query
        query.includes.forEach((include) => {
          destinationSiteUids.add(include.space)
        })
      }
      if (node.block.type === 'Embed') {
        const id = unpackHmId(node.block.link)
        if (id) {
          destinationSiteUids.add(id.uid)
        }
      }
      const annotations = getAnnotations(node.block)
      annotations?.forEach((annotation: HMAnnotation) => {
        const id = unpackHmId(annotation.link)
        if (id) {
          destinationSiteUids.add(id.uid)
        }
      })
    })
  }

  // for documents:
  // - the site that the document is in
  // - each author of the document
  // - all the sites that the document directly references through embeds,links,mentions, and queries

  if (resource.type === 'document') {
    destinationSiteUids.add(resource.id.uid)
    resource.document.authors.forEach((authorUid: string) => {
      destinationSiteUids.add(authorUid)
    })
    extractBNReferences(resource.document.content)
  }

  // for comments:
  // - the site that the comment's target document is in
  // - the author of the comment
  // - all the sites that the comment's target document directly references through embeds,links,mentions, and queries

  if (resource.type === 'comment') {
    destinationSiteUids.add(resource.comment.targetAccount)

    // in theory, these two are the same, but we'll add both to be safe and because it doesn't cost anything:
    destinationSiteUids.add(resource.comment.author)
    destinationSiteUids.add(resource.id.uid)

    extractBNReferences(resource.comment.content)
  }

  // step 2. find all the hosts for these destination sites
  // console.log('== publish 2', destinationSiteUids)

  let destinationHosts = new Set<string>([
    // always push to the gateway url
    gwUrl,
  ])

  // when copying the URL, we don't need to push to every host. just the one whose URL we're copying.
  // TODO: skip the previous steps if onlyPushToHost is provided
  if (onlyPushToHost) {
    destinationHosts = new Set([onlyPushToHost])
  }

  await Promise.all(
    Array.from(destinationSiteUids).map(async (uid) => {
      try {
        const resource = await universalClient.request('Resource', hmId(uid))
        if (resource.type === 'document') {
          const siteUrl = resource.document.metadata?.siteUrl
          if (siteUrl) destinationHosts.add(siteUrl)
        }
      } catch (error) {
        console.error('Error loading site resource for pushing to the siteUrl', uid, error)
        reportError(error, {
          feature: 'push-resource',
          operation: 'resolve-site-host',
          uid,
          resourceId: id.id,
          onlyPushToHost,
        })
      }
    }),
  )

  // console.log('== publish 3 == destinationHosts', destinationHosts)

  let status: PushResourceStatus = {
    hosts: Array.from(destinationHosts).map((host) => ({
      host,
      status: 'pending',
      message: undefined,
    })),
  }

  onStatusChange?.(status)

  function updateHostStatus(
    host: string,
    newStatus: 'success' | 'error' | 'pending',
    message: string,
    peerId?: string,
  ) {
    const hostStatus = status.hosts.find((h) => h.host === host)
    if (hostStatus) {
      status = {
        ...status,
        hosts: status.hosts.map((h) => {
          if (h.host === host) {
            return {
              ...h,
              status: newStatus,
              message: message,
              peerId: peerId,
            }
          }
          return h
        }),
      }
    }
    onStatusChange?.(status)
  }
  function updatePeerStatus(peerId: string, newStatus: 'success' | 'error' | 'pending', message: string) {
    status = {
      ...status,
      hosts: status.hosts.map((h) => {
        if (h.peerId === peerId) {
          return {
            ...h,
            status: newStatus,
            message: message,
          }
        }
        return h
      }),
    }
    onStatusChange?.(status)
  }

  const addrsForPeer = new Map<string, string[]>()
  // step 3. gather all the peerIds for these sites.
  await Promise.all(
    Array.from(destinationHosts).map(async (host) => {
      try {
        updateHostStatus(host, 'pending', 'Connecting...')
        const config = await client.web.configOfHost.query({
          host,
          timeout: 10_000,
        })
        if (config.peerId) {
          addrsForPeer.set(config.peerId, config.addrs)
          // technically this is not connected via libp2p yet, but the user doesn't need to know that. If the peerId is found, we can assume that the connection is successful for UX purposes.
          updateHostStatus(host, 'pending', 'Pushing...', config.peerId)
        }
      } catch (error) {
        console.error('Error getting peerId for host', host, error)
        updateHostStatus(host, 'error', (error as Error).message)
        reportError(error, {
          feature: 'push-resource',
          operation: 'resolve-peer',
          host,
          resourceId: id.id,
          onlyPushToHost,
        })
      }
    }),
  )

  // step 4. push this resource to all the sites.
  // - the daemon will automatically connect, and will push all the relevant materials to the destination peers
  // console.log('== publish 4 == pushing to peers', peerIds)
  const resourceIdToPush = resource.type === 'comment' ? getCommentTargetId(resource.comment) : id
  if (!resourceIdToPush) {
    console.error('Could not determine resource ID to push', resource)
    throw new Error('Could not determine resource ID to push')
  }

  const peerIdsToPush = new Set<string>()
  status.hosts.forEach(({peerId}) => {
    if (peerId) peerIdsToPush.add(peerId)
  })

  if (!peerIdsToPush.size) {
    console.error('No peers found to push to', {
      resource,
      destinationHosts,
    })
    const hostStatuses = status.hosts.map(({host, status, message}) => ({host, status, message}))
    reportError(new Error('Failed to connect to any sites.'), {
      feature: 'push-resource',
      operation: 'no-peers',
      resourceId: id.id,
      onlyPushToHost,
      destinationHosts: Array.from(destinationHosts),
      hostStatuses,
    })
    throw new Error('Failed to connect to any sites.')
  }

  const pushResourceUrl = hmIdToURL({
    ...resourceIdToPush,
    blockRef: null,
    blockRange: null,
  })
  // console.log('== publish 4 == pushing to peers', pushResourceUrl, peerIds)

  await Promise.all(
    Array.from(peerIdsToPush).map(async (peerId, syncDebugId) => {
      let lastProgress: AnnounceBlobsProgress | undefined = undefined
      const addrs = addrsForPeer.get(peerId)
      if (!addrs) {
        updatePeerStatus(peerId, 'error', 'No addresses found for peer')
      }
      try {
        const pushProgress = grpcClient.resources.pushResourcesToPeer({
          addrs,
          recursive: true,
          resources: [pushResourceUrl],
        })
        for await (const progress of pushProgress) {
          // console.log(`== publish ${syncDebugId} == progress`, JSON.stringify(toPlainMessage(progress)))
          updatePeerStatus(peerId, 'pending', `Pushing ${progress.blobsProcessed}/${progress.blobsWanted}`)
          lastProgress = progress
        }
        // console.log(`== publish ${syncDebugId} == DONE =====`)
        updatePeerStatus(peerId, 'success', 'Done')
      } catch (error) {
        console.error(`== publish ${syncDebugId} == Error pushing to peer`, peerId, error)
        updatePeerStatus(peerId, 'error', (error as Error).message)
        const hostEntry = status.hosts.find((h) => h.peerId === peerId)
        reportError(error, {
          feature: 'push-resource',
          operation: 'push-to-peer',
          host: hostEntry?.host,
          peerId,
          resourceId: id.id,
          pushResourceUrl,
          onlyPushToHost,
        })
      }
      // console.log(`== publish ${syncDebugId} == lastProgress`, lastProgress)
      // if (lastProgress?.peersFailed ?? 0 > 0) {
      //   updatePeerStatus(peerId, 'error', 'Failed to push to site.')
      // }
    }),
  )

  return true
}

export function usePushResource() {
  const universalClient = useUniversalClient()
  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  return (id: UnpackedHypermediaId, onlyPushToHost?: string, onStatusChange?: (status: PushResourceStatus) => void) =>
    pushResource(universalClient, gwUrl, id, onlyPushToHost, onStatusChange)
}

// Auto-link helpers moved to ./auto-link-parent.ts so tests can import them
// without pulling in the editor bundle via documents.ts.
export {
  addLinkToParentDraft,
  autoLinkParentAfterPublish,
  documentContainsLinkToChild,
  documentHasSelfQuery,
  publishLinkToParentDocument,
} from './auto-link-parent'
export type {AutoLinkParentResult} from './auto-link-parent'

export function useListSite(id?: UnpackedHypermediaId) {
  return useQuery({
    queryKey: [queryKeys.DOC_LIST_DIRECTORY, id?.uid, 'ALL'],
    queryFn: async () => {
      if (!id) return []
      const res = await grpcClient.documents.listDocuments({
        account: id.uid,
        pageSize: BIG_INT,
      })
      const docs = res.documents
        .map((d) => prepareHMDocumentInfo(d))
        .filter((doc) => {
          return doc.path.length > 0
        })
      return docs
    },
  })
}

function observeBlocks(
  editor: BlockNoteEditor,
  // @ts-expect-error
  blocks: Array<EditorBlock<typeof hmBlockSchema>>,
  onChange: () => void,
) {
  blocks.forEach((block, index) => {
    if (block.type == 'imagePlaceholder' && block.props.src) {
      editor.updateBlock(block, {
        type: 'image',
        props: {
          src: block.props.src,
          name: block.props.name,
        },
      })
      onChange()
    }

    if (block.children) {
      observeBlocks(editor, block.children, onChange)
    }
  })
}

export function useAccountDocuments(id?: UnpackedHypermediaId) {
  return useQuery({
    queryKey: [queryKeys.ACCOUNT_DOCUMENTS, id?.uid],
    enabled: !!id?.uid,
    queryFn: async () => {
      const account = id?.uid
      if (!account) return {documents: []}
      const result = await grpcClient.documents.listDocuments({
        account: id?.uid,
        pageSize: BIG_INT,
      })
      const documents = result.documents.map((response) => ({
        ...toPlainMessage(response),
        metadata: HMDocumentMetadataSchema.parse(
          response.metadata?.toJson({
            emitDefaultValues: true,
            enumAsInteger: false,
          }),
        ),
      }))
      return {
        documents,
      }
    },
  })
}

export function useListProfileDocuments() {
  return useQuery({
    queryFn: async () => {
      const res = await grpcClient.documents.listRootDocuments({
        pageSize: BIG_INT,
      })
      return res.documents.map(toPlainMessage)
    },
    queryKey: [queryKeys.LIST_ROOT_DOCUMENTS],
  })
}

function fillEmptyQueryBlocks(blocks: EditorBlock[], destinationId: UnpackedHypermediaId): EditorBlock[] {
  return blocks.map((block) => {
    if (block.type === 'query') {
      const queryIncludes = JSON.parse(block.props.queryIncludes || '[{"space":"","path":"","mode":"Children"}]')

      // Fill empty space with destination
      if (!queryIncludes[0]?.space || queryIncludes[0]?.space === '') {
        queryIncludes[0] = {
          space: destinationId.uid,
          path: destinationId.path?.join('/') || '',
          mode: queryIncludes[0]?.mode || 'Children',
        }

        block = {
          ...block,
          props: {
            ...block.props,
            queryIncludes: JSON.stringify(queryIncludes),
          },
        }
      }
    }

    // Recursively process children
    if (block.children?.length) {
      block = {
        ...block,
        children: fillEmptyQueryBlocks(block.children, destinationId),
      }
    }

    return block
  })
}

function removeTrailingBlocks(blocks: Array<EditorBlock>) {
  let trailedBlocks = [...blocks]
  while (true) {
    let lastBlock = trailedBlocks[trailedBlocks.length - 1]
    if (!lastBlock) break
    if (lastBlock.type == 'paragraph' && lastBlock.content.length == 0 && lastBlock.children.length == 0) {
      trailedBlocks.pop()
    } else {
      break
    }
  }
  return trailedBlocks
}

export function useCreateDraft(
  draftParams: {
    locationUid?: HMDraftMeta['locationUid']
    locationPath?: HMDraftMeta['locationPath']
    editUid?: HMDraftMeta['editUid']
    editPath?: HMDraftMeta['editPath']
    deps?: HMDraftContent['deps']
  } = {},
) {
  const navigate = useNavigate('push')
  const selectedAccountId = useSelectedAccountId()

  return async ({visibility}: {visibility?: HMResourceVisibility} = {}) => {
    const plan = computeNewDraftParams(
      visibility,
      draftParams,
      selectedAccountId ?? undefined,
      () => nanoid(10),
      () => nanoid(21),
    )
    if (!plan) return
    if (visibility === 'PRIVATE') {
      rememberDraftReturnParentId(plan.draftId, hmId(plan.routeId.uid))
      await client.drafts.write.mutate({
        ...plan.writeParams,
        signingAccount: selectedAccountId ?? undefined,
        metadata: {},
        content: [],
        deps: [],
      })
      invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT, plan.routeId.uid])
      invalidateQueries([queryKeys.DRAFTS_LIST])
    } else {
      rememberReservedLazyDraftId(plan.draftId)
    }
    navigate({key: 'document', id: plan.routeId})
  }
}

export function useForkDocument() {
  const push = usePushResource()
  const universalClient = useUniversalClient()
  return useMutation({
    mutationFn: async ({
      from,
      to,
      signingAccountId,
      origin,
    }: {
      from: UnpackedHypermediaId
      to: UnpackedHypermediaId
      signingAccountId: string
      origin?: DocumentCardActionOrigin
    }) => {
      if (!universalClient.getSigner) throw new Error('Signing not available')
      const resource = await universalClient.request('Resource', from)
      if (resource.type !== 'document') throw new Error(`Cannot fork: resource is ${resource.type}`)
      const doc = resource.document
      if (!doc.generationInfo) throw new Error('No generation info for document')
      const signer = universalClient.getSigner(signingAccountId)
      const refInput = await createVersionRef(
        {
          space: to.uid,
          path: hmIdPathToEntityQueryPath(to.path),
          genesis: doc.generationInfo.genesis,
          version: doc.version,
          generation: Number(doc.generationInfo.generation),
        },
        signer,
      )
      await universalClient.publish(refInput)
      push(from)
      push(to)
    },
  })
}

type PlannedMove = {
  from: UnpackedHypermediaId
  to: UnpackedHypermediaId
  isSubdocumentMove: boolean
}

type MoveRefBundle = {
  sourceId: UnpackedHypermediaId
  targetId: UnpackedHypermediaId
  isSubdocumentMove: boolean
  versionRefOperation: Record<string, unknown>
  versionRefInput: HMPublishBlobsInput
  redirectRefOperation: Record<string, unknown>
  redirectRefInput: HMPublishBlobsInput
}

function movePathLabel(id: UnpackedHypermediaId) {
  return id.path?.join('/') || '/'
}

function moveScopeLabel(isSubdocumentMove: boolean) {
  return isSubdocumentMove ? 'subdocument' : 'document'
}

function logMoveRefBlob({
  kind,
  sourceId,
  targetId,
  isSubdocumentMove,
  refInput,
  publishInput,
}: {
  kind: 'version' | 'redirect'
  sourceId: UnpackedHypermediaId
  targetId: UnpackedHypermediaId
  isSubdocumentMove: boolean
  refInput: Record<string, unknown>
  publishInput: HMPublishBlobsInput
}) {
  // const moveScope = moveScopeLabel(isSubdocumentMove)
  // console.groupCollapsed(
  //   `[move-document] created ${kind} ref blob for ${moveScope}: ${movePathLabel(sourceId)} -> ${movePathLabel(
  //     targetId,
  //   )}`,
  // )
  // console.log(`[move-document] move scope`, moveScope)
  // console.log(`[move-document] sourceId`, sourceId)
  // console.log(`[move-document] targetId`, targetId)
  // console.log(`[move-document] ref operation`, refInput)
  // console.log(`[move-document] publish input`, publishInput)
  // console.log(
  //   `[move-document] ref blob bytes`,
  //   publishInput.blobs.map((blob, index) => ({
  //     index,
  //     cid: blob.cid,
  //     data: blob.data,
  //     bytes: Array.from(blob.data),
  //   })),
  // )
  // console.groupEnd()
}

async function createDocumentMoveRefs({
  sourceId,
  targetId,
  isSubdocumentMove,
  doc,
  signer,
  sourceCapabilityId,
  targetCapabilityId,
}: {
  sourceId: UnpackedHypermediaId
  targetId: UnpackedHypermediaId
  isSubdocumentMove: boolean
  doc: HMDocument
  signer: HMSigner
  sourceCapabilityId?: string
  targetCapabilityId?: string
}): Promise<MoveRefBundle> {
  // console.log(`[move-document] creating move refs`, {
  //   moveScope: moveScopeLabel(isSubdocumentMove),
  //   sourceId,
  //   targetId,
  //   doc,
  // })
  if (!doc.generationInfo) throw new Error('No generation info for document')
  const generation = Number(doc.generationInfo.generation)

  const versionRefOperation = {
    space: targetId.uid,
    path: hmIdPathToEntityQueryPath(targetId.path),
    genesis: doc.generationInfo.genesis,
    version: doc.version,
    generation,
    capability: targetCapabilityId || undefined,
  }
  const versionRefInput = await createVersionRef(versionRefOperation, signer)
  logMoveRefBlob({
    kind: 'version',
    sourceId,
    targetId,
    isSubdocumentMove,
    refInput: versionRefOperation,
    publishInput: versionRefInput,
  })

  const redirectRefOperation = {
    space: sourceId.uid,
    path: hmIdPathToEntityQueryPath(sourceId.path),
    genesis: doc.generationInfo.genesis,
    generation,
    targetSpace: targetId.uid,
    targetPath: hmIdPathToEntityQueryPath(targetId.path),
    capability: sourceCapabilityId || undefined,
  }
  const redirectRefInput = await createRedirectRef(redirectRefOperation, signer)
  logMoveRefBlob({
    kind: 'redirect',
    sourceId,
    targetId,
    isSubdocumentMove,
    refInput: redirectRefOperation,
    publishInput: redirectRefInput,
  })

  return {
    sourceId,
    targetId,
    isSubdocumentMove,
    versionRefOperation,
    versionRefInput,
    redirectRefOperation,
    redirectRefInput,
  }
}

async function resolveWriteCapabilityId(signingAccountId: string, id: UnpackedHypermediaId) {
  if (signingAccountId === id.uid) return ''
  const capabilities = await grpcClient.accessControl.listCapabilities({
    account: id.uid,
    path: hmIdPathToEntityQueryPath(id.path || []),
    pageSize: BIG_INT,
  })
  const capability = capabilities.capabilities.find((cap) => cap.delegate === signingAccountId)
  if (!capability?.id) throw new Error('Could not find write capability for selected account')
  return capability.id
}

function broadcastRelocatedParentDraftChanges(
  broadcastWindowEvent: ReturnType<typeof useBroadcastWindowEvent>,
  result: ParentCardsAfterRelocationResult,
  sourceId: UnpackedHypermediaId,
) {
  if (result.removed.kind === 'removed-from-draft') {
    broadcastWindowEvent({
      type: 'draft_externally_modified',
      draftId: result.removed.parentDraftId,
      source: 'document-card-cleanup',
      deletedDocumentId: sourceId.id,
      removedBlockIds: result.removed.removedBlockIds,
    })
  }
  if (result.added.kind === 'added-to-draft') {
    broadcastWindowEvent({
      type: 'draft_externally_modified',
      draftId: result.added.parentDraftId,
      source: 'document-card-cleanup',
    })
  }
}

export function useMoveDocument() {
  const push = usePushResource()
  const universalClient = useUniversalClient()
  const broadcastWindowEvent = useBroadcastWindowEvent()
  return useMutation({
    mutationFn: async ({
      from,
      to,
      signingAccountId,
      origin,
    }: {
      from: UnpackedHypermediaId
      to: UnpackedHypermediaId
      signingAccountId: string
      origin?: DocumentCardActionOrigin
    }) => {
      if (!universalClient.getSigner) throw new Error('Signing not available')
      const signer = universalClient.getSigner(signingAccountId)
      const sourceCapabilityId = await resolveWriteCapabilityId(signingAccountId, from)
      const targetCapabilityId = await resolveWriteCapabilityId(signingAccountId, to)
      const fromPath = from.path || []
      const toPath = to.path || []
      const listedDocs = await grpcClient.documents.listDocuments({
        account: from.uid,
        pageSize: BIG_INT,
      })
      const childMoves: PlannedMove[] = listedDocs.documents
        .map((item) => prepareHMDocumentInfo(item))
        .filter((doc) => !doc.redirectInfo)
        .map((doc) => doc.path)
        .filter((path) => isChildDocumentPath(path, fromPath))
        .sort((a, b) => a.length - b.length)
        .map((path) => ({
          from: hmId(from.uid, {path}),
          to: hmId(to.uid, {path: getMovedChildPath(path, fromPath, toPath)}),
          isSubdocumentMove: true,
        }))
      const moves: PlannedMove[] = [{from, to, isSubdocumentMove: false}, ...childMoves]
      // console.log(`[move-document] planned subdocument moves`, {count: childMoves.length, childMoves})
      // console.log(`[move-document] recursive move plan`, {from, to, childMoves, moves})
      // console.log(`[move-document] loading source documents`, {count: moves.length, moves})
      const moveResources = await Promise.all(
        moves.map(async ({from: sourceId, to: targetId, isSubdocumentMove}) => {
          // console.log(`[move-document] loading source document`, {
          //   moveScope: moveScopeLabel(isSubdocumentMove),
          //   sourceId,
          //   targetId,
          // })
          const resource = await universalClient.request('Resource', sourceId)
          if (resource.type !== 'document') throw new Error(`Cannot move: resource is ${resource.type}`)
          const doc = resource.document
          if (!doc.generationInfo) throw new Error('No generation info for document')
          // console.log(`[move-document] loaded source document`, {
          //   moveScope: moveScopeLabel(isSubdocumentMove),
          //   sourceId,
          //   targetId,
          //   version: doc.version,
          //   generationInfo: doc.generationInfo,
          // })
          return {from: sourceId, to: targetId, isSubdocumentMove, doc}
        }),
      )

      // console.log(`[move-document] creating ref bundles`, {count: moveResources.length})
      const moveRefBundles = []
      for (const {from: sourceId, to: targetId, isSubdocumentMove, doc} of moveResources) {
        const moveRefs = await createDocumentMoveRefs({
          sourceId,
          targetId,
          isSubdocumentMove,
          doc,
          signer,
          sourceCapabilityId,
          targetCapabilityId,
        })
        moveRefBundles.push(moveRefs)
      }

      // console.log(`[move-document] publishing move ref bundles`, {
      //   count: moveRefBundles.length,
      //   moveRefBundles,
      // })
      for (const moveRefs of moveRefBundles) {
        // const moveScope = moveScopeLabel(moveRefs.isSubdocumentMove)
        // console.groupCollapsed(
        //   `[move-document] publishing ${moveScope} move: ${movePathLabel(moveRefs.sourceId)} -> ${movePathLabel(
        //     moveRefs.targetId,
        //   )}`,
        // )
        // console.log(`[move-document] publishing version ref`, {
        //   moveScope,
        //   sourceId: moveRefs.sourceId,
        //   targetId: moveRefs.targetId,
        //   publishInput: moveRefs.versionRefInput,
        // })
        await universalClient.publish(moveRefs.versionRefInput)
        // console.log(`[move-document] published version ref`, {
        //   moveScope,
        //   sourceId: moveRefs.sourceId,
        //   targetId: moveRefs.targetId,
        //   versionRefOperation: moveRefs.versionRefOperation,
        // })
        // console.log(`[move-document] publishing redirect ref`, {
        //   moveScope,
        //   sourceId: moveRefs.sourceId,
        //   targetId: moveRefs.targetId,
        //   publishInput: moveRefs.redirectRefInput,
        // })
        await universalClient.publish(moveRefs.redirectRefInput)
        // console.log(`[move-document] published redirect ref`, {
        //   moveScope,
        //   sourceId: moveRefs.sourceId,
        //   targetId: moveRefs.targetId,
        //   redirectRefOperation: moveRefs.redirectRefOperation,
        // })
        // console.log(`[move-document] pushing moved source and target`, {
        //   moveScope,
        //   sourceId: moveRefs.sourceId,
        //   targetId: moveRefs.targetId,
        // })
        push(moveRefs.sourceId)
        push(moveRefs.targetId)
        // console.groupEnd()
      }
      const reconciliationInputs = getDocumentCardReconciliationInputsForMove({
        from,
        to,
        signingAccountUid: signingAccountId,
        sourceCapabilityId,
        targetCapabilityId,
      })
      for (const reconciliationInput of reconciliationInputs) {
        await client.documentCardCleanup.enqueue.mutate(reconciliationInput as any)
      }
      // console.log(`[move-document] recursive move complete`, {moves})

      if (origin) {
        const parentCardResult = await updateParentCardsAfterDocumentRelocation({
          from,
          to,
          signingAccountUid: signingAccountId,
          origin,
        })
        broadcastRelocatedParentDraftChanges(broadcastWindowEvent, parentCardResult, from)
      }

      return moves
    },
    onSuccess: (moves, {from, to}) => {
      const idsToInvalidate = moves || [{from, to}]
      idsToInvalidate.forEach(({from: sourceId, to: targetId}) => {
        invalidateQueries([queryKeys.ENTITY, sourceId.id])
        invalidateQueries([queryKeys.ENTITY, targetId.id])
        invalidateQueries([queryKeys.RESOLVED_ENTITY, sourceId.id])
        invalidateQueries([queryKeys.RESOLVED_ENTITY, targetId.id])
        invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, sourceId.id])
        invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, targetId.id])
        getParentPaths(sourceId.path).forEach((path) => {
          const parentId = hmId(sourceId.uid, {path})
          invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
          invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentId.id])
        })
        getParentPaths(targetId.path).forEach((path) => {
          const parentId = hmId(targetId.uid, {path})
          invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
          invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentId.id])
        })
      })
      invalidateQueries([queryKeys.SEARCH])
      invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
      invalidateQueries([queryKeys.SITE_LIBRARY, from.uid])
      invalidateQueries([queryKeys.SITE_LIBRARY, to.uid])
    },
  })
}

export function useRepublishDocument() {
  const push = usePushResource()
  const universalClient = useUniversalClient()
  const broadcastWindowEvent = useBroadcastWindowEvent()
  return useMutation({
    mutationFn: async ({
      from,
      to,
      signingAccountId,
      origin,
    }: {
      from: UnpackedHypermediaId
      to: UnpackedHypermediaId
      signingAccountId: string
      origin?: DocumentCardActionOrigin
    }) => {
      if (!universalClient.getSigner) throw new Error('Signing not available')
      const signer = universalClient.getSigner(signingAccountId)
      const resource = await universalClient.request('Resource', from)
      if (resource.type !== 'document') throw new Error(`Cannot republish: resource is ${resource.type}`)
      const doc = resource.document
      if (!doc.generationInfo) throw new Error('No generation info for document')
      const capabilityId = await resolveWriteCapabilityId(signingAccountId, to)
      const refOperation = createRepublishRefOperation({
        sourceId: from,
        destinationId: to,
        sourceDocument: doc,
        capabilityId,
      })
      const refInput = await createRedirectRef(refOperation, signer)
      await universalClient.publish(refInput)
      push(from)
      push(to)
      const reconciliationInput = getDocumentCardReconciliationInputForRepublish({
        to,
        signingAccountUid: signingAccountId,
        capabilityId,
      })
      if (reconciliationInput) {
        await client.documentCardCleanup.enqueue.mutate(reconciliationInput as any)
      }
      if (origin) {
        const parentCardResult = await updateParentCardsAfterDocumentRelocation({
          from,
          to,
          signingAccountUid: signingAccountId,
          origin,
        })
        broadcastRelocatedParentDraftChanges(broadcastWindowEvent, parentCardResult, from)
      }
      return {from, to}
    },
    onSuccess: ({from, to}) => {
      invalidateQueries([queryKeys.ENTITY, from.id])
      invalidateQueries([queryKeys.ENTITY, to.id])
      invalidateQueries([queryKeys.RESOLVED_ENTITY, from.id])
      invalidateQueries([queryKeys.RESOLVED_ENTITY, to.id])
      invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, from.id])
      invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, to.id])
      getParentPaths(to.path).forEach((path) => {
        const parentId = hmId(to.uid, {path})
        invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
        invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentId.id])
      })
      invalidateQueries([queryKeys.SEARCH])
      invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
      invalidateQueries([queryKeys.SITE_LIBRARY, to.uid])
    },
  })
}

export function getDraftEditId(
  draftData?: {
    destinationUid: string | undefined
    destinationPath: string[] | undefined
    isNewChild: boolean | undefined
  } | null,
): UnpackedHypermediaId | undefined {
  if (!draftData) return undefined
  if (draftData.isNewChild) {
    return undefined
  } else if (!draftData.destinationUid) {
    return undefined
  } else {
    return hmId(draftData.destinationUid, {
      path: draftData.destinationPath,
    })
  }
}

export function useSiteNavigationItems(
  siteHomeEntity: HMResourceFetchResult | undefined | null,
): DocNavigationItem[] | null {
  if (!siteHomeEntity) return null
  const navNode = siteHomeEntity.document?.detachedBlocks?.navigation
  const navItems: DocNavigationItem[] = navNode
    ? navNode.children
        ?.map((itemBlock) => {
          if (itemBlock.block.type !== 'Link') return null
          const id = unpackHmId(itemBlock.block.link)
          return {
            key: itemBlock.block.id,
            id: id || undefined,
            webUrl: id ? undefined : itemBlock.block.link,
            isPublished: true,
            metadata: {
              name: itemBlock.block.text || '?',
            },
          } satisfies DocNavigationItem
        })
        .filter((b) => !!b) || []
    : []
  return navItems
}
