/**
 * Tests for blockToNode — specifically the code-block edge cases.
 *
 * Regression test for: https://github.com/seed-hypermedia/seed/issues/427
 * "Can't edit a document that has an empty code block"
 *
 * ProseMirror throws `RangeError: Empty text nodes are not allowed` when
 * schema.text('') is called. The blockToNode code-block branch must guard
 * against creating a text node from an empty string.
 */
import {Schema} from 'prosemirror-model'
import {describe, expect, it} from 'vitest'
import {blockToNode} from '../nodeConversions'

/**
 * Minimal ProseMirror schema that includes the nodes blockToNode needs:
 *   doc > blockChildren > blockNode > (code-block | paragraph) + blockChildren?
 *
 * The code-block node uses `content: 'text*'` to match the real extension.
 */
function createSchemaWithCodeBlock(): Schema {
  return new Schema({
    nodes: {
      doc: {content: 'blockChildren'},
      blockChildren: {
        content: 'blockNode+',
        attrs: {
          listType: {default: 'Group'},
          listLevel: {default: '1'},
          columnCount: {default: null},
        },
      },
      blockNode: {
        content: 'blockContent blockChildren?',
        attrs: {id: {default: ''}},
      },
      blockContent: {
        content: 'text*',
        group: 'block',
      },
      // The actual code-block node type used by the editor
      'code-block': {
        content: 'text*',
        group: 'block',
        attrs: {
          language: {default: ''},
          backgroundColor: {default: 'default'},
          textColor: {default: 'default'},
          textAlignment: {default: 'left'},
        },
      },
      paragraph: {
        content: 'text*',
        group: 'block',
        attrs: {
          backgroundColor: {default: 'default'},
          textColor: {default: 'default'},
          textAlignment: {default: 'left'},
        },
      },
      text: {group: 'inline'},
    },
  })
}

describe('blockToNode — code-block', () => {
  it('converts a code-block with content without throwing', () => {
    const schema = createSchemaWithCodeBlock()
    const block = {
      id: 'b1',
      type: 'code-block' as const,
      props: {language: 'typescript', backgroundColor: 'default', textColor: 'default', textAlignment: 'left'},
      content: [{type: 'text' as const, text: 'const x = 1', styles: {}}],
      children: [],
    }

    expect(() => blockToNode(block, schema)).not.toThrow()
    const node = blockToNode(block, schema)
    // The content node (code-block) should have the text as its child
    expect(node.firstChild?.textContent).toBe('const x = 1')
  })

  it('converts an empty code-block without throwing (regression #427)', () => {
    // Before the fix, this threw: RangeError: Empty text nodes are not allowed
    const schema = createSchemaWithCodeBlock()
    const block = {
      id: 'b1',
      type: 'code-block' as const,
      props: {language: '', backgroundColor: 'default', textColor: 'default', textAlignment: 'left'},
      content: [{type: 'text' as const, text: '', styles: {}}],
      children: [],
    }

    expect(() => blockToNode(block, schema)).not.toThrow()
    const node = blockToNode(block, schema)
    // Empty code-block should produce a node with no text content
    expect(node.firstChild?.textContent).toBe('')
  })

  it('converts a code-block with no content array without throwing', () => {
    const schema = createSchemaWithCodeBlock()
    const block = {
      id: 'b1',
      type: 'code-block' as const,
      props: {language: '', backgroundColor: 'default', textColor: 'default', textAlignment: 'left'},
      content: [] as {type: 'text'; text: string; styles: {}}[],
      children: [],
    }

    expect(() => blockToNode(block, schema)).not.toThrow()
  })
})
