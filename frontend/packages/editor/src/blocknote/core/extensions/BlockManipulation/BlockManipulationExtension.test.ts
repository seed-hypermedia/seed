import {Schema} from 'prosemirror-model'
import {EditorState, NodeSelection, TextSelection} from 'prosemirror-state'
import {describe, expect, it, vi} from 'vitest'
import {BlockManipulationExtension} from './BlockManipulationExtension'

const schema = new Schema({
  nodes: {
    doc: {
      content: 'blockNodeChild+',
    },
    blockNode: {
      group: 'blockNodeChild',
      attrs: {
        id: {default: ''},
      },
      content: 'block',
      parseDOM: [{tag: 'div[data-node-type="blockNode"]'}],
      toDOM: (node) => ['div', {'data-node-type': 'blockNode', 'data-id': node.attrs.id}, 0],
    },
    paragraph: {
      group: 'block',
      content: 'text*',
      parseDOM: [{tag: 'p'}],
      toDOM: () => ['p', 0],
    },
    embed: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: {
        url: {default: ''},
        view: {default: 'Content'},
      },
      parseDOM: [{tag: 'div[data-content-type="embed"]'}],
      toDOM: (node) => [
        'div',
        {'data-content-type': 'embed', 'data-url': node.attrs.url, 'data-view': node.attrs.view},
      ],
    },
    text: {
      group: 'inline',
    },
  },
})

function getCursorSelectPlugin(openUrl = vi.fn()) {
  return (BlockManipulationExtension as any).config.addProseMirrorPlugins.call({
    editor: {},
    options: {openUrl},
  })[0]
}

function clickEventWithTarget(target: HTMLElement) {
  const event = new MouseEvent('click', {bubbles: true, cancelable: true})
  Object.defineProperty(event, 'target', {value: target})
  return event
}

function createView({
  embedView = 'Card',
  selectedEmbed = false,
}: {
  embedView?: 'Card' | 'Content'
  selectedEmbed?: boolean
}) {
  const doc = schema.node('doc', null, [
    schema.node('blockNode', {id: 'block-1'}, [schema.node('paragraph', null, [schema.text('hello')])]),
    schema.node('blockNode', {id: 'block-2'}, [schema.node('embed', {url: 'hm://uid/doc', view: embedView})]),
  ])

  let embedPos = -1
  let embedBlockPos = -1
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockNode' && node.attrs.id === 'block-2') {
      embedBlockPos = pos
    }
    if (node.type.name === 'embed') {
      embedPos = pos
    }
    return true
  })

  const initialSelection = selectedEmbed ? NodeSelection.create(doc, embedBlockPos + 1) : TextSelection.create(doc, 2)
  let state = EditorState.create({schema, doc, selection: initialSelection})

  const view = {
    editable: true,
    get state() {
      return state
    },
    dispatch: vi.fn((tr) => {
      state = state.apply(tr)
    }),
    focus: vi.fn(),
  }

  return {
    view: view as any,
    embedNode: doc.nodeAt(embedPos)!,
    embedPos,
    embedBlockPos,
  }
}

describe('BlockManipulationExtension embed clicks', () => {
  it('selects the card embed on first click', () => {
    const openUrl = vi.fn()
    const plugin = getCursorSelectPlugin(openUrl)
    const {view, embedNode, embedPos} = createView({selectedEmbed: false, embedView: 'Card'})

    const handled = plugin.props.handleClickOn(view, null, embedNode, embedPos, new MouseEvent('click'))

    expect(handled).toBe(true)
    expect(view.dispatch).toHaveBeenCalledOnce()
    expect(view.state.selection instanceof NodeSelection).toBe(true)
    expect(view.state.selection.from).toBe(embedPos)
    expect(view.focus).toHaveBeenCalledOnce()
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('navigates on second click when the card embed is already selected', () => {
    const openUrl = vi.fn()
    const plugin = getCursorSelectPlugin(openUrl)
    const {view, embedNode, embedPos} = createView({selectedEmbed: true, embedView: 'Card'})

    const handled = plugin.props.handleClickOn(
      view,
      null,
      embedNode,
      embedPos,
      new MouseEvent('click', {metaKey: true}),
    )

    expect(handled).toBe(true)
    expect(view.dispatch).not.toHaveBeenCalled()
    expect(view.focus).not.toHaveBeenCalled()
    expect(openUrl).toHaveBeenCalledWith('hm://uid/doc', true)
  })

  it('navigates on a rapid second click even if selection has not settled to a NodeSelection yet', () => {
    const openUrl = vi.fn()
    const plugin = getCursorSelectPlugin(openUrl)
    const {view, embedNode, embedPos} = createView({selectedEmbed: false, embedView: 'Card'})

    const handled = plugin.props.handleClickOn(view, null, embedNode, embedPos, new MouseEvent('click', {detail: 2}))

    expect(handled).toBe(true)
    expect(view.dispatch).not.toHaveBeenCalled()
    expect(view.focus).not.toHaveBeenCalled()
    expect(openUrl).toHaveBeenCalledWith('hm://uid/doc', false)
  })

  it('navigates on handleDoubleClickOn for card embeds', () => {
    const openUrl = vi.fn()
    const plugin = getCursorSelectPlugin(openUrl)
    const {view, embedNode, embedPos} = createView({selectedEmbed: false, embedView: 'Card'})

    const handled = plugin.props.handleDoubleClickOn(view, null, embedNode, embedPos, new MouseEvent('dblclick'))

    expect(handled).toBe(true)
    expect(view.dispatch).not.toHaveBeenCalled()
    expect(view.focus).not.toHaveBeenCalled()
    expect(openUrl).toHaveBeenCalledWith('hm://uid/doc', false)
  })

  it('selects content embeds on first click', () => {
    const openUrl = vi.fn()
    const plugin = getCursorSelectPlugin(openUrl)
    const {view, embedNode, embedPos} = createView({selectedEmbed: false, embedView: 'Content'})

    const handled = plugin.props.handleClickOn(view, null, embedNode, embedPos, new MouseEvent('click'))

    expect(handled).toBe(true)
    expect(view.dispatch).toHaveBeenCalledOnce()
    expect(view.state.selection instanceof NodeSelection).toBe(true)
    expect(view.state.selection.from).toBe(embedPos)
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('navigates on second click when a content embed is already selected', () => {
    const openUrl = vi.fn()
    const plugin = getCursorSelectPlugin(openUrl)
    const {view, embedNode, embedPos} = createView({selectedEmbed: true, embedView: 'Content'})

    const handled = plugin.props.handleClickOn(view, null, embedNode, embedPos, new MouseEvent('click'))

    expect(handled).toBe(true)
    expect(view.dispatch).not.toHaveBeenCalled()
    expect(view.focus).not.toHaveBeenCalled()
    expect(openUrl).toHaveBeenCalledWith('hm://uid/doc', false)
  })

  it('does not open the outer embed when clicking an inner link', () => {
    const openUrl = vi.fn()
    const plugin = getCursorSelectPlugin(openUrl)
    const {view, embedNode, embedPos} = createView({selectedEmbed: true, embedView: 'Content'})
    const embedEl = document.createElement('div')
    embedEl.setAttribute('data-content-type', 'embed')
    const link = document.createElement('a')
    link.href = 'hm://uid/linked-doc'
    embedEl.appendChild(link)

    const handled = plugin.props.handleClickOn(view, null, embedNode, embedPos, clickEventWithTarget(link))

    expect(handled).toBe(false)
    expect(view.dispatch).not.toHaveBeenCalled()
    expect(view.focus).not.toHaveBeenCalled()
    expect(openUrl).not.toHaveBeenCalled()
  })
})
