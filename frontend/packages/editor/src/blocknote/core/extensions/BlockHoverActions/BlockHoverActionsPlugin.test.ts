import {Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {afterEach, describe, expect, it} from 'vitest'
import {BlockHoverActionsProsemirrorPlugin, BlockHoverActionsState} from './BlockHoverActionsPlugin'

const schema = new Schema({
  nodes: {
    doc: {content: 'blockNode+'},
    blockNode: {
      content: 'paragraph blockChildren?',
      attrs: {id: {default: ''}},
      toDOM: (node) => ['div', {'data-node-type': 'blockNode', 'data-id': node.attrs.id}, 0],
    },
    blockChildren: {
      content: 'blockNode+',
      toDOM: () => ['div', {'data-node-type': 'blockChildren'}, 0],
    },
    paragraph: {content: 'text*', toDOM: () => ['p', {'data-content-type': 'paragraph'}, 0]},
    text: {group: 'inline'},
  },
})

const views: EditorView[] = []
const mounts: HTMLElement[] = []

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy()
  }
  for (const mount of mounts.splice(0)) {
    mount.remove()
  }
})

function createView(editable: boolean, doc = createSingleBlockDoc()) {
  const hoverActions = new BlockHoverActionsProsemirrorPlugin({} as any)
  const updates: BlockHoverActionsState[] = []
  hoverActions.onUpdate((state) => updates.push(state))

  const state = EditorState.create({doc, plugins: [hoverActions.plugin]})
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  mounts.push(mount)

  const view = new EditorView(mount, {
    state,
    editable: () => editable,
  })
  views.push(view)

  return {view, updates}
}

function createSingleBlockDoc() {
  return schema.nodes.doc.create(
    null,
    schema.nodes.blockNode.create({id: 'block-1'}, schema.nodes.paragraph.create(null, schema.text('hello world'))),
  )
}

function createNestedBlockDoc() {
  return schema.nodes.doc.create(
    null,
    schema.nodes.blockNode.create({id: 'parent'}, [
      schema.nodes.paragraph.create(null, schema.text('parent')),
      schema.nodes.blockChildren.create(
        null,
        schema.nodes.blockNode.create({id: 'child'}, schema.nodes.paragraph.create(null, schema.text('child'))),
      ),
    ]),
  )
}

function dispatchMouseMove(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('mousemove', {clientX: 10, clientY: 10, bubbles: true}))
}

function setRect(element: HTMLElement, rect: Partial<DOMRect>) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        top: 0,
        right: 100,
        bottom: 20,
        left: 0,
        width: 100,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
        ...rect,
      }) as DOMRect,
  })
}

describe('BlockHoverActionsProsemirrorPlugin', () => {
  it('emits hover state while the editor is editable', () => {
    const {view, updates} = createView(true)

    dispatchMouseMove(view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement)

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'block-1'})
  })

  it('hides when text selection is active', () => {
    const {view, updates} = createView(true)
    dispatchMouseMove(view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement)

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 8)))

    expect(updates.at(-1)).toMatchObject({show: false, blockId: null})
  })

  it('keeps hover visible when the pointer leaves into the hover actions bridge', () => {
    const {view, updates} = createView(true)
    dispatchMouseMove(view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement)

    const bridge = document.createElement('div')
    bridge.dataset.bnBlockHoverActions = 'true'
    document.body.appendChild(bridge)
    view.dom.dispatchEvent(new MouseEvent('mouseleave', {relatedTarget: bridge}))
    bridge.remove()

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'block-1'})
  })

  it('targets nested block content instead of the parent block wrapper', () => {
    const {view, updates} = createView(true, createNestedBlockDoc())
    const childContent = view.dom.querySelector('[data-id="child"] > [data-content-type="paragraph"]') as HTMLElement

    dispatchMouseMove(childContent)

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'child'})
  })

  it('hides over nested children gaps instead of falling back to the parent block', () => {
    const {view, updates} = createView(true, createNestedBlockDoc())
    const parentContent = view.dom.querySelector('[data-id="parent"] > [data-content-type="paragraph"]') as HTMLElement
    const childrenWrapper = view.dom.querySelector('[data-node-type="blockChildren"]') as HTMLElement

    dispatchMouseMove(parentContent)
    dispatchMouseMove(childrenWrapper)

    expect(updates.at(-1)).toMatchObject({show: false, blockId: null})
  })

  it('keeps hover visible while crossing the current block gutter', () => {
    const {view, updates} = createView(true)
    const content = view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement
    const block = view.dom.querySelector('[data-id="block-1"]') as HTMLElement
    setRect(content, {right: 100})

    dispatchMouseMove(content)
    block.dispatchEvent(new MouseEvent('mousemove', {clientX: 110, clientY: 10, bubbles: true}))

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'block-1'})
  })

  it('keeps hover visible when leaving the editor through the current block gutter', () => {
    const {view, updates} = createView(true)
    const content = view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement
    setRect(content, {right: 100})

    dispatchMouseMove(content)
    view.dom.dispatchEvent(new MouseEvent('mouseleave', {clientX: 110, clientY: 10}))

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'block-1'})
  })

  it('keeps hover visible over a supernumber badge for the current block', () => {
    const {view, updates} = createView(true)
    const content = view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement
    const block = view.dom.querySelector('[data-id="block-1"]') as HTMLElement
    const badge = document.createElement('button')
    badge.className = 'bn-supernumber-badge'
    badge.dataset.blockId = 'block-1'
    block.appendChild(badge)
    setRect(content, {right: 100})

    dispatchMouseMove(content)
    dispatchMouseMove(badge)

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'block-1'})
  })
})
