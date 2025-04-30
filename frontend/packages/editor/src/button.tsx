import {BlockNoteEditor} from '@/blocknote/core/BlockNoteEditor'
import {Block} from '@/blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from '@/blocknote/core/extensions/Blocks/api/defaultBlocks'
import {useEditorSelectionChange} from '@/blocknote/react/hooks/useEditorSelectionChange'
import {createReactBlockSpec} from '@/blocknote/react/ReactBlockSpec'
import {updateSelection} from '@/media-render'
import {HMBlockSchema} from '@/schema'
import {Button} from '@shm/ui/button'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {AlignCenter, AlignLeft, AlignRight} from '@tamagui/lucide-icons'
import {XStack, YStack} from '@tamagui/stacks'
import {useEffect, useState} from 'react'
import {Label, SizableText} from 'tamagui'
import {useDocContentContext} from '../../ui/src/document-content'

export const ButtonBlock = createReactBlockSpec({
  type: 'button',
  propSchema: {
    ...defaultProps,

    url: {
      default: '',
    },
    name: {
      default: '',
    },
    alignment: {
      default: 'flex-start',
    },
    defaultOpen: {
      values: ['false', 'true'],
      default: 'false',
    },
  },
  containsInlineContent: true,
  // @ts-ignore
  render: ({
    block,
    editor,
  }: {
    block: Block<HMBlockSchema>
    editor: BlockNoteEditor<HMBlockSchema>
  }) => Render(block, editor),
})

type ButtonAlignment = 'flex-start' | 'center' | 'flex-end'

export type ButtonType = {
  id: string
  props: {
    url: string
    name: string
    alignment?: string
  }
  children: []
  content: []
  type: string
}

const Render = (
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) => {
  const popoverState = usePopoverState()
  // const [focused, setFocused] = useState(false)
  // const [sizing, setSizing] = useState('hug-content')
  const [alignment, setAlignment] = useState<ButtonAlignment>(
    (block.props.alignment as ButtonAlignment) || 'flex-start',
  )
  const [selected, setSelected] = useState(false)
  const [forceEdit, setForceEdit] = useState(false)
  // const [buttonText, setButtonText] = useState(
  //   block.props.name || 'Button Label',
  // )
  // const sizingOptions = [
  //   {value: 'hug-content', label: 'Hug content'},
  //   {value: 'fill-width', label: 'Fill width'},
  // ]
  // const [link, setLink] = useState(block.props.url)
  // const openUrl = useOpenUrl()
  const {openUrl} = useDocContentContext()

  const assign = (newProps: ButtonType) => {
    editor.updateBlock(block.id, {
      props: {...block.props, ...newProps.props},
    })
  }

  useEditorSelectionChange(editor, () =>
    updateSelection(editor, block, setSelected),
  )

  useEffect(() => {
    setAlignment(block.props.alignment as ButtonAlignment)
  }, [block.props.alignment])

  function ButtonLinkComponents() {
    return (
      <YStack gap="$0.25" paddingLeft="$1">
        <Label opacity={0.6} fontSize={13} marginBottom="$-2">
          Alignment
        </Label>
        <XStack gap="$3">
          <Button
            size="$2"
            height="$3"
            borderRadius="$3"
            onPress={() => {
              setForceEdit(true)
              setAlignment('flex-start')
              assign({props: {alignment: 'flex-start'}} as ButtonType)
            }}
            borderColor="$brand5"
            backgroundColor={
              alignment === 'flex-start' ? '$brand5' : '$colorTransparent'
            }
          >
            <AlignLeft size="$1.5" />
          </Button>
          <Button
            size="$2"
            height="$3"
            borderRadius="$3"
            onPress={() => {
              setForceEdit(true)
              setAlignment('center')
              assign({props: {alignment: 'center'}} as ButtonType)
            }}
            borderColor="$brand5"
            backgroundColor={
              alignment === 'center' ? '$brand5' : '$colorTransparent'
            }
          >
            <AlignCenter size="$1.5" />
          </Button>
          <Button
            size="$2"
            height="$3"
            borderRadius="$3"
            onPress={() => {
              setForceEdit(true)
              setAlignment('flex-end')
              assign({props: {alignment: 'flex-end'}} as ButtonType)
            }}
            borderColor="$brand5"
            backgroundColor={
              alignment === 'flex-end' ? '$brand5' : '$colorTransparent'
            }
          >
            <AlignRight size="$1.5" />
          </Button>
        </XStack>
      </YStack>
    )
  }

  return (
    // <Popover
    //   placement="top"
    //   open={popoverState.open}
    //   onOpenChange={(open) => {
    //     popoverState.onOpenChange(open)
    //     if (forceEdit) {
    //       setForceEdit(false)
    //     }
    //   }}
    // >
    <YStack
      justifyContent={alignment}
      alignItems={alignment}
      animateOnly={['left', 'right']}
      animation="quick"
    >
      <XStack
        width="100%"
        justifyContent={alignment}
        userSelect="none"
        key={alignment}
      >
        <XStack
          position="relative"
          // width={sizing === 'fill-width' ? '92.5%' : ''}
          // @ts-ignore
          contentEditable={false}
        >
          {/* <Popover.Trigger> */}
          <Button
            backgroundColor="$brand5"
            color="white"
            width="100%"
            justifyContent="center"
            textAlign="center"
            userSelect="none"
            borderColor={selected ? '$color8' : '$colorTransparent'}
            borderWidth={3}
            size="$4"
            maxWidth="100%"
            hoverStyle={{
              backgroundColor: '$brand4',
              borderColor: '$colorTransparent',
            }}
            focusStyle={{
              backgroundColor: '$brand3',
              borderColor: '$colorTransparent',
            }}
          >
            <SizableText
              size="$4"
              numberOfLines={1}
              ellipsizeMode="tail"
              fontWeight="600"
              fontStyle={block.props.name ? 'normal' : 'italic'}
              color={block.props.name ? 'white' : 'lightgrey'}
              opacity={block.props.name ? 1 : 0.6}
            >
              {block.props.name || 'Button Text'}
            </SizableText>
          </Button>
        </XStack>
      </XStack>
    </YStack>
    // </Popover>
  )
}
