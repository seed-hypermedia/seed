// @vitest-environment jsdom
import {TooltipProvider} from '@shm/ui/tooltip'
import {METADATA_VALUE_RULES, ObjectEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

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

function render(value: Record<string, unknown>, onCreateBlob?: () => void) {
  act(() => {
    root.render(
      <TooltipProvider>
        <ValueEditorProvider onCreateBlob={onCreateBlob}>
          <ObjectEditor value={value} onValue={() => {}} rules={METADATA_VALUE_RULES} path={[]} />
        </ValueEditorProvider>
      </TooltipProvider>,
    )
  })
}

/** Right-click the first row to open the inline context menu. */
function openRowMenu() {
  const row = container.querySelector('[role="treeitem"]') as HTMLElement
  act(() => {
    row.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: 5, clientY: 5}))
  })
}
function menuButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as
    | HTMLButtonElement
    | undefined
}

describe('New blob field action', () => {
  it('offers "New blob" on a text field when onCreateBlob is provided', () => {
    const onCreateBlob = vi.fn()
    render({title: 'hi'}, onCreateBlob)
    openRowMenu()
    const item = menuButton('New blob')
    expect(item).toBeTruthy()
    act(() => item!.click())
    expect(onCreateBlob).toHaveBeenCalledTimes(1)
  })

  it('does not offer "New blob" when no onCreateBlob is wired', () => {
    render({title: 'hi'})
    openRowMenu()
    expect(menuButton('New blob')).toBeUndefined()
  })

  it('does not offer "New blob" on a non-text field', () => {
    const onCreateBlob = vi.fn()
    render({obj: {a: 'x'}}, onCreateBlob)
    openRowMenu()
    expect(menuButton('New blob')).toBeUndefined()
  })
})
