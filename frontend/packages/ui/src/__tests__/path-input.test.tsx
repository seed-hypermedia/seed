// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act, Simulate} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {PathInput} from '../path-input'
import {FormPathInput} from '../form-input'
import {useForm} from 'react-hook-form'
import type {PathInputKind} from '@shm/shared/utils/path'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let stored: string
let submitted: string

function Harness({kind = 'path', initial = ''}: {kind?: PathInputKind; initial?: string}) {
  const [value, setValue] = React.useState(initial)
  stored = value
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submitted = value
      }}
    >
      <PathInput value={value} onValueChange={setValue} kind={kind} />
      <button type="button" onClick={() => setValue('replacement')}>
        Reset
      </button>
    </form>
  )
}

function change(value: string, caret = value.length) {
  const input = container.querySelector('input')!
  act(() => {
    input.value = value
    input.setSelectionRange(caret, caret)
    Simulate.change(input)
  })
  return input
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  stored = ''
  submitted = ''
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('PathInput editing and stored values', () => {
  it('keeps word separators during sequential typing and trims the saved value before blur', () => {
    act(() => root.render(<Harness />))
    const input = container.querySelector('input')!
    for (const character of 'Hola     Adios     ') change(input.value + character)
    expect(input.value).toBe('hola-adios-')
    expect(stored).toBe('hola-adios')
    act(() => Simulate.submit(container.querySelector('form')!))
    expect(submitted).toBe('hola-adios')
    act(() => Simulate.blur(input))
    expect(input.value).toBe('hola-adios')
  })

  it('converts pasted text to one segment and removes leading separators', () => {
    act(() => root.render(<Harness />))
    const input = change('——Café / My_Page———')
    expect(input.value).toBe('cafe-my_page-')
    expect(stored).toBe('cafe-my_page')
  })

  it('preserves the caret when editing in the middle of a value', () => {
    act(() => root.render(<Harness initial="hola-adios" />))
    const input = change('hola   -adios', 7)
    expect(input.value).toBe('hola-adios')
    expect(input.selectionStart).toBe(5)
    change(input.value.slice(0, 5) + 'X' + input.value.slice(5), 6)
    expect(input.value).toBe('hola-xadios')
    expect(input.selectionStart).toBe(6)
  })

  it('keeps a word separator and caret before a domain dot', () => {
    act(() => root.render(<Harness kind="domain" initial="my-site.com" />))
    const input = change('my-site .com', 8)
    expect(input.value).toBe('my-site-.com')
    expect(input.selectionStart).toBe(8)
    expect(stored).toBe('my-site.com')
    change('my-site-new.com', 11)
    expect(input.value).toBe('my-site-new.com')
    expect(input.selectionStart).toBe(11)
    expect(stored).toBe('my-site-new.com')
  })

  it('accepts deletion and external value changes', () => {
    act(() => root.render(<Harness />))
    const input = change('hello ')
    act(() => Simulate.click(container.querySelector('button')!))
    expect(input.value).toBe('replacement')
    change('')
    expect(stored).toBe('')
    expect(input.value).toBe('')
  })

  it('does not change existing addresses just by focusing and leaving the field', () => {
    act(() => root.render(<Harness initial="Existing.Path" />))
    const input = container.querySelector('input')!
    act(() => {
      Simulate.focus(input)
      Simulate.blur(input)
    })
    expect(stored).toBe('Existing.Path')
  })

  it('waits for text composition to finish before conversion', () => {
    act(() => root.render(<Harness />))
    const input = container.querySelector('input')!
    act(() => Simulate.compositionStart(input))
    change('Café')
    expect(input.value).toBe('Café')
    expect(stored).toBe('')
    act(() => Simulate.compositionEnd(input))
    expect(input.value).toBe('cafe')
    expect(stored).toBe('cafe')
  })

  it('uses domain rules and stores complete labels without trailing dashes', () => {
    act(() => root.render(<Harness kind="domain" />))
    const input = change(' HTTPS://My-Site.COM/hello?query=1')
    expect(input.value).toBe('my-site.com')
    expect(stored).toBe('my-site.com')
    change('my-site.com     ')
    expect(stored).toBe('my-site.com')
    act(() => Simulate.blur(input))
    expect(input.value).toBe('my-site.com')
  })
})

it('submits the normalized domain through React Hook Form without blur', async () => {
  function FormHarness() {
    const {control, handleSubmit} = useForm<{domain: string}>({defaultValues: {domain: ''}})
    return (
      <form
        onSubmit={handleSubmit(({domain}) => {
          submitted = domain
        })}
      >
        <FormPathInput control={control} name="domain" kind="domain" />
      </form>
    )
  }
  act(() => root.render(<FormHarness />))
  const input = change('---My Site---.COM---')
  expect(input.value).toBe('my-site---.com---')
  await act(async () => Simulate.submit(container.querySelector('form')!))
  expect(submitted).toBe('my-site.com')
})
