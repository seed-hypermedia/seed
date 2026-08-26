import {defaultProps} from './blocknote/core'
import {createReactBlockSpec} from './blocknote/react'

// An invisible grouping block for root level lists.
export const SlotBlock = createReactBlockSpec({
  type: 'slot',
  propSchema: {
    ...defaultProps,
    columnCount: {
      default: '',
    },
  },
  containsInlineContent: false,
  render: () => null,
})
