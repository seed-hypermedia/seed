// Vendored from @tiptap/extension-table-cell@2.0.3.
import {mergeAttributes, Node} from '@tiptap/core'

export interface TableCellOptions {
  HTMLAttributes: Record<string, any>
}

export const TableCell = Node.create<TableCellOptions>({
  name: 'tableCell',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  content: 'block+',

  addAttributes() {
    return {
      // Cell-level block id. Carries the Paragraph block id for
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

  tableRole: 'cell',

  isolating: true,

  parseHTML() {
    return [{tag: 'td'}]
  },

  renderHTML({HTMLAttributes}) {
    return ['td', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },
})
