import {BlockNoteEditor, getBlockInfoFromPos, setGroupTypes} from '@/editor'
import {Extension} from '@tiptap/core'
import {Node} from '@tiptap/pm/model'
import {Plugin} from 'prosemirror-state'
import {MarkdownToBlocks} from './MarkdownToBlocks'

function containsMarkdownSymbols(pastedText: string) {
  // Regex to detect unique Markdown symbols at the start of a line
  const markdownUniqueSymbols = new RegExp(
    [
      '^#{1,6} ', // Headers
      '^[\\s]*[-+*] ', // Unordered Lists
      '^\\d+\\. ', // Ordered Lists
      '^[\\s]*> ', // Blockquotes
      '^```', // Code Fences
      '^`[^`]+`$', // Inline Code
      '^\\[([^\\]]+)\\]\\(([^)]+)\\)$', // Links
      '^!\\[([^\\]]*)\\]\\(([^)]+)\\)$', // Images
      '^(\\*\\*|__)(.*?)\\1$',
      '^(\\*|_)(.*?)\\1$',
    ].join('|'),
    'm',
  )

  // Split the text by lines and check each line
  const lines = pastedText.split('\n').map((line) => line.trim())

  // Ensure that at least one line contains valid Markdown symbols
  return lines.some((line) => markdownUniqueSymbols.test(line))
}

export const createMarkdownExtension = (bnEditor: BlockNoteEditor) => {
  const MarkdownExtension = Extension.create({
    name: 'MarkdownPasteHandler',
    priority: 99999,

    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handlePaste: (view, event, slice) => {
              const pastedText = event.clipboardData!.getData('text/plain')
              const pastedHtml = event.clipboardData!.getData('text/html')
              const hasList =
                pastedHtml.includes('<ul') || pastedHtml.includes('<ol')

              const {state} = view
              const {selection} = state

              const isMarkdown = pastedHtml
                ? containsMarkdownSymbols(pastedText)
                : true

              if (!isMarkdown) {
                if (hasList) {
                  // const parser = new DOMParser()
                  // const doc = parser.parseFromString(pastedHtml, 'text/html')
                  // const ulElement = doc.body.querySelector('ul')
                  // const olElement = doc.body.querySelector('ol')
                  // const findPositions = [
                  //   {node: ulElement!, offset: 0},
                  //   {node: olElement!, offset: 0},
                  // ]
                  // const fragment = ProseMirrorDOMParser.fromSchema(
                  //   view.state.schema,
                  // ).parse(doc.body, {
                  //   findPositions: findPositions,
                  // })
                  const nodes: Node[] = []
                  slice.content.forEach((node, offset) => {
                    if (node.type.name === 'blockGroup') {
                      const prevContainer = nodes.pop()
                      if (prevContainer) {
                        const container = this.editor.schema.nodes[
                          'blockContainer'
                        ].create(
                          prevContainer.attrs,
                          prevContainer.content.addToEnd(node),
                        )
                        nodes.push(container)
                      }
                    } else if (node.type.name !== 'blockContainer') {
                      let nodeToInsert = node
                      if (node.type.name === 'text') {
                        nodeToInsert =
                          this.editor.schema.nodes.paragraph.create({}, node)
                      }
                      const container = this.editor.schema.nodes[
                        'blockContainer'
                      ].create(null, nodeToInsert)
                      nodes.push(container)
                    } else nodes.push(node)
                  })
                  const root = this.editor.schema.nodes['blockGroup'].create(
                    {},
                    nodes,
                  )
                  let tr = state.tr
                  tr = tr.replaceRangeWith(
                    selection.from,
                    selection.to,
                    // @ts-ignore
                    root.content.content,
                  )
                  view.dispatch(tr)
                  return true
                }
                return false
              }

              MarkdownToBlocks(pastedText, bnEditor).then((organizedBlocks) => {
                const blockInfo = getBlockInfoFromPos(state.doc, selection.from)

                bnEditor.replaceBlocks(
                  [blockInfo.node.attrs.id],
                  // @ts-ignore
                  organizedBlocks,
                )

                setGroupTypes(bnEditor._tiptapEditor, organizedBlocks)

                return
              })

              return true
            },
          },
        }),
      ]
    },
  })

  return MarkdownExtension
}
