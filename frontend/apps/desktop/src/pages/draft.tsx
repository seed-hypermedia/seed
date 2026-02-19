import {AddCollaboratorForm} from '@/components/collaborators-panel'
import {CoverImage} from '@/components/cover-image'
import {useDeleteDraftDialog} from '@/components/delete-draft-dialog'
import {DiscussionsPanel} from '@/components/discussions-panel'
import {DocNavigationDraftLoader} from '@/components/doc-navigation'
import {EditNavPopover} from '@/components/edit-navigation-popover'
import {HyperMediaEditorView} from '@/components/editor'
import {OptionsPanel} from '@/components/options-panel'
import PublishDraftButton from '@/components/publish-draft-button'
import {subscribeDraftFocus} from '@/draft-focusing'
import {useSelectedAccountCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useDraftEditor, useSiteNavigationItems} from '@/models/documents'
import {draftMachine, DraftMachineState} from '@/models/draft-machine'
import {draftEditId, draftLocationId} from '@/models/drafts'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {useChildrenActivity} from '@/models/library'
import {useOpenUrl} from '@/open-url'
import {useSelectedAccount} from '@/selected-account'
import {client} from '@/trpc'
import {useHackyAuthorsSubscriptions} from '@/use-hacky-authors-subscriptions'
import {handleDragMedia} from '@/utils/media-drag'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {BlockNoteEditor} from '@shm/editor/blocknote'
import {dispatchScroll} from '@shm/editor/editor-on-scroll-stream'
import '@shm/editor/editor.css'
import {chromiumSupportedImageMimeTypes, chromiumSupportedVideoMimeTypes, generateBlockId} from '@shm/editor/utils'
import {CommentsProvider} from '@shm/shared/comments-service-provider'
import {
  HMDocument,
  HMMetadata,
  HMNavigationItem,
  HMResourceFetchResult,
  HMResourceVisibility,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useCapabilities, useDirectory, useResource, useResources} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {DraftRoute} from '@shm/shared/routes'
import {useRouteLink} from '@shm/shared/routing'
import '@shm/shared/styles/document.css'
import {hmId, packHmId, unpackHmId} from '@shm/shared/utils'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import {useNavigationDispatch, useNavRoute} from '@shm/shared/utils/navigation'
import {PanelContent} from '@shm/ui/accessories'
import {Button} from '@shm/ui/button'
import {DocumentCollaborators} from '@shm/ui/collaborators-page'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {DirectoryPanel} from '@shm/ui/directory-panel'
import {DocumentTools} from '@shm/ui/document-tools'
import {Feed} from '@shm/ui/feed'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {Home, Trash} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {DocNavigationItem} from '@shm/ui/navigation'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {PanelLayout} from '@shm/ui/panel-layout'
import {PrivateBadge} from '@shm/ui/private-badge'
import {SiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {useMutation} from '@tanstack/react-query'
import {useSelector} from '@xstate/react'
import {Eye, Settings} from 'lucide-react'
import {Selection} from 'prosemirror-state'
import {MouseEvent, useEffect, useMemo, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {ActorRefFrom} from 'xstate'
import './draft-page.css'

export default function DraftPage() {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  const push = useNavigate('push')
  if (route.key != 'draft') throw new Error('DraftPage must have draft route')

  const {data, editor, send, state, actor} = useDraftEditor()

  const locationId = useMemo(() => {
    if (route.key != 'draft') return undefined
    // @ts-expect-error
    if (data?.locationId) return data.locationId
    if (route.locationUid) return hmId(route.locationUid, {path: route.locationPath})
    if (data?.locationUid)
      return hmId(data.locationUid, {
        path: data.locationPath,
      })
    return undefined
  }, [route, data])

  const panelKey = useMemo(() => {
    if (route.key != 'draft') return undefined
    return (route as DraftRoute).panel?.key || undefined
  }, [route])

  const editId = useMemo(() => {
    if (route.key != 'draft') return undefined
    // @ts-expect-error
    if (data?.editId) return data.editId
    if (route.editUid) return hmId(route.editUid, {path: route.editPath})
    if (data?.editUid) return hmId(data.editUid, {path: data.editPath})
    return undefined
  }, [route, data])

  const isEditingHomeDoc = useMemo(() => {
    if (editId && (editId.path?.length ?? 0) === 0) return true
    return false
  }, [locationId, editId])

  const homeIdRef = useRef<UnpackedHypermediaId | undefined>(undefined)
  const homeId = useMemo(() => {
    let id: UnpackedHypermediaId | undefined
    if (locationId) {
      id = hmId(locationId.uid, {path: []})
    } else if (editId) {
      id = hmId(editId.uid, {path: []})
    }
    if (id) homeIdRef.current = id
    return homeIdRef.current
  }, [locationId, editId])

  const homeEntity = useResource(homeId)
  const homeDocument = homeEntity.data?.type === 'document' ? homeEntity.data.document : undefined

  const draftPanelOptions = ['options', 'activity', 'discussions', 'collaborators', 'directory'] as const

  useListenAppEvent('toggle_accessory', (event) => {
    const targetKey = draftPanelOptions[event.index]
    if (!targetKey) return
    const id = route.editUid ? hmId(route.editUid, {path: route.editPath}) : undefined
    if (!id) return
    if (panelKey === targetKey) {
      replace({...route, panel: null})
    } else {
      replace({...route, panel: {key: targetKey, id}})
    }
  })

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
        ttEditor.commands.setTextSelection(editorView.state.doc.content.size - 4)
        ttEditor.commands.focus()
      } else console.warn('No position found within the editor for the given mouse coordinates.')
    }
  }

  const headerDocIdRef = useRef<UnpackedHypermediaId | undefined>(undefined)
  const computedHeaderDocId = locationId || editId
  if (computedHeaderDocId) headerDocIdRef.current = computedHeaderDocId
  const headerDocId = headerDocIdRef.current

  // Layout: useDocumentLayout lives here so elementRef can wrap PanelLayout (matching resource-page-common.tsx)
  const showOutline = typeof state.context.metadata.showOutline == 'undefined' || state.context.metadata.showOutline

  const {showSidebars, elementRef, showCollapsed, mainContentProps, sidebarProps, wrapperProps} = useDocumentLayout({
    contentWidth: state.context.metadata.contentWidth || 'M',
    showSidebars: showOutline && !isEditingHomeDoc,
  })

  const panelContent = panelKey ? (
    <ScrollArea className="flex-1">
      <DraftPanelContent
        panelKey={panelKey}
        docId={editId}
        state={state}
        actor={actor}
        isEditingHomeDoc={isEditingHomeDoc}
        route={route}
      />
    </ScrollArea>
  ) : null

  const handlePanelClose = () => {
    replace({...route, panel: null})
  }

  const handleFilterChange = (filter: {filterEventType?: string[]}) => {
    if (route.panel?.key === 'activity') {
      replace({
        ...route,
        panel: {...route.panel, filterEventType: filter.filterEventType},
      })
    }
  }

  return (
    <ErrorBoundary FallbackComponent={() => null}>
      <CommentsProvider
        useHackyAuthorsSubscriptions={useHackyAuthorsSubscriptions}
        onReplyClick={() => {
          toast.error('Not implemented draft CommentsProvider onReplyClick')
        }}
        onReplyCountClick={() => {
          toast.error('Not implemented draft CommentsProvider onReplyCountClick')
        }}
      >
        <div className={cn(panelContainerStyles, 'dark:bg-background flex h-full flex-col bg-white')}>
          {headerDocId ? (
            <DraftAppHeader
              siteHomeEntity={homeEntity.data}
              isEditingHomeDoc={isEditingHomeDoc}
              docId={headerDocId}
              document={homeDocument}
              draftMetadata={isEditingHomeDoc ? state.context.metadata : undefined}
              onDocNav={(navigation) => {
                send({
                  type: 'change.navigation',
                  navigation,
                })
              }}
              actor={actor}
            />
          ) : null}
          <div ref={elementRef} className="relative flex flex-1 flex-col overflow-hidden">
            <PanelLayout
              panelKey={panelKey ?? null}
              panelContent={panelContent}
              onPanelClose={handlePanelClose}
              filterEventType={route.panel?.key === 'activity' ? route.panel.filterEventType : undefined}
              onFilterChange={handleFilterChange}
            >
              <DraftRebaseBanner />
              <DocumentEditor
                editor={editor}
                state={state}
                actor={actor}
                data={data}
                send={send}
                handleFocusAtMousePos={handleFocusAtMousePos}
                isHomeDoc={isEditingHomeDoc}
                showSidebars={showSidebars}
                showCollapsed={showCollapsed}
                showOutline={showOutline}
                mainContentProps={mainContentProps}
                sidebarProps={sidebarProps}
                wrapperProps={wrapperProps}
              />
            </PanelLayout>
          </div>
        </div>
      </CommentsProvider>
    </ErrorBoundary>
  )
}

// function WelcomePopover({onClose}: {onClose: () => void}) {
//   return (
//     <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
//       <div className="max-w-md p-6 mx-4 border rounded-lg shadow-lg bg-background">
//         <h2 className="mb-4 text-2xl font-bold">
//           Congratulations on creating your account! 🎉
//         </h2>
//         <div className="mb-6 space-y-3 text-muted-foreground">
//           <p className="font-semibold">Quick tips to get started:</p>
//           <ul className="space-y-2 list-disc list-inside">
//             <li>[Tip 1: How to edit and format your content]</li>
//             <li>[Tip 2: How to publish your document]</li>
//             <li>[Tip 3: How to share your profile]</li>
//             <li>[Tip 4: How to create your first site]</li>
//           </ul>
//         </div>
//         <button
//           onClick={onClose}
//           className="w-full px-4 py-2 font-semibold transition-colors rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
//         >
//           Got it, let's start!
//         </button>
//       </div>
//     </div>
//   )
// }

function DraftPanelContent({
  panelKey,
  docId,
  state,
  actor,
  isEditingHomeDoc,
  route,
}: {
  panelKey: string
  docId?: UnpackedHypermediaId
  state: ReturnType<typeof useDraftEditor>['state']
  actor: ReturnType<typeof useDraftEditor>['actor']
  isEditingHomeDoc: boolean
  route: DraftRoute
}) {
  switch (panelKey) {
    case 'options':
      return state?.context?.metadata && actor ? (
        <OptionsPanel
          draftId={route.id}
          metadata={state.context.metadata}
          isHomeDoc={isEditingHomeDoc}
          onMetadata={(metadata) => {
            if (!metadata) return
            actor.send({type: 'change', metadata})
          }}
          onResetContent={() => {
            actor.send({type: 'reset.content'})
          }}
        />
      ) : null
    case 'discussions':
      if (!docId) return null
      if (isEditingHomeDoc) {
        return (
          <PanelContent>
            <Feed size="sm" filterResource={`${docId.id}*`} filterEventType={['Comment']} />
          </PanelContent>
        )
      }
      return route.panel?.key === 'discussions' ? (
        <DiscussionsPanel docId={docId} selection={{...route.panel, id: route.panel.id ?? docId}} />
      ) : null
    case 'activity':
      return (
        <PanelContent>
          <Feed
            size="sm"
            filterResource={docId?.id}
            filterEventType={route.panel?.key === 'activity' ? route.panel.filterEventType || [] : []}
          />
        </PanelContent>
      )
    case 'collaborators':
      return docId ? (
        <PanelContent>
          <AddCollaboratorForm id={docId} />
          <DocumentCollaborators docId={docId} />
        </PanelContent>
      ) : null
    case 'directory':
      return docId ? <DirectoryPanel docId={docId} /> : null
    default:
      return null
  }
}

function DocumentEditor({
  editor,
  state,
  actor,
  data,
  send,
  handleFocusAtMousePos,
  isHomeDoc = false,
  showSidebars,
  showCollapsed,
  showOutline,
  mainContentProps,
  sidebarProps,
  wrapperProps,
}: {
  editor: BlockNoteEditor
  state: ReturnType<typeof useDraftEditor>['state']
  actor: ReturnType<typeof useDraftEditor>['actor']
  data: ReturnType<typeof useDraftEditor>['data']
  send: ReturnType<typeof useDraftEditor>['send']
  handleFocusAtMousePos: (event: any) => void
  isHomeDoc: boolean
  showSidebars: boolean
  showCollapsed: boolean
  showOutline: boolean
  mainContentProps: React.HTMLAttributes<HTMLDivElement>
  sidebarProps: React.HTMLAttributes<HTMLDivElement>
  wrapperProps: React.HTMLAttributes<HTMLDivElement>
}) {
  const route = useNavRoute()
  const openUrl = useOpenUrl()
  if (route.key != 'draft') throw new Error('DraftPage must have draft route')
  const importWebFile = useMutation({
    mutationFn: (url: string) => client.webImporting.importWebFile.mutate(url),
  })
  const [isDragging, setIsDragging] = useState(false)
  const [showCover, setShowCover] = useState(false)

  const draftQuery = useDraft(route.id)

  const id = useMemo(() => {
    let uId = route.editUid || draftQuery.data?.editUid
    let path = route.editPath || draftQuery.data?.editPath
    if (!uId) {
      const locationPath = route.locationPath || draftQuery.data?.locationPath
      if (locationPath) {
        uId = route.locationUid || draftQuery.data?.locationUid
        path = locationPath
      }
    }
    if (uId) {
      return hmId(uId, {path})
    }
    return undefined
  }, [route, draftQuery.data])

  const cover = useSelector(actor, (s) => s.context.metadata.cover)

  const editId = useMemo(() => {
    if (route.editUid) {
      return hmId(route.editUid, {path: route.editPath})
    }
    if (draftQuery.data?.editUid) {
      return hmId(draftQuery.data.editUid, {path: draftQuery.data.editPath})
    }
    return undefined
  }, [route.editUid, route.editPath, draftQuery.data?.editUid, draftQuery.data?.editPath])

  // Breadcrumbs: compute parent paths from editId (existing doc) or id (new doc location)
  const breadcrumbParentIds = useMemo(() => {
    const contextId = editId || id
    if (!contextId) return []
    const parentPaths = getParentPaths(contextId.path)
    // For editId, exclude the last path (the doc itself)
    // For locationId (id), include all (they're all parents)
    const paths = editId ? parentPaths.slice(0, -1) : parentPaths
    return paths.map((path) => hmId(contextId.uid, {path}))
  }, [editId, id])

  const breadcrumbEntities = useResources(breadcrumbParentIds)

  const breadcrumbs = useMemo(() => {
    return breadcrumbParentIds.map((bId, idx) => ({
      id: bId,
      metadata:
        // @ts-expect-error - resource type union
        breadcrumbEntities[idx]?.data?.document?.metadata ?? null,
    }))
  }, [breadcrumbParentIds, breadcrumbEntities])

  // Only fetch interaction summary for existing documents being edited, not new drafts.
  const interactionSummary = useInteractionSummary(editId)

  const {data: collaborators} = useCapabilities(id)
  const directory = useChildrenActivity(id)

  // Track when DocumentTools becomes sticky
  const [isToolsSticky, setIsToolsSticky] = useState(false)
  const toolsSentinelRef = useRef<HTMLDivElement>(null)

  const documentTools = editId ? (
    <DocumentTools
      activeTab="draft"
      id={editId}
      existingDraft={draftQuery.data || false}
      commentsCount={interactionSummary.data?.comments || 0}
      collabsCount={collaborators?.filter((c) => c.role !== 'agent').length}
      layoutProps={{
        wrapperProps,
        sidebarProps,
        mainContentProps,
        showSidebars,
      }}
    />
  ) : null

  // @ts-expect-error
  const isEditing = state.matches('editing')

  useEffect(() => {
    const sentinel = toolsSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        setIsToolsSticky(!entry.isIntersecting)
      },
      {threshold: 0.1, rootMargin: '0px'},
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [isEditing])

  useEffect(() => {
    let val = !!cover
    if (val != showCover) {
      setShowCover(val)
    }
  }, [cover])

  useEffect(() => {
    const focusDocKey = id?.id || route.id
    if (!focusDocKey) return
    return subscribeDraftFocus(focusDocKey, (blockId: string) => {
      if (editor) {
        editor._tiptapEditor.commands.focus('end', {scrollIntoView: true})
        editor.setTextCursorPosition(blockId, 'end')
      }
    })
  }, [id, route.id, editor])

  if (isEditing)
    return (
      <div
        onDragStart={() => {
          setIsDragging(true)
        }}
        onDragEnd={() => {
          setIsDragging(false)
        }}
        onDragOver={(event: React.DragEvent<HTMLDivElement>) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        // @ts-expect-error
        onDrop={onDrop}
        onClick={handleFocusAtMousePos}
        className="relative flex h-full flex-1 flex-col"
      >
        {/* Floating action buttons - fade when tools are sticky */}
        <div
          className={cn(
            'absolute top-2 right-2 z-40 flex items-center gap-1 rounded-sm transition-opacity md:top-4 md:right-4',
            // isToolsSticky ? 'pointer-events-none opacity-0' : 'opacity-100',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <DraftActionButtons route={route} />
        </div>
        <ScrollArea className="h-full" onScroll={() => dispatchScroll(true)}>
          <DraftCover
            draftActor={actor}
            // @ts-expect-error
            disabled={!state.matches('editing')}
            show={showCover}
            // @ts-expect-error
            setShow={setShowCover}
            showOutline={showOutline}
          />

          {/* Title section - centered using wrapperProps layout */}
          {!isHomeDoc ? (
            <div {...wrapperProps} className={cn(wrapperProps.className)}>
              {showSidebars && <div {...sidebarProps} className={cn(sidebarProps.className, '!h-auto')} />}
              <div {...mainContentProps} className={cn(mainContentProps.className, 'flex flex-col')}>
                <DraftMetadataEditor
                  draftActor={actor}
                  onEnter={() => {
                    editor._tiptapEditor.commands.focus()
                    editor._tiptapEditor.commands.setTextSelection(0)
                  }}
                  showCover={showCover}
                  setShowCover={setShowCover}
                  visibility={route.visibility || data?.visibility}
                  breadcrumbs={breadcrumbs}
                />
              </div>
              {showSidebars && (
                <div {...sidebarProps} className={cn(sidebarProps.className, 'pointer-events-none !h-auto')} />
              )}
            </div>
          ) : null}

          {/* Sentinel element - provides top spacing before tools */}
          <div ref={toolsSentinelRef} className="h-3" />

          {/* DocumentTools - sticky with shadow */}
          <div
            className={cn(
              'dark:bg-background sticky top-0 z-10 bg-white py-1',
              isToolsSticky ? 'shadow-md' : 'shadow-none',
              'transition-shadow',
            )}
          >
            {isHomeDoc ? (
              documentTools
            ) : id ? (
              <DocumentTools
                activeTab="draft"
                id={id}
                existingDraft={draftQuery.data || false}
                layoutProps={{
                  wrapperProps,
                  sidebarProps,
                  mainContentProps,
                  showSidebars,
                }}
              />
            ) : null}
          </div>

          {/* Editor content - centered with sidebar */}
          <div className="draft-editor pt-4">
            <div {...wrapperProps}>
              {showSidebars ? (
                <div
                  {...sidebarProps}
                  className={`${sidebarProps.className || ''} flex flex-col`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="sticky top-12 mt-4">
                    <DocNavigationDraftLoader showCollapsed={showCollapsed} id={id} editor={editor} />
                  </div>
                </div>
              ) : null}
              <div {...mainContentProps}>
                <Container
                  // @ts-expect-error
                  paddingLeft="$4"
                  marginBottom={300}
                  onClick={(e: MouseEvent<HTMLDivElement>) => {
                    e.stopPropagation()
                  }}
                >
                  {editor ? <HyperMediaEditorView editor={editor} openUrl={openUrl} /> : null}
                </Container>
              </div>
              {showSidebars ? <div {...sidebarProps} /> : null}
            </div>
          </div>
        </ScrollArea>
      </div>
    )

  return null

  function onDrop(event: DragEvent) {
    if (!isDragging) return
    const dataTransfer = event.dataTransfer

    if (dataTransfer?.files && dataTransfer.files.length > 0) {
      event.preventDefault()

      // Iterate through all dropped files
      const files = Array.from(dataTransfer.files)

      // Get the current block ID where files should be inserted
      const currentBlock = editor.getTextCursorPosition().block
      let lastInsertedBlockId = currentBlock.id

      // Process files sequentially to maintain order
      files.reduce((promise, file, index) => {
        return promise.then(async () => {
          try {
            const props = await handleDragMedia(file)
            if (!props) return

            let blockType: string
            if (chromiumSupportedImageMimeTypes.has(file.type)) {
              blockType = 'image'
            } else if (chromiumSupportedVideoMimeTypes.has(file.type)) {
              blockType = 'video'
            } else {
              blockType = 'file'
            }

            const newBlockId = generateBlockId()
            const mediaBlock = {
              id: newBlockId,
              type: blockType,
              props: {
                url: props.url,
                name: props.name,
                ...(blockType === 'file' ? {size: props.size} : {}),
              },
              content: [],
              children: [],
            }

            // Insert after the last inserted block (or current block for first file)
            editor.insertBlocks([mediaBlock], lastInsertedBlockId, 'after')

            // Update the last inserted block ID for next iteration
            lastInsertedBlockId = newBlockId
          } catch (error) {
            console.error('Failed to upload file:', file.name, error)
          }
        })
      }, Promise.resolve())

      setIsDragging(false)
      return
    }

    const urls = Array.from(new Set(dataTransfer?.getData('text/plain')?.split('\n') || [])).map((u) => u.trim())

    urls.forEach((url) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        importWebFile.mutate(url, {
          onSuccess: (result) => {
            let webEmbedBlock = {
              id: generateBlockId(),
              type: 'WebEmbed',
              props: {
                // @ts-expect-error
                url: result.data.url,
              },
              content: [],
              children: [],
            }
            editor.insertBlocks(
              // @ts-ignore
              [webEmbedBlock],
              // @ts-expect-error
              editor._tiptapEditor.state.selection,
            )
          },
        })
      } else if (url.startsWith('hm://')) {
        let parsedId = unpackHmId(url)
        if (parsedId) {
          let hmDocBlock = {
            id: generateBlockId(),
            type: 'Embed',
            props: {
              link: packHmId(parsedId),
            },
            content: [],
            children: [],
          }
          // @ts-ignore
          editor.insertBlocks(
            // @ts-ignore
            [hmDocBlock],
            // @ts-expect-error
            editor._tiptapEditor.state.selection,
          )
        }
      }
    })

    setIsDragging(false)
  }

  // function onBlockSelect(
  //   blockId: string,
  //   blockRange: BlockRange | ExpandedBlockRange | undefined,
  // ) {
  //   const gwUrl = useGatewayUrl()

  //   if (!id) throw new Error('draft route id is missing')

  //   if (!id?.uid) throw new Error('uid could not be extracted from draft route')
  //   copyUrlToClipboardWithFeedback(
  //     createWebHMUrl(id.uid, {
  //       blockRef: blockId,
  //       blockRange,
  //       hostname: gwUrl.data,
  //     }),
  //     'Block',
  //   )
  // }
}

function DraftAppHeader({
  siteHomeEntity,
  docId,
  document,
  draftMetadata,
  isEditingHomeDoc = false,
  onDocNav,
  actor,
}: {
  siteHomeEntity: HMResourceFetchResult | undefined | null
  docId: UnpackedHypermediaId
  document?: HMDocument
  draftMetadata?: HMMetadata
  isEditingHomeDoc: boolean
  onDocNav: (navigation: HMNavigationItem[]) => void
  actor: ActorRefFrom<typeof draftMachine>
}) {
  const dir = useDirectory(docId, {mode: 'Children'})
  const notifyServiceHost = useNotifyServiceHost()
  const currentDocNav: HMNavigationItem[] | undefined = useSelector(
    actor,
    (s: DraftMachineState) => s.context.navigation,
  )
  const navItems = useSiteNavigationItems(siteHomeEntity)?.filter((item) => !item.draftId)
  const displayNavItems =
    currentDocNav !== undefined && isEditingHomeDoc
      ? currentDocNav.map((navItem: HMNavigationItem): DocNavigationItem => {
          const id = unpackHmId(navItem.link)
          return {
            key: navItem.id,
            id: id || undefined,
            webUrl: id ? undefined : navItem.link,
            draftId: undefined,
            metadata: {name: navItem.text},
            isPublished: true,
          }
        })
      : navItems
  if (!siteHomeEntity) return null
  return (
    <SiteHeader
      siteHomeId={siteHomeEntity.id}
      items={displayNavItems}
      docId={docId}
      document={document}
      draftMetadata={draftMetadata}
      isCenterLayout={
        draftMetadata?.theme?.headerLayout === 'Center' || draftMetadata?.layout === 'Seed/Experimental/Newspaper'
      }
      editNavPane={
        isEditingHomeDoc ? (
          <EditNavPopover
            docNav={
              displayNavItems?.map(
                (item): HMNavigationItem => ({
                  id: item.key,
                  type: 'Link',
                  text: item.metadata.name || '',
                  link: item.id ? packHmId(item.id) : item.webUrl || '',
                }),
              ) || []
            }
            editDocNav={onDocNav}
            homeId={siteHomeEntity.id}
          />
        ) : null
      }
      siteHomeDocument={siteHomeEntity.document}
      isMainFeedVisible={false}
      notifyServiceHost={notifyServiceHost}
      routeType="draft"
    />
  )
}

function DraftMetadataEditor({
  onEnter,
  draftActor,
  disabled = false,
  showCover = false,
  setShowCover,
  visibility,
  breadcrumbs,
}: {
  onEnter: () => void
  draftActor: ActorRefFrom<typeof draftMachine>
  disabled?: boolean
  showCover?: boolean
  setShowCover?: (show: boolean) => void
  visibility?: HMResourceVisibility
  breadcrumbs?: Array<{id: UnpackedHypermediaId; metadata: HMMetadata | null}>
}) {
  const route = useNavRoute()
  if (route.key !== 'draft') throw new Error('DraftHeader must have draft route')

  const [showIcon, setShowIcon] = useState(false)

  const name = useSelector(draftActor, (s) => {
    return s.context.metadata.name
  })
  const summary = useSelector(draftActor, (s) => {
    return s.context.metadata.summary
  })

  const icon = useSelector(draftActor, (s) => {
    return s.context.metadata.icon
  })
  const stateEditUid = useSelector(draftActor, (s) => {
    return s.context.editUid
  })
  const inputName = useRef<HTMLTextAreaElement | null>(null)
  const inputSummary = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const target = inputName.current
    if (!target) return
    if (target.value !== name) {
      // handle cases where the model has a different title. this happens when pasting multiline text into the title
      target.value = name || ''
      applyInputResize(target)
    }
  }, [name])

  useEffect(() => {
    const target = inputSummary.current
    if (!target) return
    if (target.value !== summary) {
      // handle cases where the model has a different title. this happens when pasting multiline text into the title
      target.value = summary || ''
      applyInputResize(target)
    }
  }, [summary])

  useEffect(() => {
    let val = !!icon
    if (val != showIcon) {
      setShowIcon(val)
    }
  }, [icon])

  useEffect(() => {
    handleResize()

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }

    function handleResize() {
      // handle the resize size of the title, responsive size may be changed
      const targetName = inputName.current
      if (!targetName) return
      applyInputResize(targetName)
      const targetSummary = inputSummary.current
      if (!targetSummary) return
      applyInputResize(targetSummary)
    }
  }, [inputName.current, inputSummary.current])

  return (
    <div
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
      }}
    >
      <Container
        className={cn(
          showCover &&
            'relative z-0 after:absolute after:inset-0 after:rounded-md after:bg-white after:content-[""] after:dark:bg-black',
        )}
        style={{
          marginTop: showCover ? '-40px' : '0',
          paddingTop: !showCover ? '60px' : '24px',
        }}
      >
        <div className="group-header z-1 flex flex-col gap-4">
          {breadcrumbs && breadcrumbs.length > 0 ? <DraftBreadcrumbs breadcrumbs={breadcrumbs} /> : null}
          {visibility === 'PRIVATE' && <PrivateBadge />}
          <textarea
            disabled={disabled}
            id="draft-name-input"
            ref={inputName}
            rows={1}
            onKeyDown={(e: any) => {
              if (e.key == 'Enter') {
                e.preventDefault()
                onEnter()
              }
            }}
            className="w-full resize-none border-none border-transparent text-4xl font-bold shadow-none ring-0 ring-transparent" // trying to hide extra content that flashes when pasting multi-line text into the title
            defaultValue={name?.trim() || ''} // this is still a controlled input because of the value comparison in useLayoutEffect
            // value={title}
            onChange={(e) => {
              applyInputResize(e.target as any)
              let newName = e.target.value
              // Replace two hyphens with a long dash
              if (name && newName.length > name.length) {
                const isHyphen = name.slice(-1) === '-' && newName.slice(-1) === '-'
                if (isHyphen) newName = newName.slice(0, -2) + '—'
              }

              draftActor.send({
                type: 'change',
                metadata: {
                  name: newName,
                },
              })
            }}
            placeholder="Document Title"
          />
          <textarea
            disabled={disabled}
            id="draft-summary-input"
            ref={inputSummary}
            rows={1}
            onKeyDown={(e: any) => {
              if (e.key == 'Enter') {
                e.preventDefault()
                onEnter()
              }
            }}
            className="text-muted-foreground w-full resize-none border-none border-transparent font-serif! text-xl font-normal shadow-none ring-0 ring-transparent outline-none" // trying to hide extra content that flashes when pasting multi-line text into the title
            defaultValue={name?.trim() || ''} // this is still a controlled input because of the value comparison in useLayoutEffect
            // value={title}
            onChange={(e) => {
              applyInputResize(e.target as any)
              let newSummary = e.target.value
              // Replace two hyphens with a long dash
              if (summary && newSummary.length > summary.length) {
                const isHyphen = summary.slice(-1) === '-' && newSummary.slice(-1) === '-'
                if (isHyphen) newSummary = newSummary.slice(0, -2) + '—'
              }

              draftActor.send({
                type: 'change',
                metadata: {
                  summary: newSummary,
                },
              })
            }}
            placeholder="Document Summary"
          />
        </div>
      </Container>
    </div>
  )
}

function DraftCover({
  draftActor,
  show = false,
  showOutline = true,
  setShowOutline,
}: {
  draftActor: ActorRefFrom<typeof draftMachine>
  disabled?: boolean
  showOutline?: boolean
  show?: boolean
  setShowOutline?: (show: boolean) => void
}) {
  const route = useNavRoute()
  if (route.key !== 'draft') throw new Error('DraftHeader must have draft route')

  const cover = useSelector(draftActor, (s) => {
    return s.context.metadata.cover
  })

  return (
    <div
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
      }}
    >
      <CoverImage
        show={show}
        showOutline={showOutline}
        onCoverUpload={(cover) => {
          if (cover) {
            draftActor.send({
              type: 'change',
              metadata: {
                cover: `ipfs://${cover}`,
              },
            })
          }
        }}
        onRemoveCover={() => {
          setShowOutline?.(true)
          draftActor.send({
            type: 'change',
            metadata: {
              cover: '',
            },
          })
        }}
        url={cover ? getDaemonFileUrl(cover) : ''}
        // @ts-expect-error
        id={route.id}
      />
    </div>
  )
}

function DraftRebaseBanner() {
  const [isRebasing, setIsRebasing] = useState(false)
  // const willEditDocId = getDraftEditId(draftData)
  // const latestDoc = useResource(willEditDocId, {subscribed: true})

  async function performRebase() {
    //   setIsRebasing(true)
    //   if (latestDoc.data?.document) {
    //     handleRebase(latestDoc.data).then(() => {
    //       setIsRebasing(false)
    //     })
    //   }
  }

  if (isRebasing) {
    return (
      <div className="flex border-0 border-b border-solid bg-yellow-100 p-4 text-black">
        <div className="mr-2">
          <Spinner className="size-4" />
        </div>
        <SizableText>Updating to the latest version...</SizableText>
      </div>
    )
  }

  return null
}

function applyInputResize(target: HTMLTextAreaElement) {
  // Reset height to auto to get accurate scrollHeight
  target.style.height = 'auto'

  // Set height to match content with no limit
  target.style.height = target.scrollHeight + 'px'
}

function DraftActionButtons({route}: {route: DraftRoute}) {
  const selectedAccount = useSelectedAccount()
  const replace = useNavigate('replace')
  const dispatch = useNavigationDispatch()
  const draftId = route.id
  const draft = useDraft(draftId)
  const editId = draftEditId(draft.data)
  const locationId = draftLocationId(draft.data)
  const editIdWriteCap = useSelectedAccountCapability(editId || locationId, 'writer')
  const deleteDialog = useDeleteDraftDialog()

  const menuItems: MenuItemType[] = [
    {
      key: 'options',
      label: 'Document Options',
      icon: <Settings className="size-4" />,
      onClick: () => {
        replace({
          ...route,
          panel: route.panel?.key === 'options' ? null : {key: 'options'},
        })
      },
    },
    {
      key: 'delete-draft',
      label: 'Delete Draft',
      icon: <Trash className="size-4" />,
      variant: 'destructive',
      onClick: () => {
        if (draftId) {
          deleteDialog.open({
            draftId,
            onSuccess: () => {
              dispatch({type: 'closeBack'})
            },
          })
        } else {
          dispatch({type: 'closeBack'})
        }
      },
    },
  ]

  if (!selectedAccount?.id) return null
  if ((editId || locationId) && !editIdWriteCap)
    return (
      <div className="flex items-center gap-2">
        <SizableText size="sm">
          <span className="font-bold">{selectedAccount?.document?.metadata.name}</span>
          {' - '}
          Not Allowed to Publish Here
        </SizableText>
      </div>
    )

  return (
    <div className="animate flex items-center gap-1">
      <PublishDraftButton key="publish-draft" />

      {draft.data ? (
        <Tooltip content="Preview Document">
          <Button
            onClick={() => {
              client.createAppWindow.mutate({
                routes: [{key: 'preview', draftId: route.id}],
                sidebarLocked: false,
                sidebarWidth: 0,
                accessoryWidth: 0,
              })
            }}
            className="hover:bg-hover dark:bg-background bg-white"
          >
            <Eye className="size-4" />
          </Button>
        </Tooltip>
      ) : null}
      <OptionsDropdown menuItems={menuItems} align="end" side="bottom" />
      {deleteDialog.content}
    </div>
  )
}

function DraftBreadcrumbs({
  breadcrumbs,
}: {
  breadcrumbs: Array<{id: UnpackedHypermediaId; metadata: HMMetadata | null}>
}) {
  const [first, ...rest] = breadcrumbs

  return (
    <div className="text-muted-foreground flex flex-1 items-center gap-2">
      {first ? (
        <div className="flex items-center gap-1">
          <Home className="size-3" />
        </div>
      ) : null}
      {rest.flatMap((crumb) => {
        return [
          <SizableText color="muted" key={`${crumb.id.id}-slash`} size="xs">
            /
          </SizableText>,
          <DraftBreadcrumbLink id={crumb.id} metadata={crumb.metadata} key={crumb.id.id} />,
        ]
      })}
    </div>
  )
}

function DraftBreadcrumbLink({id, metadata}: {id: UnpackedHypermediaId; metadata: HMMetadata | null}) {
  const linkProps = useRouteLink({key: 'document', id})
  return (
    <a
      {...linkProps}
      className="max-w-[15ch] truncate overflow-hidden text-xs whitespace-nowrap no-underline hover:underline"
    >
      {metadata?.name ?? id?.path?.at(-1) ?? '?'}
    </a>
  )
}
