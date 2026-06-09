import {callOrReturn, getExtensionField, mergeAttributes, Node, ParentConfig} from '@tiptap/core'
import {TextSelection} from '@tiptap/pm/state'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  fixTables,
  goToNextCell,
  mergeCells,
  setCellAttr,
  splitCell,
  tableEditing,
  toggleHeader,
  toggleHeaderCell,
} from '@tiptap/pm/tables'
import {NodeView} from '@tiptap/pm/view'

import {BlockNoteDOMAttributes, mergeCSSClasses} from '../blocknote'
import styles from '../blocknote/core/extensions/Blocks/nodes/Block.module.css'
import {TableView} from './TableView'
import {createTable} from './utilities/createTable'
import {deleteFullySelectedTable} from './utilities/deleteFullySelectedTable'

export interface TableOptions {
  HTMLAttributes: Record<string, any>
  resizable: boolean
  handleWidth: number
  cellMinWidth: number
  View: NodeView
  lastColumnResizable: boolean
  allowTableNodeSelection: boolean
  /** BlockNote's default DOM attributes */
  domAttributes?: BlockNoteDOMAttributes
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    table: {
      insertTable: (options?: {rows?: number; cols?: number; withHeaderRow?: boolean}) => ReturnType
      addColumnBefore: () => ReturnType
      addColumnAfter: () => ReturnType
      deleteColumn: () => ReturnType
      addRowBefore: () => ReturnType
      addRowAfter: () => ReturnType
      deleteRow: () => ReturnType
      deleteTable: () => ReturnType
      mergeCells: () => ReturnType
      splitCell: () => ReturnType
      toggleHeaderColumn: () => ReturnType
      toggleHeaderRow: () => ReturnType
      toggleHeaderCell: () => ReturnType
      mergeOrSplit: () => ReturnType
      setCellAttribute: (name: string, value: any) => ReturnType
      goToNextCell: () => ReturnType
      goToPreviousCell: () => ReturnType
      fixTables: () => ReturnType
      setCellSelection: (position: {anchorCell: number; headCell?: number}) => ReturnType
    }
  }

  interface NodeConfig<Options, Storage> {
    tableRole?:
      | string
      | ((this: {
          name: string
          options: Options
          storage: Storage
          parent: ParentConfig<NodeConfig<Options>>['tableRole']
        }) => string)
  }
}

export const Table = Node.create<TableOptions>({
  name: 'table',

  // @ts-ignore
  addOptions() {
    return {
      HTMLAttributes: {},
      resizable: false,
      handleWidth: 5,
      cellMinWidth: 25,
      // TODO: fix
      View: TableView,
      lastColumnResizable: true,
      allowTableNodeSelection: false,
      domAttributes: {},
    }
  },

  content: 'tableRow+',
  tableRole: 'table',
  isolating: true,
  group: 'block',

  parseHTML() {
    return [{tag: 'table'}]
  },

  renderHTML({HTMLAttributes}) {
    const blockContentDOMAttributes = this.options.domAttributes?.blockContent || {}
    return [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        ...blockContentDOMAttributes,
        class: mergeCSSClasses(
          // @ts-ignore
          styles.blockContent,
          blockContentDOMAttributes.class,
        ),
        'data-content-type': this.name,
      }),
      ['tbody', 0],
    ]
  },

  addCommands() {
    return {
      insertTable:
        ({rows = 3, cols = 3, withHeaderRow = true} = {}) =>
        ({tr, dispatch, editor}) => {
          const node = createTable(editor.schema, rows, cols, withHeaderRow)

          if (dispatch) {
            const offset = tr.selection.anchor + 1

            tr.replaceSelectionWith(node)
              .scrollIntoView()
              .setSelection(TextSelection.near(tr.doc.resolve(offset)))
          }

          return true
        },
      addColumnBefore:
        () =>
        ({state, dispatch}) => {
          return addColumnBefore(state, dispatch)
        },
      addColumnAfter:
        () =>
        ({state, dispatch}) => {
          return addColumnAfter(state, dispatch)
        },
      deleteColumn:
        () =>
        ({state, dispatch}) => {
          return deleteColumn(state, dispatch)
        },
      addRowBefore:
        () =>
        ({state, dispatch}) => {
          return addRowBefore(state, dispatch)
        },
      addRowAfter:
        () =>
        ({state, dispatch}) => {
          return addRowAfter(state, dispatch)
        },
      deleteRow:
        () =>
        ({state, dispatch}) => {
          return deleteRow(state, dispatch)
        },
      deleteTable:
        () =>
        ({state, dispatch}) => {
          return deleteTable(state, dispatch)
        },
      mergeCells:
        () =>
        ({state, dispatch}) => {
          return mergeCells(state, dispatch)
        },
      splitCell:
        () =>
        ({state, dispatch}) => {
          return splitCell(state, dispatch)
        },
      toggleHeaderColumn:
        () =>
        ({state, dispatch}) => {
          return toggleHeader('column')(state, dispatch)
        },
      toggleHeaderRow:
        () =>
        ({state, dispatch}) => {
          return toggleHeader('row')(state, dispatch)
        },
      toggleHeaderCell:
        () =>
        ({state, dispatch}) => {
          return toggleHeaderCell(state, dispatch)
        },
      mergeOrSplit:
        () =>
        ({state, dispatch}) => {
          if (mergeCells(state, dispatch)) {
            return true
          }

          return splitCell(state, dispatch)
        },
      setCellAttribute:
        (name, value) =>
        ({state, dispatch}) => {
          return setCellAttr(name, value)(state, dispatch)
        },
      goToNextCell:
        () =>
        ({state, dispatch}) => {
          return goToNextCell(1)(state, dispatch)
        },
      goToPreviousCell:
        () =>
        ({state, dispatch}) => {
          return goToNextCell(-1)(state, dispatch)
        },
      fixTables:
        () =>
        ({state, dispatch}) => {
          if (dispatch) {
            fixTables(state)
          }

          return true
        },
      setCellSelection:
        (position) =>
        ({tr, dispatch}) => {
          if (dispatch) {
            const selection = CellSelection.create(tr.doc, position.anchorCell, position.headCell)

            // @ts-ignore
            tr.setSelection(selection)
          }

          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.commands.goToNextCell()) {
          return true
        }

        if (!this.editor.can().addRowAfter()) {
          return false
        }

        return this.editor.chain().addRowAfter().goToNextCell().run()
      },
      'Shift-Tab': () => this.editor.commands.goToPreviousCell(),
      // Insert a line break instead of splitting the paragraph into a new block.
      Enter: () => {
        if (this.editor.isActive('tableCell') || this.editor.isActive('tableHeader')) {
          return this.editor.commands.setHardBreak()
        }
        return false
      },
      // If the selection covers all cells, delete the whole table. Otherwise, don't delete
      // the table, row or cell when the cell content is empty paragraph.
      Backspace: (ctx) => {
        if (deleteFullySelectedTable(ctx)) return true
        const {editor} = ctx
        if (editor.isActive('tableCell') || editor.isActive('tableHeader')) {
          const {empty, $from} = editor.state.selection
          if (empty && $from.parentOffset === 0) return true
        }
        return false
      },
      'Mod-Backspace': (ctx) => {
        if (deleteFullySelectedTable(ctx)) return true
        const {editor} = ctx
        if (editor.isActive('tableCell') || editor.isActive('tableHeader')) {
          const {empty, $from} = editor.state.selection
          if (empty && $from.parentOffset === 0) return true
        }
        return false
      },
      Delete: (ctx) => {
        if (deleteFullySelectedTable(ctx)) return true
        const {editor} = ctx
        if (editor.isActive('tableCell') || editor.isActive('tableHeader')) {
          const {empty, $from} = editor.state.selection
          if (empty && $from.parentOffset === $from.parent.content.size) return true
        }
        return false
      },
      'Mod-Delete': (ctx) => {
        if (deleteFullySelectedTable(ctx)) return true
        const {editor} = ctx
        if (editor.isActive('tableCell') || editor.isActive('tableHeader')) {
          const {empty, $from} = editor.state.selection
          if (empty && $from.parentOffset === $from.parent.content.size) return true
        }
        return false
      },
    }
  },

  addProseMirrorPlugins() {
    const isResizable = this.options.resizable && this.editor.isEditable

    return [
      ...(isResizable
        ? [
            columnResizing({
              handleWidth: this.options.handleWidth,
              cellMinWidth: this.options.cellMinWidth,
              // @ts-ignore
              View: this.options.View,
              // TODO: PR for @types/prosemirror-tables
              // @ts-ignore
              lastColumnResizable: this.options.lastColumnResizable,
            }),
          ]
        : []),
      tableEditing({
        allowTableNodeSelection: this.options.allowTableNodeSelection,
      }),
    ]
  },

  extendNodeSchema(extension) {
    const context = {
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
    }

    return {
      tableRole: callOrReturn(getExtensionField(extension, 'tableRole', context)),
    }
  },
})
