import {getPrevBlockInfo} from '@/blocknote/core/api/blockManipulation/commands/mergeBlocks'
import {BlockNoteEditor} from '@/blocknote/core/BlockNoteEditor'
import {
  getBlockInfoFromPos,
  getBlockInfoFromSelection,
} from '@/blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {setGroupTypes} from '@/utils'
import {Editor, Extension} from '@tiptap/core'
import {Fragment, Node, Slice} from '@tiptap/pm/model'
import {Plugin} from 'prosemirror-state'
import {nodeToBlock} from '../../api/nodeConversions/nodeConversions'
import {Block, BlockSchema} from '../Blocks/api/blockTypes'
import {SyncMarkdownToBlocks} from './MarkdownToBlocks'

function analyzePastedContent(
  pastedText: string,
  pastedHtml: string,
  slice: Slice,
) {
  const convertedNodes: {isMarkdown: boolean; node: Node}[] = []

  slice.content.forEach((node) => {
    // console.log(node.type.name, node.textContent)
    if (node.textContent && containsMarkdownSymbols(node.textContent)) {
      // console.log(node)
      convertedNodes.push({isMarkdown: true, node})
    } else {
      convertedNodes.push({isMarkdown: false, node})
    }
  })

  return convertedNodes
}

// Get nodes of a fragment or block group to be pasted
function pastedNodesToBlocks(
  parent: Node | Fragment,
  editor: Editor,
  bnEditor: BlockNoteEditor,
) {
  // const nodes: Node[] = []
  const blocks: Block<BlockSchema>[] = []
  // Stack to track heading levels for hierarchy
  const stack: {level: number; block: Block<BlockSchema>}[] = []
  let hasMarkdown = false
  let previousBlock: Block<BlockSchema> | undefined
  let startedCodeBlock: Block<BlockSchema> | undefined

  parent.forEach((node) => {
    let blockToInsert: Block<BlockSchema> | undefined
    // console.log(node)
    // console.log(
    //   'node to block: ',
    //   nodeToBlock(node, bnEditor.schema, bnEditor.blockCache),
    // )
    if (node.textContent && containsMarkdownSymbols(node.textContent))
      hasMarkdown = true
    if (node.type.name === 'blockGroup') {
      if (hasMarkdown) console.log('markdown in blockGroup!!!')
      if (blocks.length) {
        if (!previousBlock) {
          previousBlock = blocks.pop()
        }
        node.content.forEach((child) => {
          previousBlock!.children.push(
            nodeToBlock(child, bnEditor.schema, bnEditor.blockCache),
          )
        })
        previousBlock!.props.childrenType = node.attrs.listType
      }
      // const prevContainer = nodes.pop()
      // if (prevContainer) {
      //   const container = editor.schema.nodes['blockContainer'].create(
      //     prevContainer.attrs,
      //     prevContainer.content.addToEnd(node),
      //   )
      //   nodes.push(container)
      // }
    } else if (node.type.name !== 'blockContainer') {
      if (hasMarkdown) {
        console.log('markdown in content node!!!', node)
        // markdownBuffer += node.textContent + '\n' // Append to buffer
        blockToInsert = SyncMarkdownToBlocks(node.textContent, bnEditor)
        console.log(blockToInsert)
      } else {
        let nodeToInsert = node
        if (node.type.name === 'text') {
          nodeToInsert = editor.schema.nodes.paragraph.create({}, node)
        }
        const container = editor.schema.nodes['blockContainer'].create(
          null,
          nodeToInsert,
        )
        console.log('no markdown in content node!!!', node)
        blockToInsert = nodeToBlock(
          container,
          bnEditor.schema,
          bnEditor.blockCache,
        )
      }
    } else if (node.firstChild!.type.name === 'blockGroup') {
      if (hasMarkdown) console.log('markdown in first child blockGroup!!!')
      // const prevContainer = nodes.pop()
      // if (prevContainer) {
      //   const container = editor.schema.nodes['blockContainer'].create(
      //     prevContainer.attrs,
      //     prevContainer.content.addToEnd(node.firstChild!),
      //   )
      //   nodes.push(container)
      // } else if (!replaceSelectedBlock(node.firstChild!, editor)) {
      //   if (hasMarkdown) console.log('no idea what this is but markdown!!!')
      //   nodes.push(node.firstChild!)
      // }
      console.log(
        node.firstChild,
        replaceSelectedBlock(node.firstChild!, editor),
      )
    } else {
      if (hasMarkdown) {
        // console.log('markdown in blockContainer???', node.textContent)
        blockToInsert = SyncMarkdownToBlocks(node.textContent, bnEditor)
      }
      if (!blockToInsert) {
        blockToInsert = nodeToBlock(node, bnEditor.schema, bnEditor.blockCache)
        // console.log(blockToInsert)
      }

      // blocks.push(blockToPush)
    }
    if (blockToInsert) {
      if (blockToInsert.type === 'heading') {
        const headingLevel = parseInt(blockToInsert.props.level)
        while (stack.length && stack[stack.length - 1].level >= headingLevel) {
          stack.pop()
        }

        if (stack.length) {
          stack[stack.length - 1].block.children.push(blockToInsert)
        } else {
          if (previousBlock) {
            blocks.push(previousBlock)
            previousBlock = undefined
          }
          if (startedCodeBlock) {
            startedCodeBlock.content = [
              (startedCodeBlock.content[0] ? startedCodeBlock.content[0] : '') +
                blockToInsert.content[0].text,
            ]
          } else blocks.push(blockToInsert)
        }

        stack.push({level: headingLevel, block: blockToInsert})
      } else {
        // console.log(stack, blockToInsert, blocks)
        if (stack.length) {
          if (!hasMarkdown && previousBlock) {
            stack[stack.length - 1].block.children.push(previousBlock)
            previousBlock = undefined
          }
          if (
            blockToInsert.props.childrenType &&
            blockToInsert.props.childrenType !== 'Group'
          ) {
            stack[stack.length - 1].block.props.childrenType =
              blockToInsert.props.childrenType
            blockToInsert.props.childrenType = 'Group'
          }
          stack[stack.length - 1].block.children.push(blockToInsert)
        } else {
          // if (blockToInsert.type === 'code-block') {
          //   if (previousBlock) {
          //     blocks.push(previousBlock)
          //     previousBlock = undefined
          //   }
          //   if (startedCodeBlock) {
          //     startedCodeBlock.content = [
          //       {type: 'text', text: startedCodeBlock.content, styles: {}},
          //     ]
          //     blocks.push(startedCodeBlock)
          //     startedCodeBlock = undefined
          //   } else startedCodeBlock = blockToInsert
          //   console.log(blockToInsert, startedCodeBlock)
          // } else
          if (
            blockToInsert.props.childrenType &&
            blockToInsert.props.childrenType !== 'Group'
          ) {
            if (!previousBlock) {
              previousBlock = blocks.pop()
            }
            if (previousBlock) {
              previousBlock.children.push(blockToInsert)
              if (
                blockToInsert.props.childrenType !==
                previousBlock.props.childrenType
              ) {
                previousBlock.props.childrenType =
                  blockToInsert.props.childrenType
              }
            } else {
              blocks.push(blockToInsert)
            }
          } else {
            if (previousBlock) {
              blocks.push(previousBlock)
              previousBlock = undefined
            }

            if (startedCodeBlock) {
              startedCodeBlock.content = [
                (startedCodeBlock.content[0]
                  ? startedCodeBlock.content[0]
                  : '') + blockToInsert.content[0].text,
              ]
            } else blocks.push(blockToInsert)
          }
        }
      }
    }

    if (hasMarkdown) hasMarkdown = false
  })
  if (previousBlock) blocks.push(previousBlock)
  return blocks
}

function containsMarkdownSymbols(pastedText: string) {
  // Regex to detect Markdown syntax anywhere in the text
  const markdownUniqueSymbols = new RegExp(
    [
      '#{1,6} ', // Headers
      '[\\s]*[-+*] ', // Unordered Lists
      '\\d+\\. ', // Ordered Lists
      '[\\s]*> ', // Blockquotes
      '```', // Code Fences
      '^( {4,}.*)', // Indented Code Blocks
      '`[^`]+`', // Inline Code (Supports inside sentences)
      '\\[([^\\]]+)\\]\\(([^)]+)\\)', // Links (Supports inline)
      '(!\\[([^\\]]*)\\]\\(([^)]+)\\))', // Images (Standalone block only)
      '(\\*\\*|__)(.*?)\\1', // Bold (Supports inside sentences)
      '(\\*|_)(.*?)\\1', // Italic (Supports inside sentences)
      '~~(.*?)~~', // Strikethrough (Supports inside sentences)
    ].join('|'),
    'm', // Multi-line mode (optional, but kept for compatibility)
  )

  return markdownUniqueSymbols.test(pastedText)
}

// function containsMarkdownSymbols(pastedText: string) {
//   // Regex to detect unique Markdown symbols at the start of a line
//   const markdownUniqueSymbols = new RegExp(
//     [
//       '^#{1,6} ', // Headers
//       '^[\\s]*[-+*] ', // Unordered Lists
//       '^\\d+\\. ', // Ordered Lists
//       '^[\\s]*> ', // Blockquotes
//       '^```', // Code Fences
//       '^`[^`]+`$', // Inline Code
//       '^\\[([^\\]]+)\\]\\(([^)]+)\\)$', // Links
//       '^!\\[([^\\]]*)\\]\\(([^)]+)\\)$', // Images
//       '^(\\*\\*|__)(.*?)\\1$',
//       '^(\\*|_)(.*?)\\1$',
//       '^~~(.*?)~~$' // Strikethrough
//     ].join('|'),
//     'm',
//   )

//   // Split the text by lines and check each line
//   const lines = pastedText.split('\n').map((line) => line.trim())

//   // Ensure that at least one line contains valid Markdown symbols
//   return lines.some((line) => markdownUniqueSymbols.test(line))
// }

// Function to insert a group, if it is the only node being pasted.
function replaceSelectedBlock(group: Node, editor: Editor) {
  const {state, view} = editor
  const blockInfo = getBlockInfoFromSelection(state)
  // Check whether the block is empty.
  if (!state.selection.$from.parent.content.content.length) {
    const prevBlockInfo = getPrevBlockInfo(state.doc, blockInfo.block.beforePos)
    // Insert the pasted group content at the end of the previous block's child group,
    // or add a child group to the previous block.
    if (prevBlockInfo) {
      const {block, childContainer} = prevBlockInfo
      const newBlock = state.schema.nodes['blockContainer'].create(
        block.node.attrs,
        childContainer
          ? [
              block.node.firstChild!,
              state.schema.nodes['blockGroup'].create(
                childContainer.node.attrs,
                [
                  ...childContainer.node.content.content,
                  ...group.content.content,
                ],
              ),
            ]
          : block.node.content.addToEnd(group),
      )
      // setTimeout(() => {
      view.dispatch(
        state.tr.replaceRangeWith(
          block.beforePos + 1,
          block.afterPos - 1,
          newBlock,
        ),
      )
      // })

      return true
    }
    // Add the group's content to the child group selected. The selected block will be the
    // first child of the child group, because otherwise the first 'if' check would pass.
    else if (state.selection.$from.depth > 3) {
      const parentBlockInfo = getBlockInfoFromPos(
        state,
        state.selection.$from.start() - 4,
      )
      const {block, childContainer} = parentBlockInfo
      const newBlock = state.schema.nodes['blockContainer'].create(
        block.node.attrs,
        [block.node.firstChild!, group],
      )

      // setTimeout(() => {
      view.dispatch(
        state.tr.replaceRangeWith(
          block.beforePos + 1,
          block.afterPos - 1,
          newBlock,
        ),
      )
      // })
      return true
    }
  }
  return false
}

// Get nodes of a fragment or block group to be pasted
function getPastedNodes(parent: Node | Fragment, editor: Editor) {
  const nodes: Node[] = []
  parent.forEach((node) => {
    if (node.type.name === 'blockGroup') {
      const prevContainer = nodes.pop()
      if (prevContainer) {
        const container = editor.schema.nodes['blockContainer'].create(
          prevContainer.attrs,
          prevContainer.content.addToEnd(node),
        )
        nodes.push(container)
      }
    } else if (node.type.name !== 'blockContainer') {
      let nodeToInsert = node
      if (node.type.name === 'text') {
        nodeToInsert = editor.schema.nodes.paragraph.create({}, node)
      }
      const container = editor.schema.nodes['blockContainer'].create(
        null,
        nodeToInsert,
      )
      nodes.push(container)
    } else if (node.firstChild!.type.name === 'blockGroup') {
      const prevContainer = nodes.pop()
      if (prevContainer) {
        const container = editor.schema.nodes['blockContainer'].create(
          prevContainer.attrs,
          prevContainer.content.addToEnd(node.firstChild!),
        )
        nodes.push(container)
      } else if (!replaceSelectedBlock(node.firstChild!, editor)) {
        nodes.push(node.firstChild!)
      }
    } else nodes.push(node)
  })
  return nodes
}

export const createMarkdownExtension = (bnEditor: BlockNoteEditor) => {
  const MarkdownExtension = Extension.create({
    name: 'MarkdownPasteHandler',
    priority: 25,

    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handlePaste: (view, event, slice) => {
              const selectedNode = view.state.selection.$from.parent
              // Don't proceed if pasting into code block
              if (
                selectedNode.type.name === 'code-block' ||
                selectedNode.firstChild?.type.name === 'code-block'
              ) {
                return false
              }
              const pastedText = event.clipboardData!.getData('text/plain')
              const pastedHtml = event.clipboardData!.getData('text/html')
              const convertedNodes = analyzePastedContent(
                pastedText,
                pastedHtml,
                slice,
              )
              // console.log('lines:\n', convertedNodes)
              const hasList =
                pastedHtml.includes('<ul') || pastedHtml.includes('<ol')

              const {state} = view
              const {selection} = state

              const isMarkdown = pastedHtml
                ? containsMarkdownSymbols(pastedText)
                : pastedText
                ? true
                : false

              // console.log('is markdown and has list', isMarkdown, hasList)

              // Check if at least some content should be converted
              const hasMarkdown = convertedNodes.some((node) => node.isMarkdown)

              if (!hasMarkdown) {
                // Fallback: Paste everything normally if no Markdown detected
                return false
              }

              const firstBlockGroup =
                slice.content.firstChild?.type.name === 'blockGroup'

              const content = pastedNodesToBlocks(
                firstBlockGroup ? slice.content.firstChild : slice.content,
                this.editor,
                bnEditor,
              )

              console.log(content)

              if (
                state.selection.empty &&
                !state.selection.$from.parent.textContent.length
              )
                bnEditor.replaceBlocks(
                  [bnEditor.getTextCursorPosition().block.id],
                  content,
                )
              else
                bnEditor.insertBlocks(
                  content,
                  bnEditor.getTextCursorPosition().block.id,
                  'after',
                )

              setGroupTypes(this.editor, content)

              // const root = this.editor.schema.nodes['blockGroup'].create(
              //   {},
              //   content,
              // )
              // let tr = state.tr
              // tr = tr.replaceRangeWith(
              //   selection.from,
              //   selection.to,
              //   // @ts-ignore
              //   root.content.content,
              // )
              // view.dispatch(tr)

              // if (convertedNodes.length) {
              //   const content: Node[] = []
              //   convertedNodes.forEach((node) => {
              //     if (node.isMarkdown) {
              //       const blocks = SyncMarkdownToBlocks(
              //         node.node.textContent,
              //         bnEditor,
              //       )
              //       // console.log(blocks)
              //       const newNode = blockToNode(
              //         blocks[0],
              //         bnEditor._tiptapEditor.schema,
              //       )
              //       console.log(newNode)
              //     } else {
              //       content.push(node.node)
              //     }
              //   })
              //   // const root = this.editor.schema.nodes['blockGroup'].create(
              //   //   {},
              //   //   convertedNodes,
              //   // )
              //   // let tr = state.tr
              //   // tr = tr.replaceRangeWith(
              //   //   selection.from,
              //   //   selection.to,
              //   //   // @ts-ignore
              //   //   root.content.content,
              //   // )
              //   // view.dispatch(tr)
              // }

              // if (!isMarkdown) {
              //   if (hasList) {
              //     // const parser = new DOMParser()
              //     // const doc = parser.parseFromString(pastedHtml, 'text/html')
              //     // const ulElement = doc.body.querySelector('ul')
              //     // const olElement = doc.body.querySelector('ol')
              //     // const findPositions = [
              //     //   {node: ulElement!, offset: 0},
              //     //   {node: olElement!, offset: 0},
              //     // ]
              //     // const fragment = ProseMirrorDOMParser.fromSchema(
              //     //   view.state.schema,
              //     // ).parse(doc.body, {
              //     //   findPositions: findPositions,
              //     // })

              //     // If pasting HM editor content, first block will be block group
              //     const firstBlockGroup =
              //       slice.content.firstChild?.type.name === 'blockGroup'
              //     const nodes: Node[] = getPastedNodes(
              //       firstBlockGroup ? slice.content.firstChild : slice.content,
              //       this.editor,
              //     )

              //     if (nodes.length) {
              //       const root = this.editor.schema.nodes['blockGroup'].create(
              //         {},
              //         nodes,
              //       )
              //       let tr = state.tr
              //       tr = tr.replaceRangeWith(
              //         selection.from,
              //         selection.to,
              //         // @ts-ignore
              //         root.content.content,
              //       )
              //       view.dispatch(tr)
              //     }
              //     return true
              //   }
              //   return false
              // }

              // Convert only Markdown-like lines, keep others unchanged

              // MarkdownToBlocks(markdownLines, bnEditor).then(
              //   (organizedBlocks) => {
              //     console.log(organizedBlocks)

              //     const blockInfo = getBlockInfoFromSelection(view.state)

              //     bnEditor.replaceBlocks(
              //       [blockInfo.block.node.attrs.id],
              //       // @ts-ignore
              //       organizedBlocks,
              //     )

              //     setGroupTypes(bnEditor._tiptapEditor, organizedBlocks)
              //   },
              // )

              // console.log('pasted text and html', pastedText, pastedHtml)

              // if (!isMarkdown) {
              //   if (hasList) {
              //     // const parser = new DOMParser()
              //     // const doc = parser.parseFromString(pastedHtml, 'text/html')
              //     // const ulElement = doc.body.querySelector('ul')
              //     // const olElement = doc.body.querySelector('ol')
              //     // const findPositions = [
              //     //   {node: ulElement!, offset: 0},
              //     //   {node: olElement!, offset: 0},
              //     // ]
              //     // const fragment = ProseMirrorDOMParser.fromSchema(
              //     //   view.state.schema,
              //     // ).parse(doc.body, {
              //     //   findPositions: findPositions,
              //     // })

              //     // If pasting HM editor content, first block will be block group
              //     const firstBlockGroup =
              //       slice.content.firstChild?.type.name === 'blockGroup'
              //     const nodes: Node[] = getPastedNodes(
              //       firstBlockGroup ? slice.content.firstChild : slice.content,
              //       this.editor,
              //     )

              //     if (nodes.length) {
              //       const root = this.editor.schema.nodes['blockGroup'].create(
              //         {},
              //         nodes,
              //       )
              //       let tr = state.tr
              //       tr = tr.replaceRangeWith(
              //         selection.from,
              //         selection.to,
              //         // @ts-ignore
              //         root.content.content,
              //       )
              //       view.dispatch(tr)
              //     }
              //     return true
              //   }
              //   return false
              // }

              // MarkdownToBlocks(pastedText, bnEditor).then((organizedBlocks) => {
              //   console.log(organizedBlocks)
              //   const blockInfo = getBlockInfoFromSelection(state)

              //   bnEditor.replaceBlocks(
              //     [blockInfo.block.node.attrs.id],
              //     // @ts-ignore
              //     organizedBlocks,
              //   )
              //   setGroupTypes(bnEditor._tiptapEditor, organizedBlocks)
              // })

              return true
            },
          },
        }),
      ]
    },
  })

  return MarkdownExtension
}
