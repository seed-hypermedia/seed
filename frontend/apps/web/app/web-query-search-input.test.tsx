// @vitest-environment jsdom
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {UniversalAppProvider} from '@shm/shared/routing'
import {TooltipProvider} from '@shm/ui/tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {WebQuerySearchInput} from './web-query-search-input'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function makeId(uid: string, path: string[] = []): UnpackedHypermediaId {
  return {
    uid,
    path,
    id: `hm://${uid}${path.length ? `/${path.join('/')}` : ''}`,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: 'hm',
    latest: false,
  } as UnpackedHypermediaId
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  })
}

describe('WebQuerySearchInput', () => {
  let container: HTMLDivElement
  let root: Root
  let request: ReturnType<typeof vi.fn>

  beforeEach(() => {
    request = vi.fn(async () => ({
      entities: [
        {
          id: makeId('site', ['alpha']),
          title: 'Alpha Document',
          icon: '',
          parentNames: ['Home'],
          searchQuery: 'alpha',
          type: 'document',
        },
      ],
    }))
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

  it('searches documents and selects a result for query blocks', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <UniversalAppProvider
            originHomeId={makeId('site')}
            openRoute={vi.fn()}
            openUrl={vi.fn()}
            universalClient={{request} as any}
          >
            <TooltipProvider>
              <WebQuerySearchInput onSelect={onSelect} onClose={onClose} />
            </TooltipProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      )
    })

    const input = container.querySelector('input')
    if (!input) throw new Error('search input not rendered')

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'alpha')
      input.dispatchEvent(new Event('input', {bubbles: true}))
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    await flushEffects()

    expect(request).toHaveBeenCalledWith(
      'Search',
      expect.objectContaining({
        query: 'alpha',
        iriFilter: 'hm://site*',
        contentTypeFilter: undefined,
      }),
      expect.anything(),
    )

    const result = container.querySelector('[data-testid="search-result-Alpha Document"]') as HTMLButtonElement | null
    expect(result).not.toBeNull()

    act(() => {
      result?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(onSelect).toHaveBeenCalledWith({
      id: makeId('site', ['alpha']),
      route: {key: 'document', id: makeId('site', ['alpha'])},
    })
    expect(onClose).toHaveBeenCalled()
  })
})
