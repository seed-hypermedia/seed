import {cleanup, fireEvent, render, screen} from '@testing-library/react'
import {afterEach, expect, test} from 'bun:test'
import * as React from 'react'
import {RecoveryWordInputs} from './RecoveryWordInputs'

afterEach(cleanup)

function setup(wordCounts?: readonly number[]) {
  function Harness() {
    const [words, setWords] = React.useState<string[]>(Array(12).fill(''))
    const [error, setError] = React.useState('')
    return (
      <>
        <RecoveryWordInputs
          words={words}
          onChange={(next) => {
            setWords(next)
            setError('')
          }}
          onError={setError}
          wordCounts={wordCounts}
        />
        {error && <p role="alert">{error}</p>}
      </>
    )
  }
  render(<Harness />)
}

function field(number: number) {
  return screen.getByLabelText(`Recovery word ${number}`) as HTMLInputElement
}

test.each([' ', '\n', ', '])('distributes a complete pasted phrase separated by %j', (separator) => {
  setup()
  const words = [
    'abandon',
    'ability',
    'able',
    'about',
    'above',
    'absent',
    'absorb',
    'abstract',
    'absurd',
    'abuse',
    'access',
    'accident',
  ]
  fireEvent.paste(field(1), {
    clipboardData: {getData: () => `${separator}${words.join(separator).toUpperCase()}${separator}`},
  })
  words.forEach((word, index) => expect(field(index + 1).value).toBe(word))
})

test('a complete phrase pasted into a later field replaces the whole phrase', () => {
  setup()
  fireEvent.paste(field(5), {clipboardData: {getData: () => `${Array(11).fill('abandon').join(' ')} about`}})
  expect(field(1).value).toBe('abandon')
  expect(field(12).value).toBe('about')
})

test('partial paste starts at the focused field; typing a space advances focus', () => {
  setup()
  fireEvent.paste(field(3), {clipboardData: {getData: () => 'FOO bar baz'}})
  expect(field(1).value).toBe('')
  expect(field(3).value).toBe('foo')
  expect(field(5).value).toBe('baz')
  expect(document.activeElement).toBe(field(6))
  fireEvent.change(field(6), {target: {value: 'word '}})
  expect(field(6).value).toBe('word')
  expect(document.activeElement).toBe(field(7))
})

test('keeps arrow navigation and backspace navigation', () => {
  setup()
  field(4).focus()
  fireEvent.keyDown(field(4), {key: 'ArrowUp'})
  expect(document.activeElement).toBe(field(1))
  fireEvent.keyDown(field(1), {key: 'ArrowDown'})
  expect(document.activeElement).toBe(field(4))
  fireEvent.keyDown(field(4), {key: 'Backspace'})
  expect(document.activeElement).toBe(field(3))
})

test('typing a comma advances one field without clearing the following word', () => {
  setup()
  fireEvent.change(field(2), {target: {value: 'about'}})
  fireEvent.change(field(1), {target: {value: 'abandon,'}})
  expect(field(1).value).toBe('abandon')
  expect(field(2).value).toBe('about')
  expect(document.activeElement).toBe(field(2))
  fireEvent.change(field(1), {target: {value: ''}})
  expect(field(1).value).toBe('')
})

test('expands to a supported phrase length on paste', () => {
  setup([12, 15, 18, 21, 24])
  fireEvent.paste(field(1), {clipboardData: {getData: () => `${Array(23).fill('abandon').join(' ')} art`}})
  expect(screen.getAllByRole('textbox')).toHaveLength(24)
  expect(field(24).value).toBe('art')
})

test('rejects an overflowing paste instead of silently dropping words', () => {
  setup()
  fireEvent.paste(field(1), {clipboardData: {getData: () => Array(24).fill('word').join(' ')}})
  expect(screen.getByRole('alert').textContent).toContain('Too many words')
  expect(field(1).value).toBe('')
})
