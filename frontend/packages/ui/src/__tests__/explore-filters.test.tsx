// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ExploreAuthorMenu, ExploreDateMenu} from '../explore-filters'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

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

function click(element: Element | null | undefined) {
  if (!element) throw new Error('element not found')
  act(() => element.dispatchEvent(new MouseEvent('click', {bubbles: true})))
}

function buttonWithText(text: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === text)
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}

describe('ExploreAuthorMenu', () => {
  const nameless = 'z6MkNamelessAccount12345678'
  const accounts = [
    // A nameless account, which the account list labels with its own id. Listed first here, so the
    // test can see it move behind the named ones.
    {value: nameless, label: nameless},
    {value: 'z6MkAlice', label: 'Alice'},
    {value: 'z6MkBob', label: 'Bob Builder'},
  ]
  const people = () =>
    Array.from(container.querySelectorAll('button'))
      .map((button) => button.textContent?.trim())
      .filter((text) => text !== 'Anyone')

  it('lists a nameless account by its short id, after the named ones', () => {
    act(() => root.render(<ExploreAuthorMenu accounts={accounts} selected={null} onSelect={vi.fn()} />))
    // The same short id the document byline shows, never the full one.
    expect(people()).toEqual(['Alice', 'Bob Builder', '12345678'])
    expect(container.textContent).not.toContain(nameless)
    expect(buttonWithText('12345678')?.querySelector('.text-muted-foreground')).not.toBeNull()
  })

  it('finds a nameless account by the short id a byline shows', () => {
    const onSelect = vi.fn()
    act(() => root.render(<ExploreAuthorMenu accounts={accounts} selected={null} onSelect={onSelect} />))
    typeInto(container.querySelector('input')!, '1234')
    expect(people()).toEqual(['12345678'])
    click(buttonWithText('12345678'))
    expect(onSelect).toHaveBeenCalledWith(nameless)
  })

  it('narrows by name and selects one author', () => {
    const onSelect = vi.fn()
    act(() => root.render(<ExploreAuthorMenu accounts={accounts} selected={null} onSelect={onSelect} />))
    typeInto(container.querySelector('input')!, 'build')
    expect(container.textContent).not.toContain('Alice')
    click(buttonWithText('Bob Builder'))
    expect(onSelect).toHaveBeenCalledWith('z6MkBob')
  })

  it('clears the author with Anyone', () => {
    const onSelect = vi.fn()
    act(() => root.render(<ExploreAuthorMenu accounts={accounts} selected="z6MkAlice" onSelect={onSelect} />))
    click(buttonWithText('Anyone'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})

describe('ExploreDateMenu', () => {
  it('applies a preset on the chosen field', () => {
    const onApply = vi.fn()
    act(() => root.render(<ExploreDateMenu initial={{field: 'created', preset: 'any'}} onApply={onApply} />))
    click(buttonWithText('Updated'))
    click(buttonWithText('Past month'))
    click(buttonWithText('Apply filters'))
    expect(onApply).toHaveBeenCalledWith({field: 'updated', preset: 'month'})
  })

  it('opens on the range the query already holds and applies it back', () => {
    const onApply = vi.fn()
    act(() =>
      root.render(
        <ExploreDateMenu
          initial={{field: 'created', preset: 'custom', from: '2026-09-01', to: '2026-09-30'}}
          onApply={onApply}
        />,
      ),
    )
    const [from, to] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'))
    expect(from?.value).toBe('2026-09-01')
    expect(to?.value).toBe('2026-09-30')
    click(buttonWithText('Apply filters'))
    expect(onApply).toHaveBeenCalledWith({field: 'created', preset: 'custom', from: '2026-09-01', to: '2026-09-30'})
  })
})
