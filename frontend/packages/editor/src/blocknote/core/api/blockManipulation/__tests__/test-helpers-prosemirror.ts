import {Schema} from 'prosemirror-model'
import {EditorState} from 'prosemirror-state'
import {Node as PMNode} from 'prosemirror-model'

/**
 * Creates a minimal ProseMirror schema for testing list commands.
 * This bypasses TipTap to avoid loading React/UI dependencies.
 */
export function createMinimalSchema(): Schema {
  return new Schema({
    nodes: {
      doc: {
        content: 'blockGroup',
      },
      blockContainer: {
        content: 'paragraph (blockGroup | listGroup)?',
        attrs: {id: {default: null}},
        parseDOM: [{tag: 'div[data-node-type="blockContainer"]'}],
        toDOM() {
          return ['div', {'data-node-type': 'blockContainer'}, 0]
        },
      },
      blockGroup: {
        content: 'blockContainer+',
        parseDOM: [{tag: 'div[data-node-type="blockGroup"]'}],
        toDOM() {
          return ['div', {'data-node-type': 'blockGroup'}, 0]
        },
      },
      listGroup: {
        content: 'listContainer+',
        attrs: {
          listType: {default: 'Unordered'},
          listLevel: {default: '1'},
        },
        parseDOM: [
          {tag: 'ul', attrs: {listType: 'Unordered'}},
          {tag: 'ol', attrs: {listType: 'Ordered'}},
        ],
        toDOM(node) {
          const tag = node.attrs.listType === 'Ordered' ? 'ol' : 'ul'
          return [tag, 0]
        },
      },
      listContainer: {
        content: 'paragraph (blockGroup | listGroup)?',
        attrs: {id: {default: null}},
        parseDOM: [{tag: 'li'}],
        toDOM() {
          return ['li', 0]
        },
      },
      paragraph: {
        content: 'text*',
        parseDOM: [{tag: 'p'}],
        toDOM() {
          return ['p', 0]
        },
      },
      text: {
        group: 'inline',
      },
    },
  })
}

/**
 * Creates a document with a blockGroup containing a blockContainer with text.
 * Structure: doc > blockContainer > paragraph + blockGroup > blockContainer > paragraph("Hello")
 */
export function createDocWithBlockGroup(
  schema: Schema,
  text: string = 'Hello',
): PMNode {
  const innerPara = schema.nodes.paragraph.create(null, schema.text(text))
  const innerContainer = schema.nodes.blockContainer.create(
    {id: 'test-1'},
    innerPara,
  )
  const blockGroup = schema.nodes.blockGroup.create(null, innerContainer)

  const rootPara = schema.nodes.paragraph.create()
  const rootContainer = schema.nodes.blockContainer.create(
    {id: 'root'},
    [rootPara, blockGroup],
  )

  return schema.nodes.doc.create(null, rootContainer)
}

/**
 * Loads a document from JSON fixture.
 * This is easier than manually building nodes - just export JSON from your editor!
 */
export function createDocFromJSON(schema: Schema, json: any): PMNode {
  return schema.nodeFromJSON(json)
}

/**
 * Helper to print document structure for debugging
 */
export function printDoc(doc: PMNode, indent: string = ''): string {
  const lines: string[] = []

  function traverse(node: PMNode, depth: number = 0) {
    const pad = '  '.repeat(depth)
    const attrs =
      Object.keys(node.attrs).length > 0 ? ` ${JSON.stringify(node.attrs)}` : ''
    const text = node.isText ? ` "${node.text}"` : ''
    lines.push(`${pad}${node.type.name}${attrs}${text}`)

    node.forEach((child) => traverse(child, depth + 1))
  }

  traverse(doc)
  return lines.join('\n')
}

/**
 * Find a position inside a block by its id attribute.
 * Returns a position inside the block's first text content.
 */
export function findPosInBlock(doc: PMNode, blockId: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (
      found === -1 &&
      (node.type.name === 'blockContainer' ||
        node.type.name === 'listContainer') &&
      node.attrs.id === blockId
    ) {
      // pos = start of node, +1 = inside node, +1 = inside paragraph content
      found = pos + 2
    }
  })
  if (found === -1) throw new Error(`Block with id "${blockId}" not found`)
  return found
}

/**
 * Find a position inside the last container in the document.
 * Useful when the target container has a null id.
 */
export function findPosInLastContainer(doc: PMNode): number {
  let lastPos = -1
  doc.descendants((node, pos) => {
    if (
      node.type.name === 'blockContainer' ||
      node.type.name === 'listContainer'
    ) {
      lastPos = pos + 2
    }
  })
  if (lastPos === -1) throw new Error('No container found')
  return lastPos
}

/**
 * Creates a mock Editor object for commands that need it.
 * Most commands just need state and dispatch.
 */
export function createMockEditor(state: EditorState) {
  const editor: any = {
    state,
    schema: state.schema,
    commands: {
      command: (cmd: any) => {
        // Execute the command synchronously for testing
        if (typeof cmd === 'function') {
          return cmd({
            editor,
            state,
            dispatch: undefined, // Don't dispatch in nested commands during tests
          })
        }
        return true
      },
    },
    chain: () => ({
      run: () => true,
      command: () => ({run: () => true}),
      sinkListItem: () => ({run: () => true, command: () => ({run: () => true})}),
    }),
  }
  return editor
}
