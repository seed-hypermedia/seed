import {Node as PMNode, Schema} from 'prosemirror-model'
import {liftListItem, sinkListItem} from 'prosemirror-schema-list'
import {EditorState} from 'prosemirror-state'

/**
 * Minimal ProseMirror schema matching the unified editor architecture.
 * Bypasses TipTap to avoid loading React/UI dependencies.
 *
 * Schema: doc > blockChildren > blockNode+ > paragraph + blockChildren?
 */
export function createMinimalSchema(): Schema {
  return new Schema({
    nodes: {
      doc: {
        content: 'blockChildren',
      },
      blockChildren: {
        content: 'blockNode+',
        attrs: {
          listType: {default: 'Group'},
          listLevel: {default: '1'},
        },
      },
      blockNode: {
        content: 'paragraph blockChildren?',
        group: 'blockNodeChild block',
        attrs: {id: {default: null}},
      },
      paragraph: {
        content: 'text*',
        group: 'block',
      },
      text: {
        group: 'inline',
      },
    },
  })
}

/**
 * Loads a document from JSON fixture.
 */
export function createDocFromJSON(schema: Schema, json: any): PMNode {
  return schema.nodeFromJSON(json)
}

/**
 * Block type for document builder
 */
export type BlockDef = {
  id?: string
  text: string
  children?: {
    listType?: string
    listLevel?: string
    blocks: BlockDef[]
  }
}

/**
 * Declarative document builder
 */
export function buildDoc(
  schema: Schema,
  blocks: BlockDef[],
  opts?: {listType?: string; listLevel?: string},
): PMNode {
  function buildBlockNode(def: BlockDef): PMNode {
    const paragraph = def.text
      ? schema.nodes['paragraph']!.create(null, schema.text(def.text))
      : schema.nodes['paragraph']!.create()
    const content: PMNode[] = [paragraph]
    if (def.children) {
      content.push(buildBlockChildren(def.children.blocks, def.children))
    }
    return schema.nodes['blockNode']!.create({id: def.id ?? null}, content)
  }

  function buildBlockChildren(
    defs: BlockDef[],
    groupOpts?: {listType?: string; listLevel?: string},
  ): PMNode {
    return schema.nodes['blockChildren']!.create(
      {
        listType: groupOpts?.listType ?? 'Group',
        listLevel: groupOpts?.listLevel ?? '1',
      },
      defs.map(buildBlockNode),
    )
  }

  return schema.nodes['doc']!.create(null, buildBlockChildren(blocks, opts))
}

/**
 * Print document structure for debugging.
 */
export function printDoc(doc: PMNode): string {
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
 * Find a position inside a blockNode by its id attribute.
 * Returns a position inside the block's paragraph content.
 */
export function findPosInBlock(doc: PMNode, blockId: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (
      found === -1 &&
      node.type.name === 'blockNode' &&
      node.attrs.id === blockId
    ) {
      // pos = start of blockNode, +1 = inside blockNode, +1 = inside paragraph
      found = pos + 2
    }
  })
  if (found === -1) throw new Error(`Block with id "${blockId}" not found`)
  return found
}

/**
 * Find a position inside the last blockNode in the document.
 * Useful when the target block has a null id.
 */
export function findPosInLastBlock(doc: PMNode): number {
  let lastPos = -1
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockNode') {
      lastPos = pos + 2
    }
  })
  if (lastPos === -1) throw new Error('No blockNode found')
  return lastPos
}

/**
 * Wraps EditorState so that `.tr` always returns the same Transaction,
 * mirroring TipTap's chainableState behavior. This allows commands to
 * call `state.tr.delete(...)`, `state.tr.insert(...)`, etc. on a single
 * shared transaction rather than creating a new one each time.
 */
function createChainableState(state: EditorState): any {
  const tr = state.tr
  return new Proxy(state, {
    get(target, prop, receiver) {
      if (prop === 'tr') return tr
      if (prop === 'doc') return tr.doc
      if (prop === 'selection') return tr.selection
      return Reflect.get(target, prop, receiver)
    },
  })
}

/**
 * Creates a mock Editor with a working chain() that executes commands
 * sequentially, updating state between each step.
 * Uses real ProseMirror sinkListItem and liftListItem commands for nest/unnest operations.
 */
export function createMockEditor(initialState: EditorState) {
  const editor: any = {
    _state: initialState,
    get state() {
      return this._state
    },
    set state(s: EditorState) {
      this._state = s
    },
    get schema() {
      return this._state.schema
    },
    commands: {
      command: (cmd: any) => {
        if (typeof cmd === 'function') {
          let success = false
          const chainable = createChainableState(editor._state)
          cmd({
            editor,
            state: chainable,
            dispatch: (tr: any) => {
              editor._state = editor._state.apply(tr)
              success = true
            },
          })
          return success
        }
        return true
      },
      liftListItem: (nodeTypeName: string) => {
        const nodeType = editor._state.schema.nodes[nodeTypeName]
        const cmd = liftListItem(nodeType)
        let success = false
        cmd(editor._state, (tr) => {
          editor._state = editor._state.apply(tr)
          success = true
        })
        return success
      },
    },
    chain: () => {
      const commands: Array<() => boolean> = []

      const chainObj: any = {
        sinkListItem: (nodeTypeName: string) => {
          commands.push(() => {
            const nodeType = editor._state.schema.nodes[nodeTypeName]
            const cmd = sinkListItem(nodeType)
            let success = false
            cmd(editor._state, (tr) => {
              editor._state = editor._state.apply(tr)
              success = true
            })
            return success
          })
          return chainObj
        },
        liftListItem: (nodeTypeName: string) => {
          commands.push(() => {
            const nodeType = editor._state.schema.nodes[nodeTypeName]
            const cmd = liftListItem(nodeType)
            let success = false
            cmd(editor._state, (tr) => {
              editor._state = editor._state.apply(tr)
              success = true
            })
            return success
          })
          return chainObj
        },
        command: (cmd: any) => {
          commands.push(() => {
            const fn = typeof cmd === 'function' ? cmd : () => false
            let success = false
            const chainable = createChainableState(editor._state)
            fn({
              editor,
              state: chainable,
              dispatch: (tr: any) => {
                editor._state = editor._state.apply(tr)
                success = true
              },
            })
            return success
          })
          return chainObj
        },
        run: () => {
          for (const cmd of commands) {
            cmd()
          }
          return true
        },
      }

      return chainObj
    },
  }
  return editor
}
