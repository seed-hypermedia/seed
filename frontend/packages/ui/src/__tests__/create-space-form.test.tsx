// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {CreateSpaceForm, type CreateSpaceFormState} from '../create-space-form'
import {TooltipProvider} from '../tooltip'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React

function renderForm(props: React.ComponentProps<typeof CreateSpaceForm>) {
  act(() => {
    root.render(
      <TooltipProvider>
        <CreateSpaceForm {...props} />
      </TooltipProvider>,
    )
  })
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)
  if (!button) throw new Error(`Button "${label}" not found`)
  return button
}

function clickButton(label: string) {
  act(() => {
    findButton(label).dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
}

describe('CreateSpaceForm', () => {
  it('disables continue button until the space has a name', () => {
    renderForm({onComplete: () => {}})
    expect(findButton('Continue').disabled).toBe(true)

    act(() => {
      root.unmount()
    })
    root = createRoot(container)
    renderForm({onComplete: () => {}, initialState: {name: 'Alberti studio'}})
    expect(findButton('Continue').disabled).toBe(false)
  })

  it('walks through all three steps and completes with the collected state', () => {
    const onComplete = vi.fn()
    renderForm({onComplete, initialState: {name: 'Alberti studio'}})
    expect(container.textContent).toContain("Let's start! Name your space")
    expect(container.textContent).toContain('Step 1/3')

    clickButton('Continue')
    expect(container.textContent).toContain('Add the main identity elements of your space')
    expect(container.textContent).toContain('Step 2/3')

    clickButton('Skip for now')
    expect(container.textContent).toContain('Navigation & Appearance')
    expect(container.textContent).toContain('Step 3/3')

    clickButton('Create space')
    expect(onComplete).toHaveBeenCalledOnce()
    const state = onComplete.mock.calls[0]?.[0] as CreateSpaceFormState
    expect(state.name).toBe('Alberti studio')
    expect(state.cover).toBeNull()
    expect(state.logo).toBeNull()
  })

  it('calls onClose when the close button is pressed', () => {
    const onClose = vi.fn()
    renderForm({onComplete: () => {}, onClose})
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close"]')!
        .dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('only renders the close button when onClose is provided', () => {
    renderForm({onComplete: () => {}})
    expect(container.querySelector('[aria-label="Close"]')).toBeNull()
  })
})
