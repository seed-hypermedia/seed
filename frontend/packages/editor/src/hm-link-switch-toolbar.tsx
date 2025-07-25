import {HMDocument, UnpackedHypermediaId} from '@shm/shared'
import {getDocumentTitle} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {
  CircleDot,
  ExternalLink,
  Link,
  PanelBottom,
  Pencil,
  Quote,
  Unlink,
} from '@tamagui/lucide-icons'
import {Fragment, Node} from '@tiptap/pm/model'
import {useEffect, useMemo, useState} from 'react'
import {Button, XGroup, XStack, YStack} from 'tamagui'
import {
  BlockNoteEditor,
  getBlockInfoFromPos,
  HyperlinkToolbarProps,
} from './blocknote'
import {getNodeById} from './blocknote/core/api/util/nodeUtil'
import {HypermediaLinkForm} from './hm-link-form'
import {HMBlockSchema} from './schema'

export function HypermediaLinkSwitchToolbar(
  props: HyperlinkToolbarProps & {
    openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
    stopEditing: boolean
    forceEditing?: boolean
    formComponents: () => React.JSX.Element
    type: string
    setHovered?: (hovered: boolean) => void
  },
) {
  const [isEditing, setIsEditing] = useState(props.forceEditing || false)
  const unpackedRef = useMemo(() => unpackHmId(props.url), [props.url])
  const entity = useResource(unpackedRef)
  const document =
    entity.data?.type === 'document' ? entity.data.document : undefined
  useEffect(() => {
    if (props.stopEditing && isEditing) {
      setIsEditing(false)
    }
  }, [props.stopEditing, isEditing])

  return (
    <XStack
      zIndex="$zIndex.4"
      {...(props.setHovered && {
        onMouseEnter: () => {
          props.setHovered?.(true)
        },
        onMouseLeave: () => {
          props.setHovered?.(false)
          props.editor.hyperlinkToolbar.startHideTimer()
        },
      })}
      className="switch-toolbar"
    >
      {isEditing ? (
        // Render the form when in editing mode
        <YStack
          paddingVertical="$4"
          paddingHorizontal="$3"
          gap="$2"
          borderRadius="$4"
          overflow="hidden"
          bg="$backgroundFocus"
          elevation="$3"
          zIndex="$zIndex.5"
          // bottom={-45}
          // position="absolute"
          onMouseEnter={props.stopHideTimer}
          onMouseLeave={props.startHideTimer}
        >
          <SizableText weight="bold">{`${
            props.type.charAt(0).toUpperCase() + props.type.slice(1)
          } settings`}</SizableText>
          {props.formComponents && props.formComponents()}
          <HypermediaLinkForm
            url={props.url}
            text={props.text}
            updateLink={props.updateHyperlink}
            editLink={props.editHyperlink}
            openUrl={props.openUrl}
            type={props.type}
            hasName={props.type !== 'embed' && props.type !== 'mention'}
            hasSearch={props.type !== 'link'}
            isHmLink={!!unpackedRef}
          />
        </YStack>
      ) : (
        // Render the toolbar by default
        <XGroup elevation="$5" paddingHorizontal={0}>
          <LinkSwitchButton
            tooltipText="Open in a new window"
            icon={ExternalLink}
            onPress={() => props.openUrl(props.url, true)}
            active={false}
          />
          <LinkSwitchButton
            tooltipText="Delete link"
            icon={Unlink}
            onPress={props.deleteHyperlink}
            active={false}
          />
          <LinkSwitchButton
            tooltipText={`Edit ${props.type}`}
            icon={Pencil}
            onPress={() => {
              setIsEditing(true)
            }}
            active={false}
          />
          <LinkSwitchButton
            tooltipText="Change to a link"
            icon={Link}
            onPress={() => {
              let title = props.text ? props.text : props.url
              if (['mention', 'embed'].includes(props.type)) {
                const linkTitle = getTitle(unpackedRef, document)
                if (linkTitle) title = linkTitle
              }
              if (props.type === 'mention') {
                const tiptap = props.editor._tiptapEditor
                const {view, state} = tiptap
                const $pos = state.doc.resolve(state.selection.from)

                let offset = 0
                let mention: Node
                $pos.parent.descendants((node, pos) => {
                  if (node.type.name === 'inline-embed') {
                    mention = node
                    offset = pos
                  }
                })
                // @ts-ignore
                if (mention) {
                  let tr = state.tr.replaceWith(
                    $pos.start() + offset,
                    $pos.start() + offset + 1,

                    state.schema.text(
                      title,
                      // @ts-ignore
                      state.schema.marks['link'].create({href: props.url})!,
                    ),
                  )
                  view.dispatch(tr)
                }
              } else {
                const {state} = props.editor._tiptapEditor
                const node = state.schema.nodes.paragraph.create(
                  null,
                  state.schema.text(
                    title,
                    // @ts-ignore
                    state.schema.marks['link'].create({href: props.url})!,
                  ),
                )
                insertNode(
                  props.editor,
                  props.id,
                  props.url,
                  props.text,
                  props.type,
                  node,
                )
              }
              props.resetHyperlink()
            }}
            active={props.type === 'link'}
          />
          <LinkSwitchButton
            tooltipText="Change to a mention"
            icon={Quote}
            onPress={() => {
              const tiptap = props.editor._tiptapEditor
              const {state} = tiptap
              const node = state.schema.nodes['inline-embed'].create(
                {
                  link: props.url,
                },
                state.schema.text(' '),
              )
              insertMentionNode(
                props.editor,
                props.text,
                node,
                props.id,
                props.type === 'link',
              )
              props.resetHyperlink()
            }}
            active={props.type === 'mention'}
          />
          <LinkSwitchButton
            tooltipText="Change to a button"
            icon={CircleDot}
            onPress={() => {
              let title = props.text ? props.text : props.url
              if (['mention', 'embed'].includes(props.type)) {
                const buttonTitle = getTitle(unpackedRef, document)
                if (buttonTitle) title = buttonTitle
              }
              const schema = props.editor._tiptapEditor.state.schema
              const node = schema.nodes.button.create({
                url: props.url,
                name: title,
              })

              insertNode(
                props.editor,
                props.id,
                props.url,
                props.text,
                props.type,
                node,
              )
            }}
            active={props.type === 'button'}
          />
          <LinkSwitchButton
            tooltipText="Change to an embed"
            icon={PanelBottom}
            onPress={() => {
              const schema = props.editor._tiptapEditor.state.schema
              const node = schema.nodes.embed.create(
                {
                  url: props.url,
                  view: 'Content',
                },
                schema.text(' '),
              )

              insertNode(
                props.editor,
                props.id,
                props.url,
                props.text,
                props.type,
                node,
              )
            }}
            active={props.type === 'embed'}
          />
        </XGroup>
      )}
    </XStack>
  )
}

function LinkSwitchButton({
  tooltipText,
  icon: Icon,
  onPress,
  active,
}: {
  tooltipText: string
  icon: any
  onPress: () => void
  active: boolean
}) {
  return (
    <XGroup.Item>
      <XStack p="$1.5" bg="$backgroundFocus">
        <Tooltip content={tooltipText}>
          <Button
            borderRadius="$3"
            bg={active ? '$brand5' : '$backgroundFocus'}
            fontWeight={active ? 'bold' : '400'}
            size="$3"
            disabled={active}
            disabledStyle={{opacity: 1}}
            hoverStyle={{bg: '$brand5'}}
            icon={Icon}
            onPress={onPress}
          />
        </Tooltip>
      </XStack>
    </XGroup.Item>
  )
}

function getTitle(
  unpackedId?: UnpackedHypermediaId | null,
  document?: HMDocument | null,
) {
  if (!document || !unpackedId) return
  let title
  if (unpackedId.blockRef) {
    const block = document.content.find((block) => {
      if (block.block) {
        return block.block.id === unpackedId.blockRef
      }
    })
    if (block?.block?.type === 'Heading') {
      title = block.block.text
    }
  }
  if (!title) {
    title = getDocumentTitle(document)
  }
  return title
}

function insertNode(
  editor: BlockNoteEditor<HMBlockSchema>,
  selectedId: string,
  link: string,
  text: string,
  prevType: string,
  node: Node,
) {
  const {state, view} = editor._tiptapEditor
  const {selection} = state
  const {$from} = selection
  const blockInfo = getBlockInfoFromPos(state, selection.$anchor.pos)
  let tr = state.tr

  // If mention or link is inline with other text the child count will be more than 1
  if (blockInfo.blockContent.node.content.childCount > 1) {
    const $pos = state.doc.resolve($from.pos)
    let startPos = $pos.start()
    let endPos = $pos.end()
    let endContent = Fragment.empty
    if (prevType === 'link') {
      $pos.parent.descendants((node, pos, _parent, index) => {
        if (node.marks.length > 0 && node.marks[0].attrs.href === link) {
          startPos = index === 0 ? $pos.start() + pos - 2 : $pos.start() + pos
          endPos = index === 0 ? $pos.end() : $pos.start() + pos + text.length
        } else if (startPos !== $pos.start() && endPos !== $pos.end()) {
          endContent = endContent.addToEnd(node)
        }
      })
    } else if (prevType === 'mention') {
      $pos.parent.descendants((node, pos, _parent, index) => {
        if (node.type.name === 'inline-embed' && node.attrs.link === link) {
          startPos = index === 0 ? $pos.start() - 1 : $pos.start() + pos
          endPos = index === 0 ? $pos.end() : $pos.start() + pos + 1
        } else if (startPos !== $pos.start() && endPos !== $pos.end()) {
          endContent = endContent.addToEnd(node)
        }
      })
    }

    const newBlock = state.schema.nodes['blockContainer'].createAndFill()!
    const nextBlockPos = $pos.end() + 2
    const nextBlockContentPos = nextBlockPos + 2
    const $nextBlockPos = state.doc.resolve(nextBlockContentPos)
    if (
      endContent.childCount &&
      !(
        endContent.childCount === 1 &&
        endContent.firstChild?.textContent.trim() === ''
      )
    ) {
      tr = tr.insert(nextBlockPos, newBlock)

      const endNode = $pos.parent.copy(endContent)
      tr = tr.replaceWith(
        $nextBlockPos.before($nextBlockPos.depth),
        nextBlockContentPos + 1,
        endNode,
      )
    }

    tr = tr.insert(nextBlockPos, newBlock)
    tr = tr.replaceWith(
      $nextBlockPos.before($nextBlockPos.depth),
      nextBlockContentPos + 1,
      node,
    )
    tr = tr.deleteRange(startPos, $pos.end())
  } else {
    const {posBeforeNode} = getNodeById(selectedId, state.doc)
    const blockInfo = getBlockInfoFromPos(state, posBeforeNode + 1)
    tr = tr.replaceRangeWith(
      blockInfo.blockContent.beforePos,
      blockInfo.blockContent.afterPos,
      node,
    )
  }
  view.dispatch(tr)
  editor._tiptapEditor.commands.focus()
}

function insertMentionNode(
  editor: BlockNoteEditor<HMBlockSchema>,
  name: string,
  node: Node,
  selectedId: string,
  inline: boolean,
) {
  const {state, view} = editor._tiptapEditor
  let tr = state.tr
  const {posBeforeNode} = getNodeById(selectedId, state.doc)

  const $pos = state.doc.resolve(posBeforeNode + 1)
  let startPos = $pos.start()
  let endPos = $pos.start() + 2

  if (inline) {
    let offset = 0
    $pos.parent.descendants((node, pos) => {
      if (node.marks.length > 0) {
        offset = pos
      }
    })
    startPos = startPos + offset
    endPos = startPos + name.length
  }

  view.dispatch(tr.replaceRangeWith(startPos, endPos, node))
}
