import {Mark} from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: string) => ReturnType
    }
  }
}

export const TextColorMark = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      value: {
        default: undefined,
        parseHTML: (element) => element.getAttribute('data-text-color'),
        renderHTML: (attributes) => ({
          'data-text-color': attributes.value,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (element) => {
          if (typeof element === 'string') {
            return false
          }

          if (element.hasAttribute('data-text-color')) {
            return {value: element.getAttribute('data-text-color')}
          }

          return false
        },
      },
    ]
  },

  renderHTML({HTMLAttributes}) {
    return ['span', HTMLAttributes, 0]
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({commands}) => {
          if (color !== 'default') {
            return commands.setMark(this.name, {value: color})
          }

          return commands.unsetMark(this.name)
        },
    }
  },
})
