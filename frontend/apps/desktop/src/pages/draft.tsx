import {AccessoryLayout} from '@/components/accessory-sidebar'
import {CoverImage} from '@/components/cover-image'
import {DocNavigationDraftLoader} from '@/components/doc-navigation'
import {useDocumentAccessory} from '@/components/document-accessory'
import {EditNavPopover} from '@/components/edit-navigation-popover'
import {HyperMediaEditorView} from '@/components/editor'
import {subscribeDraftFocus} from '@/draft-focusing'
import {useDraft} from '@/models/accounts'
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
import {BlockNoteEditor, getBlockInfoFromPos} from '@shm/editor/blocknote'
import {dispatchScroll} from '@shm/editor/editor-on-scroll-stream'
import '@shm/editor/editor.css'
import {
  chromiumSupportedImageMimeTypes,
  chromiumSupportedVideoMimeTypes,
  generateBlockId,
} from '@shm/editor/utils'
import {
  HMDocument,
  HMEntityContent,
  HMMetadata,
  HMNavigationItem,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {DraftRoute} from '@shm/shared/routes'
import '@shm/shared/styles/document.css'
import {hmId, packHmId, unpackHmId} from '@shm/shared/utils'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {useDocContentContext} from '@shm/ui/document-content'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {useDocumentLayout} from '@shm/ui/layout'
import {DocNavigationItem} from '@shm/ui/navigation'
import {Separator} from '@shm/ui/separator'
import {SiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {useIsDark} from '@shm/ui/use-is-dark'
import {cn} from '@shm/ui/utils'
import {useSelector} from '@xstate/react'
import {Selection} from 'prosemirror-state'
import {useEffect, useMemo, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {GestureResponderEvent} from 'react-native'
import {Button, Input, XStack, YStack} from 'tamagui'
import {ActorRefFrom} from 'xstate'
import {useShowTitleObserver} from './app-title'
import {AppDocContentProvider} from './document-content-provider'
import './draft-page.css'
export default function DraftPage() {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  if (route.key != 'draft') throw new Error('DraftPage must have draft route')

  const {data, editor, send, state, actor} = useDraftEditor()

  const locationId = useMemo(() => {
    if (route.key != 'draft') return undefined
    if (data?.locationId) return data.locationId
    if (route.locationUid)
      return hmId('d', route.locationUid, {path: route.locationPath})
    if (data?.locationUid)
      return hmId('d', data.locationUid, {
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
    if (data?.editId) return data.editId
    if (route.editUid) return hmId('d', route.editUid, {path: route.editPath})
    if (data?.editUid) return hmId('d', data.editUid, {path: data.editPath})
    return undefined
  }, [route, data])

  const isEditingHomeDoc = useMemo(() => {
    if (editId && (editId.path?.length ?? 0) === 0) return true
    return false
  }, [locationId, editId])

  const homeId = useMemo(() => {
    if (locationId) {
      return hmId('d', locationId.uid, {path: []})
    }
    if (editId) {
      return hmId('d', editId.uid, {path: []})
    }
    return undefined
  }, [locationId, editId])

  const homeEntity = useEntity(homeId)

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
      <div className="flex h-full flex-1">
        <AccessoryLayout
          accessory={accessory}
          accessoryKey={accessoryKey}
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
                  document={homeEntity.data?.document || undefined}
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
      return hmId('d', uId, {path})
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
        onDrop={onDrop}
        onClick={handleFocusAtMousePos}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <ScrollArea onScroll={() => dispatchScroll(true)}>
          <AppDocContentProvider
            // onBlockCopy={onBlockCopy} // todo: allow copy block when editing doc
            importWebFile={importWebFile}
          >
            <DraftCover
              draftActor={actor}
              disabled={!state.matches('editing')}
              show={showCover}
              setShow={setShowCover}
              showOutline={showOutline}
            />
            <YStack ref={elementRef} w="100%" f={1}>
              <XStack {...wrapperProps}>
                {showSidebars ? (
                  <YStack
                    marginTop={showCover ? 152 : 220}
                    onPress={(e) => e.stopPropagation()}
                    {...sidebarProps}
                  >
                    <DocNavigationDraftLoader
                      showCollapsed={showCollapsed}
                      id={id}
                    />
                  </YStack>
                ) : null}
                <YStack {...mainContentProps}>
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
                    paddingLeft="$4"
                    marginBottom={300}
                    onPress={(e: GestureResponderEvent) => {
                      // this prevents to fire handleFocusAtMousePos on click
                      e.stopPropagation()
                      // editor?._tiptapEditor.commands.focus()
                    }}
                  >
                    {editor ? (
                      <HyperMediaEditorView editor={editor} openUrl={openUrl} />
                    ) : null}
                  </Container>
                </YStack>
                {showSidebars ? <YStack {...sidebarProps} /> : null}
              </XStack>
            </YStack>
          </AppDocContentProvider>
        </ScrollArea>
      </div>
    )

  return null

  function onDrop(event: DragEvent) {
    if (!isDragging) return
    const dataTransfer = event.dataTransfer

    if (dataTransfer) {
      const ttEditor = (editor as BlockNoteEditor)._tiptapEditor
      const files: File[] = []

      if (dataTransfer.files.length) {
        for (let i = 0; i < dataTransfer.files.length; i++) {
          files.push(dataTransfer.files[i])
        }
      } else if (dataTransfer.items.length) {
        for (let i = 0; i < dataTransfer.items.length; i++) {
          const item = dataTransfer.items[i].getAsFile()
          if (item) {
            files.push(item)
          }
        }
      }

      if (files.length > 0) {
        const editorElement = document.getElementsByClassName(
          'mantine-Editor-root',
        )[0]
        const editorBoundingBox = editorElement.getBoundingClientRect()
        const posAtCoords = ttEditor.view.posAtCoords({
          left: editorBoundingBox.left + editorBoundingBox.width / 2,
          top: event.clientY,
        })
        let pos: number | null
        if (posAtCoords && posAtCoords.inside !== -1) pos = posAtCoords.pos
        else if (event.clientY > editorBoundingBox.bottom)
          pos = ttEditor.view.state.doc.content.size - 4

        let lastId: string

        // using reduce so files get inserted sequentially
        files.reduce((previousPromise, file, index) => {
          return previousPromise.then(() => {
            event.preventDefault()
            event.stopPropagation()

            if (pos) {
              return handleDragMedia(file).then((props) => {
                if (!props) return false

                const {state} = ttEditor.view
                let blockNode
                const newId = generateBlockId()

                if (chromiumSupportedImageMimeTypes.has(file.type)) {
                  blockNode = {
                    id: newId,
                    type: 'image',
                    props: {
                      url: props.url,
                      name: props.name,
                    },
                  }
                } else if (chromiumSupportedVideoMimeTypes.has(file.type)) {
                  blockNode = {
                    id: newId,
                    type: 'video',
                    props: {
                      url: props.url,
                      name: props.name,
                    },
                  }
                } else {
                  blockNode = {
                    id: newId,
                    type: 'file',
                    props: {
                      ...props,
                    },
                  }
                }

                const blockInfo = getBlockInfoFromPos(state, pos)

                if (index === 0) {
                  ;(editor as BlockNoteEditor).insertBlocks(
                    [blockNode],
                    blockInfo.block.node.attrs.id,
                    // blockInfo.node.textContent ? 'after' : 'before',
                    'after',
                  )
                } else {
                  ;(editor as BlockNoteEditor).insertBlocks(
                    [blockNode],
                    lastId,
                    'after',
                  )
                }

                lastId = newId
              })
            }
          })
        }, Promise.resolve())
        // .then(() => true) // TODO: @horacio ask Iskak about this
        setIsDragging(false)
        return true
      }
      setIsDragging(false)
      return false
    }
    setIsDragging(false)

    return false
  }

  // function onBlockCopy(
  //   blockId: string,
  //   blockRange: BlockRange | ExpandedBlockRange | undefined,
  // ) {
  //   const gwUrl = useGatewayUrl()

  //   if (!id) throw new Error('draft route id is missing')

  //   if (!id?.uid) throw new Error('uid could not be extracted from draft route')
  //   copyUrlToClipboardWithFeedback(
  //     createWebHMUrl(id.type, id.uid, {
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
  const dir = useListDirectory(siteHomeEntity?.id)
  const currentDocNav: HMNavigationItem[] | undefined = useSelector(
    actor,
    (s: any) => s.context.navigation,
  )
  const navItems = useSiteNavigationItems(siteHomeEntity)?.filter(
    (item) => !item.draftId,
  )

  if (!siteHomeEntity) return null

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

  const siteHomeMetadata = isEditingHomeDoc
    ? draftMetadata
    : siteHomeEntity.document?.metadata

  return (
    <SiteHeader
      originHomeId={siteHomeEntity.id}
      items={displayNavItems}
      document={
        isEditingHomeDoc && document
          ? {...document, metadata: draftMetadata}
          : document || undefined
      }
      docId={docId}
      isCenterLayout={
        siteHomeMetadata?.theme?.headerLayout === 'Center' ||
        siteHomeMetadata?.layout === 'Seed/Experimental/Newspaper'
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
  const {textUnit} = useDocContentContext()
  const [showIcon, setShowIcon] = useState(false)

  const isDark = useIsDark()
  const name = useSelector(draftActor, (s) => {
    return s.context.metadata.name
  })
  const icon = useSelector(draftActor, (s) => {
    return s.context.metadata.icon
  })
  const stateEditUid = useSelector(draftActor, (s) => {
    return s.context.editUid
  })
  const input = useRef<HTMLTextAreaElement | null>(null)
  const editUid = route.editUid || stateEditUid

  useShowTitleObserver(input.current)

  useEffect(() => {
    // handle the initial size of the title
    const target = input.current
    if (!target) return
    applyTitleResize(target)
    draftActor.send({
      type: 'set.nameRef',
      nameRef: target,
    })
  }, [input.current])

  useEffect(() => {
    const target = input.current
    if (!target) return
    if (target.value !== name) {
      // handle cases where the model has a different title. this happens when pasting multiline text into the title
      target.value = name || ''
      applyTitleResize(target)
    }
  }, [name])

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
      const target = input.current
      if (!target) return
      applyTitleResize(target)
    }
  }, [input.current])

  return (
    <YStack
      onPress={(e: MouseEvent) => {
        e.stopPropagation()
      }}
    >
      <Container
        animation="fast"
        marginTop={showCover ? -40 : 0}
        paddingTop={!showCover ? 60 : '$6'}
        // bg="$background"
        bg={isDark ? '$background' : '$backgroundStrong'}
        borderRadius="$2"
      >
        <YStack group="header" gap="$4">
          <Input
            disabled={disabled}
            // we use multiline so that we can avoid horizontal scrolling for long titles
            multiline
            id="draft-name-input"
            ref={input}
            onKeyPress={(e: any) => {
              if (e.nativeEvent.key == 'Enter') {
                e.preventDefault()
                onEnter()
              }
            }}
            size="$9"
            borderRadius="$1"
            borderWidth={0}
            overflow="hidden" // trying to hide extra content that flashes when pasting multi-line text into the title
            flex={1}
            backgroundColor="transparent"
            fontWeight="bold"
            fontFamily="$body"
            onChange={(e: any) => {
              applyTitleResize(e.target as HTMLTextAreaElement)
            }}
            outlineColor="transparent"
            borderColor="transparent"
            defaultValue={name?.trim() || ''} // this is still a controlled input because of the value comparison in useLayoutEffect
            // value={title}
            onChangeText={(newName: string) => {
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
            padding={0}
          />
          <Separator />
        </YStack>
      </Container>
    </YStack>
  )
}

function DraftCover({
  draftActor,
  disabled = false,
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

  const input = useRef<HTMLTextAreaElement | null>(null)

  useShowTitleObserver(input.current)

  useEffect(() => {
    // handle the initial size of the title
    const target = input.current
    if (!target) return
    applyTitleResize(target)
    draftActor.send({
      type: 'set.nameRef',
      nameRef: target,
    })
  }, [input.current])

  return (
    <YStack
      onPress={(e: MouseEvent) => {
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
        id={route.id}
      />
    </YStack>
  )
}

function DraftRebaseBanner() {
  const [isRebasing, setIsRebasing] = useState(false)
  // const willEditDocId = getDraftEditId(draftData)
  // const latestDoc = useSubscribedEntity(willEditDocId)

  async function performRebase() {
    //   setIsRebasing(true)
    //   if (latestDoc.data?.document) {
    //     handleRebase(latestDoc.data).then(() => {
    //       setIsRebasing(false)
    //     })
    //   }
    //   // console.log('performRebase', {
    //   //   draft: draft?.content,
    //   //   document: latestDoc.data?.document,
    //   // })
    // }
    // const draftPrevId = draftData?.draft.previousId
    // async function performRebase() {
    //   setIsRebasing(true)
    // if (latestDoc.data?.document) {
    //   handleRebase(latestDoc.data).then(() => {
    //     setIsRebasing(false)
    //   })
    // }
    // console.log('performRebase', {
    //   draft: draft?.content,
    //   document: latestDoc.data?.document,
    // })
  }

  return false ? (
    <XStack
      theme="yellow"
      bg="$backgroundHover"
      ai="center"
      jc="center"
      p="$3"
      gap="$4"
    >
      <SizableText size="sm">
        A new change has been published to this document.{' '}
      </SizableText>
      <Button bg="$backgroundFocus" size="$2" onPress={() => performRebase()}>
        {isRebasing ? <Spinner /> : 'Merge'}
      </Button>
    </XStack>
  ) : null
}

function applyTitleResize(target: HTMLTextAreaElement) {
  // Reset the height first to get the correct scrollHeight
  target.style.height = '0'
  // Set the height to the scrollHeight to fit the content
  target.style.height = `${target.scrollHeight}px`
}
