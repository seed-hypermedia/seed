import {dispatchOnboardingDialog} from '@/components/onboarding'
import {grpcClient} from '@/grpc-client'
import {useDraft} from '@/models/accounts'
import {useOpenUrl} from '@/open-url'
import {getSlashMenuItems} from '@/slash-menu-items'
import {trpc} from '@/trpc'
import {Timestamp, toPlainMessage} from '@bufbuild/protobuf'
import {ConnectError} from '@connectrpc/connect'
import {useBlockNote} from '@shm/editor/blocknote'
import {BlockNoteEditor} from '@shm/editor/blocknote/core'
import {createHypermediaDocLinkPlugin} from '@shm/editor/hypermedia-link-plugin'
import {
  Block,
  DocumentChange,
} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {editorBlockToHMBlock} from '@shm/shared/client/editorblock-to-hmblock'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {BIG_INT, DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {extractRefs} from '@shm/shared/content'
import {EditorBlock} from '@shm/shared/editor-types'
import {
  HMBlock,
  HMBlockNode,
  HMDocument,
  HMDocumentInfo,
  HMDocumentMetadataSchema,
  HMDocumentSchema,
  HMDraft,
  HMDraftContent,
  HMDraftMeta,
  HMEntityContent,
  HMNavigationItem,
  HMQuery,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {getQueryResultsWithClient} from '@shm/shared/models/directory'
import {useEntities, useEntity} from '@shm/shared/models/entity'
import {useInlineMentions} from '@shm/shared/models/inline-mentions'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {
  createBlocksMap,
  getDocAttributeChanges,
} from '@shm/shared/utils/document-changes'
import {createHMUrl, hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {
  entityQueryPathToHmIdPath,
  hmIdPathToEntityQueryPath,
} from '@shm/shared/utils/path-api'
import {eventStream} from '@shm/shared/utils/stream'
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
import _ from 'lodash'
import {nanoid} from 'nanoid'
import {useEffect, useMemo} from 'react'
import {assign, fromPromise} from 'xstate'
import {hmBlockSchema} from '../editor'
import {useNavRoute} from '../utils/navigation'
import {pathNameify} from '../utils/path'
import {useNavigate} from '../utils/useNavigate'
import {useConnectPeer} from './contacts'
import {useMyAccountIds} from './daemon'
import {draftMachine} from './draft-machine'
import {setGroupTypes} from './editor-utils'
import {getParentPaths} from './entities'
import {useGatewayUrlStream} from './gateway-settings'
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
  if (!accountUid) return {data: []}
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
  const entities = useEntities(docRefs.map((r) => r.refId))
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
    append(draftId, event) {
      return appendDraft.mutateAsync({draftId, event})
    },
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
  const editEntity = useEntity(editId)
  const writeRecentSigner = trpc.recentSigners.writeRecentSigner.useMutation()
  return useMutation<HMDocument, any, PublishDraftInput>({
    mutationFn: async ({
      draft,
      destinationId,
      accountId,
    }: PublishDraftInput): Promise<HMDocument> => {
      if (draft.editId?.id !== editId?.id) {
        throw new Error(
          'Edit ID mismatch. Draft edit ID is not the same as the edit ID in the route.',
        )
      }
      console.log('~ draft', draft)
      console.log('~ document', editEntity.data?.document)

      const blocksMap = editId
        ? createBlocksMap(editEntity.data?.document?.content || [], '')
        : {}
      const newContent = removeTrailingBlocks(draft.content || [])

      const changes = compareBlocksWithMap(blocksMap, newContent, '')
      const deleteChanges = extractDeletes(blocksMap, changes.touchedBlocks)

      const navigationChanges = getNavigationChanges(
        draft.navigation,
        editEntity.data?.document,
      )
      console.log('~ navigationChanges', navigationChanges)
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
            const resultDoc: HMDocument = HMDocumentSchema.parse(
              publishedDoc.toJson(),
            )
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
      const resultDocId = hmId('d', result.account, {
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

function getNavigationChanges(
  navigation: HMNavigationItem[] | undefined,
  document: HMDocument | null | undefined,
) {
  const ops: DocumentChange[] = []
  const hasNavigationBlock = false // todo check document for this
  if (!hasNavigationBlock) {
    ops.push(
      new DocumentChange({
        op: {
          case: 'replaceBlock',
          value: {
            id: 'navigation',
            type: 'Group',
          },
        },
      }),
    )
  }
  let leftSibling: string | undefined = undefined
  navigation?.forEach((item) => {
    ops.push(
      new DocumentChange({
        op: {
          case: 'replaceBlock',
          value: {
            id: item.id,
            type: 'Link',
            link: item.link,
            text: item.text,
          },
        },
      }),
    )
    ops.push(
      new DocumentChange({
        op: {
          case: 'moveBlock',
          value: {
            blockId: item.id,
            parent: 'navigation',
            leftSibling,
          },
        },
      }),
    )
    leftSibling = item.id
  })
  return ops
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
    return hmId('d', route.locationUid, {
      path: route.locationPath,
    })
  }, [route])

  const locationEntity = useEntity(locationId)

  const editId = useMemo(() => {
    if (data?.editUid)
      return hmId('d', data.editUid, {
        path: data.editPath,
      })
    if (route.editUid)
      return hmId('d', route.editUid, {
        path: route.editPath,
      })
    return undefined
  }, [route, data])

  const editEntity = useEntity(editId)

  // editor props
  // const [writeEditorStream] = useRef(writeableStateStream<any>(null)).current
  const showNostr = trpc.experiments.get.useQuery().data?.nostr
  const openUrl = useOpenUrl()
  const gwUrl = useGatewayUrlStream()
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const saveDraft = trpc.drafts.write.useMutation()
  const {onMentionsQuery} = useInlineMentions()

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
        const rect: DOMRect = domAtPos.node.getBoundingClientRect()
        // Check if the cursor is off screen
        // if (rect && (rect.top < 0 || rect.top > window.innerHeight)) {
        if (rect && rect.top > window.innerHeight) {
          // Scroll the cursor into view if not caused by media drag
          // @ts-ignore
          if (!editor.sideMenu.sideMenuView?.isDragging)
            domAtPos.node.scrollIntoView({block: 'center'})
        }
      } catch {}
      return
    },
    linkExtensionOptions: {
      // openOnClick: false,
      grpcClient,
      gwUrl,
      openUrl,
      checkWebUrl: checkWebUrl.mutateAsync,
    },
    onMentionsQuery,
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
            if (context.nameRef) {
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
                signingAccount: event.payload.data.signingAccount,
                deps: event.payload.data.deps,
                navigation: event.payload.data.navigation,
              }
            } else if (event.payload.type == 'edit') {
              if (context.editUid && editEntity.data?.document?.content) {
                content = hmBlocksToEditorContent(
                  editEntity.data.document.content || [],
                  {
                    childrenType: 'Group',
                  },
                )
                editor.replaceBlocks(editor.topLevelBlocks, content as any)
                const tiptap = editor?._tiptapEditor
                // this is a hack to set the current blockGroups in the editor to the correct type, because from the BN API we don't have access to those nodes.
                setGroupTypes(tiptap, content as any)
              }
              return {
                metadata: event.payload.data.document?.metadata,
                signingAccount: context.signingAccount,
                content,
                deps: event.payload.data.document?.version
                  ? [event.payload.data.document?.version]
                  : undefined,
              }
            } else if (event.payload.type == 'location') {
              if (locationEntity.data?.document?.content) {
                content = hmBlocksToEditorContent(
                  locationEntity.data.document.content || [],
                  {
                    childrenType: 'Group',
                  },
                )
                editor.replaceBlocks(editor.topLevelBlocks, content as any)
                const tiptap = editor?._tiptapEditor
                setGroupTypes(tiptap, content as any)
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

    const doc = HMDocumentSchema.parse(apiDoc.toJson())
    return doc
  }
  return getDoc
}

export function useDocumentNavigation(
  docId?: UnpackedHypermediaId | null,
): HMNavigationItem[] {
  const dir = useListDirectory(docId)
  const doc = useEntity(docId)
  // check if doc.data has detachedHeads.navigation,
  // if (doc.data?.detachedHeads?.navigation) {
  // }

  return (
    dir.data?.map((d) => ({
      type: 'Link',
      id: d.id,
      link: d.id,
      text: d.metadata?.name,
    })) || []
  )
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
                    const id = hmId('d', result.account, {
                      path: result.path,
                      version: result.version,
                    })
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
            if (node.block.annotations) {
              await Promise.all(
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
      syncParentIds.push(hmId('d', id.uid, {path}))
    })
    const authorIds = (
      await Promise.all(
        doc.authors.map(async (authorUid) => {
          try {
            // we want to make sure the site has our version of each author (or later). so we need to provide the version into the id for discovery
            const authorDoc = await grpcClient.documents.getDocument({
              account: authorUid,
            })
            const authorId = hmId('d', authorUid, {version: authorDoc.version})
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
    siteDiscover({
      uid: id.uid,
      version: id.version,
      path: id.path,
      host: siteHost || DEFAULT_GATEWAY_URL,
    })
    referenceMaterialIds.forEach((url) => {
      const id = unpackHmId(url)
      if (!id) return
      siteDiscover({
        uid: id.uid,
        version: id.version,
        path: id.path,
        host: siteHost || DEFAULT_GATEWAY_URL,
      })
    })
    return true
  }
}

export function queryListDirectory(
  id?: UnpackedHypermediaId | null,
): UseQueryOptions<unknown, unknown, Array<HMDocumentInfo>> {
  return {
    queryKey: [queryKeys.DOC_LIST_DIRECTORY, id?.uid],
    queryFn: async () => {
      if (!id) return []
      const results = await grpcClient.documents.listDocuments({
        account: id.uid,
        pageSize: BIG_INT,
      })
      const docs: HMDocumentInfo[] = results.documents
        .filter((doc) => {
          return doc.path !== ''
        })
        .map((d) => ({
          ...toPlainMessage(d),
          type: 'document',
          id: hmId('d', d.account, {
            path: entityQueryPathToHmIdPath(d.path),
          }).id,
          metadata: HMDocumentMetadataSchema.parse(
            d.metadata?.toJson({emitDefaultValues: true}),
          ),
          path: entityQueryPathToHmIdPath(d.path),
        }))
      return docs
    },
    enabled: !!id,
  } as const
}

export function useListDirectory(
  id?: UnpackedHypermediaId | null,
  options?: {mode: 'Children' | 'AllDescendants'},
): UseQueryResult<Array<HMDocumentInfo>> {
  const fullSpace = useQuery(queryListDirectory(id))
  const result: UseQueryResult<Array<HMDocumentInfo>> = {
    ...fullSpace,
    data: useMemo(() => {
      if (!fullSpace.data) return []
      return fullSpace.data.filter((doc) => {
        if (!id) return false
        // if doc.path (string[]) is not prefixed by id.path (string[]), return false
        if (id.path && !id?.path.every((p, idx) => p === doc.path[idx]))
          return false

        if (id.path && id.path.length === doc.path.length) {
          return !id.path.every((p, idx) => p === doc.path[idx])
        }

        // if options.mode is 'Children', check if the number of segments in doc.path is one more than the number of segments in id.path
        if (options?.mode == 'Children') {
          if (doc.path.length !== (id.path?.length || 0) + 1) return false
        }

        return true
      })
    }, [fullSpace.data, options?.mode, id?.path]),
  }
  return result
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
        .map((d) => ({
          ...toPlainMessage(d),
          metadata: HMDocumentMetadataSchema.parse(
            d.metadata?.toJson({emitDefaultValues: true}),
          ),
        }))
        .filter((doc) => {
          return doc.path !== ''
        })
        .map((doc) => {
          return {...doc, path: doc.path.slice(1).split('/')}
        })
      return docs as HMDocumentInfo[]
    },
  })
}

export function compareBlocksWithMap(
  blocksMap: BlocksMap,
  blocks: Array<EditorBlock>,
  parentId: string,
) {
  let changes: Array<DocumentChange> = []
  let touchedBlocks: Array<string> = []

  // iterate over editor blocks
  blocks?.forEach((block, idx) => {
    // add blockid to the touchedBlocks list to capture deletes later
    touchedBlocks.push(block.id)

    // compare replace
    let prevBlockState = blocksMap[block.id]

    // const childGroup = getBlockGroup(editor, block.id) // TODO: do this with no editor

    // if (childGroup) {
    if (false) {
      // @ts-expect-error
      block.props.childrenType = childGroup.type ? childGroup.type : 'Group'
      // @ts-expect-error
      block.props.listLevel = childGroup.listLevel
      // @ts-expect-error
      if (childGroup.start) block.props.start = childGroup.start.toString()
    }
    let currentBlockState = editorBlockToHMBlock(block)

    if (
      !prevBlockState ||
      prevBlockState.block.attributes?.listLevel !==
        currentBlockState.attributes?.listLevel
    ) {
      const serverBlock = editorBlockToHMBlock(block)

      // add moveBlock change by default to all blocks
      changes.push(
        new DocumentChange({
          op: {
            case: 'moveBlock',
            value: {
              blockId: block.id,
              leftSibling: idx > 0 && blocks[idx - 1] ? blocks[idx - 1].id : '',
              parent: parentId,
            },
          },
        }),
        new DocumentChange({
          op: {
            case: 'replaceBlock',
            value: Block.fromJson(serverBlock),
          },
        }),
      )
    } else {
      let left = idx > 0 && blocks[idx - 1] ? blocks[idx - 1].id : ''
      if (prevBlockState.left !== left || prevBlockState.parent !== parentId) {
        changes.push(
          new DocumentChange({
            op: {
              case: 'moveBlock',
              value: {
                blockId: block.id,
                leftSibling: left,
                parent: parentId,
              },
            },
          }),
        )
      }

      if (!isBlocksEqual(prevBlockState.block, currentBlockState)) {
        // this means is a new block and we need to also add a replaceBlock change
        changes.push(
          new DocumentChange({
            op: {
              case: 'replaceBlock',
              value: Block.fromJson(currentBlockState),
            },
          }),
        )
      }
    }

    if (block.children.length) {
      let nestedResults = compareBlocksWithMap(
        blocksMap,
        block.children,
        block.id,
      )
      changes = [...changes, ...nestedResults.changes]
      touchedBlocks = [...touchedBlocks, ...nestedResults.touchedBlocks]
    }
  })

  return {
    changes,
    touchedBlocks,
  }
}

export function compareDraftWithMap(
  blocksMap: BlocksMap,
  blockNodes: HMBlockNode[],
  parentId: string,
) {
  let changes: Array<DocumentChange> = []
  let touchedBlocks: Array<string> = []

  // iterate over editor blocks
  blockNodes.forEach((bn, idx) => {
    if (bn.block) {
      // add blockid to the touchedBlocks list to capture deletes later
      touchedBlocks.push(bn.block.id)

      // compare replace
      let prevBlockState = blocksMap[bn.block.id]

      // TODO: get block group

      let currentBlockState = bn.block

      if (!prevBlockState) {
        const serverBlock = currentBlockState

        // add moveBlock change by default to all blocks
        changes.push(
          new DocumentChange({
            op: {
              case: 'moveBlock',
              value: {
                blockId: bn.block.id,
                leftSibling:
                  idx > 0 && blockNodes[idx - 1]
                    ? blockNodes[idx - 1].block!.id
                    : '',
                parent: parentId,
              },
            },
          }),
          new DocumentChange({
            op: {
              case: 'replaceBlock',
              value: Block.fromJson(serverBlock),
            },
          }),
        )
      } else {
        let left =
          idx > 0 && blockNodes[idx - 1] ? blockNodes[idx - 1].block!.id : ''
        if (
          prevBlockState.left !== left ||
          prevBlockState.parent !== parentId
        ) {
          changes.push(
            new DocumentChange({
              op: {
                case: 'moveBlock',
                value: {
                  blockId: bn.block.id,
                  leftSibling: left,
                  parent: parentId,
                },
              },
            }),
          )
        }

        if (!isBlocksEqual(prevBlockState.block, currentBlockState)) {
          // this means is a new block and we need to also add a replaceBlock change
          changes.push(
            new DocumentChange({
              op: {
                case: 'replaceBlock',
                value: Block.fromJson(currentBlockState),
              },
            }),
          )
        }
      }

      if (bn.children?.length) {
        let nestedResults = compareDraftWithMap(
          blocksMap,
          bn.children,
          bn.block.id,
        )
        changes = [...changes, ...nestedResults.changes]
        touchedBlocks = [...touchedBlocks, ...nestedResults.touchedBlocks]
      }
    }
  })

  return {
    changes,
    touchedBlocks,
  }
}

export function extractDeletes(
  blocksMap: BlocksMap,
  touchedBlocks: Array<string>,
) {
  let deletedIds = Object.keys(blocksMap).filter(
    (id) => !touchedBlocks.includes(id),
  )

  return deletedIds.map(
    (dId) =>
      new DocumentChange({
        op: {
          case: 'deleteBlock',
          value: dId,
        },
      }),
  )
}

export function isBlocksEqual(b1: HMBlock, b2: HMBlock): boolean {
  if (!b1 || !b2) {
    console.log('Blocks not equal: One or both blocks are null/undefined', {
      b1,
      b2,
    })
    return false
  }
  if (b1 === b2) return true

  // Helper function to compare annotations, treating undefined and empty arrays as equal
  const areAnnotationsEqual = (a1?: any[], a2?: any[]) => {
    if (!a1 && !a2) return true
    if (!a1 && a2?.length === 0) return true
    if (!a2 && a1?.length === 0) return true
    return _.isEqual(a1, a2)
  }

  // Helper function to compare text, treating undefined and empty string as equal
  const isTextEqual = (t1?: string, t2?: string) => {
    if (!t1 && !t2) return true
    if (!t1 && t2 === '') return true
    if (!t2 && t1 === '') return true
    return t1 === t2
  }

  const checks = {
    id: b1.id === b2.id,
    text: isTextEqual(b1.text, b2.text),
    link: b1.link === b2.link,
    type: b1.type === b2.type,
    annotations: areAnnotationsEqual(b1.annotations, b2.annotations),
    attributes: isBlockAttributesEqual(b1, b2),
  }

  const result = Object.values(checks).every(Boolean)

  if (!result) {
    console.log('Blocks not equal. Differences found:', {
      blockId: b1.id,
      differences: Object.entries(checks)
        .filter(([_, isEqual]) => !isEqual)
        .map(([prop]) => ({
          property: prop,
          b1Value:
            prop === 'annotations'
              ? b1.annotations
              : prop === 'attributes'
              ? b1.attributes
              : b1[prop],
          b2Value:
            prop === 'annotations'
              ? b2.annotations
              : prop === 'attributes'
              ? b2.attributes
              : b2[prop],
        })),
    })
  }

  return result
}

function isBlockAttributesEqual(b1: HMBlock, b2: HMBlock): boolean {
  const a1 = b1.attributes
  const a2 = b2.attributes

  if (!a1 && !a2) return true
  if (!a1 || !a2) {
    console.log('Block attributes not equal: One side is missing attributes', {
      blockId: b1.id,
      a1,
      a2,
    })
    return false
  }

  const attributesToCompare = [
    'childrenType',
    'start',
    'level',
    'url',
    'name',
    'alignment',
    'size',
    'href',
    'link',
    'language',
    'view',
    'width',
    'banner',
    'query',
    'columnCount',
  ]

  const result = attributesToCompare.every((attr) => {
    if (attr === 'query') {
      return isQueryEqual(a1.query, a2.query)
    }
    return (
      (a1[attr] === undefined && a2[attr] === undefined) ||
      a1[attr] === a2[attr]
    )
  })

  if (!result) {
    console.log('Block attributes not equal. Differences found:', {
      blockId: b1.id,
      differences: attributesToCompare
        .filter(
          (attr) =>
            !(
              (a1[attr] === undefined && a2[attr] === undefined) ||
              a1[attr] === a2[attr]
            ),
        )
        .map((attr) => ({
          attribute: attr,
          a1Value: a1[attr],
          a2Value: a2[attr],
        })),
    })
  }

  return result
}

function observeBlocks(
  editor: BlockNoteEditor,
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
    return hmId('d', draftData.destinationUid, {
      path: draftData.destinationPath,
    })
  }
}

function isQueryEqual(q1?: HMQuery, q2?: HMQuery): boolean {
  if (!q1 && !q2) return true
  if (!q1 || !q2) return false

  // Compare limit
  if (q1.limit !== q2.limit) return false

  // Compare sorting arrays
  if (!_.isEqual(q1.sort || [], q2.sort || [])) return false

  // Compare includes arrays
  if (q1.includes.length !== q2.includes.length) return false

  // Deep compare each include item
  for (let i = 0; i < q1.includes.length; i++) {
    const include1 = q1.includes[i]
    const include2 = q2.includes[i]

    if (include1.mode !== include2.mode) return false
    if (include1.path !== include2.path) return false
    if (include1.space !== include2.space) return false
  }

  if (q1.sort?.length !== q2.sort?.length) return false

  for (let i = 0; i < q1.sort!.length; i++) {
    const sort1 = q1.sort![i]
    const sort2 = q2.sort![i]

    if (sort1.reverse !== sort2.reverse) return false
    if (sort1.term !== sort2.term) return false
  }
  return true
}
