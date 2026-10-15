// @vitest-environment jsdom
import React, {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act, Simulate} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {CodeInput} from '../components/code-input'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const complete = vi.fn()
const changed = vi.fn()

function Form({initial = '', disabled = false}: {initial?: string; disabled?: boolean}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <CodeInput
        length={6}
        value={value}
        disabled={disabled}
        onChange={(next) => {
          changed(next)
          setValue(next)
        }}
        onComplete={complete}
      />
      <button onClick={() => setValue('')}>Reset</button>
    </>
  )
}

function inputs() {
  return [...container.querySelectorAll('input')]
}
function values() {
  return inputs().map((input) => input.value)
}
function change(index: number, value: string) {
  act(() => {
    Simulate.change(inputs()[index]!, {target: {value}} as any)
  })
}
function key(index: number, key: string) {
  act(() => {
    Simulate.keyDown(inputs()[index]!, {key})
  })
}

beforeEach(() => {
  complete.mockClear()
  changed.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('CodeInput', () => {
  it('preserves later digits when deleting and correcting a middle cell', () => {
    act(() => root.render(<Form initial="123456" />))
    key(2, 'Backspace')
    expect(values()).toEqual(['1', '2', '', '4', '5', '6'])
    expect(changed).toHaveBeenLastCalledWith('12456')
    expect(complete).not.toHaveBeenCalled()
    change(2, '9')
    expect(values()).toEqual(['1', '2', '9', '4', '5', '6'])
    expect(complete).toHaveBeenCalledWith('129456')
  })
  it('keeps out-of-order entry in its selected cell until all six cells are filled', () => {
    act(() => root.render(<Form />))
    change(5, '6')
    expect(values()).toEqual(['', '', '', '', '', '6'])
    expect(complete).not.toHaveBeenCalled()
    for (let index = 0; index < 5; index++) change(index, String(index + 1))
    expect(complete).toHaveBeenCalledExactlyOnceWith('123456')
  })
  it('backspaces to the previous empty-cell neighbor and supports Delete', () => {
    act(() => root.render(<Form initial="123456" />))
    key(2, 'Delete')
    key(2, 'Backspace')
    expect(values()).toEqual(['1', '', '', '4', '5', '6'])
    expect(document.activeElement).toBe(inputs()[1])
    expect(complete).not.toHaveBeenCalled()
  })
  it('accepts browser autofill and full-code paste including leading zeroes', () => {
    act(() => root.render(<Form />))
    change(0, '012345')
    expect(values().join('')).toBe('012345')
    expect(complete).toHaveBeenCalledWith('012345')
    act(() => Simulate.paste(inputs()[0]!, {clipboardData: {getData: () => '98 76 54'}} as any))
    expect(values().join('')).toBe('987654')
    expect(complete).toHaveBeenCalledWith('987654')
  })
  it('clears every cell when the parent resets after a resend', () => {
    act(() => root.render(<Form initial="123456" />))
    key(2, 'Backspace')
    act(() => Simulate.click(container.querySelector('button')!))
    expect(values()).toEqual(['', '', '', '', '', ''])
  })
  it('ignores paste while disabled during verification', () => {
    act(() => root.render(<Form disabled />))
    act(() => Simulate.paste(inputs()[0]!, {clipboardData: {getData: () => '123456'}} as any))
    expect(changed).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })
})
