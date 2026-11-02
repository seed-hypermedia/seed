// @vitest-environment jsdom
import {CBOR_VALUE_RULES, ObjectEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

/**
 * A string attribute that holds lines (an app tool's code, a schema as text) is edited in a text
 * area, and a paste with line breaks into the one-line input keeps them instead of flattening.
 */

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

function render(value: Record<string, unknown>, onValue: (value: unknown) => void = () => {}) {
  act(() => {
    root.render(
      <ValueEditorProvider>
        <ObjectEditor value={value} onValue={onValue} rules={CBOR_VALUE_RULES} path={[]} />
      </ValueEditorProvider>,
    )
  })
}

describe('multi-line string attributes', () => {
  it('edits a value with line breaks in a text area that keeps them', () => {
    const code = 'export default async function (input, ctx) {\n  return {}\n}'
    render({code})
    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    expect(textarea!.value).toBe(code)
    expect(container.querySelector('input[type="text"], input:not([type])')).toBeNull()
  })

  it('turns the input into a text area when a paste carries line breaks, and commits the paste', () => {
    const committed: unknown[] = []
    render({code: ''}, (value) => committed.push(value))
    const input = container.querySelector('input')!
    expect(input).not.toBeNull()
    const paste = new Event('paste', {bubbles: true, cancelable: true})
    Object.defineProperty(paste, 'clipboardData', {value: {getData: () => 'line one\nline two'}})
    act(() => {
      input.dispatchEvent(paste)
    })
    expect(paste.defaultPrevented).toBe(true)
    expect(committed).toEqual([{code: 'line one\nline two'}])
    expect(container.querySelector('textarea')?.value).toBe('line one\nline two')
  })
})
