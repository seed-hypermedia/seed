import {useAppContext, useGRPCClient} from '@/app-context'
import {dispatchWizardEvent} from '@/components/create-account'
import {createHypermediaDocLinkPlugin} from '@/editor'
import {grpcClient} from '@/grpc-client'
import {useDraft} from '@/models/accounts'
import {useOpenUrl} from '@/open-url'
import {slashMenuItems} from '@/slash-menu-items'
import {trpc} from '@/trpc'
import {Timestamp, toPlainMessage} from '@bufbuild/protobuf'
import {ConnectError} from '@connectrpc/connect'
import {
  BIG_INT,
  Block,
  DEFAULT_GATEWAY_URL,
  DocumentChange,
  DocumentChange_SetAttribute,
  EditorBlock,
  HMBlock,
  HMBlockNode,
  HMDocument,
  HMDocumentInfo,
  HMDocumentMetadataSchema,
  HMDocumentSchema,
  HMDraft,
  HMEntityContent,
  HMMetadata,
  UnpackedHypermediaId,
  createHMUrl,
  editorBlockToHMBlock,
  entityQueryPathToHmIdPath,
  eventStream,
  extractRefs,
  hmBlockToEditorBlock,
  hmBlocksToEditorContent,
  hmId,
  hmIdPathToEntityQueryPath,
  invalidateQueries,
  queryKeys,
  unpackHmId,
  writeableStateStream,
} from '@shm/shared'
import {getQueryResultsWithClient} from '@shm/shared/src/models/directory'
import {toast} from '@shm/ui'
import type {UseQueryResult} from '@tanstack/react-query'
import {
  UseInfiniteQueryOptions,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import {Extension, findParentNode} from '@tiptap/core'
import {NodeSelection, Selection} from '@tiptap/pm/state'
import {useMachine} from '@xstate/react'
import _ from 'lodash'
import {nanoid} from 'nanoid'
import {useEffect, useMemo, useRef} from 'react'
import {ContextFrom, OutputFrom, fromPromise} from 'xstate'
import {BlockNoteEditor, hmBlockSchema, useBlockNote} from '../editor'
import {useNavRoute} from '../utils/navigation'
import {pathNameify} from '../utils/path'
import {useNavigate} from '../utils/useNavigate'
import {useConnectPeer} from './contacts'
import {useMyAccountIds} from './daemon'
import {draftMachine} from './draft-machine'
import {setGroupTypes} from './editor-utils'
import {getParentPaths, useEntities, useEntity} from './entities'
import {useGatewayUrlStream} from './gateway-settings'
import {useInlineMentions} from './search'
import {siteDiscover} from './web-links'

export const [draftDispatch, draftEvents] = eventStream<{
  type: 'CHANGE'
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
export function useAccountDraftList(accountUid: string) {
  return trpc.drafts.listAccount.useQuery(accountUid, {})
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

function changesToJSON(changes: DocumentChange[]) {
  return changes.map((change) => {
    if (change.op.case === 'replaceBlock') {
      return {...change.op}
    }
    return change.op
  })
}

type PrimitiveValue = string | number | boolean | null | undefined

function extractMetaEntries(jsonObject: {}): [string[], PrimitiveValue][] {
  return Object.entries(jsonObject).flatMap(
    ([key, value]: [string, unknown]) => {
      if (typeof value === 'object' && value !== null) {
        return extractMetaEntries(value).map(([k, v]) => [key + '.' + k, v])
      }
      return [[[key], value]]
    },
  )
}

type AttributeValueType = 'boolValue' | 'nullValue' | 'intValue' | 'stringValue'
function docAttributeChangeNull(key: string[], value: null) {
  return new DocumentChange({
    op: {
      case: 'setAttribute',
      value: new DocumentChange_SetAttribute({
        blockId: '',
        key,
        value: {
          case: 'nullValue',
          value: new Empty(),
        },
      }),
    },
  })
}
function docAttributeChangeString(key: string[], value: string) {
  return new DocumentChange({
    op: {
      case: 'setAttribute',
      value: new DocumentChange_SetAttribute({
        blockId: '',
        key,
        value: {
          case: 'stringValue',
          value,
        },
      }),
    },
  })
}
function docAttributeChangeInt(key: string[], value: number) {
  return new DocumentChange({
    op: {
      case: 'setAttribute',
      value: new DocumentChange_SetAttribute({
        blockId: '',
        key,
        value: {
          case: 'intValue',
          value: BigInt(value),
        },
      }),
    },
  })
}
function docAttributeChangeBool(key: string[], value: boolean) {
  return new DocumentChange({
    op: {
      case: 'setAttribute',
      value: new DocumentChange_SetAttribute({
        blockId: '',
        key,
        value: {
          case: 'boolValue',
          value,
        },
      }),
    },
  })
}

function getDocAttributeChanges(metadata: HMMetadata) {
  const changes = []
  if (metadata.name !== undefined)
    changes.push(docAttributeChangeString(['name'], metadata.name))
  if (metadata.icon !== undefined)
    changes.push(docAttributeChangeString(['icon'], metadata.icon))
  if (metadata.thumbnail !== undefined)
    changes.push(docAttributeChangeString(['thumbnail'], metadata.thumbnail))
  if (metadata.cover !== undefined)
    changes.push(docAttributeChangeString(['cover'], metadata.cover))
  if (metadata.siteUrl !== undefined)
    changes.push(docAttributeChangeString(['siteUrl'], metadata.siteUrl))
  if (metadata.layout !== undefined)
    changes.push(docAttributeChangeString(['layout'], metadata.layout))
  if (metadata.displayPublishTime !== undefined)
    changes.push(
      docAttributeChangeString(
        ['displayPublishTime'],
        metadata.displayPublishTime,
      ),
    )
  if (metadata.seedExperimentalLogo !== undefined)
    changes.push(
      docAttributeChangeString(
        ['seedExperimentalLogo'],
        metadata.seedExperimentalLogo,
      ),
    )
  if (metadata.seedExperimentalHomeOrder !== undefined)
    changes.push(
      docAttributeChangeString(
        ['seedExperimentalHomeOrder'],
        metadata.seedExperimentalHomeOrder,
      ),
    )
  if (metadata.showOutline !== undefined)
    changes.push(docAttributeChangeBool(['showOutline'], metadata.showOutline))
  if (metadata.theme !== undefined) {
    if (metadata.theme.headerLayout !== undefined)
      changes.push(
        docAttributeChangeString(
          ['theme', 'headerLayout'],
          metadata.theme.headerLayout,
        ),
      )
  }
  console.log('changes', changes)
  return changes
}

export function usePublishDraft(
  opts?: UseMutationOptions<
    HMDocument,
    unknown,
    {
      draft: HMDraft
      previous: HMDocument | undefined
      id: UnpackedHypermediaId | undefined
    }
  >,
) {
  const grpcClient = useGRPCClient()
  const accts = useMyAccountIds()
  const writeRecentSigner = trpc.recentSigners.writeRecentSigner.useMutation()
  return useMutation<
    HMDocument,
    any,
    {
      draft: HMDraft
      previous: HMDocument | undefined
      id: UnpackedHypermediaId | undefined
    }
  >({
    mutationFn: async ({draft, previous, id}) => {
      const blocksMap = previous ? createBlocksMap(previous.content, '') : {}

      const content = removeTrailingBlocks(draft.content || [])

      const changes = compareBlocksWithMap(blocksMap, content, '')

      const deleteChanges = extractDeletes(blocksMap, changes.touchedBlocks)
      // return null
      if (accts.data?.length == 0) {
        dispatchWizardEvent(true)
      } else {
        try {
          if (draft.signingAccount && id?.id) {
            const allChanges = [
              ...getDocAttributeChanges(draft.metadata),
              ...changes.changes,
              ...deleteChanges,
            ]

            let capabilityId = ''
            if (draft.signingAccount !== id.uid) {
              const capabilities =
                await grpcClient.accessControl.listCapabilities({
                  account: id.uid,
                  path: hmIdPathToEntityQueryPath(id.path),
                })
              const capability = capabilities.capabilities.find(
                (cap) => cap.delegate === draft.signingAccount,
              )
              if (!capability)
                throw new Error(
                  'Could not find capability for this draft signing account',
                )
              capabilityId = capability.id
            }
            writeRecentSigner.mutateAsync(draft.signingAccount).then(() => {
              invalidateQueries(['trpc.recentSigners.get'])
            })
            const publishedDoc =
              await grpcClient.documents.createDocumentChange({
                signingKeyName: draft.signingAccount,
                account: id.uid,
                baseVersion: draft.previousId?.version || '',
                path: id.path?.length
                  ? `/${id.path
                      .map((p, idx) =>
                        idx == id.path!.length - 1
                          ? p.startsWith('_') && draft.metadata.name
                            ? pathNameify(draft.metadata.name)
                            : p.replace('_', '')
                          : p.replace('_', ''),
                      )
                      .join('/')}`
                  : '',
                changes: allChanges,
                capability: capabilityId,
              })

            const resultDoc = {
              ...toPlainMessage(publishedDoc),
              metadata: HMDocumentMetadataSchema.parse(
                publishedDoc.metadata?.toJson({emitDefaultValues: true}),
              ),
            }

            return resultDoc
          } else {
            // dispatchWizardEvent(true)
            // toast.error('PUBLISH ERROR: Please select an account to sign first')
            throw Error('PUBLISH ERROR: Please select an account to sign first')
          }
        } catch (error) {
          const connectErr = ConnectError.from(error)
          toast.error(`Publish error: ${connectErr.rawMessage}`)
          throw Error(connectErr.rawMessage)
        }
      }
    },
    onSuccess: (result, variables, context) => {
      const documentId = variables.id?.id
      opts?.onSuccess?.(result, variables, context)
      if (documentId) {
        invalidateQueries([queryKeys.ENTITY, documentId])
        invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, variables.id?.uid])
        invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
        invalidateQueries([queryKeys.SITE_LIBRARY, variables.id?.uid])
        invalidateQueries([queryKeys.LIST_ACCOUNTS])
      }
    },
  })
}

export function useDocumentRead(id: UnpackedHypermediaId | undefined | false) {
  const grpcClient = useGRPCClient()
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
  const grpcClient = useGRPCClient()
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

export function useDraftName(
  input: UseQueryOptions<EditorDraftState> & {id?: UnpackedHypermediaId},
) {
  const draft = useDraft(input.id)
  return (draft.data?.metadata?.name || undefined) as string | undefined
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

export function useDraftEditor({id}: {id?: UnpackedHypermediaId}) {
  const {grpcClient} = useAppContext()
  const openUrl = useOpenUrl()
  const route = useNavRoute()
  const replaceRoute = useNavigate('replace')
  const gwUrl = useGatewayUrlStream()
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const gotEdited = useRef(false)
  const showNostr = trpc.experiments.get.useQuery().data?.nostr
  const [writeEditorStream] = useRef(writeableStateStream<any>(null)).current
  const saveDraft = trpc.drafts.write.useMutation()
  const {inlineMentionsQuery, inlineMentionsData} = useInlineMentions()
  const isNewDraft = route.key == 'draft' && !!route.new

  const editor = useBlockNote<typeof hmBlockSchema>({
    onEditorContentChange(editor: BlockNoteEditor<typeof hmBlockSchema>) {
      if (!gotEdited.current) {
        gotEdited.current = true
      }

      writeEditorStream(editor.topLevelBlocks)
      observeBlocks(
        editor,
        editor.topLevelBlocks,
        () => {},
        // send({type: 'CHANGE'}),
      )
      send({type: 'CHANGE'})
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
      openOnClick: false,
      grpcClient,
      gwUrl,
      openUrl,
      checkWebUrl: checkWebUrl.mutateAsync,
    },
    onMentionsQuery: (query: string) => {
      inlineMentionsQuery(query)
    },
    blockSchema: hmBlockSchema,
    slashMenuItems: !showNostr
      ? slashMenuItems.filter((item) => item.name != 'Nostr')
      : slashMenuItems,
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

  useEffect(() => {
    if (inlineMentionsData) {
      editor?.setInlineEmbedOptions(inlineMentionsData)
    }
  }, [inlineMentionsData])

  const createOrUpdateDraft = fromPromise<
    HMDraft & {id?: string},
    ContextFrom<typeof draftMachine>
  >(async ({input}) => {
    const blocks = editor.topLevelBlocks
    let inputData: Partial<HMDraft> = {}
    const draftId = id.id || input.id

    if (!draftId)
      throw new Error('Draft Error: no id passed to update function')
    if (!input.draft) {
      inputData = {
        content: blocks,
        deps: [],
        metadata: input.metadata,
        members: {},
        lastUpdateTime: Date.now(),
        previousId: input.entity.id,
        signingAccount: input.signingAccount || undefined,
      } as HMDraft
    } else {
      inputData = {
        ...input.draft,
        content: blocks,
        metadata: {
          ...input.draft.metadata,
          ...input.metadata,
        },
        signingAccount: input.signingAccount || undefined,
      } as HMDraft
    }
    const res = await saveDraft.mutateAsync({id: draftId, draft: inputData})

    if (!id) {
      return {...res, id: draftId}
    } else {
      return res
    }
  })

  const [state, send, actor] = useMachine(
    draftMachine.provide({
      actions: {
        populateEditor: function ({context, event}) {
          let content: Array<EditorBlock> = []
          if (context.entity && !context.draft && context.entity.document) {
            // populate draft from document
            content = hmBlocksToEditorContent(context.entity.document.content, {
              childrenType: 'Group',
            })
          } else if (
            context.draft != null &&
            context.draft.content.length != 0
          ) {
            content = context.draft.content
          }
          editor.replaceBlocks(editor.topLevelBlocks, content)
          const tiptap = editor?._tiptapEditor
          // this is a hack to set the current blockGroups in the editor to the correct type, because from the BN API we don't have access to those nodes.
          setGroupTypes(tiptap, content)
        },
        focusEditor: () => {
          if (!isNewDraft) {
            const tiptap = editor?._tiptapEditor
            if (tiptap && !tiptap.isFocused) {
              editor._tiptapEditor.commands.focus()
            }
          }
        },
        focusName: ({context}) => {
          if (context.nameRef && isNewDraft) {
            context.nameRef.focus()
            context.nameRef.setSelectionRange(
              context.nameRef.value.length,
              context.nameRef.value.length,
            )
          }
        },
        replaceRouteifNeeded: ({
          event,
        }: {
          event: {output: OutputFrom<typeof createOrUpdateDraft>}
        }) => {
          if (event.output.id) {
            const id = unpackHmId(event.output.id)
            if (!id) throw new Error('Draft save resulted in invalid hm ID')
            if (route.key !== 'draft')
              throw new Error('Invalid route, draft expected.')
            replaceRoute({...route, id, new: false})
          }
        },
        onSaveSuccess: function () {
          invalidateQueries([queryKeys.DRAFT, id?.id])
          invalidateQueries(['trpc.drafts.get'])
          invalidateQueries(['trpc.drafts.list'])
          invalidateQueries(['trpc.drafts.listAccount'])
          invalidateQueries([queryKeys.ENTITY, id?.id])
        },
        resetContent: function ({event}) {
          if (event.type !== 'RESET.CONTENT') return
          const content = hmBlocksToEditorContent(event.blockNodes, {
            childrenType: 'Group',
          })
          editor.replaceBlocks(editor.topLevelBlocks, content)
          const tiptap = editor?._tiptapEditor
          setGroupTypes(tiptap, content)
        },
      },
      actors: {
        createOrUpdateDraft,
      },
    }),
  )

  const backendDraft = useDraft(id)
  const backendDocument = useEntity(
    backendDraft.status == 'success' && backendDraft.data?.previousId
      ? backendDraft.data.previousId
      : id,
  )

  async function handleRebase(newEntity: HMEntityContent) {
    /**
     * 1. get current version's blocks map
     * 2. get new version's blocks map
     * 3. get touched changes in draft
     * 4. get touched changes in new version
     * 5. compare touched blocks in draft vs touched blocks of new version
     * 6. update blocks in editor
     * 7. update previousId on draft (state machine)
     */

    const blocksMap1 = createBlocksMap(
      backendDocument.data?.document?.content || [],
      '',
    )
    const blocksMap2 = createBlocksMap(newEntity.document?.content || [], '')
    const editorContent = removeTrailingBlocks(editor.topLevelBlocks)

    const changes = compareBlocksWithMap(blocksMap1, editorContent, '')
    const changes2 = compareDraftWithMap(
      blocksMap1,
      newEntity.document?.content,
      '',
    )

    changes2.touchedBlocks.forEach((blockId) => {
      const blockContent = blocksMap2[blockId]
      if (blockContent) {
        const editorBlock = hmBlockToEditorBlock(blockContent.block)
        // this is updating the editor with the new version's block without comparing with the draft changes (destructive)
        // TODO: fix types of editorBlock
        editor.updateBlock(blockId, editorBlock as any)
      }
    })

    send({type: 'FINISH.REBASE', entity: newEntity})
  }

  useEffect(() => {
    if (
      backendDraft.status == 'success' &&
      backendDocument.status != 'loading'
    ) {
      send({
        type: 'GET.DRAFT.SUCCESS',
        draft: backendDraft.data,
        entity:
          backendDocument.status != 'error' && backendDocument.data
            ? backendDocument.data
            : null,
      })
    }
    if (backendDraft.status == 'error') {
      send({type: 'GET.DRAFT.ERROR', error: backendDraft.error})
    }
    // }
  }, [backendDraft.status, backendDocument.status])

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

  useEffect(() => {
    draftEvents.subscribe(
      (value: {type: 'CHANGE'; signingAccount: string} | null) => {
        if (value) {
          send(value)
        }
      },
    )
  }, [])

  return {editor, handleFocusAtMousePos, state, send, actor, handleRebase}

  // ==============

  // TODO: fix types
  function handleFocusAtMousePos(event: any) {
    let ttEditor = (editor as BlockNoteEditor)._tiptapEditor
    let editorView = ttEditor.view
    let editorRect = editorView.dom.getBoundingClientRect()
    let centerEditor = editorRect.left + editorRect.width / 2

    const pos = editorView.posAtCoords({
      left: editorRect.left + 1,
      top: event.clientY,
    })

    if (pos) {
      let node = editorView.state.doc.nodeAt(pos.pos)
      if (node) {
        let resolvedPos = editorView.state.doc.resolve(pos.pos)
        let lineStartPos = pos.pos
        let selPos = lineStartPos

        if (event.clientX >= centerEditor) {
          let lineEndPos = lineStartPos

          // Loop through the line to find its end based on next Y position
          while (lineEndPos < resolvedPos.end()) {
            const coords = editorView.coordsAtPos(lineEndPos)
            if (coords && coords.top >= event.clientY) {
              lineEndPos--
              break
            }
            lineEndPos++
          }
          selPos = lineEndPos
        }

        const sel = Selection.near(editorView.state.doc.resolve(selPos))
        ttEditor.commands.focus()
        ttEditor.commands.setTextSelection(sel)
      }
    } else {
      if (event.clientY > editorRect.bottom) {
        // editorView.state.doc.descendants((node, pos) => {
        //   console.log(node, pos)
        // })
        // From debugging positions, the last node is always resolved at position doc.content.size - 4, but it is possible to add exact position by calling doc.descendants
        ttEditor.commands.setTextSelection(
          editorView.state.doc.content.size - 4,
        )
        ttEditor.commands.focus()
      } else
        console.warn(
          'No position found within the editor for the given mouse coordinates.',
        )
    }
  }
}

export type HyperDocsEditor = Exclude<
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

export function createBlocksMap(
  blockNodes: Array<HMBlockNode> = [],
  parentId: string,
) {
  let result: BlocksMap = {}
  blockNodes.forEach((bn, idx) => {
    if (bn.block?.id) {
      let prevBlockNode = idx > 0 ? blockNodes[idx - 1] : undefined

      if (bn.block) {
        result[bn.block.id] = {
          parent: parentId,
          left:
            prevBlockNode && prevBlockNode.block ? prevBlockNode.block.id : '',
          block: bn.block,
        }
      }

      if (bn.children?.length) {
        // recursively call the block children and append to the result
        result = {...result, ...createBlocksMap(bn.children, bn.block.id)}
      }
    }
  })

  return result
}

function useGetDoc() {
  const grpcClient = useGRPCClient()

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

export function usePublishToSite() {
  const connectPeer = useConnectPeer()
  const grpcClient = useGRPCClient()
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
  const grpcClient = useGRPCClient()
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
  let result =
    // b1.id == b2.id &&
    b1.text == b2.text &&
    b1.link == b2.link &&
    _.isEqual(b1.annotations, b2.annotations) &&
    // TODO: how to correctly compare attributes???
    isBlockAttributesEqual(b1, b2) &&
    b1.type == b2.type
  return result
}

function isBlockAttributesEqual(b1: HMBlock, b2: HMBlock): boolean {
  let a1 = b1.attributes
  let a2 = b2.attributes
  if (!a1 && !a2) return true
  if (!a1 || !a2) return false
  return (
    a1.childrenType == a2.childrenType &&
    a1.start == a2.start &&
    a1.level == a2.level &&
    a1.url == a2.url &&
    a1.size == a2.size &&
    a1.href == a2.href &&
    a1.link == a2.link &&
    a1.language == a2.language &&
    a1.view == a2.view &&
    a1.width == a2.width &&
    a1.banner == a2.banner
  )
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
  const grpcClient = useGRPCClient()
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
  const grpcClient = useGRPCClient()

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

function findDifferences(obj1, obj2) {
  let differences = {}

  function compare(obj1, obj2, path = '') {
    if (
      typeof obj1 !== 'object' ||
      obj1 === null ||
      typeof obj2 !== 'object' ||
      obj2 === null
    ) {
      if (obj1 !== obj2) {
        differences[path] = {obj1, obj2} // Difference found
      }
      return
    }

    const keys1 = Object.keys(obj1)
    const keys2 = Object.keys(obj2)

    // Keys only in obj1
    keys1.forEach((key) => {
      if (!keys2.includes(key)) {
        differences[`${path}${key}`] = {obj1: obj1[key], obj2: undefined}
      }
    })

    // Keys only in obj2
    keys2.forEach((key) => {
      if (!keys1.includes(key)) {
        differences[`${path}${key}`] = {obj1: undefined, obj2: obj2[key]}
      }
    })

    // Keys present in both, compare values recursively
    keys1.forEach((key) => {
      if (keys2.includes(key)) {
        compare(obj1[key], obj2[key], `${path}${key}.`)
      }
    })
  }

  compare(obj1, obj2)
  return differences
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

export function useCreateDraft(parentDocId: UnpackedHypermediaId) {
  const navigate = useNavigate('push')
  return () => {
    const id = hmId('d', parentDocId.uid, {
      path: [...(parentDocId.path || []), `_${pathNameify(nanoid(10))}`],
    })
    navigate({
      key: 'draft',
      id,
      new: true,
    })
  }
}
