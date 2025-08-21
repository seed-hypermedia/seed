import {AccessoryLayout} from '@/components/accessory-sidebar'
import {triggerCommentDraftFocus} from '@/components/commenting'
import {CoverImage} from '@/components/cover-image'
import {DocNavigationDraftLoader} from '@/components/doc-navigation'
import {useDocumentAccessory} from '@/components/document-accessory'
import {EditNavPopover} from '@/components/edit-navigation-popover'
import {HyperMediaEditorView} from '@/components/editor'
import {DesktopCommentsService} from '@/desktop-comments-service'
import {subscribeDraftFocus} from '@/draft-focusing'
import {useDraft} from '@/models/accounts'
import {useSelectedAccountContacts} from '@/models/contacts'
import {
  useDraftEditor,
  useListDirectory,
  useSiteNavigationItems,
} from '@/models/documents'
import {draftMachine} from '@/models/draft-machine'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {handleDragMedia} from '@/utils/media-drag'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {BlockNoteEditor} from '@shm/editor/blocknote'
import {dispatchScroll} from '@shm/editor/editor-on-scroll-stream'
import '@shm/editor/editor.css'
import {
  chromiumSupportedImageMimeTypes,
  chromiumSupportedVideoMimeTypes,
  generateBlockId,
} from '@shm/editor/utils'
import {CommentsProvider} from '@shm/shared/comments-service-provider'
import {
  HMDocument,
  HMEntityContent,
  HMMetadata,
  HMNavigationItem,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {DraftRoute} from '@shm/shared/routes'
import '@shm/shared/styles/document.css'
import {hmId, packHmId, unpackHmId} from '@shm/shared/utils'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {useDocumentLayout} from '@shm/ui/layout'
import {DocNavigationItem} from '@shm/ui/navigation'
import {Separator} from '@shm/ui/separator'
import {SiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {useSelector} from '@xstate/react'
import {Selection} from 'prosemirror-state'
import {MouseEvent, useEffect, useMemo, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {ActorRefFrom} from 'xstate'
import {AppDocContentProvider} from './document-content-provider'
import './draft-page.css'

export default function DraftPage() {
  const commentsService = new DesktopCommentsService()
  const route = useNavRoute()
  const replace = useNavigate('replace')
  if (route.key != 'draft') throw new Error('DraftPage must have draft route')

  const {data, editor, send, state, actor} = useDraftEditor()

  const locationId = useMemo(() => {
    if (route.key != 'draft') return undefined
    // @ts-expect-error
    if (data?.locationId) return data.locationId
    if (route.locationUid)
      return hmId(route.locationUid, {path: route.locationPath})
    if (data?.locationUid)
      return hmId(data.locationUid, {
        path: data.locationPath,
      })
    return undefined
  }, [route, data])

  const accessoryKey = useMemo(() => {
    if (route.key != 'draft') return undefined
    return (route as DraftRoute).accessory?.key || undefined
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

  const homeId = useMemo(() => {
    if (locationId) {
      return hmId(locationId.uid, {path: []})
    }
    if (editId) {
      return hmId(editId.uid, {path: []})
    }
    return undefined
  }, [locationId, editId])

  const homeEntity = useResource(homeId)
  const homeDocument =
    homeEntity.data?.type === 'document' ? homeEntity.data.document : undefined

  const {accessory, accessoryOptions} = useDocumentAccessory({
    docId: editId,
    state,
    actor,
    isEditingHomeDoc,
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

  const headerDocId = locationId || (!!homeEntity.data && editId)
  return (
    <ErrorBoundary FallbackComponent={() => null}>
      <CommentsProvider
        service={commentsService}
        onReplyClick={(replyComment) => {
          replace({
            ...route,
            accessory: {
              key: 'discussions',
              openComment: replyComment.id,
              isReplying: true,
            },
          })
          triggerCommentDraftFocus(route.id, replyComment.id)
        }}
        onReplyCountClick={(replyComment) => {
          replace({
            ...route,
            accessory: {
              key: 'discussions',
              openComment: replyComment.id,
            },
          })
        }}
      >
        <div className="flex h-full flex-1">
          <AccessoryLayout
            accessory={accessory}
            accessoryKey={accessoryKey}
            // @ts-expect-error
            onScroll={() => dispatchScroll(true)}
            onAccessorySelect={(key) => {
              if (!key) return
              replace({...route, accessory: {key: key as any}}) // TODO: fix this type
            }}
            accessoryOptions={accessoryOptions}
            isNewDraft={editId == undefined}
          >
            <div
              className={cn(
                panelContainerStyles,
                'dark:bg-background flex flex-col bg-white',
              )}
            >
              <DraftRebaseBanner />
              {headerDocId ? (
                <>
                  <DraftAppHeader
                    siteHomeEntity={homeEntity.data}
                    isEditingHomeDoc={isEditingHomeDoc}
                    docId={headerDocId}
                    document={homeDocument}
                    draftMetadata={state.context.metadata}
                    onDocNav={(navigation) => {
                      send({
                        type: 'change.navigation',
                        navigation,
                      })
                    }}
                    actor={actor}
                  />
                  <DocumentEditor
                    editor={editor}
                    state={state}
                    actor={actor}
                    data={data}
                    send={send}
                    handleFocusAtMousePos={handleFocusAtMousePos}
                    isHomeDoc={isEditingHomeDoc}
                  />
                </>
              ) : (
                <DocumentEditor
                  editor={editor}
                  state={state}
                  actor={actor}
                  data={data}
                  send={send}
                  handleFocusAtMousePos={handleFocusAtMousePos}
                  isHomeDoc={isEditingHomeDoc}
                />
              )}
            </div>
          </AccessoryLayout>
        </div>
      </CommentsProvider>
    </ErrorBoundary>
  )
}

function DocumentEditor({
  editor,
  state,
  actor,
  data,
  send,
  handleFocusAtMousePos,
  isHomeDoc = false,
}: {
  editor: BlockNoteEditor
  state: ReturnType<typeof useDraftEditor>['state']
  actor: ReturnType<typeof useDraftEditor>['actor']
  data: ReturnType<typeof useDraftEditor>['data']
  send: ReturnType<typeof useDraftEditor>['send']
  handleFocusAtMousePos: (event: any) => void
  isHomeDoc: boolean
}) {
  const route = useNavRoute()
  const openUrl = useOpenUrl()
  if (route.key != 'draft') throw new Error('DraftPage must have draft route')
  const importWebFile = trpc.webImporting.importWebFile.useMutation()
  const [isDragging, setIsDragging] = useState(false)
  const [showCover, setShowCover] = useState(false)
  const showOutline =
    typeof state.context.metadata.showOutline == 'undefined' ||
    state.context.metadata.showOutline

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

  const {
    showSidebars,
    elementRef,
    showCollapsed,
    mainContentProps,
    sidebarProps,
    wrapperProps,
  } = useDocumentLayout({
    contentWidth: state.context.metadata.contentWidth || 'M',
    showSidebars: showOutline && !isHomeDoc,
  })

  useEffect(() => {
    let val = !!cover
    if (val != showCover) {
      setShowCover(val)
    }
  }, [cover])

  useEffect(() => {
    if (!id?.id) return
    return subscribeDraftFocus(id.id, (blockId: string) => {
      if (editor) {
        editor._tiptapEditor.commands.focus('end', {scrollIntoView: true})
        editor.setTextCursorPosition(blockId, 'end')
      }
    })
  }, [id])

  const contacts = useSelectedAccountContacts()

  // @ts-expect-error
  if (state.matches('editing'))
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
        className="flex flex-1 flex-col overflow-hidden"
      >
        <ScrollArea onScroll={() => dispatchScroll(true)}>
          <AppDocContentProvider
            // onBlockCopy={onBlockCopy} // todo: allow copy block when editing doc
            importWebFile={importWebFile}
            contacts={contacts.data}
          >
            <DraftCover
              draftActor={actor}
              // @ts-expect-error
              disabled={!state.matches('editing')}
              show={showCover}
              // @ts-expect-error
              setShow={setShowCover}
              showOutline={showOutline}
            />
            <div ref={elementRef} className="draft-editor w-full flex-1">
              <div {...wrapperProps}>
                {showSidebars ? (
                  <div
                    // @ts-expect-error
                    className={showCover ? 'mt-[152px]' : 'mt-[220px]'}
                    onClick={(e) => e.stopPropagation()}
                    {...sidebarProps}
                  >
                    <DocNavigationDraftLoader
                      showCollapsed={showCollapsed}
                      id={id}
                    />
                  </div>
                ) : null}
                <div {...mainContentProps}>
                  {!isHomeDoc ? (
                    <DraftMetadataEditor
                      draftActor={actor}
                      onEnter={() => {
                        editor._tiptapEditor.commands.focus()
                        editor._tiptapEditor.commands.setTextSelection(0)
                      }}
                      // disabled={!state.matches('ready')}
                      showCover={showCover}
                      setShowCover={setShowCover}
                    />
                  ) : null}
                  <Container
                    // @ts-expect-error
                    paddingLeft="$4"
                    marginBottom={300}
                    onClick={(e: MouseEvent<HTMLDivElement>) => {
                      // this prevents to fire handleFocusAtMousePos on click
                      e.stopPropagation()
                      // editor?._tiptapEditor.commands.focus()
                    }}
                  >
                    {editor ? (
                      <HyperMediaEditorView editor={editor} openUrl={openUrl} />
                    ) : null}
                  </Container>
                </div>
                {showSidebars ? <div {...sidebarProps} /> : null}
              </div>
            </div>
          </AppDocContentProvider>
        </ScrollArea>
      </div>
    )

  return null

  function onDrop(event: DragEvent) {
    if (!isDragging) return
    const dataTransfer = event.dataTransfer

    if (dataTransfer?.files && dataTransfer.files.length > 0) {
      handleDragMedia(
        dataTransfer.files,
        // @ts-expect-error
        (type, fileCID) => {
          console.log('==== MEDIA UPLOAD', type, fileCID)
          let mediaBlock = {
            id: generateBlockId(),
            type: type,
            props: {
              url: `ipfs://${fileCID}`,
              name: '',
            },
            content: [],
            children: [],
          }
          editor.insertBlocks(
            [mediaBlock],
            // @ts-expect-error
            editor._tiptapEditor.state.selection,
          )
        },
        chromiumSupportedImageMimeTypes,
        chromiumSupportedVideoMimeTypes,
      )
      setIsDragging(false)
      return
    }

    const urls = Array.from(
      new Set(dataTransfer?.getData('text/plain')?.split('\n') || []),
    ).map((u) => u.trim())

    urls.forEach((url) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        importWebFile.mutate(
          // @ts-expect-error
          {url},
          {
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
          },
        )
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

  // function onBlockCopy(
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
  siteHomeEntity: HMEntityContent | undefined | null
  docId: UnpackedHypermediaId
  document?: HMDocument
  draftMetadata: HMMetadata
  isEditingHomeDoc: boolean
  onDocNav: (navigation: HMNavigationItem[]) => void
  actor: any // TODO: proper type
}) {
  const dir = useListDirectory(docId, {mode: 'Children'})
  const currentDocNav: HMNavigationItem[] | undefined = useSelector(
    actor,
    (s: any) => s.context.navigation,
  )
  const navItems = useSiteNavigationItems(siteHomeEntity)?.filter(
    (item) => !item.draftId,
  )
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
      originHomeId={siteHomeEntity.id}
      items={displayNavItems}
      docId={docId}
      document={document}
      // @ts-expect-error
      draftMetadata={draftMetadata}
      isCenterLayout={
        siteHomeEntity.document?.metadata.theme?.headerLayout === 'Center' ||
        siteHomeEntity.document?.metadata.layout ===
          'Seed/Experimental/Newspaper'
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
      supportQueries={[
        {
          in: siteHomeEntity.id,
          results: dir.data || [],
        },
      ]}
      supportDocuments={[siteHomeEntity]}
    />
  )
}

function DraftMetadataEditor({
  onEnter,
  draftActor,
  disabled = false,
  showCover = false,
  setShowCover,
}: {
  onEnter: () => void
  draftActor: ActorRefFrom<typeof draftMachine>
  disabled?: boolean
  showCover?: boolean
  setShowCover?: (show: boolean) => void
}) {
  const route = useNavRoute()
  if (route.key !== 'draft')
    throw new Error('DraftHeader must have draft route')

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
                const isHyphen =
                  name.slice(-1) === '-' && newName.slice(-1) === '-'
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
                const isHyphen =
                  summary.slice(-1) === '-' && newSummary.slice(-1) === '-'
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
          {}
          <Separator />
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
  if (route.key !== 'draft')
    throw new Error('DraftHeader must have draft route')

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
  // const latestDoc = useSubscribedResource(willEditDocId)

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
