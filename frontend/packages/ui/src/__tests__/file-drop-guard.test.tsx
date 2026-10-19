// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {FileDropGuard} from '../file-drop-guard'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function dragEvent(type: 'dragover' | 'drop', types: string[]) {
  const event = new Event(type, {bubbles: true, cancelable: true}) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    value: {types, dropEffect: 'copy'},
  })
  return event
}

describe('FileDropGuard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<FileDropGuard />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it.each(['dragover', 'drop'] as const)('prevents unhandled file %s events', (type) => {
    const event = dragEvent(type, ['Files'])

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(event.dataTransfer?.dropEffect).toBe('none')
  })

  it.each(['dragover', 'drop'] as const)('leaves text and link %s events alone', (type) => {
    const event = dragEvent(type, ['text/plain', 'text/uri-list'])

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(event.dataTransfer?.dropEffect).toBe('copy')
  })

  it.each(['dragover', 'drop'] as const)('coexists with a child drop zone that handled %s', (type) => {
    const child = document.createElement('div')
    container.appendChild(child)
    child.addEventListener(type, (event) => event.preventDefault())
    const event = dragEvent(type, ['Files'])

    child.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(event.dataTransfer?.dropEffect).toBe('copy')
  })
})
