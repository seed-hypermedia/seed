import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SearchType} from '@shm/shared/client/.generated/entities/v1alpha/entities_pb'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {executeChatSearch} from '../chat-search'

const mockDesktopRequest = vi.hoisted(() => vi.fn())

vi.mock('../desktop-api', () => ({
  desktopRequest: mockDesktopRequest,
}))

describe('executeChatSearch', () => {
  beforeEach(() => {
    mockDesktopRequest.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uses client search defaults and formats deduplicated hm results', async () => {
    mockDesktopRequest.mockResolvedValue({
      searchQuery: 'seed',
      entities: [
        {
          id: unpackHmId('hm://z6Mkabc/projects/seed')!,
          title: 'Seed Notes',
          icon: 'document',
          parentNames: ['Projects'],
          versionTime: '3/19/2026, 10:00 AM',
          searchQuery: 'seed',
          type: 'document',
        },
        {
          id: unpackHmId('hm://z6Mkabc/projects/seed')!,
          title: 'Seed Notes',
          icon: 'document',
          parentNames: ['Projects'],
          versionTime: '3/19/2026, 10:00 AM',
          searchQuery: 'seed',
          type: 'document',
        },
        {
          id: unpackHmId('hm://z6Mkperson')!,
          title: 'Seed Contact',
          icon: 'contact',
          parentNames: [],
          searchQuery: 'seed',
          type: 'contact',
        },
      ],
    })

    const result = await executeChatSearch({query: '  seed  '})

    expect(mockDesktopRequest).toHaveBeenCalledWith('Search', {
      query: 'seed',
      accountUid: undefined,
      includeBody: false,
      contextSize: 48,
      perspectiveAccountUid: undefined,
      searchType: SearchType.SEARCH_HYBRID,
      pageSize: undefined,
    })
    expect(result.summary).toBe('Found 2 results for "seed".')
    expect(result.markdown).toContain('Search results for "seed" (2 results, search type: hybrid, include body: no)')
    expect(result.markdown).toContain('1. [Seed Notes](hm://z6Mkabc/projects/seed)')
    expect(result.markdown).toContain('- URL: hm://z6Mkabc/projects/seed')
    expect(result.markdown).toContain('2. [Seed Contact](hm://z6Mkperson)')
    expect(result.markdown).toContain('- URL: hm://z6Mkperson')
    expect(result.markdown).not.toContain('3. ')
    expect(result.results).toEqual([
      {
        title: 'Seed Notes',
        url: 'hm://z6Mkabc/projects/seed',
        type: 'document',
        parentNames: ['Projects'],
        versionTime: '3/19/2026, 10:00 AM',
      },
      {
        title: 'Seed Contact',
        url: 'hm://z6Mkperson',
        type: 'contact',
        parentNames: [],
        versionTime: undefined,
      },
    ])
  })

  it('passes through explicit search options and reports empty results', async () => {
    mockDesktopRequest.mockResolvedValue({
      searchQuery: 'concepts',
      entities: [],
    })

    const result = await executeChatSearch({
      query: 'concepts',
      accountUid: 'z6Mkaccount',
      includeBody: true,
      contextSize: 12,
      perspectiveAccountUid: 'z6Mkviewer',
      searchType: 'semantic',
      pageSize: 5,
    })

    expect(mockDesktopRequest).toHaveBeenCalledWith('Search', {
      query: 'concepts',
      accountUid: 'z6Mkaccount',
      includeBody: true,
      contextSize: 12,
      perspectiveAccountUid: 'z6Mkviewer',
      searchType: SearchType.SEARCH_SEMANTIC,
      pageSize: 5,
    })
    expect(result.summary).toContain('No results found for "concepts" (search type: semantic, include body: yes).')
    expect(result.markdown).toContain('No results found for "concepts" (search type: semantic, include body: yes).')
    expect(result.results).toEqual([])
  })
})
