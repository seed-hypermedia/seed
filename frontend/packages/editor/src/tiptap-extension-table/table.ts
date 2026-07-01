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
  selectionCell,
  setCellAttr,
  splitCell,
  tableEditing,
  TableMap,
  toggleHeader,
  toggleHeaderCell,
} from '@tiptap/pm/tables'
import {NodeView} from '@tiptap/pm/view'

import {BlockNoteDOMAttributes, getBlockInfoFromSelection, mergeCSSClasses} from '../blocknote'
import styles from '../blocknote/core/extensions/Blocks/nodes/Block.module.css'
import {TableView} from './TableView'
import {addColumnBeforeWithHeaderPromotion, addRowBeforeWithHeaderPromotion} from './header-promotion-commands'
import {columnIdPlugin} from './table-cell-columnid-plugin'
import {tablePasteCleanupPlugin} from './table-paste-cleanup'
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
      /** Insert a new header row above row 0 and demote the existing row 0
       * to a regular row in one transaction. */
      addRowBeforeWithHeaderPromotion: () => ReturnType
      /** Insert a new header column left of column 0 and demote the existing
       * column 0 to a regular column in one transaction. */
      addColumnBeforeWithHeaderPromotion: () => ReturnType
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

  addNodeView() {
    return ({node, editor}) => {
      return new TableView(node, this.options.cellMinWidth, editor)
    }
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
        ({state, tr, dispatch, editor}) => {
          const table = createTable(editor.schema, rows, cols, withHeaderRow)

          if (!dispatch) return true

          // Find the current blockNode container.
          let blockInfo
          try {
            blockInfo = getBlockInfoFromSelection(state)
          } catch {
            blockInfo = undefined
          }

          // Wrap the table in a blockNode so it is inserted at the correct nesting level.
          // @ts-ignore
          const tableBlockNode = state.schema.nodes['blockNode'].create(null, table)

          if (blockInfo) {
            const blockContent = blockInfo.blockContent.node
            const blockContentText = blockContent.textContent
            const isEmptyOrSlash =
              blockContent.type.name === 'paragraph' && (blockContentText === '' || blockContentText === '/')

            if (isEmptyOrSlash) {
              // Replace the current blockNode entirely.
              tr.replaceWith(blockInfo.block.beforePos, blockInfo.block.afterPos, tableBlockNode)
            } else {
              // Insert as the next sibling after the current blockNode.
              tr.insert(blockInfo.block.afterPos, tableBlockNode)
            }
          } else {
            tr.replaceSelectionWith(tableBlockNode)
          }

          // Move selection to the first table cell
          const insertPos = blockInfo
            ? (blockInfo.blockContent.node.textContent === '' || blockInfo.blockContent.node.textContent === '/'
                ? blockInfo.block.beforePos
                : blockInfo.block.afterPos) + 3
            : tr.selection.anchor + 1
          tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos))).scrollIntoView()

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
      addRowBeforeWithHeaderPromotion:
        () =>
        ({state, tr, dispatch}) => {
          return addRowBeforeWithHeaderPromotion(state, tr, dispatch)
        },
      addColumnBeforeWithHeaderPromotion:
        () =>
        ({state, tr, dispatch}) => {
          return addColumnBeforeWithHeaderPromotion(state, tr, dispatch)
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
      // Move the cursor to the cell directly below. If  in the last row,
      // add a row first and then move into it.
      Enter: () => {
        if (!this.editor.isActive('tableCell') && !this.editor.isActive('tableHeader')) {
          return false
        }

        // Try to move into the cell directly below the current one.
        const moved = this.editor.commands.command(({state, tr, dispatch}) => {
          const $cell = selectionCell(state)
          if (!$cell) return false

          const table = $cell.node(-1)
          const tableStart = $cell.start(-1)
          const map = TableMap.get(table)

          const cellRelPos = $cell.pos - tableStart
          const rect = map.findCell(cellRelPos)

          // rect.bottom is one past the last row this cell covers.
          // If that's at or past the table height, the cursor is in the last row.
          if (rect.bottom >= map.height) return false

          // Target cell at same column, next row.
          const targetRelPos = map.map[rect.bottom * map.width + rect.left]
          if (targetRelPos == null) return false

          if (dispatch) {
            const insidePos = tableStart + targetRelPos + 2
            tr.setSelection(TextSelection.create(tr.doc, insidePos)).scrollIntoView()
          }
          return true
        })
        if (moved) return true

        // Add a new row below, then move into the same column
        // cell in the newly added row.
        if (!this.editor.can().addRowAfter()) return true
        return this.editor
          .chain()
          .addRowAfter()
          .command(({state, tr, dispatch}) => {
            const $cell = selectionCell(state)
            if (!$cell) return false
            const table = $cell.node(-1)
            const tableStart = $cell.start(-1)
            const map = TableMap.get(table)
            const cellRelPos = $cell.pos - tableStart
            const rect = map.findCell(cellRelPos)
            if (rect.bottom >= map.height) return false
            const targetRelPos = map.map[rect.bottom * map.width + rect.left]
            if (targetRelPos == null) return false
            if (dispatch) {
              const insidePos = tableStart + targetRelPos + 2
              tr.setSelection(TextSelection.create(tr.doc, insidePos)).scrollIntoView()
            }
            return true
          })
          .run()
      },
      // Insert a line break within the current cell.
      'Shift-Enter': () => {
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
      tablePasteCleanupPlugin,
      columnIdPlugin,
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
