import {describe, expect, it, vi} from 'vitest'
import {LIST_PAGE_SIZE, listAllPages} from '../list-all-pages'

describe('listAllPages', () => {
  it('follows nextPageToken until exhausted and concatenates items', async () => {
    const pages: Record<string, {items: number[]; nextPageToken: string}> = {
      '': {items: [1, 2], nextPageToken: 'p2'},
      p2: {items: [3], nextPageToken: 'p3'},
      p3: {items: [4, 5], nextPageToken: ''},
    }
    const fetchPage = vi.fn(async (token: string) => pages[token]!)

    const items = await listAllPages(fetchPage, (r) => r)

    expect(items).toEqual([1, 2, 3, 4, 5])
    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(fetchPage).toHaveBeenNthCalledWith(1, '')
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'p2')
    expect(fetchPage).toHaveBeenNthCalledWith(3, 'p3')
  })

  it('returns a single page without extra requests when there is no token', async () => {
    const fetchPage = vi.fn(async () => ({items: ['only'], nextPageToken: ''}))

    const items = await listAllPages(fetchPage, (r) => r)

    expect(items).toEqual(['only'])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('stops after maxPages round-trips even when more pages exist', async () => {
    const pages: Record<string, {items: number[]; nextPageToken: string}> = {
      '': {items: [1, 2], nextPageToken: 'p2'},
      p2: {items: [3, 4], nextPageToken: 'p3'},
      p3: {items: [5], nextPageToken: ''},
    }
    const fetchPage = vi.fn(async (token: string) => pages[token]!)

    const items = await listAllPages(fetchPage, (r) => r, {maxPages: 2})

    expect(items).toEqual([1, 2, 3, 4])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('stops at the safety cap even if the server keeps returning tokens', async () => {
    const page = Array.from({length: LIST_PAGE_SIZE}, (_, i) => i)
    const fetchPage = vi.fn(async () => ({items: page, nextPageToken: 'more'}))

    const items = await listAllPages(fetchPage, (r) => r)

    expect(items.length).toBe(10_000)
    expect(fetchPage).toHaveBeenCalledTimes(10_000 / LIST_PAGE_SIZE)
  })
})
