// @vitest-environment jsdom
import React from 'react'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {UniversalAppProvider} from '@shm/shared/routing'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentVersionGraphView} from '../document-version-graph-view'
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

function renderGraph() {
  act(() => {
    root.render(
      <UniversalAppProvider openRoute={vi.fn()} openUrl={vi.fn()} universalClient={{request: vi.fn()} as any}>
        <DocumentVersionGraphView
          docId={hmId('z6Mkfm8befyW32tingJymhfqjX6nhLwoBkQxdSmqg9DnqmiH', {path: ['demo-67']})}
          latestVersion="bafy2bzacedezxtfo7mezppdmjfijpzmj72zgnjnbgrx5exprimzuwzxfwsq2g.bafy2bzaceaejob735npr3aweouk2rumqajhi4okuqucpayknnhvng6t276ei2"
          changes={[
            {
              id: 'bafyreiecjrjf2hb7yhopf2lqua4xtd5fxz4ivxvay2rb6a5lu7kwgeubyq',
              deps: [],
              author: 'z6Mkfm8befyW32tingJymhfqjX6nhLwoBkQxdSmqg9DnqmiH',
              createTime: '2026-04-27T21:40:00Z',
            },
            {
              id: 'bafy2bzacedezxtfo7mezppdmjfijpzmj72zgnjnbgrx5exprimzuwzxfwsq2g',
              deps: ['bafyreiecjrjf2hb7yhopf2lqua4xtd5fxz4ivxvay2rb6a5lu7kwgeubyq'],
              author: 'z6Mkfm8befyW32tingJymhfqjX6nhLwoBkQxdSmqg9DnqmiH',
              createTime: '2026-04-27T21:40:00Z',
            },
            {
              id: 'bafy2bzaceaejob735npr3aweouk2rumqajhi4okuqucpayknnhvng6t276ei2',
              deps: ['bafyreiecjrjf2hb7yhopf2lqua4xtd5fxz4ivxvay2rb6a5lu7kwgeubyq'],
              author: 'z6MkQzh9W6yCrGp11fppNWCoDrKYoxkk7ooGQ4HrSdnEX8ukP',
              createTime: '2026-04-27T21:41:00Z',
            },
          ]}
        />
      </UniversalAppProvider>,
    )
  })
}

describe('DocumentVersionGraphView layout', () => {
  it('keeps graph marks visible above selected rows and wraps long detail values', () => {
    renderGraph()

    const selectedRow = container.querySelector('button[aria-pressed="true"]')
    expect(selectedRow?.className).toContain('bg-accent')
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('z-20')
    expect(container.querySelector('aside')?.className).toContain('overflow-hidden')

    const detailRows = Array.from(container.querySelectorAll('dt')).map((label) => ({
      label: label.textContent,
      value: label.nextElementSibling,
    }))
    expect(detailRows.find((row) => row.label === 'Author')?.value?.className).toContain('break-all')
    expect(detailRows.find((row) => row.label === 'Dependencies')?.value?.className).toContain('break-all')
  })
})
