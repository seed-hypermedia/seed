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
import {useState} from 'react'
import {BlockNoteEditor, HyperlinkToolbarProps, PartialBlock} from './blocknote'
import {HMBlockSchema} from './schema'

export function HypermediaLinkSwitchToolbar(
  props: HyperlinkToolbarProps & {
    openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
    editComponent: React.ComponentType<{
      url: string
      text: string
      updateHyperlink: (url: string, text: string) => void
      editHyperlink: (url: string, text: string) => void
      openUrl: (
        url?: string | undefined,
        newWindow?: boolean | undefined,
      ) => void
      onClose?: (bool: boolean) => void
      editor: BlockNoteEditor
    }>
    type: string
  },
) {
  const [isEditing, setIsEditing] = useState(false)
  const {editComponent: EditComponent} = props
  // const formSize: SizeTokens = '$2'

  // const [_url, setUrl] = useState(props.url || '')
  // const [_text, setText] = useState(props.text || '')
  // const unpackedRef = useMemo(() => unpackHmId(_url), [_url])
  // const _latest = unpackedRef?.latest || false

  // function handleKeydown(event: KeyboardEvent) {
  //   if (event.key === 'Escape' || event.key == 'Enter') {
  //     event.preventDefault()
  //     props.editHyperlink(_url, _text)
  //   }
  // }

  // useEffect(() => {
  //   props.editor.hyperlinkToolbar.on('update', (state) => {
  //     setText(state.text || '')
  //     setUrl(state.url || '')
  //   })
  // }, [props.editor])

  // useEffect(() => {
  //   window.addEventListener('keydown', handleKeydown)

  //   return () => {
  //     window.removeEventListener('keydown', handleKeydown)
  //   }
  // }, [])

  return (
    <XStack>
      {isEditing ? (
        // Render the form when in editing mode
        <EditComponent onClose={setIsEditing} {...props} />
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
              // const {view, state} = props.editor._tiptapEditor
              // const newLength = state.selection.from + props.text.length
              // console.log(state.selection.$anchor.parent)

              // const tr = state.tr
              //   .insertText(
              //     props.text,
              //     state.selection.from,
              //     newLength,
              //     // this.hyperlinkMarkRange!.to,
              //   )
              //   .addMark(
              //     state.selection.from,
              //     newLength,
              //     state.schema.mark('link', {href: props.url}),
              //   )

              // // state.selection.to = newLength

              // view.dispatch(tr)
            }}
            active={props.type === 'link'}
          />
          <LinkSwitchButton
            tooltipText="Change to a mention"
            icon={Quote}
            onPress={() => {
              const mentionBlock = {
                type: 'inline-embed',
                content: [],
                props: {
                  link: props.url,
                },
              } as PartialBlock<HMBlockSchema>
              // props.editor.insertBlocks([mentionBlock], props.id, 'after')
              props.editor.replaceBlocks([props.id], [mentionBlock])
            }}
            active={props.type === 'mention'}
          />
          <LinkSwitchButton
            tooltipText="Change to a button"
            icon={CircleDot}
            onPress={() => {
              const buttonBlock = {
                type: 'button',
                content: [],
                props: {
                  url: props.url,
                  name: props.text.length ? props.text : props.url,
                },
              } as PartialBlock<HMBlockSchema>
              // props.editor.insertBlocks([buttonBlock], props.id, 'after')
              props.editor.replaceBlocks([props.id], [buttonBlock])
            }}
            active={props.type === 'button'}
          />
          <LinkSwitchButton
            tooltipText="Change to an embed"
            icon={PanelBottom}
            onPress={() => {
              const embedBlock = {
                type: 'embed',
                content: [],
                props: {
                  url: props.url,
                },
              } as PartialBlock<HMBlockSchema>
              // props.editor.insertBlocks([embedBlock], props.id, 'after')
              props.editor.replaceBlocks([props.id], [embedBlock])
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

// {unpackedRef ? (
//   <XStack ai="center" minWidth={200} gap="$2">
//     <Checkbox
//       id="link-latest"
//       size="$2"
//       key={_latest}
//       value={_latest}
//       onCheckedChange={(newValue) => {
//         let newUrl = createHmDocLink_DEPRECATED({
//           documentId: unpackedRef?.id,
//           version: unpackedRef?.version,
//           blockRef: unpackedRef?.blockRef,
//           variants: unpackedRef?.variants,
//           latest: newValue != 'indeterminate' ? newValue : false,
//         })
//         console.log('== newUrl', newUrl)
//         props.updateHyperlink(newUrl, props.text)
//         setUrl(newUrl)
//       }}
//     >
//       <Checkbox.Indicator>
//         <Check />
//       </Checkbox.Indicator>
//     </Checkbox>
//     <Label htmlFor="link-latest" size={formSize}>
//       Link to Latest Version
//     </Label>
//   </XStack>
// ) : null}
