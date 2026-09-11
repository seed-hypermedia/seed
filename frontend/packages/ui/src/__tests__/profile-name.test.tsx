// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ProfileName} from '../profile-name'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
function render(props: React.ComponentProps<typeof ProfileName>) {
  act(() => root.render(<ProfileName {...props} />))
}
function click(label: string) {
  act(() => container.querySelector(`[aria-label="${label}"]`)!.dispatchEvent(new MouseEvent('click', {bubbles: true})))
}
function change(value: string) {
  act(() => {
    const input = container.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}
async function key(key: string) {
  await act(async () =>
    container.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true})),
  )
}
describe('ProfileName', () => {
  it('shows public identity alongside a petname but no editor without a save action', () => {
    render({publicName: 'Public Alice', petname: 'Alice'})
    expect(container.querySelector('h1')?.textContent).toBe('Alice')
    expect(container.textContent).toContain('Public Alice')
    expect(container.querySelector('button')).toBeNull()
  })
  it('edits on double click, discloses publication, trims and saves on Enter', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render({publicName: 'Alice', onSave})
    act(() => container.querySelector('h1')!.dispatchEvent(new MouseEvent('dblclick', {bubbles: true})))
    expect(container.textContent).toContain('published')
    change('  Ally  ')
    await key('Enter')
    expect(onSave).toHaveBeenCalledWith('Ally')
    expect(container.querySelector('input')).toBeNull()
  })
  it('does not save on blur and cancels with Escape or X', async () => {
    const onSave = vi.fn()
    render({publicName: 'Alice', petname: 'Ally', onSave})
    click('Edit contact name')
    change('Discard')
    act(() => container.querySelector('input')!.dispatchEvent(new FocusEvent('focusout', {bubbles: true})))
    expect(onSave).not.toHaveBeenCalled()
    await key('Escape')
    expect(container.querySelector('input')).toBeNull()
    click('Edit contact name')
    expect(container.querySelector('input')!.value).toBe('Ally')
    click('Cancel contact name')
    expect(onSave).not.toHaveBeenCalled()
  })
  it('clears a petname with an empty value and keeps failed input for retry', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    render({publicName: 'Alice', petname: 'Ally', onSave})
    click('Edit contact name')
    change('   ')
    await key('Enter')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Try again')
    expect(container.querySelector('input')!.value).toBe('   ')
    await act(async () => click('Save contact name'))
    expect(onSave).toHaveBeenLastCalledWith('')
    expect(container.querySelector('input')).toBeNull()
  })
  it('disables repeat submissions until saving completes and restores pencil focus', async () => {
    let finish!: () => void
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    render({publicName: 'Alice', onSave})
    click('Edit contact name')
    change('Ally')
    await key('Enter')
    expect(container.querySelector('input')!.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Save contact name"]')!.disabled).toBe(true)
    click('Save contact name')
    expect(onSave).toHaveBeenCalledOnce()
    await act(async () => finish())
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Edit contact name')
  })

  it('resets an edit when keyed to a different viewing identity', () => {
    const onSave = vi.fn()
    act(() => root.render(<ProfileName key="viewer-a" publicName="Alice" petname="Ally" onSave={onSave} />))
    click('Edit contact name')
    change('Unsaved')
    act(() => root.render(<ProfileName key="viewer-b" publicName="Alice" petname="Alice B" onSave={onSave} />))
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('Alice B')
    expect(onSave).not.toHaveBeenCalled()
  })
})
