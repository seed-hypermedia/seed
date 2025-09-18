import {createTipTapBlock} from './blocknote/core/extensions/Blocks/api/block'
import {updateBlockCommand} from './blocknote/core/api/blockManipulation/commands/updateBlock'
import styles from './blocknote/core/extensions/Blocks/nodes/Block.module.css'
import {headingVariants} from '@shm/ui/heading'
import {InputRule, mergeAttributes} from '@tiptap/core'

export const HMHeadingBlockContent = createTipTapBlock<'heading'>({
  name: 'heading',
  content: 'inline*',

  addAttributes() {
    return {
      level: {
        default: '2',
        // instead of "level" attributes, use "data-level"
        parseHTML: (element) => element.getAttribute('data-level'),
        renderHTML: (attributes) => {
          return {
            'data-level': attributes.level,
          }
        },
      },
    }
  },

  addInputRules() {
    return [
      ...['1'].map((level) => {
        return new InputRule({
          find: new RegExp(`^#\\s$`),
          handler: ({state, chain, range}) => {
            chain()
              .command(
                updateBlockCommand(
                  state.doc.resolve(state.selection.from).start() - 2,
                  {
                    type: 'heading',
                    props: {
                      level: '2',
                    },
                  },
                ),
              )
              // Removes the "#" character(s) used to set the heading.
              .deleteRange({from: range.from, to: range.to})
          },
        })
      }),
    ]
  },

  parseHTML() {
    return [
      {
        tag: 'span[role="heading"]',
        attrs: {level: 2},
        node: 'heading',
        // priority: 500,
      },
      {
        tag: 'h1',
        attrs: {level: 2},
        node: 'heading',
      },
      {
        tag: 'h2',
        attrs: {level: 2},
        node: 'heading',
      },
      {
        tag: 'h3',
        attrs: {level: 3},
        node: 'heading',
      },
      {
        tag: 'h4',
        attrs: {level: 4},
        node: 'heading',
      },
      {
        tag: 'h5',
        attrs: {level: 5},
        node: 'heading',
      },
      {
        tag: 'h6',
        attrs: {level: 6},
        node: 'heading',
      },
    ]
  },

  renderHTML({HTMLAttributes, node}) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: `${styles.blockContent} block-heading`,
        'data-content-type': this.name,
      }),
      [
        `h${node.attrs.level}`,
        // 'p',
        {
          class: `${styles.inlineContent} heading-content ${headingVariants({
            level: node.attrs.level as 1 | 2 | 3 | 4,
          })}`,
        },
        0,
      ],
    ]
  },
})

export const Heading = {
  propSchema: {
    listLevel: {
      default: '1',
    },
  },
  node: HMHeadingBlockContent,
}
