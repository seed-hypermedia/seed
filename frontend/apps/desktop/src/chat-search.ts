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
  const visible: HMSearchPayload['entities'] = []
  const limit = input.pageSize || (input.query.length < 3 ? 30 : Number.MAX_SAFE_INTEGER)

  for (const entity of output.entities) {
    const url = packHmId(entity.id)
    if (seenUrls.has(url)) continue

    seenUrls.add(url)
    visible.push(entity)

    if (visible.length >= limit) break
  }

  return visible
}

function formatSearchResults(
  output: HMSearchPayload,
  input: Required<Pick<ChatSearchInput, 'query'>> & ChatSearchInput,
) {
  const searchType = getSearchType(input.searchType)
  const visibleResults = getVisibleSearchResults(output, input)

  if (visibleResults.length === 0) {
    return `No results found for "${input.query}" (search type: ${searchType}, include body: ${
      input.includeBody ? 'yes' : 'no'
    }). Try a broader query, a different search type, or enable includeBody.`
  }

  const lines = [
    `Search results for "${input.query}" (${visibleResults.length} result${
      visibleResults.length === 1 ? '' : 's'
    }, search type: ${searchType}, include body: ${input.includeBody ? 'yes' : 'no'})`,
  ]

  for (let index = 0; index < visibleResults.length; index++) {
    const entity = visibleResults[index]
    const url = packHmId(entity.id)
    lines.push(`${index + 1}. ${entity.title || url}`)
    lines.push(`   URL: ${url}`)
    lines.push(`   Type: ${entity.type}`)
    if (entity.parentNames.length > 0) {
      lines.push(`   Parents: ${entity.parentNames.join(' / ')}`)
    }
    if (entity.versionTime) {
      lines.push(`   Updated: ${entity.versionTime}`)
    }
  }

  return lines.join('\n')
}

/**
 * Runs the assistant search tool with the same request fields supported by the desktop client search API.
 */
export async function executeChatSearch(input: ChatSearchInput): Promise<string> {
  const query = input.query.trim()
  if (!query) {
    return 'Error: Search query cannot be empty.'
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

  return formatSearchResults(output, {
    ...input,
    query,
    includeBody: input.includeBody || false,
    searchType,
  })
}
