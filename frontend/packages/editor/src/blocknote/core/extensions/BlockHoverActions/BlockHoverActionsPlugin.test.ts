import {Schema} from 'prosemirror-model'
import {EditorState, NodeSelection, TextSelection} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {afterEach, describe, expect, it} from 'vitest'
import {BlockHoverActionsProsemirrorPlugin, BlockHoverActionsState} from './BlockHoverActionsPlugin'

const suppressedContentTypes = ['query'] as const
const hoverableAtomicContentTypes = ['embed', 'image', 'video', 'file'] as const

const schema = new Schema({
  nodes: {
    doc: {content: 'blockNode+'},
    blockNode: {
      content: 'block blockChildren?',
      attrs: {id: {default: ''}},
      toDOM: (node) => ['div', {'data-node-type': 'blockNode', 'data-id': node.attrs.id}, 0],
    },
    blockChildren: {
      content: 'blockNode+',
      toDOM: () => ['div', {'data-node-type': 'blockChildren'}, 0],
    },
    paragraph: {group: 'block', content: 'text*', toDOM: () => ['p', {'data-content-type': 'paragraph'}, 0]},
    query: {group: 'block', toDOM: () => ['div', {'data-content-type': 'query'}]},
    embed: {group: 'block', toDOM: () => ['div', {'data-content-type': 'embed'}]},
    image: {group: 'block', toDOM: () => ['div', {'data-content-type': 'image'}]},
    video: {group: 'block', toDOM: () => ['div', {'data-content-type': 'video'}]},
    file: {group: 'block', toDOM: () => ['div', {'data-content-type': 'file'}]},
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
  const editor = {
    get isEditable() {
      return editable
    },
  }
  const hoverActions = new BlockHoverActionsProsemirrorPlugin(editor as any)
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

function createTwoBlockDoc() {
  return schema.nodes.doc.create(null, [
    schema.nodes.blockNode.create({id: 'block-1'}, schema.nodes.paragraph.create(null, schema.text('first'))),
    schema.nodes.blockNode.create({id: 'block-2'}, schema.nodes.paragraph.create(null, schema.text('second'))),
  ])
}

function createAtomicBlockDoc(
  contentType: (typeof suppressedContentTypes)[number] | (typeof hoverableAtomicContentTypes)[number],
) {
  return schema.nodes.doc.create(
    null,
    schema.nodes.blockNode.create({id: contentType}, schema.nodes[contentType].create()),
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

function forceFocused(view: EditorView) {
  Object.defineProperty(view, 'hasFocus', {configurable: true, value: () => true})
}

function textPosForBlock(doc: any, blockId: string) {
  let result = 1
  doc.descendants((node: any, pos: number) => {
    if (node.isText && doc.resolve(pos).node(1).attrs.id === blockId) {
      result = pos
      return false
    }
    return true
  })
  return result
}

describe('BlockHoverActionsProsemirrorPlugin', () => {
  it('emits hover state in reading mode', () => {
    const {view, updates} = createView(false)

    dispatchMouseMove(view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement)

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'block-1'})
  })

  it('does not change blocks on mouse hover while editing', () => {
    const {view, updates} = createView(true, createTwoBlockDoc())
    forceFocused(view)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, textPosForBlock(view.state.doc, 'block-1'))),
    )

    dispatchMouseMove(view.dom.querySelector('[data-id="block-2"] > [data-content-type="paragraph"]') as HTMLElement)

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'block-1'})
  })

  it('hides when text selection is active', () => {
    const {view, updates} = createView(true)
    forceFocused(view)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 8)))

    expect(updates.at(-1)).toMatchObject({show: false, blockId: null})
  })

  it.each(suppressedContentTypes)('suppresses %s blocks in reading mode', (contentType) => {
    const {view, updates} = createView(false, createAtomicBlockDoc(contentType))

    dispatchMouseMove(view.dom.querySelector(`[data-content-type="${contentType}"]`) as HTMLElement)

    expect(updates.at(-1)).toBeUndefined()
  })

  it.each(hoverableAtomicContentTypes)('emits hover state for %s blocks in reading mode', (contentType) => {
    const {view, updates} = createView(false, createAtomicBlockDoc(contentType))

    dispatchMouseMove(view.dom.querySelector(`[data-content-type="${contentType}"]`) as HTMLElement)

    expect(updates.at(-1)).toMatchObject({show: true, blockId: contentType})
  })

  it('emits hover state for selected media blocks while editing', () => {
    const {view, updates} = createView(true, createAtomicBlockDoc('image'))
    forceFocused(view)

    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 1)))

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'image'})
  })

  it('suppresses query blocks even when hovering nested DOM inside them', () => {
    const {view, updates} = createView(false, createAtomicBlockDoc('query'))
    const queryContent = view.dom.querySelector('[data-content-type="query"]') as HTMLElement
    const nested = document.createElement('div')
    nested.setAttribute('data-content-type', 'paragraph')
    queryContent.appendChild(nested)

    dispatchMouseMove(nested)

    expect(updates.at(-1)).toBeUndefined()
  })

  it('keeps hover visible when the pointer leaves into the hover actions card in reading mode', () => {
    const {view, updates} = createView(false)
    dispatchMouseMove(view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement)

    const card = document.createElement('div')
    card.dataset.bnBlockHoverActions = 'true'
    document.body.appendChild(card)
    view.dom.dispatchEvent(new MouseEvent('mouseleave', {relatedTarget: card}))
    card.remove()

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'block-1'})
  })

  it('targets nested block content instead of the parent block wrapper in reading mode', () => {
    const {view, updates} = createView(false, createNestedBlockDoc())
    const childContent = view.dom.querySelector('[data-id="child"] > [data-content-type="paragraph"]') as HTMLElement

    dispatchMouseMove(childContent)

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'child'})
  })

  it('hides over nested children gaps instead of falling back to the parent block in reading mode', () => {
    const {view, updates} = createView(false, createNestedBlockDoc())
    const parentContent = view.dom.querySelector('[data-id="parent"] > [data-content-type="paragraph"]') as HTMLElement
    const childrenWrapper = view.dom.querySelector('[data-node-type="blockChildren"]') as HTMLElement

    dispatchMouseMove(parentContent)
    dispatchMouseMove(childrenWrapper)

    expect(updates.at(-1)).toMatchObject({show: false, blockId: null})
  })

  it('keeps hover visible while crossing the current block gutter in reading mode', () => {
    const {view, updates} = createView(false)
    const content = view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement
    const block = view.dom.querySelector('[data-id="block-1"]') as HTMLElement
    setRect(content, {right: 100})

    dispatchMouseMove(content)
    block.dispatchEvent(new MouseEvent('mousemove', {clientX: 110, clientY: 10, bubbles: true}))

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'block-1'})
  })

  it('keeps hover visible over a supernumber badge for the current block in reading mode', () => {
    const {view, updates} = createView(false)
    const block = view.dom.querySelector('[data-id="block-1"]') as HTMLElement
    const badge = document.createElement('button')
    badge.className = 'bn-supernumber-badge'
    badge.dataset.blockId = 'block-1'
    block.appendChild(badge)

    dispatchMouseMove(badge)

    expect(updates.at(-1)).toMatchObject({show: true, blockId: 'block-1'})
  })
})
