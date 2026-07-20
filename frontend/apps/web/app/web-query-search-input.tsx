import type {SearchResult} from '@seed-hypermedia/client/editor-types'
import type {QuerySearchInputProps} from '@shm/editor/query-search-context'
import {SearchType} from '@shm/shared/client/.generated/entities/v1alpha/entities_pb'
import {useSearch} from '@shm/shared/models/search'
import {useUniversalAppContext} from '@shm/shared/routing'
import {packHmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {appRouteOfId} from '@shm/shared/utils/navigation'
import {useDebounce} from '@shm/shared/utils/use-debounce'
import {SearchInput as SearchInputUI, SearchResultItem} from '@shm/ui/search'
import {Separator} from '@shm/ui/separator'
import {SizableText} from '@shm/ui/text'
import {Fragment, useCallback, useEffect, useMemo, useState} from 'react'

const WEB_QUERY_SEARCH_DEBOUNCE_MS = 250

/** Search input used by query blocks on the web app to choose their source document. */
export function WebQuerySearchInput({onClose, onSelect, allowWebURL}: QuerySearchInputProps) {
  const {originHomeId} = useUniversalAppContext()
  const [search, setSearch] = useState('')
  const trimmedSearch = search.trim()
  const debouncedSearch = useDebounce(trimmedSearch, WEB_QUERY_SEARCH_DEBOUNCE_MS)
  const isDebouncing = trimmedSearch.length > 0 && debouncedSearch !== trimmedSearch
  const [focusedIndex, setFocusedIndex] = useState(0)
  const searchResults = useSearch(debouncedSearch, {
    enabled: debouncedSearch.length > 0,
    includeBody: true,
    contextSize: Math.max(8, 48 - debouncedSearch.length),
    searchType: SearchType.SEARCH_KEYWORD,
    pageSize: 30,
    iriFilter: originHomeId?.uid ? `hm://${originHomeId.uid}*` : undefined,
  })

  const directHmIdItem = useMemo<SearchResult | null>(() => {
    const id = unpackHmId(debouncedSearch)
    if (!id) return null
    return {
      key: packHmId(id),
      title: 'Use pasted document',
      subtitle: 'Document',
      path: id.path ?? [],
      searchQuery: debouncedSearch,
      onSelect: () => {
        onSelect({id, route: appRouteOfId(id)})
        onClose?.()
      },
      onFocus: () => setFocusedIndex(0),
      onMouseEnter: () => setFocusedIndex(0),
    }
  }, [debouncedSearch, onClose, onSelect])

  const webUrlItem = useMemo<SearchResult | null>(() => {
    if (!allowWebURL) return null
    if (!debouncedSearch.startsWith('http://') && !debouncedSearch.startsWith('https://')) return null
    return {
      key: `web-url:${debouncedSearch}`,
      title: `Use ${debouncedSearch}`,
      subtitle: 'Web URL',
      path: [],
      searchQuery: debouncedSearch,
      onSelect: () => {
        onSelect({webUrl: debouncedSearch})
        onClose?.()
      },
      onFocus: () => setFocusedIndex(0),
      onMouseEnter: () => setFocusedIndex(0),
    }
  }, [allowWebURL, debouncedSearch, onClose, onSelect])

  const documentItems = useMemo<SearchResult[]>(() => {
    return (searchResults.data?.entities ?? [])
      .filter((item) => item.type !== 'comment')
      .map((item, index) => ({
        key: packHmId(item.id),
        title: item.title || item.id.uid,
        subtitle: item.type === 'contact' ? 'Profile' : 'Document',
        icon: item.icon,
        path: item.parentNames,
        searchQuery: item.searchQuery,
        versionTime: item.versionTime || '',
        onSelect: () => {
          onSelect({id: item.id, route: appRouteOfId(item.id)})
          onClose?.()
        },
        onFocus: () => setFocusedIndex(index + (directHmIdItem || webUrlItem ? 1 : 0)),
        onMouseEnter: () => setFocusedIndex(index + (directHmIdItem || webUrlItem ? 1 : 0)),
      }))
  }, [directHmIdItem, onClose, onSelect, searchResults.data?.entities, webUrlItem])

  const items = useMemo(() => {
    return [directHmIdItem ?? webUrlItem, ...documentItems].filter(Boolean) as SearchResult[]
  }, [directHmIdItem, documentItems, webUrlItem])

  useEffect(() => {
    if (focusedIndex >= items.length) setFocusedIndex(0)
  }, [focusedIndex, items.length])

  const selectFocusedItem = useCallback(() => {
    const item = items[focusedIndex]
    item?.onSelect?.()
  }, [focusedIndex, items])

  const isLoading = isDebouncing || searchResults.isFetching
  const statusMessage = getSearchStatusMessage({
    query: trimmedSearch,
    isLoading,
    isError: searchResults.isError,
    hasResults: items.length > 0,
  })

  return (
    <SearchInputUI
      searchResults={items}
      focusedIndex={focusedIndex}
      loading={isLoading}
      inputProps={{
        value: search,
        disabled: false,
        onChangeText: setSearch,
      }}
      onEscape={() => onClose?.()}
      onEnter={selectFocusedItem}
      onArrowUp={() => {
        if (!items.length) return
        setFocusedIndex((prev) => (prev - 1 + items.length) % items.length)
      }}
      onArrowDown={() => {
        if (!items.length) return
        setFocusedIndex((prev) => (prev + 1) % items.length)
      }}
    >
      <div className="flex flex-col">
        {items.length > 0
          ? items.map((item, index) => (
              <Fragment key={item.key}>
                <SearchResultItem item={item} selected={focusedIndex === index} />
                {index === items.length - 1 ? null : <Separator />}
              </Fragment>
            ))
          : statusMessage}
      </div>
    </SearchInputUI>
  )
}

function getSearchStatusMessage({
  query,
  isLoading,
  isError,
  hasResults,
}: {
  query: string
  isLoading: boolean
  isError: boolean
  hasResults: boolean
}) {
  if (!query)
    return <SizableText className="text-muted-foreground p-4 text-center">Type to search documents</SizableText>
  if (isError) return <SizableText className="text-destructive p-4 text-center">Search failed</SizableText>
  if (isLoading) return <SizableText className="text-muted-foreground p-4 text-center">Searching…</SizableText>
  if (!hasResults)
    return <SizableText className="text-muted-foreground p-4 text-center">No documents found</SizableText>
  return null
}
