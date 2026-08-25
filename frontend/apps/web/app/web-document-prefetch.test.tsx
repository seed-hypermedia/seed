// @vitest-environment jsdom
import {hmId} from '@shm/shared'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {WebDocumentPrefetch} from './web-document-prefetch'

vi.mock('@remix-run/react', () => ({
  PrefetchPageLinks: ({page}: {page: string}) => <link data-prefetch-page={page} />,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('WebDocumentPrefetch', () => {
  it('prefetches each intended document route once', () => {
    const guide = hmId('site', {path: ['guide']})
    const about = hmId('site', {path: ['about']})
    let prefetch!: (id: typeof guide) => void

    act(() => {
      root.render(
        <WebDocumentPrefetch originHomeId={hmId('site')}>
          {(onPrefetch) => {
            prefetch = onPrefetch
            return null
          }}
        </WebDocumentPrefetch>,
      )
    })
    act(() => {
      prefetch(guide)
      prefetch(guide)
      prefetch(about)
    })

    expect(
      Array.from(container.querySelectorAll('[data-prefetch-page]')).map((node) =>
        node.getAttribute('data-prefetch-page'),
      ),
    ).toEqual(['/guide', '/about'])
  })
})
