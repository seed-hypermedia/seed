import {getSchema} from '@tiptap/core'
import {Editor} from '@tiptap/core'
import {EditorState} from 'prosemirror-state'
import {Node as PMNode, Schema} from 'prosemirror-model'
import {
  BlockContainer,
  BlockGroup,
  Doc,
  ListContainer,
  ListGroup,
} from '../../../extensions/Blocks'
import {ParagraphBlockContent} from '../../../extensions/Blocks/nodes/BlockContent/ParagraphBlockContent/ParagraphBlockContent'
import {Text} from '@tiptap/extension-text'

/**
 * Creates a minimal TipTap editor for testing
 */
export function createTestEditor(content?: PMNode): Editor {
  const editor = new Editor({
    extensions: [
      Doc,
      BlockContainer,
      BlockGroup,
      ListContainer,
      ListGroup,
      ParagraphBlockContent,
      Text,
    ],
    content: content ? content.toJSON() : undefined,
  })

  return editor
}

/**
 * Creates a simple EditorState for command testing without full TipTap editor
 */
export function createTestState(doc: PMNode): EditorState {
  const schema = createTestSchema()
  return EditorState.create({
    doc,
    schema,
  })
}

/**
 * Creates the schema with all node types needed for testing
 */
export function createTestSchema(): Schema {
  // Use TipTap's getSchema to build the schema from extensions
  const extensions = [
    Doc,
    BlockContainer,
    BlockGroup,
    ListContainer,
    ListGroup,
    ParagraphBlockContent,
    Text,
  ]

  return getSchema(extensions)
}

/**
 * Helper to create a blockGroup with a single blockContainer containing a paragraph
 */
export function createBlockGroupWithParagraph(
  schema: Schema,
  text: string = 'Hello',
): PMNode {
  const paragraph = schema.nodes['paragraph']!.create(null, schema.text(text))
  const blockContainer = schema.nodes['blockContainer']!.create({id: 'test-1'}, [
    paragraph,
  ])
  const blockGroup = schema.nodes['blockGroup']!.create(null, [blockContainer])

  return blockGroup
}

/**
 * Helper to create a document with a blockGroup
 */
export function createDocWithBlockGroup(
  schema: Schema,
  text: string = 'Hello',
): PMNode {
  const blockGroup = createBlockGroupWithParagraph(schema, text)
  const blockContainer = schema.nodes['blockContainer']!.create(
    {id: 'root-1'},
    [schema.nodes['paragraph']!.create(null, schema.text('Root')), blockGroup],
  )

  return schema.nodes['doc']!.create(null, [blockContainer])
}

/**
 * Helper to print document structure for debugging
 */
export function printDocStructure(doc: PMNode): string {
  const lines: string[] = []

  function traverse(node: PMNode, depth: number = 0) {
    const indent = '  '.repeat(depth)
    const attrs = Object.keys(node.attrs).length
      ? ` ${JSON.stringify(node.attrs)}`
      : ''
    lines.push(`${indent}${node.type.name}${attrs}`)

    node.forEach((child) => traverse(child, depth + 1))
  }

  traverse(doc)
  return lines.join('\n')
}
