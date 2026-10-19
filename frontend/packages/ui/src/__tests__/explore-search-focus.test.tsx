// @vitest-environment jsdom
import {useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {describe, expect, test} from 'vitest'
import {focusExploreSearch, useFocusExploreSearchListener} from '../explore-search-focus'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function SearchInput() {
  const inputRef = useRef<HTMLInputElement>(null)
  useFocusExploreSearchListener(inputRef)
  return <input ref={inputRef} aria-label="Search" />
}

describe('Explore search focus', () => {
  test('refocuses the open page search input after it was blurred', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<SearchInput />))
    const input = container.querySelector('input')!
    input.focus()
    input.blur()
    expect(document.activeElement).not.toBe(input)

    focusExploreSearch()
    expect(document.activeElement).toBe(input)

    act(() => root.unmount())
    container.remove()
  })
})
