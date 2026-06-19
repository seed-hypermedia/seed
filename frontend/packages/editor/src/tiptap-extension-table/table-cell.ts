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
      // Reference to the TableColumn block this cell belongs to. Stable across
      // column reorders. The cell follows its column by id, not position.
      columnId: {
        default: null,
        keepOnSplit: true,
        parseHTML: (element) => element.getAttribute('data-column-id'),
        renderHTML: (attributes) => {
          if (!attributes.columnId) return {}
          return {'data-column-id': attributes.columnId}
        },
      },
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
