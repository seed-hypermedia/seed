// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {Button} from '../button'
import {SettingsRow, SettingsSection} from '../settings-list'
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
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('SettingsSection', () => {
  it('renders an uppercase label and a bordered card body', () => {
    act(() => {
      root.render(
        <SettingsSection label="AUTHENTICATION">
          <div>child</div>
        </SettingsSection>,
      )
    })

    expect(container.textContent).toContain('AUTHENTICATION')
    const label = container.querySelector('p')
    expect(label?.className).toContain('uppercase')
    expect(container.textContent).toContain('child')
  })
})

describe('SettingsRow', () => {
  it('renders the icon, label, description, and action', () => {
    act(() => {
      root.render(
        <SettingsRow
          icon={<svg data-testid="icon" />}
          label="Password"
          description="Password is set"
          action={<Button>Change</Button>}
        />,
      )
    })

    expect(container.querySelector('[data-testid="icon"]')).not.toBeNull()
    expect(container.textContent).toContain('Password')
    expect(container.textContent).toContain('Password is set')
    expect(container.querySelector('[data-slot="button"]')?.textContent).toContain('Change')
  })

  it('omits the description and action nodes when not provided', () => {
    act(() => {
      root.render(<SettingsRow icon={<svg />} label="Email address" />)
    })

    expect(container.textContent).toContain('Email address')
    expect(container.querySelector('[data-slot="button"]')).toBeNull()
  })
})

describe('Button loading', () => {
  it('disables the button and renders a spinner when loading', () => {
    act(() => {
      root.render(
        <Button loading onClick={() => {}}>
          Add Passkey
        </Button>,
      )
    })

    const button = container.querySelector<HTMLButtonElement>('[data-slot="button"]')
    expect(button?.disabled).toBe(true)
    expect(button?.querySelector('svg')).not.toBeNull()
    expect(button?.textContent).toContain('Add Passkey')
  })
})
