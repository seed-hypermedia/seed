import {createTipTapBlock, mergeCSSClasses} from '@shm/editor/blocknote'
import styles from '@shm/editor/blocknote/core/extensions/Blocks/nodes/Block.module.css'
import {mergeAttributes} from '@tiptap/core'

export const ImagePlaceholder = createTipTapBlock<'imagePlaceholder'>({
  name: 'imagePlaceholder',

  addAttributes() {
    return {
      src: {
        default: null,
      },
      title: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
      },
    ]
  },

  renderHTML({HTMLAttributes}) {
    const blockContentDOMAttributes =
      this.options.domAttributes?.blockContent || {}
    return [
      'img',
      mergeAttributes({
        ...blockContentDOMAttributes,
        class: mergeCSSClasses(
          styles.blockContent,
          blockContentDOMAttributes.class,
        ),
        'data-content-type': this.name,
        'data-src': HTMLAttributes.src,
        'data-title': HTMLAttributes.title,
      }),
    ]
  },
})
