// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {EmbedWrapper} from '../embed-wrapper'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@shm/shared/routing', () => ({
  useRouteLink: () => ({}),
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => ({key: 'document', id: {id: 'hm://uid-1/doc', uid: 'uid-1', path: ['doc']}}),
}))

vi.mock('../highlight-context', () => ({
  useHighlighter: () => () => ({}),
}))

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

describe('EmbedWrapper', () => {
  it('does not apply legacy range-elision class to ranged embeds', () => {
    act(() => {
      root.render(
        <EmbedWrapper
          id={hmId('uid-1', {path: ['doc'], blockRef: 'block-1', blockRange: {start: 1, end: 3}})}
          parentBlockId={null}
          isRange
        >
          <span>whole block content</span>
        </EmbedWrapper>,
      )
    })

    const wrapper = container.querySelector('[data-content-type="embed"]') as HTMLElement | null
    expect(wrapper).toBeTruthy()
    expect(wrapper?.className).not.toContain('hm-embed-range-wrapper')
    expect(wrapper?.dataset.isRange).toBe('true')
  })
})
