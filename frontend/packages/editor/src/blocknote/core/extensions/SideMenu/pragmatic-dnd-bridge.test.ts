import {describe, expect, it} from 'vitest'
import {renderBlocksDragPreview} from './pragmatic-dnd-bridge'

/** A block element as the editor renders it: its content, then its nested blocks. */
function block(id: string, text: string, children: string[] = [], type = 'paragraph'): string {
  const nested = children.length ? `<div data-node-type="blockChildren">${children.join('')}</div>` : ''
  return `<div data-node-type="blockNode" data-id="${id}"><div data-content-type="${type}">${text}</div>${nested}</div>`
}

/**
 * An editor DOM with blocks `a`, `b` (holding `b1` and `b2`), `c`, an empty paragraph `g` holding the grid cards `g1`
 * to `g3`, then `d`.
 */
function editorDom(): HTMLElement {
  const dom = document.createElement('div')
  dom.innerHTML = [
    block('a', 'A'),
    block('b', 'B', [block('b1', 'B1'), block('b2', 'B2')]),
    block('c', 'C'),
    block(
      'g',
      '',
      ['g1', 'g2', 'g3'].map((id) => block(id, '', [], 'image')),
    ),
    block('d', 'D'),
  ].join('')
  return dom
}

/** Ids of the blocks shown in the preview, nested ones included, in document order. */
function shownBlocks(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-node-type="blockNode"]')).map((el) => el.getAttribute('data-id')!)
}

/** The preview's summary line, if any. */
function summary(container: HTMLElement): string | undefined {
  const last = container.firstElementChild?.lastElementChild
  return last && !last.hasAttribute('data-id') ? last.textContent! : undefined
}

function render(blockIds: string[]): HTMLElement {
  const container = document.createElement('div')
  renderBlocksDragPreview(container, editorDom(), blockIds)
  return container
}

describe('renderBlocksDragPreview', () => {
  it('shows every dragged block, in document order', () => {
    const container = render(['a', 'c'])
    expect(shownBlocks(container)).toEqual(['a', 'c'])
    expect(summary(container)).toBeUndefined()
  })

  it('shows a dragged nested block only as part of its dragged parent', () => {
    const container = render(['b', 'b1'])
    expect(shownBlocks(container)).toEqual(['b', 'b1', 'b2'])
  })

  it('shows a nested block dragged without its parent', () => {
    expect(shownBlocks(render(['b1', 'c']))).toEqual(['b1', 'c'])
  })

  it('counts nested blocks toward the limit and the rest in the summary', () => {
    const container = render(['a', 'b', 'c'])
    expect(shownBlocks(container)).toEqual(['a', 'b', 'b1'])
    expect(summary(container)).toBe('+2 more')
  })

  it('counts grid cards but not the empty paragraph holding them', () => {
    const container = render(['c', 'g', 'd'])
    expect(shownBlocks(container)).toEqual(['c', 'g', 'g1', 'g2'])
    expect(summary(container)).toBe('+2 more')
  })

  it('leaves out an empty holder when none of its nested blocks fit', () => {
    const container = render(['b', 'g'])
    expect(shownBlocks(container)).toEqual(['b', 'b1', 'b2'])
    expect(summary(container)).toBe('+3 more')
  })

  it('renders nothing when no dragged block is in the editor', () => {
    expect(render(['missing']).childElementCount).toBe(0)
  })
})
