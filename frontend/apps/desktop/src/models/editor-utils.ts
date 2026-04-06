import {HMBlock} from '@seed-hypermedia/client/hm-types'
import {Editor} from '@tiptap/react'
import {Node} from 'prosemirror-model'

export function setGroupTypes(tiptap: Editor, blocks: Array<Partial<HMBlock>>) {
  blocks.forEach((block: Partial<HMBlock>) => {
    tiptap.state.doc.descendants((node: Node, pos: number) => {
      if (
        node.attrs.id === block.id &&
        // @ts-expect-error
        block.props &&
        // @ts-expect-error
        block.props.childrenType
      ) {
        // @ts-ignore
        node.descendants((child: Node, childPos: number) => {
          if (child.type.name === 'blockChildren') {
            setTimeout(() => {
              let tr = tiptap.state.tr
              const attrs: Record<string, any> = {
                // @ts-expect-error
                listType: block.props?.childrenType,
                // @ts-expect-error
                listLevel: block.props?.listLevel,
              }
              // @ts-expect-error
              if (block.props?.start) {
                // @ts-expect-error
                attrs.start = parseInt(block.props.start)
              }
              // @ts-expect-error
              if (block.props?.childrenType === 'Grid' && block.props?.columnCount) {
                // @ts-expect-error
                attrs.columnCount = block.props.columnCount
              }
              tr = tr.setNodeMarkup(pos + childPos + 1, null, attrs)
              tiptap.view.dispatch(tr)
            })
            return false
          }
        })
      }
    })
    // @ts-expect-error
    if (block.children) {
      // @ts-expect-error
      setGroupTypes(tiptap, block.children)
    }
  })
}
