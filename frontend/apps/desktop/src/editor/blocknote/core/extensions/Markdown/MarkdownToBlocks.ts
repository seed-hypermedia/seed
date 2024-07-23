import {hmBlockSchema} from '@/editor/schema'
import {DOMParser as ProseMirrorDOMParser} from '@tiptap/pm/model'
import rehypeStringify from 'rehype-stringify'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {unified} from 'unified'
import {Block, BlockNoteEditor, BlockSchema, nodeToBlock} from '../..'

export const MarkdownToBlocks = async (
  markdown: string,
  editor: BlockNoteEditor,
) => {
  const blocks: Block<BlockSchema>[] = []
  const organizedBlocks: Block<BlockSchema>[] = []

  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown)

  const parser = new DOMParser()
  const doc = parser.parseFromString(file.value.toString(), 'text/html')

  const {view} = editor._tiptapEditor
  const {state} = view
  const {selection} = state

  // Get ProseMirror fragment from pasted markdown, previously converted to HTML
  const fragment = ProseMirrorDOMParser.fromSchema(view.state.schema).parse(
    doc.body,
  )
  fragment.firstChild!.content.forEach((node) => {
    if (node.type.name !== 'blockContainer') {
      return false
    }
    blocks.push(nodeToBlock(node, hmBlockSchema))
  })

  // Function to determine heading level
  const getHeadingLevel = (block: Block<BlockSchema>) => {
    if (block.type.startsWith('heading')) {
      return parseInt(block.props.level, 10)
    }
    return 0
  }

  // Stack to track heading levels for hierarchy
  const stack: {level: number; block: Block<BlockSchema>}[] = []

  blocks.forEach((block) => {
    const headingLevel = getHeadingLevel(block)

    if (headingLevel > 0) {
      while (stack.length && stack[stack.length - 1].level >= headingLevel) {
        stack.pop()
      }

      if (stack.length) {
        stack[stack.length - 1].block.children.push(block)
      } else {
        organizedBlocks.push(block)
      }

      stack.push({level: headingLevel, block})
    } else {
      if (stack.length) {
        stack[stack.length - 1].block.children.push(block)
      } else {
        organizedBlocks.push(block)
      }
    }
  })
  return organizedBlocks
}
