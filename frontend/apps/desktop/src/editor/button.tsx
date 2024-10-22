import {useOpenUrl} from '@/open-url'
import {Button, Input, SizableText, XStack} from '@shm/ui'
import {MousePointerClick} from '@tamagui/lucide-icons'
import {SetStateAction} from 'react'
import {
  Block,
  BlockNoteEditor,
  createReactBlockSpec,
  defaultProps,
} from './blocknote'
import {MediaContainer} from './media-container'
import {DisplayComponentProps, MediaRender, MediaType} from './media-render'
import {HMBlockSchema} from './schema'
import {isValidUrl} from './utils'

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

const Render = (
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) => {
  const submitButton = (url: string, assign: any, setFileName: any) => {
    if (isValidUrl(url)) {
      assign({props: {url: url}} as MediaType)
    } else setFileName({name: 'The provided URL is invalid.', color: 'red'})
    const cursorPosition = editor.getTextCursorPosition()
    editor.focus()
    if (cursorPosition.block.id === block.id) {
      if (cursorPosition.nextBlock)
        editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
      else {
        editor.insertBlocks(
          [{type: 'paragraph', content: ''}],
          block.id,
          'after',
        )
        editor.setTextCursorPosition(
          editor.getTextCursorPosition().nextBlock!,
          'start',
        )
      }
    }
  }
  return (
    <MediaRender
      block={block}
      editor={editor}
      mediaType="button"
      submit={submitButton}
      DisplayComponent={display}
      icon={<MousePointerClick />}
      CustomInput={ButtonInput}
    />
  )
}

const ButtonInput = ({
  assign,
  setUrl,
  fileName,
  setFileName,
}: {
  assign: any
  setUrl: any
  fileName: any
  setFileName: any
}) => {
  return (
    <XStack flex={1} gap="$2">
      <Input
        unstyled
        borderColor="$color8"
        borderWidth="$1"
        borderRadius="$2"
        paddingLeft="$3"
        height="$3"
        width="100%"
        placeholder={'Input Button Label here...'}
        hoverStyle={{
          borderColor: '$color11',
        }}
        focusStyle={{
          borderColor: '$color11',
        }}
        onChange={(e: {nativeEvent: {text: SetStateAction<string>}}) => {
          assign({props: {name: e.nativeEvent.text}})
          if (fileName.color)
            setFileName({
              name: 'Upload File',
              color: undefined,
            })
        }}
        autoFocus={true}
      />
      <Input
        unstyled
        borderColor="$color8"
        borderWidth="$1"
        borderRadius="$2"
        paddingLeft="$3"
        height="$3"
        width="100%"
        placeholder={'Input Button URL here...'}
        hoverStyle={{
          borderColor: '$color11',
        }}
        focusStyle={{
          borderColor: '$color11',
        }}
        onChange={(e: {nativeEvent: {text: SetStateAction<string>}}) => {
          setUrl(e.nativeEvent.text)
          if (fileName.color)
            setFileName({
              name: 'Upload File',
              color: undefined,
            })
        }}
        autoFocus={true}
      />
    </XStack>
  )
}

const display = ({
  editor,
  block,
  selected,
  setSelected,
  assign,
}: DisplayComponentProps) => {
  const openUrl = useOpenUrl()

  return (
    <MediaContainer
      editor={editor}
      block={block}
      mediaType="button"
      selected={selected}
      setSelected={setSelected}
      assign={assign}
    >
      <XStack height="$5" width="100%" jc="center" ai="center">
        <Button
          borderWidth={1}
          borderRadius={1}
          bc="$brand10"
          size="$3"
          minWidth="$10"
          maxWidth="100%"
          px="$2"
          fontSize="$4"
          justifyContent="center"
          textAlign="center"
          userSelect="none"
          onPress={() => {
            openUrl(block.props.url)
          }}
        >
          <SizableText numberOfLines={1} ellipsizeMode="tail">
            {block.props.name}
          </SizableText>
        </Button>
      </XStack>
    </MediaContainer>
  )
}
