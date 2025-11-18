import {dispatchOnboardingDialog} from '@/components/onboarding'
import {grpcClient} from '@/grpc-client'
import {useDraft} from '@/models/accounts'
import {useOpenUrl} from '@/open-url'
import {useSelectedAccountId} from '@/selected-account'
import {getSlashMenuItems} from '@/slash-menu-items'
import {trpc} from '@/trpc'
import {Timestamp, toPlainMessage} from '@bufbuild/protobuf'
import {ConnectError} from '@connectrpc/connect'
import {useBlockNote} from '@shm/editor/blocknote'
import {BlockNoteEditor} from '@shm/editor/blocknote/core'
import {createHypermediaDocLinkPlugin} from '@shm/editor/hypermedia-link-plugin'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {BIG_INT, DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {extractRefs} from '@shm/shared/content'
import {prepareHMDocument} from '@shm/shared/document-utils'
import {EditorBlock} from '@shm/shared/editor-types'
import {
  HMBlock,
  HMBlockNode,
  HMDocument,
  HMDocumentInfo,
  HMDocumentMetadataSchema,
  HMDraft,
  HMDraftContent,
  HMDraftMeta,
  HMEntityContent,
  HMNavigationItem,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {getQueryResultsWithClient} from '@shm/shared/models/directory'
import {
  prepareHMDocumentInfo,
  useResource,
  useResources,
} from '@shm/shared/models/entity'
import {useInlineMentions} from '@shm/shared/models/inline-mentions'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {
  compareBlocksWithMap,
  createBlocksMap,
  extractDeletes,
  getDocAttributeChanges,
} from '@shm/shared/utils/document-changes'
import {createHMUrl, hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {
  entityQueryPathToHmIdPath,
  hmIdPathToEntityQueryPath,
} from '@shm/shared/utils/path-api'
import {eventStream} from '@shm/shared/utils/stream'
import {DocNavigationItem, getSiteNavDirectory} from '@shm/ui/navigation'
import {toast} from '@shm/ui/toast'
import type {UseQueryResult} from '@tanstack/react-query'
import {
  UseInfiniteQueryOptions,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query'
import {Extension, findParentNode} from '@tiptap/core'
import {NodeSelection} from '@tiptap/pm/state'
import {useMachine} from '@xstate/react'
import {nanoid} from 'nanoid'
import {useEffect, useMemo} from 'react'
import {assign, fromPromise} from 'xstate'
import {hmBlockSchema} from '../editor'
import {pathNameify} from '../utils/path'
import {useNavigate} from '../utils/useNavigate'
import {useConnectPeer} from './contacts'
import {useMyAccountIds} from './daemon'
import {draftMachine} from './draft-machine'
import {setGroupTypes} from './editor-utils'
import {getParentPaths} from './entities'
import {useGatewayUrlStream} from './gateway-settings'
import {getNavigationChanges} from './navigation'
import {siteDiscover} from './web-links'

export const [draftDispatch, draftEvents] = eventStream<{
  type: 'change'
  signingAccount: string
}>()

export function useDocumentList(
  opts?: UseInfiniteQueryOptions<{
    nextPageToken: string
    documents: HMDocument
  }> & {},
) {
  throw new Error('No API implemented for useDocumentList')
}

export function useDraftList() {
  return trpc.drafts.list.useQuery(undefined, {})
}

export function useAccountDraftList(accountUid?: string) {
  return trpc.drafts.listAccount.useQuery(accountUid, {
    enabled: !!accountUid,
  })
}

export function useDeleteDraft(
  opts?: UseMutationOptions<void, unknown, string>,
) {
  const deleteDraft = trpc.drafts.delete.useMutation({
    ...opts,
    onSuccess: (data, input, ctx) => {
      invalidateQueries(['trpc.drafts.get', input])
      invalidateQueries(['trpc.drafts.list'])
      invalidateQueries(['trpc.drafts.listAccount'])
      opts?.onSuccess?.(data, input, ctx)
    },
  })
  return deleteDraft
}

export type EmbedsContent = HMEntityContent[]

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
  let dateA = a ? a.toDate() : 0
  let dateB = b ? b.toDate() : 1

  // @ts-ignore
  return dateB - dateA
}

export function getDefaultShortname(
  docTitle: string | undefined,
  docId: string,
) {
  const unpackedId = unpackHmId(docId)
  const idShortname = unpackedId ? unpackedId.uid.slice(0, 5).toLowerCase() : ''
  const kebabName = docTitle ? pathNameify(docTitle) : idShortname
  const shortName =
    kebabName.length > 40 ? kebabName.substring(0, 40) : kebabName
  return shortName
}

function useDraftDiagnosis() {
  const appendDraft = trpc.diagnosis.appendDraftLog.useMutation()
  const completeDraft = trpc.diagnosis.completeDraftLog.useMutation()
  return {
    // @ts-expect-error
    append(draftId, event) {
      return appendDraft.mutateAsync({draftId, event})
    },
    // @ts-expect-error
    complete(draftId, event) {
      return completeDraft.mutateAsync({draftId, event})
    },
  }
}

type PublishDraftInput = {
  draft: HMDraft
  destinationId: UnpackedHypermediaId
  accountId: string
}
export function usePublishDraft(
  editId: UnpackedHypermediaId | undefined | null,
  opts?: UseMutationOptions<HMDocument, unknown, PublishDraftInput>,
) {
  const accts = useMyAccountIds()
  const editEntity = useResource(editId)
  const editDocument =
    editEntity.data?.type === 'document' ? editEntity.data.document : undefined
  const writeRecentSigner = trpc.recentSigners.writeRecentSigner.useMutation()
  return useMutation<HMDocument, any, PublishDraftInput>({
    mutationFn: async ({
      draft,
      destinationId,
      accountId,
    }: PublishDraftInput): Promise<HMDocument> => {
      const blocksMap = editId
        ? createBlocksMap(editDocument?.content || [], '')
        : {}
      const newContent = removeTrailingBlocks(draft.content || [])
      const changes = compareBlocksWithMap(blocksMap, newContent, '')

      const deleteChanges = extractDeletes(blocksMap, changes.touchedBlocks)

      console.log('🔍 DEBUG: Navigation data before getNavigationChanges:', {
        draftNavigation: draft.navigation,
        editDocumentNavigationBlock: editDocument?.detachedBlocks?.navigation,
        hasNavigation: !!draft.navigation,
        navigationLength: draft.navigation?.length || 0,
        hasOldNavigationBlock: !!editDocument?.detachedBlocks?.navigation,
        editDocumentExists: !!editDocument,
        editDocumentDetachedBlocks: editDocument?.detachedBlocks,
        editId,
      })

      const navigationChanges = getNavigationChanges(
        draft.navigation,
        editDocument?.detachedBlocks?.navigation,
      )

      console.log('🔍 DEBUG: Navigation changes generated:', {
        changesCount: navigationChanges.length,
        changes: navigationChanges.map((change) => ({
          op: change.op.case,
          blockId:
            change.op.case === 'replaceBlock'
              ? change.op.value.id
              : change.op.case === 'moveBlock'
              ? change.op.value.blockId
              : change.op.case === 'deleteBlock'
              ? change.op.value
              : 'unknown',
        })),
      })
      if (accts.data?.length == 0) {
        dispatchOnboardingDialog(true)
      } else {
        try {
          if (accountId && draft.id) {
            const allChanges = [
              ...navigationChanges,
              ...getDocAttributeChanges(draft.metadata),
              ...changes.changes,
              ...deleteChanges,
            ]

            let capabilityId = ''
            if (accountId !== destinationId.uid) {
              const capabilities =
                await grpcClient.accessControl.listCapabilities({
                  account: destinationId.uid,
                  path: hmIdPathToEntityQueryPath(destinationId.path || []),
                })

              const capability = capabilities.capabilities.find(
                (cap) => cap.delegate === accountId,
              )
              if (!capability)
                throw new Error(
                  'Could not find capability for this draft signing account',
                )
              capabilityId = capability.id
            }
            writeRecentSigner.mutateAsync(accountId).then(() => {
              invalidateQueries(['trpc.recentSigners.get'])
            })

            const publishedDoc =
              await grpcClient.documents.createDocumentChange({
                signingKeyName: accountId,
                account: destinationId.uid,
                baseVersion: draft.deps?.join('.') || '',
                path: hmIdPathToEntityQueryPath(destinationId.path || []),
                changes: allChanges,
                capability: capabilityId,
              })
            const resultDoc: HMDocument = prepareHMDocument(publishedDoc)
            return resultDoc
          } else {
            throw Error('PUBLISH ERROR: Please select an account to sign first')
          }
        } catch (error) {
          const connectErr = ConnectError.from(error)
          if (connectErr.rawMessage.includes('path already exists')) {
            toast.error(
              `Can't publish to this path. You already have a document at this location.`,
            )
          } else {
            toast.error(`Publish error: ${connectErr.rawMessage}`)
          }

          throw Error(connectErr.rawMessage)
        }
      }
      throw new Error('Unhandled publish')
    },
    onSuccess: (
      result: HMDocument,
      variables: PublishDraftInput,
      context: unknown,
    ) => {
      const resultDocId = hmId(result.account, {
        path: entityQueryPathToHmIdPath(result.path),
      })
      opts?.onSuccess?.(result, variables, context)
      if (resultDocId) {
        invalidateQueries([queryKeys.ENTITY, resultDocId.id])
        invalidateQueries([queryKeys.ACCOUNT, resultDocId.uid])
        invalidateQueries([queryKeys.RESOLVED_ENTITY, resultDocId.id])
        invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, resultDocId.uid])
        invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
        invalidateQueries([queryKeys.SITE_LIBRARY, resultDocId.uid])
        invalidateQueries([queryKeys.LIST_ACCOUNTS])
        invalidateQueries([queryKeys.DOC_CITATIONS])
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

export function useDrafts(
  ids: string[],
  options?: UseQueryOptions<HMDocument | null>,
) {
  // return useQueries({
  //   queries: ids.map((draftId) => trpc.drafts.get.useQuery(draftId, {
  //     enabled: !!draftId,
  //     queryKey: [queryKeys.DRAFT, draftId],
  //   }),
  //   ...(options || {}),
  // })
  // TODO: IMPLEMENT ME
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

export function useDraftEditor() {
  /**
   * fetch:
   * - draft with draft ID (can be null)
   * - home document with location UID (can be null)
   * - edit document with edit UID + edit path (can be null)
   */
  const route = useNavRoute()
  const replace = useNavigate('replace')

  if (route.key != 'draft') throw new Error('DraftPage must have draft route')

  const {data, status: draftStatus} = useDraft(route.id)

  const locationId = useMemo(() => {
    if (!route.locationUid) return undefined
    return hmId(route.locationUid, {
      path: route.locationPath,
    })
  }, [route])

  const locationEntity = useResource(locationId)

  const editId = useMemo(() => {
    if (data?.editUid)
      return hmId(data.editUid, {
        path: data.editPath,
      })
    if (route.editUid)
      return hmId(route.editUid, {
        path: route.editPath,
      })
    return undefined
  }, [route, data])

  const editEntity = useResource(editId)
  const editDocument =
    editEntity.data?.type === 'document' ? editEntity.data.document : undefined
  // editor props
  // const [writeEditorStream] = useRef(writeableStateStream<any>(null)).current
  const showNostr = trpc.experiments.get.useQuery().data?.nostr
  const openUrl = useOpenUrl()
  const gwUrl = useGatewayUrlStream()
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const saveDraft = trpc.drafts.write.useMutation()
  const selectedAccountId = useSelectedAccountId()
  const {onMentionsQuery} = useInlineMentions(selectedAccountId)
  const importWebFile = trpc.webImporting.importWebFile.useMutation()

  const editor = useBlockNote<typeof hmBlockSchema>({
    onEditorContentChange(editor: BlockNoteEditor<typeof hmBlockSchema>) {
      // if (!gotEdited.current) {
      //   gotEdited.current = true
      // }

      // writeEditorStream(editor.topLevelBlocks)
      observeBlocks(
        editor,
        editor.topLevelBlocks,
        () => {},
        // send({type: 'CHANGE'}),
      )
      send({type: 'change'})
    },
    onTextCursorPositionChange(editor: BlockNoteEditor<typeof hmBlockSchema>) {
      const {view} = editor._tiptapEditor
      const {selection} = view.state
      if (
        selection.from !== selection.to &&
        !(selection instanceof NodeSelection)
      )
        return
      const domAtPos = view.domAtPos(selection.from)
      try {
        // @ts-expect-error
        const rect: DOMRect = domAtPos.node.getBoundingClientRect()
        // Check if the cursor is off screen
        // if (rect && (rect.top < 0 || rect.top > window.innerHeight)) {
        if (rect && rect.top > window.innerHeight) {
          // Scroll the cursor into view if not caused by media drag
          // @ts-ignore
          // @ts-expect-error
          if (!editor.sideMenu.sideMenuView?.isDragging)
            // @ts-expect-error
            domAtPos.node.scrollIntoView({block: 'center'})
        }
      } catch {}
      return
    },
    linkExtensionOptions: {
      // openOnClick: false,
      // @ts-expect-error
      grpcClient,
      gwUrl,
      openUrl,
      checkWebUrl: checkWebUrl.mutateAsync,
    },
    onMentionsQuery,
    importWebFile: importWebFile.mutateAsync,
    blockSchema: hmBlockSchema,
    getSlashMenuItems: () => getSlashMenuItems({showNostr, docId: editId}),
    _tiptapOptions: {
      extensions: [
        Extension.create({
          name: 'hypermedia-link',
          addProseMirrorPlugins() {
            return [createHypermediaDocLinkPlugin({}).plugin]
          },
        }),
      ],
    },
  })

  const writeDraft = fromPromise<
    {id: string},
    {
      metadata: HMDraft['metadata']
      deps: HMDraft['deps']
      // @ts-expect-error
      signingAccount: HMDraft['signingAccount']
      navigation?: HMNavigationItem[]
    }
  >(async ({input}) => {
    // Implementation will be provided in documents.ts
    try {
      const locationUid = route.locationUid || data?.locationUid
      const locationPath = route.locationPath || data?.locationPath
      const editUid = route.editUid || data?.editUid
      const editPath = route.editPath || data?.editPath
      console.log('Saving draft with navigation:', input.navigation)
      const newDraft = await saveDraft.mutateAsync({
        id: route.id,
        metadata: input.metadata,
        signingAccount: input.signingAccount,
        content: editor.topLevelBlocks,
        deps: input.deps,
        navigation: input.navigation,
        locationUid,
        locationPath,
        editUid,
        editPath,
      })

      return newDraft
    } catch (error) {
      console.error('Error creating draft', error)
      throw error
    }
  })

  // state machine
  const [state, send, actor] = useMachine(
    draftMachine.provide({
      actions: {
        focusContent: ({context, event}) => {
          if (route.editUid || data?.editUid) {
            const tiptap = editor?._tiptapEditor
            if (tiptap && !tiptap.isFocused) {
              editor._tiptapEditor.commands.focus()
            }
          } else {
            // @ts-expect-error
            if (context.nameRef) {
              // @ts-expect-error
              context.nameRef.focus()
            }
          }
        },
        populateData: assign(({context, event}) => {
          let content: Array<EditorBlock> = []
          if (event.type == 'fetch.success') {
            if (event.payload.type == 'draft') {
              content = event.payload.data.content
              editor.replaceBlocks(editor.topLevelBlocks, content as any)
              const tiptap = editor?._tiptapEditor
              // this is a hack to set the current blockGroups in the editor to the correct type, because from the BN API we don't have access to those nodes.
              setGroupTypes(tiptap, content as any)
              return {
                content: event.payload.data.content,
                metadata: event.payload.data.metadata,
                // @ts-expect-error
                signingAccount: event.payload.data.signingAccount,
                deps: event.payload.data.deps,
                navigation: event.payload.data.navigation,
              }
            } else if (event.payload.type == 'edit') {
              if (context.editUid && editDocument?.content) {
                content = hmBlocksToEditorContent(editDocument.content || [], {
                  childrenType: 'Group',
                })
                editor.replaceBlocks(editor.topLevelBlocks, content as any)
                const tiptap = editor?._tiptapEditor
                // this is a hack to set the current blockGroups in the editor to the correct type, because from the BN API we don't have access to those nodes.
                setGroupTypes(tiptap, content as any)
              }
              return {
                metadata: event.payload.data.document?.metadata,
                // @ts-expect-error
                signingAccount: context.signingAccount,
                content,
                deps: event.payload.data.document?.version
                  ? [event.payload.data.document?.version]
                  : undefined,
              }
            }
          }

          return context
        }),
        replaceRoute: (_, {id}) => {
          replace({
            key: 'draft',
            id,
            deps: route.deps || undefined,
            accessory: {key: 'options'},
          })
          return {}
        },
      },
      actors: {
        writeDraft,
      },
    }),
    {
      input: {
        ...route,
        deps: data?.deps || undefined,
      },
    },
  )

  // send events to machine when fetch do draft or other documents
  useEffect(() => {
    let locationUid = route.locationUid || data?.locationUid
    let editUid = route.editUid || data?.editUid
    if (
      typeof locationUid === 'undefined' &&
      typeof editUid === 'undefined' &&
      data === null // drafts can return null if they don't exist
    ) {
      send({type: 'fetch.success', payload: {type: 'load.new.draft'}})
    }
    if (draftStatus === 'success' && data !== null) {
      send({type: 'fetch.success', payload: {type: 'draft', data}})
    } else if (locationEntity.status === 'success' && locationEntity.data) {
      send({
        type: 'fetch.success',
        payload: {type: 'location', data: locationEntity.data},
      })
    } else if (editEntity.status === 'success' && editEntity.data) {
      send({
        type: 'fetch.success',
        payload: {type: 'edit', data: editEntity.data},
      })
    }
  }, [data, locationEntity.status, editEntity.status])

  useEffect(() => {
    function handleSelectAll(event: KeyboardEvent) {
      if (event.key == 'a' && event.metaKey) {
        if (editor) {
          event.preventDefault()
          editor._tiptapEditor.commands.focus()
          editor._tiptapEditor.commands.selectAll()
        }
      }
    }

    window.addEventListener('keydown', handleSelectAll)

    return () => {
      window.removeEventListener('keydown', handleSelectAll)
    }
  }, [])

  // this updates the draft with the correct signing account
  useEffect(() => {
    draftEvents.subscribe(
      (value: {type: 'change'; signingAccount?: string} | null) => {
        if (value) {
          send(value)
        }
      },
    )
  }, [])

  return {
    data,
    state,
    send,
    actor,
    locationEntity,
    editEntity,
    editor,
  }
}

export type HyperMediaEditor = Exclude<
  ReturnType<typeof useDraftEditor>['editor'],
  null
>

export const findBlock = findParentNode(
  (node) => node.type.name === 'blockContainer',
)

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

function useGetDoc() {
  async function getDoc(id: UnpackedHypermediaId) {
    const path = hmIdPathToEntityQueryPath(id.path)
    const apiDoc = await grpcClient.documents.getDocument({
      account: id.uid,
      path,
      version: id.version || undefined,
    })

    return prepareHMDocument(apiDoc)
  }
  return getDoc
}

export function usePublishToSite() {
  const connectPeer = useConnectPeer()

  const getDoc = useGetDoc()
  return async (
    id: UnpackedHypermediaId,
    siteHost?: string,
  ): Promise<boolean> => {
    const getQueryResults = getQueryResultsWithClient(grpcClient)

    // list of all references. this should be populated with an ID before extractReferenceMaterials is called for it
    const allReferenceIds: UnpackedHypermediaId[] = [] // do not include id, because it is the root document that does the referencing
    // list of all hmUrls that have already been referenced. this is used to avoid infinite loops
    const alreadyReferencedHmUrls = new Set<string>([])

    async function extractReferenceMaterials(
      id: UnpackedHypermediaId,
      document: HMDocument,
    ) {
      const hmUrl = createHMUrl(id)
      if (alreadyReferencedHmUrls.has(hmUrl)) {
        return
      }

      async function extractQueryDependencies(blockNodes: HMBlockNode[]) {
        await Promise.all(
          blockNodes.map(async (node: HMBlockNode) => {
            node.children &&
              (await extractQueryDependencies(node.children || []))
            if (node.block.type === 'Query') {
              const query = node.block.attributes.query
              const results = await getQueryResults(query)
              if (results) {
                await Promise.all(
                  results.results.map(async (result) => {
                    const {id} = result
                    allReferenceIds.push(id)
                    await extractReferenceMaterials(id, document)
                  }),
                )
              }
            }
          }),
        )
      }

      async function extractEmbedDependencies(blockNodes: HMBlockNode[]) {
        await Promise.all(
          blockNodes.map(async (node) => {
            node.children &&
              (await extractEmbedDependencies(node.children || []))
            if (node.block.type === 'Embed' && node.block.link) {
              const id = unpackHmId(node.block.link)
              if (id) {
                allReferenceIds.push(id)
                await extractReferenceMaterials(id, document)
              }
            }
            // @ts-expect-error
            if (node.block.annotations) {
              await Promise.all(
                // @ts-expect-error
                node.block.annotations.map(async (annotation) => {
                  if (annotation.type === 'Embed' && annotation.link) {
                    const id = unpackHmId(annotation.link)
                    if (id) {
                      allReferenceIds.push(id)
                      await extractReferenceMaterials(id, document)
                    }
                  }
                }),
              )
            }
          }),
        )
      }
      alreadyReferencedHmUrls.add(hmUrl) // do this before running the queries and embeds, so that we don't recursively hit the same url
      await extractQueryDependencies(document.content)
      await extractEmbedDependencies(document.content)
    }

    const doc = await getDoc(id)

    const authors = new Set(doc.authors)
    await connectPeer.mutateAsync(siteHost)
    const parentPaths = getParentPaths(id.path)
    const syncParentIds: UnpackedHypermediaId[] = []
    parentPaths.forEach((path) => {
      if (!!id.path && path.length === id.path.length) {
        return
      }
      if (authors.has(id.uid) && path.length === 0) {
        return
      }
      syncParentIds.push(hmId(id.uid, {path}))
    })
    const authorIds = (
      await Promise.all(
        doc.authors.map(async (authorUid) => {
          try {
            // we want to make sure the site has our version of each author (or later). so we need to provide the version into the id for discovery
            const authorDoc = await grpcClient.documents.getDocument({
              account: authorUid,
            })
            const authorId = hmId(authorUid, {version: authorDoc.version})
            if (authorId.uid === id.uid && authorId.version === doc.version) {
              // we are already discovering this doc, so it does not need to be included in the list of authorIds
              return null
            }
            return authorId
          } catch (e) {
            // probably failed to find the author. this should not be fatal for the site publish workflow
            return null
          }
        }),
      )
    ).filter((a) => !!a)
    await extractReferenceMaterials(id, doc)
    const referenceMaterialIds = new Set<string>()
    allReferenceIds.forEach((id) => {
      referenceMaterialIds.add(createHMUrl(id))
    })
    authorIds.forEach((id) => {
      referenceMaterialIds.add(createHMUrl(id))
    })
    syncParentIds.forEach((id) => {
      referenceMaterialIds.add(createHMUrl(id))
    })
    await siteDiscover({
      uid: id.uid,
      version: id.version,
      path: id.path,
      host: siteHost || DEFAULT_GATEWAY_URL,
      media: true,
    })
    for (const url of Array.from(referenceMaterialIds)) {
      const id = unpackHmId(url)
      if (!id) continue
      await siteDiscover({
        uid: id.uid,
        version: id.version,
        path: id.path,
        host: siteHost || DEFAULT_GATEWAY_URL,
        media: true,
      })
    }
    return true
  }
}

const loadQueryResults = getQueryResultsWithClient(grpcClient)

export function queryListDirectory(
  id?: UnpackedHypermediaId | null,
  options?: {mode?: 'Children' | 'AllDescendants'},
): UseQueryOptions<unknown, unknown, Array<HMDocumentInfo>> {
  return {
    queryKey: [queryKeys.DOC_LIST_DIRECTORY, id?.id, options?.mode],
    queryFn: async () => {
      if (!id) return []
      const results = await loadQueryResults({
        includes: [
          {
            space: id.uid,
            mode: 'Children',
            path: hmIdPathToEntityQueryPath(id.path),
          },
        ],
      })
      return results?.results || []
    },
    enabled: !!id,
  } as const
}

export function useListDirectory(
  id?: UnpackedHypermediaId | null,
  options?: {mode: 'Children' | 'AllDescendants'},
): UseQueryResult<Array<HMDocumentInfo>> {
  return useQuery(queryListDirectory(id, options))
}

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

    // TODO: this code was making impossible to remove a paragraph above a media element when it was nested. This was in place because it was also impossible to add a selection above a media element when this media element was the last one in the draft. Now it seems to both cases be fixed when this code is removed. 🤷‍♂️
    // if (
    //   index === blocks.length - 1 &&
    //   ['image', 'video', 'file', 'embed'].includes(block.type)
    // ) {
    //   editor.insertBlocks(
    //     [
    //       {
    //         type: 'paragraph',
    //       },
    //     ],
    //     block.id,
    //     'after',
    //   )
    //   if (editor.getTextCursorPosition().nextBlock) {
    //     editor.setTextCursorPosition(editor.getTextCursorPosition().nextBlock)
    //   }
    // }
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
          response.metadata?.toJson({emitDefaultValues: true}),
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

function removeTrailingBlocks(blocks: Array<EditorBlock>) {
  let trailedBlocks = [...blocks]
  while (true) {
    let lastBlock = trailedBlocks[trailedBlocks.length - 1]
    if (!lastBlock) break
    if (
      lastBlock.type == 'paragraph' &&
      lastBlock.content.length == 0 &&
      lastBlock.children.length == 0
    ) {
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
  return () => {
    const id = nanoid(10)
    navigate({
      key: 'draft',
      id,
      accessory: {key: 'options'},
      ...draftParams,
    })
  }
}

export function useForkDocument() {
  return useMutation({
    mutationFn: async ({
      from,
      to,
      signingAccountId,
    }: {
      from: UnpackedHypermediaId
      to: UnpackedHypermediaId
      signingAccountId: string
    }) => {
      const document = await grpcClient.documents.getDocument({
        account: from.uid,
        path: hmIdPathToEntityQueryPath(from.path),
        version: from.latest ? undefined : from.version || undefined,
      })
      const {generationInfo} = document
      if (!generationInfo) throw new Error('No generation info for document')
      await grpcClient.documents.createRef({
        account: to.uid,
        signingKeyName: signingAccountId,
        path: hmIdPathToEntityQueryPath(to.path),
        target: {
          target: {
            case: 'version',
            value: {
              genesis: generationInfo.genesis,
              version: document.version,
            },
          },
        },
      })
    },
  })
}

export function useMoveDocument() {
  return useMutation({
    mutationFn: async ({
      from,
      to,
      signingAccountId,
    }: {
      from: UnpackedHypermediaId
      to: UnpackedHypermediaId
      signingAccountId: string
    }) => {
      const document = await grpcClient.documents.getDocument({
        account: from.uid,
        path: hmIdPathToEntityQueryPath(from.path),
        version: from.latest ? undefined : from.version || undefined,
      })
      const {generationInfo} = document
      if (!generationInfo) throw new Error('No generation info for document')
      await grpcClient.documents.createRef({
        account: to.uid,
        signingKeyName: signingAccountId,
        path: hmIdPathToEntityQueryPath(to.path),
        target: {
          target: {
            case: 'version',
            value: {
              genesis: generationInfo.genesis,
              version: document.version,
            },
          },
        },
      })
      await grpcClient.documents.createRef({
        account: from.uid,
        signingKeyName: signingAccountId,
        path: hmIdPathToEntityQueryPath(from.path),
        target: {
          target: {
            case: 'redirect',
            value: {
              account: to.uid,
              path: hmIdPathToEntityQueryPath(to.path),
            },
          },
        },
      })
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
  siteHomeEntity: HMEntityContent | undefined | null,
): DocNavigationItem[] | null {
  const homeDir = useListDirectory(siteHomeEntity?.id, {
    mode: 'Children',
  })
  const drafts = useAccountDraftList(siteHomeEntity?.id?.uid)
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
    : getSiteNavDirectory({
        id: siteHomeEntity.id,
        directory: homeDir.data,
        drafts: drafts.data,
      })
  return navItems
}
