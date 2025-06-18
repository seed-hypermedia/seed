import {BlockNoteEditor} from '@/blocknote/core/BlockNoteEditor'
import {Block} from '@/blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from '@/blocknote/core/extensions/Blocks/api/defaultBlocks'
import {useEditorSelectionChange} from '@/blocknote/react/hooks/useEditorSelectionChange'
import {createReactBlockSpec} from '@/blocknote/react/ReactBlockSpec'
import {updateSelection} from '@/media-render'
import {HMBlockSchema} from '@/schema'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {useEffect, useState} from 'react'
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

  return (
    <div
      className="flex flex-col w-full select-none max-w-full"
      style={{
        justifyContent: alignment || 'flex-start',
      }}
      contentEditable={false}
    >
      <Button
        variant="brand"
        size="lg"
        className={cn(
          'border-none w-auto justify-center select-none border-transparent max-w-full text-center',
          alignment == 'center'
            ? 'self-center'
            : alignment == 'flex-end'
            ? 'self-end'
            : 'self-start',
        )}
      >
        <SizableText
          size="lg"
          className="truncate text-center font-bold text-white font-sans"
        >
          {block.props.name || 'Button Text'}
        </SizableText>
      </Button>
    </div>
  )
}
