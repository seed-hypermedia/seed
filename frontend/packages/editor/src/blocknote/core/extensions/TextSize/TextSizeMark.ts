import {Mark} from '@tiptap/core'

/** Inline mark that holds the chosen text size for a text range. */
export const TextSizeMark = Mark.create({
  name: 'textSize',

  addAttributes() {
    return {
      value: {
        default: undefined,
        parseHTML: (element) => element.getAttribute('data-text-size'),
        renderHTML: (attributes) => ({
          'data-text-size': attributes.value,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (element) => {
          if (typeof element === 'string') return false
          if (element.hasAttribute('data-text-size')) {
            return {value: element.getAttribute('data-text-size')}
          }
          return false
        },
      },
    ]
  },

  renderHTML({HTMLAttributes}) {
    return ['span', HTMLAttributes, 0]
  },
})
