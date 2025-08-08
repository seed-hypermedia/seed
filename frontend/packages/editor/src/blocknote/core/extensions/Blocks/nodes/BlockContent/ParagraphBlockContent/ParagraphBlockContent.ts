import {mergeAttributes} from '@tiptap/core'
import {mergeCSSClasses} from '../../../../../shared/utils'
import {createTipTapBlock} from '../../../api/block'
import styles from '../../Block.module.css'

export const ParagraphBlockContent = createTipTapBlock({
  name: 'paragraph',
  content: 'inline*',

  parseHTML() {
    return [
      {
        tag: 'p',
        priority: 200,
        node: 'paragraph',
        getAttrs: (node) => {
          // Don't match if has image child (for markdown parse).
          const hasImage = node.querySelector('img') !== null

          return hasImage ? false : null
        },
      },
    ]
  },

  renderHTML({HTMLAttributes}) {
    const blockContentDOMAttributes =
      this.options.domAttributes?.blockContent || {}
    const inlineContentDOMAttributes =
      this.options.domAttributes?.inlineContent || {}

    return [
      'div',
      mergeAttributes(
        {
          ...blockContentDOMAttributes,
          class: mergeCSSClasses(
            // @ts-expect-error
            styles.blockContent,
            blockContentDOMAttributes.class,
          ),
          'data-content-type': this.name,
        },
        HTMLAttributes,
      ),
      [
        'p',
        {
          ...inlineContentDOMAttributes,
          class: mergeCSSClasses(
            // @ts-expect-error
            styles.inlineContent,
            inlineContentDOMAttributes.class,
          ),
        },
        0,
      ],
    ]
  },
})
