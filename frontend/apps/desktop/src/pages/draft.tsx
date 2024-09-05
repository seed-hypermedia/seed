import {ThumbnailForm} from '@/components/avatar-form'
import {CoverImage} from '@/components/cover-image'
import {HyperMediaEditorView} from '@/components/editor'
import Footer from '@/components/footer'
import {MainWrapper} from '@/components/main-wrapper'
import {subscribeDraftFocus} from '@/draft-focusing'
import {BlockNoteEditor, getBlockInfoFromPos} from '@/editor'
import {useDraft} from '@/models/accounts'
import {useDraftEditor} from '@/models/documents'
import {draftMachine} from '@/models/draft-machine'
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
import {
  BlockRange,
  createWebHMUrl,
  ExpandedBlockRange,
  getFileUrl,
  HMDraft,
  hmId,
  packHmId,
} from '@shm/shared'
import {
  Button,
  Container,
  copyUrlToClipboardWithFeedback,
  Input,
  Separator,
  SizableText,
  useDocContentContext,
  useHeadingTextStyles,
  XStack,
} from '@shm/ui'
import {Image, Smile} from '@tamagui/lucide-icons'
import {useSelector} from '@xstate/react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {YStack} from 'tamagui'
import {ActorRefFrom} from 'xstate'
import {useShowTitleObserver} from './app-title'
import {AppDocContentProvider} from './document-content-provider'
import './draft-page.css'

export default function DraftPage() {
  const route = useNavRoute()

  const importWebFile = trpc.webImporting.importWebFile.useMutation()
  const [isDragging, setIsDragging] = useState(false)
  if (route.key != 'draft') throw new Error('DraftPage must have draft route')

  let data = useDraftEditor({
    id: route.id,
  })

  // useEffect(() => {
  //   const intervalFn = () => {
  //     if (data.state.matches({ready: 'idle'})) {
  //       // data.editor.replaceBlocks(data.editor.topLevelBlocks, [
  //       //   {
  //       //     id: nanoid(8),
  //       //     type: 'paragraph',
  //       //     props: {
  //       //       textAlignment: 'left',
  //       //       diff: 'undefined',
  //       //     },
  //       //     content: [
  //       //       {
  //       //         type: 'text',
  //       //         text: 'asdasd',
  //       //         styles: {},
  //       //       },
  //       //     ],
  //       //     children: [],
  //       //   },
  //       //   ...data.editor.topLevelBlocks,
  //       // ])
  //       console.log('data.editor.topLevelBlocks', data.editor.topLevelBlocks)
  //     }
  //   }
  //   let interval = setInterval(intervalFn, 1000)

  //   if (interval) {
  //     clearInterval(interval)
  //     interval = setInterval(intervalFn, 1000)
  //   }

  //   return () => clearInterval(interval)
  // }, [data.state])

  useEffect(() => {
    if (!route.id?.id) return
    return subscribeDraftFocus(route.id?.id, (blockId: string) => {
      if (data.editor) {
        data.editor._tiptapEditor.commands.focus()
        data.editor.setTextCursorPosition(blockId, 'start')
      }
    })
  }, [route.id?.id, data.editor, route.id?.id])

  if (data.state.matches('ready')) {
    return (
      <ErrorBoundary FallbackComponent={() => null}>
        <MainWrapper
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
          onPress={data.handleFocusAtMousePos}
        >
          <AppDocContentProvider
            disableEmbedClick
            onCopyBlock={onCopyBlock}
            importWebFile={importWebFile}
            docId={route.id}
          >
            <DraftHeader
              draftActor={data.actor}
              onEnter={() => {
                data.editor._tiptapEditor.commands.focus()
                data.editor._tiptapEditor.commands.setTextSelection(0)
              }}
              disabled={!data.state.matches('ready')}
            />
            <Container
              paddingLeft="$10"
              marginBottom={300}
              $gtSm={{
                paddingLeft: '$4',
              }}
              onPress={(e: MouseEvent) => {
                // this prevents to fire handleFocusAtMousePos on click
                e.stopPropagation()
                // data.editor?._tiptapEditor.commands.focus()
              }}
            >
              {data.editor ? (
                <HyperMediaEditorView editable={true} editor={data.editor} />
              ) : null}
            </Container>
          </AppDocContentProvider>
        </MainWrapper>
        <Footer />
      </ErrorBoundary>
    )
  }

  return null

  // ==========

  function onDrop(event: DragEvent) {
    if (!isDragging) return
    const dataTransfer = event.dataTransfer

    if (dataTransfer) {
      const ttEditor = (data.editor as BlockNoteEditor)._tiptapEditor
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

                  const blockInfo = getBlockInfoFromPos(state.doc, pos)

                  if (index === 0) {
                    ;(data.editor as BlockNoteEditor).insertBlocks(
                      [blockNode],
                      blockInfo.id,
                      // blockInfo.node.textContent ? 'after' : 'before',
                      'after',
                    )
                  } else {
                    ;(data.editor as BlockNoteEditor).insertBlocks(
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
    if (route.key != 'draft') throw new Error('DraftPage must have draft route')
    if (!route.id) throw new Error('draft route id is missing')

    if (!route.id?.uid)
      throw new Error('uid could not be extracted from draft route')
    copyUrlToClipboardWithFeedback(
      createWebHMUrl(route.id.type, route.id.uid, {
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
}: {
  onEnter: () => void
  draftActor: ActorRefFrom<typeof draftMachine>
  disabled?: boolean
}) {
  const route = useNavRoute()
  if (route.key !== 'draft')
    throw new Error('DraftHeader must have draft route')
  const {textUnit} = useDocContentContext()
  const [showThumbnail, setShowThumbnail] = useState(false)
  const [showCover, setShowCover] = useState(false)
  let headingTextStyles = useHeadingTextStyles(1, textUnit)
  const name = useSelector(draftActor, (s) => {
    return s.context.name
  })

  const thumbnail = useSelector(draftActor, (s) => {
    return s.context.thumbnail
  })

  const cover = useSelector(draftActor, (s) => {
    return s.context.cover
  })

  const input = useRef<HTMLTextAreaElement | null>(null)
  useShowTitleObserver(input.current)
  useEffect(() => {
    // handle the initial size of the title
    const target = input.current
    if (!target) return
    applyTitleResize(target)
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
    let val = !!cover
    if (val != showCover) {
      setShowCover(val)
    }
  }, [cover])

  useEffect(() => {
    let val = !!thumbnail
    if (val != showThumbnail) {
      setShowThumbnail(val)
    }
  }, [thumbnail])

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
      <CoverImage
        show={showCover}
        onCoverUpload={(cover) => {
          if (cover) {
            draftActor.send({
              type: 'CHANGE',
              cover: `ipfs://${cover}`,
            })
          }
        }}
        onRemoveCover={() => {
          setShowCover(false)
          draftActor.send({
            type: 'CHANGE',
            cover: null,
          })
        }}
        url={cover ? getFileUrl(cover) : ''}
        id={route.id?.id}
      />

      <Container
        animation="fast"
        marginTop={showCover ? -40 : 0}
        paddingTop={!showCover ? 60 : '$6'}
        bg="$background"
        borderRadius="$2"
      >
        <YStack group="header" gap="$4">
          <XStack gap="$2" ai="flex-end">
            {showThumbnail ? (
              <ThumbnailForm
                borderRadius={
                  route.id?.path && route.id?.path.length != 0
                    ? 100 / 8
                    : undefined
                }
                marginTop={showCover ? -80 : 0}
                size={100}
                id={route.id ? route.id.uid : 'document-avatar'}
                label={name}
                url={thumbnail ? getFileUrl(thumbnail) : ''}
                onAvatarUpload={(thumbnail) => {
                  if (thumbnail) {
                    draftActor.send({
                      type: 'CHANGE',
                      thumbnail: `ipfs://${thumbnail}`,
                    })
                  }
                }}
                onRemoveThumbnail={() => {
                  setShowThumbnail(false)
                  draftActor.send({
                    type: 'CHANGE',
                    thumbnail: null,
                  })
                }}
              />
            ) : null}
            {!showThumbnail ? (
              <Button
                icon={Smile}
                size="$1"
                chromeless
                hoverStyle={{bg: '$color5'}}
                onPress={() => setShowThumbnail(true)}
              >
                Add Thumbnail
              </Button>
            ) : null}
            {!showCover ? (
              <Button
                hoverStyle={{bg: '$color5'}}
                icon={Image}
                size="$1"
                chromeless
                onPress={() => setShowCover(true)}
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
            paddingLeft={9.6}
            defaultValue={name?.trim() || ''} // this is still a controlled input because of the value comparison in useLayoutEffect
            // value={title}
            onChangeText={(name: string) => {
              // TODO: change title here
              draftActor.send({type: 'CHANGE', name})
            }}
            placeholder="Untitled Document"
            {...headingTextStyles}
            padding={0}
          />
          {route.id?.path?.length ? (
            <XStack marginTop="$3" gap="$3">
              {route.id?.path?.length ? (
                <PathDraft draftActor={draftActor} />
              ) : null}
            </XStack>
          ) : null}

          <Separator borderColor="$color8" />
        </YStack>
      </Container>
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
}: {
  draftActor: ActorRefFrom<typeof draftMachine>
}) {
  const route = useNavRoute()
  if (route.key != 'draft') throw new Error('not a draft')
  const replaceRoute = useNavigate('replace')

  const draftContext = useSelector(draftActor, (s) => s.context)
  const name = useMemo(() => draftContext.name, [draftContext])
  const routePath = useMemo(() => route.id?.path, [route])
  const [isDirty, setDirty] = useState(false)
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
    if (route.key != 'draft' && !route.id) return
    const newId = hmId('d', route.id.uid, {path: [...paths, path]})
    const packedId = packHmId(newId)

    let newContent = {
      metadata: {
        name: draftContext.name,
        cover: draftContext.cover,
        thumbnail: draftContext.thumbnail,
      },
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
            />
            <SizableText
              size="$2"
              color="$blue9"
              userSelect="none"
              hoverStyle={{textDecorationLine: 'underline', cursor: 'pointer'}}
              onPress={handleDraftChange}
            >
              Apply
            </SizableText>
            <SizableText
              size="$2"
              color="$red9"
              userSelect="none"
              hoverStyle={{textDecorationLine: 'underline', cursor: 'pointer'}}
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
        ) : (
          <>
            <SizableText
              flexGrow={0}
              flexShrink={0}
              size="$2"
              color="$blue9"
              userSelect="none"
              hoverStyle={{textDecorationLine: 'underline', cursor: 'pointer'}}
              onPress={() => {
                setDirty(true)
                setEditing(true)
              }}
            >
              Edit
            </SizableText>
          </>
        )}
      </XStack>
    </XStack>
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
