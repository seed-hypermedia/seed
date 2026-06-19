import {Node as PMNode} from 'prosemirror-model'
import {Plugin, PluginKey} from 'prosemirror-state'

import {UniqueID} from '../blocknote/core/extensions/UniqueID/UniqueID'

export const columnIdPlugin = new Plugin({
  key: new PluginKey('table-cell-columnid'),
  appendTransaction(transactions, _oldState, newState) {
    if (!transactions.some((tr) => tr.docChanged)) return null

    let tr = newState.tr
    let modified = false

    newState.doc.descendants((tableNode, tablePos) => {
      if (tableNode.type.name !== 'table') return true

      const numCols = tableNode.firstChild?.childCount ?? 0
      if (numCols === 0) return false

      // Derive one canonical columnId per column position from existing cells.
      const colIds: string[] = new Array(numCols).fill('')
      tableNode.content.forEach((rowNode) => {
        if (rowNode.type.name !== 'tableRow') return
        rowNode.content.forEach((cellNode, _offset, col) => {
          const cid = cellNode.attrs?.columnId
          if (typeof cid === 'string' && cid && !colIds[col]) {
            colIds[col] = cid
          }
        })
      })
      // Mint fresh ids for columns where no cell has one.
      for (let c = 0; c < numCols; c++) {
        if (!colIds[c]) colIds[c] = UniqueID.options.generateID()
      }

      // Fill in columnId for cells that lack it.
      tableNode.content.forEach((rowNode, rowOffset) => {
        if (rowNode.type.name !== 'tableRow') return
        rowNode.content.forEach((cellNode: PMNode, cellOffset, col) => {
          if (cellNode.attrs?.columnId) return
          const cellPos = tablePos + 2 + rowOffset + cellOffset
          tr = tr.setNodeMarkup(cellPos, null, {
            ...cellNode.attrs,
            columnId: colIds[col],
          })
          modified = true
        })
      })

      return false
    })

    return modified ? tr : null
  },
})
