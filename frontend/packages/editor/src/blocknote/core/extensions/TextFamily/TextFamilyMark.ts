import {Mark} from '@tiptap/core'

/** Inline mark that holds the chosen font family for a text range. */
export const TextFamilyMark = Mark.create({
  name: 'textFamily',

  addAttributes() {
    return {
      value: {
        default: undefined,
        parseHTML: (element) => element.getAttribute('data-text-family'),
        renderHTML: (attributes) => ({
          'data-text-family': attributes.value,
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
          if (element.hasAttribute('data-text-family')) {
            return {value: element.getAttribute('data-text-family')}
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
