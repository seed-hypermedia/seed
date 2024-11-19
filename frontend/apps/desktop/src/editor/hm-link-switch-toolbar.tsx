import {unpackHmId} from '@shm/shared'
import {
  Button,
  ExternalLink,
  Link,
  Pencil,
  Tooltip,
  Unlink,
  XGroup,
  XStack,
} from '@shm/ui'
import {CircleDot, PanelBottom, Quote} from '@tamagui/lucide-icons'
import {Fragment, Node} from '@tiptap/pm/model'
import {useEffect, useMemo, useState} from 'react'
import {
  BlockNoteEditor,
  getBlockInfoFromPos,
  HyperlinkToolbarProps,
  PartialBlock,
} from './blocknote'
import {HMBlockSchema} from './schema'

export function HypermediaLinkSwitchToolbar(
  props: HyperlinkToolbarProps & {
    openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
    stopEditing: boolean
    editComponent: React.ComponentType<{
      url: string
      text: string
      updateHyperlink: (url: string, text: string) => void
      editHyperlink: (url: string, text: string) => void
      openUrl: (
        url?: string | undefined,
        newWindow?: boolean | undefined,
      ) => void
      onClose: () => void
      editor: BlockNoteEditor
      type: string
      isSeedDocument: boolean
    }>
    type: string
  },
) {
  const [isEditing, setIsEditing] = useState(false)
  const {editComponent: EditComponent} = props
  const unpackedRef = useMemo(() => unpackHmId(props.url), [props.url])

  useEffect(() => {
    if (props.stopEditing && isEditing) {
      setIsEditing(false)
    }
  }, [props.stopEditing, isEditing])

  return (
    <XStack>
      {isEditing ? (
        // Render the form when in editing mode
        <EditComponent
          onClose={() => setIsEditing(false)}
          isSeedDocument={unpackedRef ? true : false}
          {...props}
        />
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
            onPress={() => setIsEditing(true)}
            active={false}
          />
          <LinkSwitchButton
            tooltipText="Change to a link"
            icon={Link}
            onPress={() => {
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
                      mention.attrs.title,
                      // @ts-ignore
                      state.schema.marks['link'].create({href: props.url})!,
                    ),
                  )
                  view.dispatch(tr)
                }
              } else {
                const linkBlock = {
                  type: 'paragraph',
                  props: {},
                  content: [
                    {
                      type: 'link',
                      href: props.url,
                      content: props.text.length ? props.text : props.url,
                    },
                  ],
                } as PartialBlock<HMBlockSchema>
                // props.editor.insertBlocks([linkBlock], props.id, 'after')
                props.editor.replaceBlocks([props.id], [linkBlock])
              }
            }}
            active={props.type === 'link'}
          />
          <LinkSwitchButton
            tooltipText="Change to a mention"
            icon={Quote}
            onPress={() => {
              if (props.type === 'link') {
                const tiptap = props.editor._tiptapEditor
                const {state} = tiptap
                const node = state.schema.nodes['inline-embed'].create(
                  {
                    link: props.url,
                    title: props.text,
                  },
                  state.schema.text(' '),
                )
                insertMentionNode(props.editor, props.text, node)
              } else {
                const mentionBlock = {
                  type: 'inline-embed',
                  content: [],
                  props: {
                    link: props.url,
                    title: props.text,
                  },
                } as PartialBlock<HMBlockSchema>
                // props.editor.insertBlocks([mentionBlock], props.id, 'after')
                props.editor.replaceBlocks([props.id], [mentionBlock])
              }
            }}
            active={props.type === 'mention'}
          />
          <LinkSwitchButton
            tooltipText="Change to a button"
            icon={CircleDot}
            onPress={() => {
              if (['mention', 'link'].includes(props.type)) {
                const schema = props.editor._tiptapEditor.state.schema
                const node = schema.nodes.button.create({
                  url: props.url,
                  name: props.text ? props.text : props.url,
                })

                insertNode(
                  props.editor,
                  props.url,
                  props.text,
                  props.type,
                  node,
                )
              } else {
                const buttonBlock = {
                  type: 'button',
                  content: [],
                  props: {
                    url: props.url,
                    name: props.text ? props.text : props.url,
                  },
                } as PartialBlock<HMBlockSchema>
                // props.editor.insertBlocks([buttonBlock], props.id, 'after')
                props.editor.replaceBlocks([props.id], [buttonBlock])
              }
            }}
            active={props.type === 'button'}
          />
          <LinkSwitchButton
            tooltipText="Change to an embed"
            icon={PanelBottom}
            onPress={() => {
              if (['mention', 'link'].includes(props.type)) {
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
                  props.url,
                  props.text,
                  props.type,
                  node,
                )
              } else {
                const embedBlock = {
                  type: 'embed',
                  content: [],
                  props: {
                    url: props.url,
                  },
                } as PartialBlock<HMBlockSchema>
                // props.editor.insertBlocks([embedBlock], props.id, 'after')
                props.editor.replaceBlocks([props.id], [embedBlock])
              }
            }}
            active={props.type === 'embed'}
          />
        </XGroup>
      )}
    </XStack>
  )
}

function LinkSwitchButton({
  // editor,
  // toggleStyle,

  tooltipText,
  icon: Icon,
  onPress,
  active,
}: {
  // editor: BlockNoteEditor<HMBlockSchema>
  // toggleStyle: EditorToggledStyle
  tooltipText: string
  icon: any
  onPress: () => void
  active: boolean
}) {
  // const [active, setActive] = useState<boolean>(
  //   // toggleStyle in editor.getActiveStyles(),
  //   false,
  // )

  // function toggleCurrentStyle() {
  //   setActive(toggleStyle in editor.getActiveStyles())
  // }

  // useEditorContentChange(editor, toggleCurrentStyle)
  // useEditorSelectionChange(editor, toggleCurrentStyle)

  // function handlePress(style: EditorToggledStyle) {
  //   editor.focus()
  //   editor.toggleStyles({[toggleStyle]: true})
  // }

  return (
    // <Theme inverse={active}>
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
            // width="$2"
            // height="$3"
            // borderRadius={0}
            hoverStyle={{bg: '$brand5'}}
            icon={Icon}
            onPress={onPress}
          />
          {/* <Button
            borderRadius="$3"
            bg={active ? '$brand5' : '$backgroundFocus'}
            fontWeight={active ? 'bold' : '400'}
            // size="$3"
            width="$2"
            height="$3"
            // borderRadius={0}
            // icon={icon}
            onPress={onPress}
          >
            <Icon size="$5" />
          </Button> */}
        </Tooltip>
      </XStack>
    </XGroup.Item>
    // </Theme>
  )
}

function insertNode(
  editor: BlockNoteEditor<HMBlockSchema>,
  link: string,
  text: string,
  prevType: string,
  node: Node,
) {
  const {state, schema, view} = editor._tiptapEditor
  const {doc, selection} = state
  const {$from} = selection
  const block = getBlockInfoFromPos(doc, selection.$anchor.pos)
  let tr = state.tr

  // If mention or link is inline with other text the child count will be more than 1
  if (block.contentNode.content.childCount > 1) {
    const $pos = state.doc.resolve($from.pos)
    let startPos = $pos.start()
    let endPos = $pos.end()
    if (prevType === 'link') {
      $pos.parent.descendants((node, pos) => {
        if (node.marks.length > 0 && node.marks[0].attrs.href === link) {
          startPos = $pos.start() + pos
          endPos = $pos.start() + pos + text.length
        }
      })
    } else if (prevType === 'mention') {
      if ($pos.parent.firstChild?.type.name === 'inline-embed') {
        startPos = $pos.start() - 1
        endPos = $pos.end()
      } else
        $pos.parent.descendants((node, pos) => {
          if (node.type.name === 'inline-embed') {
            startPos = $pos.start() + pos
            endPos = $pos.start() + pos + 1
          }
        })
    }

    const newBlock = state.schema.nodes['blockContainer'].createAndFill()!
    const nextBlockPos = $pos.end() + 2
    const nextBlockContentPos = nextBlockPos + 2
    tr = tr.insert(nextBlockPos, newBlock)
    const $nextBlockPos = state.doc.resolve(nextBlockContentPos)
    tr = tr.replaceWith(
      $nextBlockPos.before($nextBlockPos.depth),
      nextBlockContentPos + 1,
      node,
    )
    tr = tr.deleteRange(startPos, endPos)
  } else {
    const $pos = state.doc.resolve($from.pos)
    tr = tr.replaceWith($pos.start() - 2, $pos.end(), node)
  }
  view.dispatch(tr)
  editor._tiptapEditor.commands.focus()
}

function insertMentionNode(
  editor: BlockNoteEditor<HMBlockSchema>,
  title: string,
  node: Node,
) {
  const {state, view} = editor._tiptapEditor
  const {selection} = state
  const {$from} = selection
  let tr = state.tr

  const $pos = state.doc.resolve($from.pos)

  let offset = 0
  $pos.parent.descendants((node, pos) => {
    if (node.marks.length > 0) {
      offset = pos
    }
  })

  view.dispatch(
    tr
      .deleteRange($pos.start() + offset, $pos.start() + offset + title.length)
      .insert(
        $pos.start() + offset,
        Fragment.fromArray([node, view.state.schema.text(' ')]),
      ),
  )
}
