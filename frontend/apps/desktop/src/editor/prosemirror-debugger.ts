import {Extension} from '@tiptap/core'
import {Plugin, PluginKey, Transaction} from 'prosemirror-state'

const debugPluginKey = new PluginKey('debugPlugin')

export const debugPlugin = Extension.create({
  addProseMirrorPlugins() {
    return [pmDebugPlugin]
  },
})

const pmDebugPlugin = new Plugin({
  key: debugPluginKey,
  // This will run on every transaction
  appendTransaction(transactions: readonly Transaction[], oldState, newState) {
    transactions.forEach((transaction) => {
      // Check if "addToHistory" meta is present
      console.log('Transaction', transaction)

      if (transaction.getMeta('addToHistory')) {
        console.log('Transaction with addToHistory:', transaction)
      }
    })
    return null // Add this line
  },
})
