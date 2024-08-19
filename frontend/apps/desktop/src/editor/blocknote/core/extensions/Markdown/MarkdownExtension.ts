import {BlockNoteEditor, getBlockInfoFromPos, setGroupTypes} from '@/editor'
import {Extension} from '@tiptap/core'
import {DOMParser as ProseMirrorDOMParser} from 'prosemirror-model'
import {Plugin} from 'prosemirror-state'
import {MarkdownToBlocks} from './MarkdownToBlocks'

const markdownRegex = new RegExp(
  [
    '^#{1,6} .+', // Headers
    '(\\*\\*|__)(.*?)\\1|(\\*|_)(.*?)\\3', // Bold/Italic
    '\\[([^\\]]+)\\]\\(([^)]+)\\)', // Links
    '!\\[([^\\]]*)\\]\\(([^)]+)\\)', // Images
    '`([^`]+)`', // Inline Code
    '^[-+*] .+', // Unordered Lists
    '^\\d+\\. .+', // Ordered Lists
    '^```[a-zA-Z]*\\n[\\s\\S]*?\\n```', // Code Blocks
  ].join('|'),
  'gm',
)

function isMarkdown(text: string) {
  return markdownRegex.test(text)
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

              if (!isMarkdown(pastedText)) {
                if (hasList) {
                  const parser = new DOMParser()
                  const doc = parser.parseFromString(pastedHtml, 'text/html')
                  const fragment = ProseMirrorDOMParser.fromSchema(
                    view.state.schema,
                  ).parse(doc.body)
                  let tr = state.tr
                  tr = tr.replaceRangeWith(
                    selection.from,
                    selection.to,
                    fragment.firstChild!.content.content,
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
