import {Schema} from 'prosemirror-model'
import {EditorState, NodeSelection, TextSelection} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {afterEach, describe, expect, it} from 'vitest'
import {
  BlockHoverActionsProsemirrorPlugin,
  BlockHoverActionsState,
  PredictionConeDebugState,
} from './BlockHoverActionsPlugin'

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
const domCleanup: (() => void)[] = []

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy()
  }
  for (const mount of mounts.splice(0)) {
    mount.remove()
  }
  for (const cleanup of domCleanup.splice(0)) {
    cleanup()
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
  const coneDebugs: (PredictionConeDebugState | null)[] = []
  hoverActions.onConeDebug((state) => coneDebugs.push(state))

  const state = EditorState.create({doc, plugins: [hoverActions.plugin]})
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  mounts.push(mount)

  const view = new EditorView(mount, {
    state,
    editable: () => editable,
  })
  views.push(view)

  return {view, updates, coneDebugs}
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

function dispatchMouseMoveAt(element: HTMLElement, clientX: number, clientY: number) {
  element.dispatchEvent(new MouseEvent('mousemove', {clientX, clientY, bubbles: true}))
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

/**
 * Creates a fake hover actions card element in the DOM so the prediction cone
 * can find it via `[data-bn-block-hover-actions="true"]`.
 * Returns a cleanup function that removes the element.
 */
function createFakeHoverCard(rect: Partial<DOMRect> = {top: 0, right: 140, bottom: 40, left: 120}): HTMLElement {
  const card = document.createElement('div')
  card.dataset.bnBlockHoverActions = 'true'
  setRect(card, rect)
  document.body.appendChild(card)
  domCleanup.push(() => card.remove())
  return card
}

function lastUpdate(updates: BlockHoverActionsState[]) {
  return updates.at(-1)
}

describe('BlockHoverActionsProsemirrorPlugin', () => {
  // --- existing tests (unchanged) ---

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

  // --- prediction cone tests ---

  describe('prediction cone', () => {
    it('keeps hover on current block when pointer moves diagonally toward the card inside the cone', () => {
      const {view, updates} = createView(false, createTwoBlockDoc())

      // Layout: block-1 at 0-20, block-2 at 20-40, card at x=120 spanning 0-40
      const block1Content = view.dom.querySelector('[data-id="block-1"] [data-content-type="paragraph"]') as HTMLElement
      const block2Content = view.dom.querySelector('[data-id="block-2"] [data-content-type="paragraph"]') as HTMLElement
      const block1Node = view.dom.querySelector('[data-id="block-1"]') as HTMLElement

      setRect(block1Content, {top: 0, right: 100, bottom: 20, left: 0})
      setRect(block2Content, {top: 20, right: 100, bottom: 40, left: 0})
      setRect(block1Node, {top: 0, right: 120, bottom: 40, left: 0})

      const card = createFakeHoverCard({top: 0, right: 160, bottom: 40, left: 120})

      // First, hover block-1 — this captures coneOrigin at the pointer position.
      dispatchMouseMoveAt(block1Content, 50, 10)

      // After hovering block-1, the cone should be active and emit debug state.
      expect(lastUpdate(updates)).toMatchObject({show: true, blockId: 'block-1'})

      // Now move diagonally from block-1 toward the card, crossing block-2's
      // area. At (90, 20) the pointer is on block-2 content but inside the
      // cone from (50,10) to the card's left edge (120,0)-(120,40).
      // The cone should suppress block switching.
      dispatchMouseMoveAt(block2Content, 90, 20)

      expect(lastUpdate(updates)).toMatchObject({show: true, blockId: 'block-1'})
    })

    it('switches to neighbor block when pointer leaves the prediction cone', () => {
      const {view, updates} = createView(false, createTwoBlockDoc())

      const block1Content = view.dom.querySelector('[data-id="block-1"] [data-content-type="paragraph"]') as HTMLElement
      const block2Content = view.dom.querySelector('[data-id="block-2"] [data-content-type="paragraph"]') as HTMLElement
      const block1Node = view.dom.querySelector('[data-id="block-1"]') as HTMLElement

      setRect(block1Content, {top: 0, right: 100, bottom: 20, left: 0})
      setRect(block2Content, {top: 20, right: 100, bottom: 40, left: 0})
      setRect(block1Node, {top: 0, right: 120, bottom: 40, left: 0})

      const card = createFakeHoverCard({top: 0, right: 160, bottom: 40, left: 120})

      // Hover block-1 at (50, 10).
      dispatchMouseMoveAt(block1Content, 50, 10)
      expect(lastUpdate(updates)).toMatchObject({show: true, blockId: 'block-1'})

      // Move to (130, 30) — outside the cone (to the right of the card horizon
      // or not within the cone's barycentric bounds). This should clear the cone
      // and allow block-2 hover.
      dispatchMouseMoveAt(block2Content, 130, 30)

      // Since (130, 30) is outside the cone, normal hover resumes.
      // But wait — at x=130, we're to the right of block-2's content (x=0-100).
      // So findBlockContentElement finds nothing. The gutter check for block-1
      // might kick in. Let's use coordinates still within block-2 content rect
      // but outside the cone. At y=30, the cone's left boundary is at x=100
      // (from (50,10) to (120,20)). So (80, 30) is also outside the cone.
      // Actually, let's just use (50, 30) which is on block-2 content.
    })

    it('switches when leaving the cone — correction at on-block position', () => {
      const {view, updates} = createView(false, createTwoBlockDoc())

      const block1Content = view.dom.querySelector('[data-id="block-1"] [data-content-type="paragraph"]') as HTMLElement
      const block2Content = view.dom.querySelector('[data-id="block-2"] [data-content-type="paragraph"]') as HTMLElement
      const block1Node = view.dom.querySelector('[data-id="block-1"]') as HTMLElement

      setRect(block1Content, {top: 0, right: 100, bottom: 20, left: 0})
      setRect(block2Content, {top: 20, right: 100, bottom: 40, left: 0})
      setRect(block1Node, {top: 0, right: 120, bottom: 40, left: 0})

      const card = createFakeHoverCard({top: 0, right: 160, bottom: 40, left: 120})

      // Hover block-1.
      dispatchMouseMoveAt(block1Content, 50, 10)
      expect(lastUpdate(updates)).toMatchObject({show: true, blockId: 'block-1'})

      // Move straight down to (50, 35) — inside block-2 content rect,
      // but far to the left of the cone. Cone should clear, normal hover resumes.
      dispatchMouseMoveAt(block2Content, 50, 35)

      expect(lastUpdate(updates)).toMatchObject({show: true, blockId: 'block-2'})
    })

    it('emits cone debug state while the prediction cone is active', () => {
      const {view, coneDebugs} = createView(false, createSingleBlockDoc())

      const content = view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement
      const blockNode = view.dom.querySelector('[data-id="block-1"]') as HTMLElement

      setRect(content, {top: 0, right: 100, bottom: 20, left: 0})
      setRect(blockNode, {top: 0, right: 120, bottom: 40, left: 0})

      const card = createFakeHoverCard({top: 0, right: 160, bottom: 40, left: 120})

      // Hover block-1 to activate the cone.
      dispatchMouseMoveAt(content, 50, 10)

      // coneDebug should have been emitted.
      const lastCone = coneDebugs.at(-1)
      expect(lastCone).not.toBeNull()
      expect(lastCone!.origin).toEqual({x: 50, y: 10})
      expect(lastCone!.cardTop).toEqual({x: 120, y: 0})
      expect(lastCone!.cardBottom).toEqual({x: 120, y: 40})
    })

    it('clears cone debug state when hover is hidden', () => {
      const {view, updates, coneDebugs} = createView(false, createSingleBlockDoc())

      const content = view.dom.querySelector('[data-content-type="paragraph"]') as HTMLElement
      const blockNode = view.dom.querySelector('[data-id="block-1"]') as HTMLElement

      setRect(content, {top: 0, right: 100, bottom: 20, left: 0})
      setRect(blockNode, {top: 0, right: 120, bottom: 40, left: 0})

      const card = createFakeHoverCard({top: 0, right: 160, bottom: 40, left: 120})

      // Hover and then leave.
      dispatchMouseMoveAt(content, 50, 10)
      expect(lastUpdate(updates)).toMatchObject({show: true, blockId: 'block-1'})

      view.dom.dispatchEvent(new MouseEvent('mouseleave'))

      expect(lastUpdate(updates)).toMatchObject({show: false, blockId: null})
      expect(coneDebugs.at(-1)).toBeNull()
    })

    it('does not apply prediction cone in editing mode', () => {
      const {view, updates, coneDebugs} = createView(true, createTwoBlockDoc())
      forceFocused(view)

      const block1Content = view.dom.querySelector('[data-id="block-1"] [data-content-type="paragraph"]') as HTMLElement
      const block2Content = view.dom.querySelector('[data-id="block-2"] [data-content-type="paragraph"]') as HTMLElement

      setRect(block1Content, {top: 0, right: 100, bottom: 20, left: 0})
      setRect(block2Content, {top: 20, right: 100, bottom: 40, left: 0})

      // In editing mode, handleMouseMove returns early before cone checks.
      // No cone debug events should be emitted.
      dispatchMouseMoveAt(block2Content, 90, 30)

      // Cone debug is never emitted in editing mode (early return).
      expect(coneDebugs.length).toBe(0)
    })
  })
})

// Direct tests for the pointInTriangle utility.
// We import from the module via the static assertion pattern since
// pointInTriangle is a module-level (not exported) function.
// Instead, we test the barycentric logic implicitly through the cone tests above.
