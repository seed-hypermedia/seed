// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {DropdownMenu, DropdownMenuTrigger} from '../components/dropdown-menu'
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

describe('DropdownMenuTrigger', () => {
  it('keeps hover-hidden triggers visible while their menu is open', () => {
    act(() => {
      root.render(
        <DropdownMenu>
          <DropdownMenuTrigger className="opacity-0 group-hover:opacity-100">Options</DropdownMenuTrigger>
        </DropdownMenu>,
      )
    })

    const trigger = container.querySelector('[data-slot="dropdown-menu-trigger"]')
    expect(trigger?.className).toContain('data-[state=open]:opacity-100')
  })

  it('applies the open-state visibility class to asChild triggers', () => {
    act(() => {
      root.render(
        <DropdownMenu>
          <DropdownMenuTrigger asChild className="opacity-0 group-hover:opacity-100">
            <button type="button">Options</button>
          </DropdownMenuTrigger>
        </DropdownMenu>,
      )
    })

    const trigger = container.querySelector('[data-slot="dropdown-menu-trigger"]')
    expect(trigger?.className).toContain('data-[state=open]:opacity-100')
  })
})
