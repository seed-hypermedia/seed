import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from './blocknote/core/extensions/Blocks/api/defaultBlocks'
import {createReactBlockSpec} from './blocknote/react/ReactBlockSpec'
import {ButtonBlockView} from './button-view'
import type {HMBlockSchema} from './schema'

export {ButtonBlockView, type ButtonType} from './button-view'

/**
 * BlockNote block spec for the URL button. Renders `ButtonBlockView` which
 * navigates to `block.props.url` on click in read-only mode.
 */
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
  // No inline content is ever rendered for this block: a leaf node (like
  // query) lets browsers represent its NodeSelection cleanly instead of
  // bouncing the DOM selection into phantom editable positions, and removes
  // the invisible-content merge/caret traps.
  containsInlineContent: false,
  selectable: true,
  // @ts-ignore
  render: ({block, editor}: {block: Block<HMBlockSchema>; editor: BlockNoteEditor<HMBlockSchema>}) => (
    <ButtonBlockView block={block} editor={editor} />
  ),
})
