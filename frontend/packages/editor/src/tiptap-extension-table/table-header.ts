// Vendored from @tiptap/extension-table-header@2.0.3.
import {mergeAttributes, Node} from '@tiptap/core'

export interface TableHeaderOptions {
  HTMLAttributes: Record<string, any>
}

export const TableHeader = Node.create<TableHeaderOptions>({
  name: 'tableHeader',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  content: 'block+',

  addAttributes() {
    return {
      // Header cell-level block id. Carries the Paragraph block id for
      // the cell's content so anchored data (comments, quote ranges) survives
      // load/save. UniqueID generates one on first read if missing.
      id: {default: null, keepOnSplit: true},
      colspan: {
        default: 1,
      },
      rowspan: {
        default: 1,
      },
      colwidth: {
        default: null,
        parseHTML: (element) => {
          const colwidth = element.getAttribute('colwidth')
          const value = colwidth ? [parseInt(colwidth, 10)] : null

          return value
        },
      },
    }
  },

  tableRole: 'header_cell',

  isolating: true,

  parseHTML() {
    return [{tag: 'th'}]
  },

  renderHTML({HTMLAttributes}) {
    return ['th', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },
})
