import {mergeAttributes, Node} from '@tiptap/core'
import {BlockNoteDOMAttributes} from '../api/blockTypes'

export const ListContainer = Node.create<{
  domAttributes?: BlockNoteDOMAttributes
}>({
  name: 'listContainer',
  group: 'block',
  content: 'blockContent (listGroup | blockGroup)?',
  defining: true,

  addAttributes() {
    return {
      // Preserve block attributes like id
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) {
            return {}
          }
          return {
            'data-id': attributes.id,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'li',
        priority: 300,
      },
      {
        tag: 'div[data-node-type="listContainer"]',
        priority: 200,
      },
    ]
  },

  renderHTML({HTMLAttributes}) {
    const listContainerDOMAttributes =
      this.options.domAttributes?.listContainer || {}

    return [
      'li',
      mergeAttributes(
        {
          ...listContainerDOMAttributes,
          'data-node-type': 'listContainer',
        },
        HTMLAttributes,
      ),
      0,
    ]
  },
})
