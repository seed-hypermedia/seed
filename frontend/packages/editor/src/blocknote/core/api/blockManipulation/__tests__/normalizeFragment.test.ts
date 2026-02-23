import {Fragment, Schema} from 'prosemirror-model'
import {beforeEach, describe, expect, it} from 'vitest'
import {
  normalizeBlockContainer,
  normalizeFragment,
  splitBlockContainerNode,
} from '../../../extensions/Blocks/nodes/normalizeFragment'
import {createMinimalSchema} from './test-helpers-prosemirror'

describe('normalizeFragment — paste normalization', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createMinimalSchema()
  })

  // Helpers
  function para(text?: string) {
    return text
      ? schema.nodes['paragraph']!.create(null, schema.text(text))
      : schema.nodes['paragraph']!.create()
  }

  function bn(attrs: any, ...children: any[]) {
    return schema.nodes['blockNode']!.create(attrs, children)
  }

  function bc(attrs: any, children: any[]) {
    return schema.nodes['blockChildren']!.create(attrs, children)
  }

  function group(children: any[]) {
    return bc({listType: 'Group', listLevel: '1'}, children)
  }

  function ulist(children: any[], level = '1') {
    return bc({listType: 'Unordered', listLevel: level}, children)
  }

  describe('splitBlockContainerNode', () => {
    // Valid blockNode (1 paragraph), no split
    it('returns single-element array for valid blockNode', () => {
      const node = bn({id: null}, para('Hello'))
      const result = splitBlockContainerNode(node)
      expect(result).toHaveLength(1)
      expect(result[0].firstChild.textContent).toBe('Hello')
    })

    // Invalid blockNode (2 paragraphs), split into 2
    //
    //   blockNode (id: "test")
    //     paragraph "First"
    //     paragraph "Second"
    //   →
    //   [blockNode(paragraph "First"), blockNode(paragraph "Second")]
    //
    it('splits blockNode with multiple paragraphs', () => {
      const node = schema.nodes['blockNode']!.create({id: 'test'}, [
        para('First'),
        para('Second'),
      ])
      const result = splitBlockContainerNode(node)
      expect(result).toHaveLength(2)
      expect(result[0].firstChild.textContent).toBe('First')
      expect(result[1].firstChild.textContent).toBe('Second')
      // ID cleared on split nodes. NodeConversion will set new IDs
      expect(result[0].attrs.id).toBeNull()
      expect(result[1].attrs.id).toBeNull()
    })

    // blockChildren assigned to last split node
    //
    //   blockNode
    //     paragraph "First"
    //     paragraph "Second"
    //     blockChildren (Group)
    //   →
    //   [blockNode(paragraph "First"),
    //    blockNode(paragraph "Second", blockChildren)]
    //
    it('assigns blockChildren to last split node', () => {
      const children = group([bn({id: null}, para('Child'))])
      const node = schema.nodes['blockNode']!.create({id: null}, [
        para('First'),
        para('Second'),
        children,
      ])
      const result = splitBlockContainerNode(node)
      expect(result).toHaveLength(2)
      expect(result[0].childCount).toBe(1) // just paragraph
      expect(result[1].childCount).toBe(2) // paragraph + blockChildren
      expect(result[1].lastChild.type.name).toBe('blockChildren')
    })
  })

  describe('normalizeBlockContainer', () => {
    // blockNode with only blockChildren → prepends empty paragraph
    //
    //   blockNode
    //     blockChildren (Group)
    //   →
    //   blockNode
    //     paragraph ""
    //     blockChildren (Group)
    //
    it('prepends empty paragraph when blockNode has only blockChildren', () => {
      const node = schema.nodes['blockNode']!.create({id: null}, [
        group([bn({id: null}, para('Child'))]),
      ])
      const result = normalizeBlockContainer(node, schema)
      expect(result.childCount).toBe(2)
      expect(result.firstChild.type.name).toBe('paragraph')
      expect(result.firstChild.textContent).toBe('')
      expect(result.lastChild.type.name).toBe('blockChildren')
    })

    // Valid blockNode → unchanged
    it('leaves valid blockNode unchanged', () => {
      const node = bn({id: 'a'}, para('Hello'))
      const result = normalizeBlockContainer(node, schema)
      expect(result.firstChild.textContent).toBe('Hello')
      expect(result.childCount).toBe(1)
    })
  })

  describe('flatten Group without nested lists', () => {
    // Group blockChildren with simple children → flattened
    //
    //   Fragment:
    //     blockChildren (Group)
    //       blockNode (A)
    //       blockNode (B)
    //   →
    //   Fragment:
    //     blockNode (A)
    //     blockNode (B)
    //
    it('extracts children from Group blockChildren', () => {
      const fragment = Fragment.from([
        group([bn({id: 'a'}, para('A')), bn({id: 'b'}, para('B'))]),
      ])
      const result = normalizeFragment(fragment, schema)
      expect(result.childCount).toBe(2)
      expect(result.child(0).type.name).toBe('blockNode')
      expect(result.child(0).firstChild!.textContent).toBe('A')
      expect(result.child(1).firstChild!.textContent).toBe('B')
    })

    // Group with nested lists → NOT flattened, wrapped in blockNode
    //
    //   Fragment:
    //     blockChildren (Group)
    //       blockNode (A)
    //         blockChildren (Group)
    //           blockNode (C)
    //       blockNode (B)
    //   →
    //   Fragment:
    //     blockNode
    //       paragraph ""
    //       blockChildren (Group)
    //         ...
    //
    it('does NOT flatten Group with nested lists', () => {
      const fragment = Fragment.from([
        group([
          bn({id: 'a'}, para('A'), group([bn({id: 'c'}, para('C'))])),
          bn({id: 'b'}, para('B')),
        ]),
      ])
      const result = normalizeFragment(fragment, schema)
      expect(result.childCount).toBe(1)
      expect(result.child(0).type.name).toBe('blockNode')
    })
  })

  describe('wrap orphan nodes', () => {
    // Orphan paragraph → wrapped in blockNode
    //
    //   Fragment:
    //     paragraph "Hello"
    //   →
    //   Fragment:
    //     blockNode
    //       paragraph "Hello"
    //
    it('wraps orphan paragraph in blockNode', () => {
      const fragment = Fragment.from([para('Hello')])
      const result = normalizeFragment(fragment, schema)
      expect(result.childCount).toBe(1)
      expect(result.child(0).type.name).toBe('blockNode')
      expect(result.child(0).firstChild!.textContent).toBe('Hello')
    })

    // Orphan list blockChildren → wrapped in blockNode with empty paragraph
    //
    //   Fragment:
    //     blockChildren (Unordered)
    //       blockNode (paragraph "Item")
    //   →
    //   Fragment:
    //     blockNode
    //       paragraph ""
    //       blockChildren (Unordered)
    //         blockNode (paragraph "Item")
    //
    it('wraps orphan list blockChildren in blockNode with empty paragraph', () => {
      const fragment = Fragment.from([ulist([bn({id: null}, para('Item'))])])
      const result = normalizeFragment(fragment, schema)
      expect(result.childCount).toBe(1)
      const wrapper = result.child(0)
      expect(wrapper.type.name).toBe('blockNode')
      expect(wrapper.firstChild!.type.name).toBe('paragraph')
      expect(wrapper.firstChild!.textContent).toBe('')
      expect(wrapper.lastChild!.type.name).toBe('blockChildren')
      expect(wrapper.lastChild!.attrs.listType).toBe('Unordered')
    })
  })

  describe('merge blockChildren into previous blockNode', () => {
    // [blockNode, blockChildren] → blockChildren merged into blockNode
    //
    //   Fragment:
    //     blockNode (paragraph "A")
    //     blockChildren (Unordered)
    //       blockNode (paragraph "Item")
    //   →
    //   Fragment:
    //     blockNode
    //       paragraph "A"
    //       blockChildren (Unordered)
    //         blockNode (paragraph "Item")
    //
    it('merges blockChildren into preceding blockNode', () => {
      const fragment = Fragment.from([
        bn({id: 'a'}, para('A')),
        ulist([bn({id: null}, para('Item'))]),
      ])
      const result = normalizeFragment(fragment, schema)
      expect(result.childCount).toBe(1)
      const merged = result.child(0)
      expect(merged.type.name).toBe('blockNode')
      expect(merged.firstChild!.textContent).toBe('A')
      expect(merged.lastChild!.type.name).toBe('blockChildren')
      expect(merged.lastChild!.attrs.listType).toBe('Unordered')
    })
  })

  describe('unwrap empty wrapper', () => {
    // blockChildren(Group) > blockNode(emptyPara + blockChildren(Unordered))
    // → inner blockChildren unwrapped and re-wrapped in new blockNode
    //
    //   Fragment:
    //     blockChildren (Group)
    //       blockNode
    //         paragraph ""
    //         blockChildren (Unordered)
    //           blockNode (paragraph "Item")
    //   →
    //   Fragment:
    //     blockNode
    //       paragraph ""
    //       blockChildren (Unordered)
    //         blockNode (paragraph "Item")
    //
    it('unwraps nested blockChildren from empty wrapper blockNode', () => {
      const inner = ulist([bn({id: null}, para('Item'))])
      const wrapper = group([bn({id: null}, para(), inner)])
      const fragment = Fragment.from([wrapper])
      const result = normalizeFragment(fragment, schema)

      expect(result.childCount).toBe(1)
      const node = result.child(0)
      expect(node.type.name).toBe('blockNode')
      expect(node.firstChild!.type.name).toBe('paragraph')
      expect(node.firstChild!.textContent).toBe('')
      expect(node.lastChild!.type.name).toBe('blockChildren')
      expect(node.lastChild!.attrs.listType).toBe('Unordered')
    })
  })

  describe('without schema', () => {
    // Without schema, orphan block nodes pass through unwrapped
    it('passes through orphan paragraphs without wrapping', () => {
      const fragment = Fragment.from([para('Hello')])
      const result = normalizeFragment(fragment)
      expect(result.childCount).toBe(1)
      expect(result.child(0).type.name).toBe('paragraph')
    })

    // Group flattening works without schema too
    it('flattens Group blockChildren', () => {
      const fragment = Fragment.from([
        group([bn({id: 'a'}, para('A')), bn({id: 'b'}, para('B'))]),
      ])
      const result = normalizeFragment(fragment)
      expect(result.childCount).toBe(2)
      expect(result.child(0).firstChild!.textContent).toBe('A')
      expect(result.child(1).firstChild!.textContent).toBe('B')
    })
  })
})
