import type {HMSearchPayload} from '@seed-hypermedia/client/hm-types'
import {SearchType} from '@shm/shared/client/.generated/entities/v1alpha/entities_pb'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {desktopRequest} from './desktop-api'

type ChatSearchType = 'keyword' | 'semantic' | 'hybrid'

type ChatSearchInput = {
  query: string
  accountUid?: string
  includeBody?: boolean
  contextSize?: number
  perspectiveAccountUid?: string
  searchType?: ChatSearchType
  pageSize?: number
}

type ChatSearchResultItem = {
  title: string
  url: string
  type: string
  parentNames: string[]
  versionTime?: string
}

type ChatSearchToolOutput = {
  summary: string
  markdown: string
  query: string
  searchType: ChatSearchType
  includeBody: boolean
  results: ChatSearchResultItem[]
}

const CHAT_SEARCH_TYPES: Record<ChatSearchType, SearchType> = {
  keyword: SearchType.SEARCH_KEYWORD,
  semantic: SearchType.SEARCH_SEMANTIC,
  hybrid: SearchType.SEARCH_HYBRID,
}

function getSearchType(searchType?: ChatSearchType): ChatSearchType {
  return searchType || 'hybrid'
}

function getVisibleSearchResults(output: HMSearchPayload, input: Pick<ChatSearchInput, 'pageSize' | 'query'>) {
  const seenUrls = new Set<string>()
  const visible: ChatSearchResultItem[] = []
  const limit = input.pageSize || (input.query.length < 3 ? 30 : Number.MAX_SAFE_INTEGER)

  for (const entity of output.entities) {
    const url = packHmId(entity.id)
    if (seenUrls.has(url)) continue

    seenUrls.add(url)
    visible.push({
      title: entity.title || url,
      url,
      type: entity.type,
      parentNames: entity.parentNames,
      versionTime: entity.versionTime || undefined,
    })

    if (visible.length >= limit) break
  }

  return visible
}

function buildSearchToolOutput(
  output: HMSearchPayload,
  input: Required<Pick<ChatSearchInput, 'query' | 'includeBody'>> & ChatSearchInput,
): ChatSearchToolOutput {
  const searchType = getSearchType(input.searchType)
  const visibleResults = getVisibleSearchResults(output, input)

  if (visibleResults.length === 0) {
    const summary = `No results found for "${input.query}" (search type: ${searchType}, include body: ${
      input.includeBody ? 'yes' : 'no'
    }). Try a broader query, a different search type, or enable includeBody.`

    return {
      summary,
      markdown: summary,
      query: input.query,
      searchType,
      includeBody: input.includeBody,
      results: [],
    }
  }

  const lines = [
    `Search results for "${input.query}" (${visibleResults.length} result${
      visibleResults.length === 1 ? '' : 's'
    }, search type: ${searchType}, include body: ${input.includeBody ? 'yes' : 'no'})`,
    '',
  ]

  for (let index = 0; index < visibleResults.length; index++) {
    const entity = visibleResults[index]
    lines.push(`${index + 1}. [${entity.title}](${entity.url})`)
    lines.push(`   - Type: ${entity.type}`)
    if (entity.parentNames.length > 0) {
      lines.push(`   - Parents: ${entity.parentNames.join(' / ')}`)
    }
    if (entity.versionTime) {
      lines.push(`   - Updated: ${entity.versionTime}`)
    }
    lines.push(`   - URL: ${entity.url}`)
    lines.push('')
  }

  return {
    summary: `Found ${visibleResults.length} result${visibleResults.length === 1 ? '' : 's'} for "${input.query}".`,
    markdown: lines.join('\n'),
    query: input.query,
    searchType,
    includeBody: input.includeBody,
    results: visibleResults,
  }
}

/**
 * Runs the assistant search tool with the same request fields supported by the desktop client search API.
 */
export async function executeChatSearch(input: ChatSearchInput): Promise<ChatSearchToolOutput> {
  const query = input.query.trim()
  if (!query) {
    return {
      summary: 'Error: Search query cannot be empty.',
      markdown: 'Error: Search query cannot be empty.',
      query: '',
      searchType: getSearchType(input.searchType),
      includeBody: input.includeBody || false,
      results: [],
    }
  }

  const searchType = getSearchType(input.searchType)
  const output = await desktopRequest('Search', {
    query,
    accountUid: input.accountUid,
    includeBody: input.includeBody || false,
    contextSize: input.contextSize ?? 48,
    perspectiveAccountUid: input.perspectiveAccountUid,
    searchType: CHAT_SEARCH_TYPES[searchType],
    pageSize: input.pageSize,
  })

  return buildSearchToolOutput(output, {
    ...input,
    query,
    includeBody: input.includeBody || false,
    searchType,
  })
}
