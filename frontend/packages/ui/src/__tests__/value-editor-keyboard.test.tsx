// @vitest-environment jsdom
import {CBOR_VALUE_RULES, ObjectEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(value: unknown) {
  act(() => {
    root.render(
      <ValueEditorProvider>
        <ObjectEditor value={value as Record<string, unknown>} onValue={() => {}} rules={CBOR_VALUE_RULES} path={[]} />
      </ValueEditorProvider>,
    )
  })
}

/** The keyed rows, in DOM order, labeled by their field key text. */
function rowKeys(): string[] {
  return Array.from(container.querySelectorAll('[role="treeitem"]')).map(
    (el) => el.querySelector('span')?.textContent?.trim() ?? '',
  )
}
function rowFor(key: string): HTMLElement {
  return Array.from(container.querySelectorAll('[role="treeitem"]')).find(
    (el) => el.querySelector('span')?.textContent?.trim() === key,
  ) as HTMLElement
}
function press(el: HTMLElement, key: string) {
  act(() => el.focus())
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}))
  })
}
function activeKey(): string {
  return (document.activeElement as HTMLElement)?.querySelector('span')?.textContent?.trim() ?? ''
}

describe('value editor keyboard navigation', () => {
  it('exposes rows as treeitems with a single roving tab-stop', () => {
    render({alpha: 'x', beta: 'y'})
    const items = Array.from(container.querySelectorAll('[role="treeitem"]'))
    expect(items.length).toBe(2)
    // exactly one tab-stop (tabIndex 0), the rest are -1
    expect(items.filter((el) => (el as HTMLElement).tabIndex === 0).length).toBe(1)
  })

  it('ArrowDown / ArrowUp move focus between visible rows', () => {
    // Equal-length keys so canonical DAG-CBOR order matches source order (aa, bb).
    render({aa: 'x', bb: 'y'})
    press(rowFor('aa'), 'ArrowDown')
    expect(activeKey()).toBe('bb')
    press(rowFor('bb'), 'ArrowUp')
    expect(activeKey()).toBe('aa')
  })

  it('ArrowLeft collapses an expanded container; ArrowRight expands it', () => {
    render({obj: {inner: 'y'}})
    // expanded: the child row is present
    expect(rowKeys()).toContain('inner')
    press(rowFor('obj'), 'ArrowLeft')
    expect(rowKeys()).not.toContain('inner') // collapsed
    press(rowFor('obj'), 'ArrowRight')
    expect(rowKeys()).toContain('inner') // expanded again
  })

  it('ArrowRight on an expanded container moves to its first child; ArrowLeft returns to parent', () => {
    render({obj: {inner: 'y'}})
    press(rowFor('obj'), 'ArrowRight')
    expect(activeKey()).toBe('inner')
    press(rowFor('inner'), 'ArrowLeft')
    expect(activeKey()).toBe('obj')
  })

  it("selection follows focus into a field's editor (no highlight left behind)", () => {
    render({aa: 'x', bb: 'y'})
    const bbInput = rowFor('bb').querySelector('input') as HTMLInputElement
    act(() => bbInput.focus())
    // The bb row is highlighted, not aa.
    expect(rowFor('bb').getAttribute('aria-selected')).toBe('true')
    expect(rowFor('aa').getAttribute('aria-selected')).toBe('false')
  })

  it('focusing a nested field selects the innermost row, not its ancestor', () => {
    render({obj: {inner: 'y'}})
    const innerInput = rowFor('inner').querySelector('input') as HTMLInputElement
    act(() => innerInput.focus())
    expect(rowFor('inner').getAttribute('aria-selected')).toBe('true')
    expect(rowFor('obj').getAttribute('aria-selected')).toBe('false')
  })

  it('only the selected row reveals its actions menu (not every nested field)', () => {
    render({obj: {inner: 'y'}})
    const menu = (key: string) =>
      document.querySelector(`[aria-label="Actions for ${key}"]`) as HTMLElement
    act(() => (rowFor('inner').querySelector('input') as HTMLInputElement).focus())
    // The reveal is the standalone `opacity-100` class (classList token, not the
    // base `data-[state=open]:opacity-100`). Only the focused (inner) field
    // reveals its menu; the ancestor object's stays hidden.
    expect(menu('inner').classList.contains('opacity-100')).toBe(true)
    expect(menu('obj').classList.contains('opacity-100')).toBe(false)
  })
})
