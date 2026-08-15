import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {Markdown} from '../markdown'

vi.mock('@/models/gateway-settings', () => ({
  useGatewayUrl: () => ({data: undefined}),
}))

vi.mock('@/open-url', () => ({
  resolveHypermediaRoute: () => null,
  useOpenUrl: () => vi.fn(),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: undefined}),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('Markdown', () => {
  it('renders GFM tables as real tables', () => {
    const md = ['| Metric | Value |', '| --- | --- |', '| Total items | 1,635 |', '| Year range | 1987 – 2025 |'].join(
      '\n',
    )
    const el = render(<Markdown>{md}</Markdown>)
    const table = el.querySelector('table')
    expect(table).toBeTruthy()
    expect(el.querySelectorAll('th')).toHaveLength(2)
    expect(el.querySelectorAll('td')).toHaveLength(4)
    expect(table!.textContent).toContain('Total items')
    expect(table!.textContent).toContain('1,635')
  })

  it('does not crash on inline code with GFM enabled (the old remark-gfm regression)', () => {
    const el = render(<Markdown>{'Here is `inline code` and a `second` span.'}</Markdown>)
    expect(el.querySelectorAll('code')).toHaveLength(2)
    expect(el.textContent).toContain('inline code')
  })

  it('renders the HM table dialect as a clean table: comments invisible, no extra columns', () => {
    const md = [
      '<!-- id:TBL00001 -->',
      '| Name <!-- col:COL00001 --> | Age <!-- col:COL00002 --> <!-- id:ROW00001 --> |',
      '| --- | --- |',
      '| Alice | 30 <!-- id:ROW00002 --> |',
      '| Bob | 25 <!-- id:ROW00003 --> |',
    ].join('\n')
    const el = render(<Markdown>{md}</Markdown>)
    const table = el.querySelector('table')
    expect(table).toBeTruthy()
    // Two columns, not three — identity comments must not add cells
    expect(el.querySelectorAll('th')).toHaveLength(2)
    expect(el.querySelectorAll('td')).toHaveLength(4)
    // Comments render as nothing
    expect(table!.textContent).not.toContain('COL00001')
    expect(table!.textContent).not.toContain('ROW00002')
    expect(table!.textContent).toContain('Alice')
    expect(table!.textContent).toContain('30')
  })

  it('keeps tables as plain text while streaming (enableGfm=false)', () => {
    const md = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    const el = render(<Markdown enableGfm={false}>{md}</Markdown>)
    expect(el.querySelector('table')).toBeNull()
  })

  it('strips id comments from prose but keeps comments inside code blocks', () => {
    const md = 'A paragraph <!-- id:PARA0001 -->\n\n```html\n<!-- a real code sample -->\n```'
    const el = render(<Markdown>{md}</Markdown>)
    // Only whitespace may remain where the comment was
    expect(el.querySelector('p')!.textContent!.trim()).toBe('A paragraph')
    expect(el.querySelector('pre')!.textContent).toContain('<!-- a real code sample -->')
  })

  it('renders strikethrough and lists with GFM enabled', () => {
    const el = render(<Markdown>{'~~gone~~ and **kept**\n\n- one\n- two'}</Markdown>)
    expect(el.querySelector('del')).toBeTruthy()
    expect(el.querySelectorAll('li')).toHaveLength(2)
  })
})
