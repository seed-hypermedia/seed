import {AccessoryLayout} from '@/components/accessory-sidebar'
import {CoverImage} from '@/components/cover-image'
import {HyperMediaEditorView} from '@/components/editor'
import {IconForm} from '@/components/icon-form'
import {SidebarSpacer} from '@/components/main-wrapper'
import {OptionsPanel} from '@/components/options-panel'
import {SiteNavigationDraftLoader} from '@/components/site-navigation'
import {subscribeDraftFocus} from '@/draft-focusing'
import {useDraft} from '@/models/accounts'
import {
  useAccountDraftList,
  useCreateDraft,
  useDraftEditor,
  useListDirectory,
} from '@/models/documents'
import {draftMachine} from '@/models/draft-machine'
import {useSubscribedEntity} from '@/models/entities'
import {useGatewayUrl} from '@/models/gateway-settings'
import {trpc} from '@/trpc'
import {
  chromiumSupportedImageMimeTypes,
  chromiumSupportedVideoMimeTypes,
  generateBlockId,
  handleDragMedia,
} from '@/utils/media-drag'
import {useNavRoute} from '@/utils/navigation'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {BlockNoteEditor, getBlockInfoFromPos} from '@shm/editor/blocknote'
import {useEntity} from '@shm/shared/models/entity'
import '@shm/shared/styles/document.css'
import {validatePath} from '@shm/shared/utils/document-path'
import {Button} from '@shm/ui/button'
import {Container} from '@shm/ui/container'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {
  useDocContentContext,
  useHeadingTextStyles,
} from '@shm/ui/document-content'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {Options} from '@shm/ui/icons'
import {getSiteNavDirectory} from '@shm/ui/navigation'
import {SiteHeader} from '@shm/ui/site-header'
import {Heading, Input, Separator, SizableText, XStack} from 'tamagui'

import {Image, MoreHorizontal, Plus, Smile} from '@tamagui/lucide-icons'
import {useSelector} from '@xstate/react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {GestureResponderEvent} from 'react-native'
// import 'show-keys'
import {ImportDropdownButton} from '@/components/import-doc-button'
import {EmbedToolbarProvider} from '@/editor/embed-toolbar-context'
import {useOpenUrl} from '@/open-url'
import {
  HMBlockNode,
  HMDocument,
  HMDraft,
  HMEntityContent,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {
  BlockRange,
  createWebHMUrl,
  ExpandedBlockRange,
  hmId,
  packHmId,
} from '@shm/shared/utils/entity-id-url'
import {Spinner} from '@shm/ui/spinner'
import {YStack} from 'tamagui'
import {ActorRefFrom} from 'xstate'
import {useShowTitleObserver} from './app-title'
import {AppDocContentProvider} from './document-content-provider'
import './draft-page.css'

import {upgradeNewspaperLayoutModel} from '@/models/upgrade-document-model'
import {dispatchScroll} from '@shm/editor/editor-on-scroll-stream'
import {useDocumentLayout} from '@shm/ui/layout'
import {dialogBoxShadow} from '@shm/ui/universal-dialog'
export default function DraftPage() {
  const route = useNavRoute()

  if (route.key != 'draft') throw new Error('DraftPage must have draft route')

  const [accessoryKey, setAccessory] = useState<undefined | 'options'>(
    undefined,
  )

  const draft = useDraft(route.id)
  let data = useDraftEditor({
    id: route.id,
  })

  const {shouldRebase, performRebase, isRebasing} = useDraftRebase({
    currentId: route.id,
    draftId: draft.data?.previousId,
    draft: draft.data,
    document: data.state.context.entity?.document,
    handleRebase: data.handleRebase,
  })

  let accessory = null

  if (accessoryKey == 'options' && route.id) {
    accessory = (
      <OptionsPanel
        metadata={data.state.context.metadata}
        onMetadata={(metadata) => {
          if (!draft.data) return
          data.actor.send({type: 'CHANGE', metadata})
        }}
        onClose={() => setAccessory(undefined)}
        draftId={route.id}
        onResetContent={(blockNodes: HMBlockNode[]) => {
          data.actor.send({type: 'RESET.CONTENT', blockNodes})
        }}
      />
    )
  }
  const isNewspaperLayout =
    data.state.context.metadata.layout === 'Seed/Experimental/Newspaper'
  const accessoryOptions: {
    key: 'options'
    label: string
    icon?: null | React.FC<{
      color: string
      size?: number
    }>
  }[] = []

  accessoryOptions.push({
    key: 'options',
    label: 'Options',
    icon: Options,
  })

  const homeEntity = useEntity(hmId('d', route.id.uid))

  const documentEditorContent = (
    <>
      {shouldRebase ? (
        <XStack
          theme="yellow"
          bg="$backgroundHover"
          ai="center"
          jc="center"
          p="$3"
          gap="$4"
        >
          <SizableText size="$2">
            A new change has been published to this document.{' '}
          </SizableText>
          <Button
            bg="$backgroundFocus"
            size="$2"
            onPress={() => performRebase()}
          >
            {isRebasing ? <Spinner /> : 'Merge'}
          </Button>
        </XStack>
      ) : null}
      <DraftAppHeader
        siteHomeMetadata={
          route.id.path?.length
            ? homeEntity.data?.document?.metadata
            : draft.data?.metadata
        }
        siteHomeEntity={homeEntity.data}
        docId={route.id}
        document={homeEntity.data?.document || undefined}
      >
        <DocumentEditor {...data} id={route.id} />
      </DraftAppHeader>
    </>
  )

  return (
    <ErrorBoundary FallbackComponent={() => null}>
      <XStack flex={1} height="100%">
        <SidebarSpacer />
        <AccessoryLayout
          accessory={accessory}
          accessoryKey={accessoryKey}
          onAccessorySelect={(key: typeof accessoryKey) => {
            setAccessory(key)
          }}
          accessoryOptions={accessoryOptions}
        >
          {isNewspaperLayout ? (
            <YStack f={1} ai="center" jc="center" h="100%">
              <YStack
                theme="red"
                gap="$4"
                padding="$4"
                backgroundColor="$red3"
                borderRadius="$4"
                boxShadow={dialogBoxShadow}
              >
                <Heading size="$3" fontSize="$4">
                  Document Model Upgrade Required
                </Heading>
                <Button
                  onPress={() => {
                    upgradeNewspaperLayoutModel(
                      route.id,
                      (metadata) => {
                        data.actor.send({type: 'CHANGE', metadata})
                      },
                      (blockNodes: HMBlockNode[]) => {
                        data.actor.send({type: 'RESET.CONTENT', blockNodes})
                      },
                    )
                  }}
                >
                  Upgrade Document
                </Button>
              </YStack>
            </YStack>
          ) : (
            documentEditorContent
          )}
        </AccessoryLayout>
      </XStack>
    </ErrorBoundary>
  )
}

function DraftAppHeader({
  siteHomeMetadata,
  siteHomeEntity,
  docId,
  children,
  document,
}: {
  siteHomeMetadata: HMMetadata | undefined | null
  siteHomeEntity: HMEntityContent | undefined | null
  docId: UnpackedHypermediaId
  children?: React.ReactNode
  document?: HMDocument
}) {
  const dir = useListDirectory(siteHomeEntity?.id)
  const drafts = useAccountDraftList(docId.uid)
  if (!siteHomeEntity) return null
  const navItems = getSiteNavDirectory({
    id: siteHomeEntity.id,
    supportQueries: dir.data
      ? [{in: siteHomeEntity.id, results: dir.data}]
      : [],
    drafts: drafts.data,
  })
  // const draft = useDraft(docId)
  return (
    <SiteHeader
      onScroll={() => dispatchScroll('scroll')}
      homeId={siteHomeEntity.id}
      items={navItems}
      document={document || undefined}
      docId={docId}
      isCenterLayout={
        siteHomeMetadata?.theme?.headerLayout === 'Center' ||
        siteHomeMetadata?.layout === 'Seed/Experimental/Newspaper'
      }
      // document={draft} // we have an issue with outline: the header expects the draft to be in HMDocument format, but the draft is editor
      children={children}
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

function NewSubDocumentButton({
  parentDocId,
}: {
  parentDocId: UnpackedHypermediaId
}) {
  const createDraft = useCreateDraft(parentDocId)
  return (
    <>
      <Button icon={Plus} color="$green9" onPress={createDraft} size="$2">
        Create
      </Button>
      <ImportDropdownButton
        id={parentDocId}
        button={<Button size="$1" circular icon={MoreHorizontal} />}
      />
    </>
  )
}

function DocumentEditor({
  editor,
  state,
  actor,
  handleFocusAtMousePos,
  id,
}: ReturnType<typeof useDraftEditor> & {id: UnpackedHypermediaId}) {
  const route = useNavRoute()
  const openUrl = useOpenUrl()
  if (route.key != 'draft') throw new Error('DraftPage must have draft route')
  const importWebFile = trpc.webImporting.importWebFile.useMutation()
  const [isDragging, setIsDragging] = useState(false)
  const [showCover, setShowCover] = useState(false)
  const isHomeDoc = !route.id.path?.length
  const showOutline =
    typeof state.context.metadata.showOutline == 'undefined' ||
    state.context.metadata.showOutline

  const cover = useSelector(actor, (s) => s.context.metadata.cover)

  const {
    showSidebars,
    elementRef,
    showCollapsed,
    mainContentProps,
    sidebarProps,
    wrapperProps,
    contentMaxWidth,
  } = useDocumentLayout({
    contentWidth: state.context.metadata.contentWidth,
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
    return subscribeDraftFocus(id?.id, (blockId: string) => {
      if (editor) {
        editor._tiptapEditor.commands.focus('end', {scrollIntoView: true})
        editor.setTextCursorPosition(blockId, 'end')
      }
    })
  }, [id?.id, editor])

  if (state.matches('ready'))
    return (
      <YStack
        onDragStart={() => {
          setIsDragging(true)
        }}
        onDragEnd={() => {
          setIsDragging(false)
        }}
        onDragOver={(event: DragEvent) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDrop={onDrop}
        onPress={handleFocusAtMousePos}
      >
        <AppDocContentProvider
          disableEmbedClick
          onCopyBlock={onCopyBlock}
          importWebFile={importWebFile}
          docId={id}
        >
          <DraftCover
            draftActor={actor}
            disabled={!state.matches('ready')}
            show={showCover}
            setShow={setShowCover}
            showOutline={
              typeof state.context.metadata.showOutline == 'undefined'
                ? true
                : state.context.metadata.showOutline
            }
          />
          <YStack ref={elementRef} w="100%" f={1}>
            <XStack {...wrapperProps}>
              {showSidebars ? (
                <YStack
                  marginTop={showCover ? 152 : 220}
                  onPress={(e) => e.stopPropagation()}
                  {...sidebarProps}
                >
                  <SiteNavigationDraftLoader showCollapsed={showCollapsed} />
                </YStack>
              ) : null}
              <YStack {...mainContentProps}>
                {!isHomeDoc ? (
                  <DraftHeader
                    draftActor={actor}
                    onEnter={() => {
                      editor._tiptapEditor.commands.focus()
                      editor._tiptapEditor.commands.setTextSelection(0)
                    }}
                    disabled={!state.matches('ready')}
                    showCover={showCover}
                    setShowCover={setShowCover}
                  />
                ) : null}
                <EmbedToolbarProvider>
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
                </EmbedToolbarProvider>
              </YStack>
              {showSidebars ? <YStack {...sidebarProps} /> : null}
            </XStack>
          </YStack>
        </AppDocContentProvider>
      </YStack>
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
        files
          // @ts-expect-error
          .reduce((previousPromise, file, index) => {
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

  function onCopyBlock(
    blockId: string,
    blockRange: BlockRange | ExpandedBlockRange | undefined,
  ) {
    const gwUrl = useGatewayUrl()

    if (!id) throw new Error('draft route id is missing')

    if (!id?.uid) throw new Error('uid could not be extracted from draft route')
    copyUrlToClipboardWithFeedback(
      createWebHMUrl(id.type, id.uid, {
        blockRef: blockId,
        blockRange,
        hostname: gwUrl.data,
      }),
      'Block',
    )
  }
}

export function DraftHeader({
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
  let headingTextStyles = useHeadingTextStyles(1, textUnit)
  const name = useSelector(draftActor, (s) => {
    return s.context.metadata.name
  })
  const icon = useSelector(draftActor, (s) => {
    return s.context.metadata.icon
  })

  const prevDoc = useSelector(draftActor, (s) => s.context.entity?.document)

  const input = useRef<HTMLTextAreaElement | null>(null)

  useShowTitleObserver(input.current)

  useEffect(() => {
    // handle the initial size of the title
    const target = input.current
    if (!target) return
    applyTitleResize(target)
    draftActor.send({
      type: 'SET.NAME.REF',
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
        bg="$background"
        borderRadius="$2"
      >
        <YStack group="header" gap="$4">
          <XStack gap="$2" ai="flex-end">
            {showIcon ? (
              <IconForm
                borderRadius={
                  route.id?.path && route.id?.path.length != 0
                    ? 100 / 8
                    : undefined
                }
                marginTop={showCover ? -80 : 0}
                size={100}
                id={route.id ? route.id.uid : 'document-avatar'}
                label={name}
                url={icon ? getDaemonFileUrl(icon) : ''}
                onIconUpload={(icon) => {
                  if (icon) {
                    draftActor.send({
                      type: 'CHANGE',
                      metadata: {
                        icon: `ipfs://${icon}`,
                      },
                    })
                  }
                }}
                onRemoveIcon={() => {
                  setShowIcon(false)
                  draftActor.send({
                    type: 'CHANGE',
                    metadata: {
                      icon: null,
                    },
                  })
                }}
              />
            ) : null}
            {!showIcon ? (
              <Button
                icon={Smile}
                size="$1"
                chromeless
                hoverStyle={{bg: '$color5'}}
                onPress={() => setShowIcon(true)}
              >
                Add Icon
              </Button>
            ) : null}
            {!showCover ? (
              <Button
                hoverStyle={{bg: '$color5'}}
                icon={Image}
                size="$1"
                chromeless
                onPress={() => setShowCover?.(true)}
              >
                Add Cover
              </Button>
            ) : null}
          </XStack>
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
            backgroundColor="$color2"
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

              // TODO: change title here
              draftActor.send({
                type: 'CHANGE',
                metadata: {
                  name: newName,
                },
              })
            }}
            placeholder="Document Title"
            {...headingTextStyles}
            padding={0}
          />
          {route.id?.path?.length ? (
            <XStack marginTop="$3" gap="$3">
              {route.id?.path?.length ? (
                <PathDraft canEditPath={!prevDoc} draftActor={draftActor} />
              ) : null}
            </XStack>
          ) : null}

          <Separator borderColor="$color8" />
        </YStack>
      </Container>
    </YStack>
  )
}

export function DraftCover({
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
      type: 'SET.NAME.REF',
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
              type: 'CHANGE',
              metadata: {
                cover: `ipfs://${cover}`,
              },
            })
          }
        }}
        onRemoveCover={() => {
          setShowOutline?.(true)
          draftActor.send({
            type: 'CHANGE',
            metadata: {
              cover: '',
            },
          })
        }}
        url={cover ? getDaemonFileUrl(cover) : ''}
        id={route.id?.id}
      />
    </YStack>
  )
}

function applyTitleResize(target: HTMLTextAreaElement) {
  // without this, the scrollHeight doesn't shrink, so when the user deletes a long title it doesnt shrink back
  target.style.height = ''

  // here is the actual auto-resize
  target.style.height = `${target.scrollHeight}px`
}

function PathDraft({
  draftActor,
  canEditPath = true,
}: {
  draftActor: ActorRefFrom<typeof draftMachine>
  canEditPath: boolean
}) {
  const route = useNavRoute()
  if (route.key != 'draft') throw new Error('not a draft')
  const replaceRoute = useNavigate('replace')
  const input = useRef<HTMLTextAreaElement | null>(null)
  const draftContext = useSelector(draftActor, (s) => s.context)
  const name = useMemo(
    () => draftContext.metadata.name,
    [draftContext.metadata],
  )
  const routePath = useMemo(() => route.id?.path, [route])
  const [isDirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setEditing] = useState(false)
  const [paths, currentPath] = useMemo(
    () => separateLastItem(routePath),
    [routePath],
  )

  const {data: draft} = useDraft(route.id)
  const createDraft = trpc.drafts.write.useMutation()
  const deleteDraft = trpc.drafts.delete.useMutation()

  useEffect(() => {
    if (isDirty) return
    if (!!name && currentPath?.startsWith('_')) {
      setPath(pathNameify(name))
    }
  }, [name, isDirty])

  const [path, setPath] = useState('')

  async function handleDraftChange() {
    setError(null)
    if (route.key != 'draft') return
    const invalid = validatePath(path)
    if (invalid) {
      setError(invalid.error)
      input.current?.focus()
      return
    }
    const newId = hmId('d', route.id.uid, {path: [...paths, path]})
    const packedId = packHmId(newId)

    let newContent = {
      metadata: draftContext.metadata,
      signingAccount: draftContext.signingAccount,
      content: draft?.content || [],
    } as HMDraft

    await createDraft.mutateAsync({
      id: packedId,
      draft: newContent,
    })

    await deleteDraft.mutateAsync(packHmId(route.id))
    replaceRoute({...route, id: newId})
    setEditing(false)
  }

  return (
    <YStack>
      <XStack ai="center" gap="$2" f={1} w="100%">
        <SizableText size="$1">Path:</SizableText>
        <XStack ai="center" gap="$2" f={1}>
          {!isEditing || paths.length ? (
            <SizableText
              size="$2"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              overflow="hidden"
            >
              {paths.map((p) => `/${p}`)}
              {!isEditing ? `/${path || currentPath}` : ''}
            </SizableText>
          ) : null}

          {isEditing ? (
            <>
              <Input
                f={1}
                size="$1"
                value={path}
                onChangeText={(t: string) => setPath(pathNameify(t))}
                ref={input}
              />
              <SizableText
                size="$2"
                color="$brand5"
                userSelect="none"
                hoverStyle={{textDecorationLine: 'underline'}}
                onPress={handleDraftChange}
              >
                Apply
              </SizableText>
              <SizableText
                size="$2"
                color="$red9"
                userSelect="none"
                hoverStyle={{textDecorationLine: 'underline'}}
                onPress={() => {
                  if (!!name && path.startsWith('_')) {
                    setPath(pathNameify(name))
                  } else {
                    setPath(currentPath || '')
                  }
                  setDirty(false)
                  setEditing(false)
                }}
              >
                Cancel
              </SizableText>
            </>
          ) : canEditPath ? (
            <>
              <SizableText
                flexGrow={0}
                flexShrink={0}
                size="$2"
                color="$brand5"
                userSelect="none"
                hoverStyle={{textDecorationLine: 'underline'}}
                onPress={() => {
                  setDirty(true)
                  setEditing(true)
                }}
              >
                Edit
              </SizableText>
            </>
          ) : null}
        </XStack>
      </XStack>
      {error ? (
        <SizableText color="$red9" size="$2">
          {error}
        </SizableText>
      ) : null}
    </YStack>
  )
}

function separateLastItem(
  arr: string[] | null | undefined,
): [string[], string | undefined] {
  if (arr?.length == 0) {
    return [[], undefined]
  } else if (arr?.length == 1) {
    return [[], arr[0]]
  } else {
    const allButLast = arr!.slice(0, -1) // All elements except the last one
    const lastItem = arr![arr!.length - 1] // The last element

    return [allButLast, lastItem]
  }
}

function useDraftRebase({
  currentId,
  draftId,
  document,
  draft,
  handleRebase,
}: {
  currentId?: UnpackedHypermediaId | null
  draftId?: UnpackedHypermediaId | null
  document?: HMDocument | null
  draft?: HMDraft | null
  handleRebase: (newEntity: HMEntityContent) => Promise<void>
}) {
  const [isRebasing, setIsRebasing] = useState(false)
  const rebasedData = useSubscribedEntity(currentId)

  async function performRebase() {
    setIsRebasing(true)
    if (rebasedData.data?.document) {
      handleRebase(rebasedData.data).then(() => {
        setIsRebasing(false)
      })
    }

    // console.log('performRebase', {
    //   draft: draft?.content,
    //   document: rebasedData.data?.document,
    // })
  }

  return {
    isRebasing,
    shouldRebase:
      // Only show rebase if we have both versions and they don't match
      draftId?.version != null &&
      rebasedData.data?.id.version != null &&
      draftId.version !== rebasedData.data.id.version,
    performRebase,
  }
}
