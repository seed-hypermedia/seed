import {resolveHypermediaUrl} from '@seed-hypermedia/client'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {packHmId, SearchResult, unpackHmId, useSearch} from '@shm/shared'
import {useDirectory} from '@shm/shared/models/entity'
import {Globe, Search} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {Input} from './components/input'
import {SearchResultItem} from './search'
import {Spinner} from './spinner'
import {cn} from './utils'

function getDisplayValueForLink(link: string) {
  if (!link) return ''
  const unpackedLink = unpackHmId(link)
  return unpackedLink ? `/${unpackedLink.path?.join('/') || ''}` : link
}

/** Searches for a document, or takes a pasted URL, and reports the chosen link. */
export function HMDocURLInput({
  link,
  onUpdate,
  homeId,
  filterPresets,
  overlayResults = false,
}: {
  link: string
  onUpdate: (link: string, title: string) => void
  homeId?: UnpackedHypermediaId
  filterPresets: (item: {link: string}) => boolean
  overlayResults?: boolean
}) {
  const [query, setQuery] = useState(getDisplayValueForLink(link))
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [activeSelection, setActiveSelection] = useState<{
    link: string
    title: string
  } | null>(null)
  const [isResolvingUrl, setIsResolvingUrl] = useState(false)
  const displayValue = getDisplayValueForLink(link)
  const isWebUrl = /^https?:\/\//.test(query.trim())
  const Icon = isWebUrl ? Globe : Search

  useEffect(() => {
    setQuery(displayValue)
  }, [displayValue])

  function closeAndReset() {
    setIsOpen(false)
    setFocusedIndex(0)
    setActiveSelection(null)
    setQuery(displayValue)
    setIsResolvingUrl(false)
  }

  return (
    <div className={cn('flex flex-col gap-2', overlayResults && 'relative')}>
      <div className="relative">
        <Icon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          aria-label="Link"
          className={cn('pl-9', link ? 'text-primary' : 'text-muted-foreground')}
          value={query}
          placeholder="Search documents or paste URL"
          onFocus={() => {
            setIsOpen(true)
            setFocusedIndex(0)
          }}
          onBlur={() => {
            window.setTimeout(() => {
              if (
                document.activeElement instanceof HTMLElement &&
                document.activeElement.dataset.navLinkResult === 'true'
              ) {
                return
              }
              closeAndReset()
            }, 0)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
            setFocusedIndex(0)
          }}
          onKeyDown={async (e) => {
            // The desktop Edit menu's Select All has no shortcut. TODO: find a blocker of cmd A
            // if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
            //   e.preventDefault()
            //   e.currentTarget.select()
            //   return
            // }

            if (e.key === 'Escape') {
              e.preventDefault()
              closeAndReset()
              return
            }

            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setFocusedIndex((prev) => prev - 1)
              return
            }

            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setFocusedIndex((prev) => prev + 1)
              return
            }

            if (e.key !== 'Enter') return

            const trimmedQuery = query.trim()
            if (!trimmedQuery) return

            e.preventDefault()

            if (/^https?:\/\//.test(trimmedQuery)) {
              onUpdate(trimmedQuery, trimmedQuery)
              setIsResolvingUrl(true)
              try {
                const resolved = await resolveHypermediaUrl(trimmedQuery)
                if (resolved) {
                  onUpdate(resolved.id, resolved.title || trimmedQuery)
                }
              } catch (error) {
                console.error(error)
              } finally {
                setIsResolvingUrl(false)
                setIsOpen(false)
                setActiveSelection(null)
              }
              return
            }

            if (activeSelection) {
              onUpdate(activeSelection.link, activeSelection.title)
              setQuery(getDisplayValueForLink(activeSelection.link))
              setIsOpen(false)
              setFocusedIndex(0)
              setActiveSelection(null)
            }
          }}
        />
      </div>
      {isOpen ? (
        <div className={cn(overlayResults && 'absolute inset-x-0 top-full z-50 mt-2')}>
          <SearchUI
            query={query}
            focusedIndex={focusedIndex}
            isResolvingUrl={isResolvingUrl}
            onActiveResultChange={setActiveSelection}
            onFocusedIndexChange={setFocusedIndex}
            onValue={(nextLink, title) => {
              onUpdate(nextLink, title)
              setQuery(getDisplayValueForLink(nextLink))
              setIsOpen(false)
              setFocusedIndex(0)
              setActiveSelection(null)
              setIsResolvingUrl(false)
            }}
            homeId={homeId}
            filterPresets={filterPresets}
          />
        </div>
      ) : null}
    </div>
  )
}

function SearchUI({
  query,
  focusedIndex,
  isResolvingUrl,
  onActiveResultChange,
  onFocusedIndexChange,
  onValue,
  homeId,
  filterPresets,
}: {
  query: string
  focusedIndex: number
  isResolvingUrl: boolean
  onActiveResultChange: (result: {link: string; title: string} | null) => void
  onFocusedIndexChange: (index: number | ((prev: number) => number)) => void
  onValue: (link: string, title: string) => void
  homeId?: UnpackedHypermediaId
  filterPresets: (item: {link: string}) => boolean
}) {
  const trimmedQuery = query.trim()
  const isWebUrl = /^https?:\/\//.test(trimmedQuery)
  const isSearching = !!trimmedQuery.length
  const search = useSearch(query, {enabled: isSearching && !isWebUrl})
  const dirList = useDirectory(homeId, {mode: 'Children'})
  const results: SearchResult[] = (
    isSearching
      ? search?.data?.entities
          ?.sort((a, b) => Number(!!b.id.latest) - Number(!!a.id.latest))
          ?.map((item, index) => {
            const title = item.title || item.id.uid
            return {
              key: packHmId(item.id),
              title,
              path: item.parentNames,
              icon: item.icon,
              onFocus: () => {
                onFocusedIndexChange(index)
              },
              onMouseEnter: () => {
                onFocusedIndexChange(index)
              },
              onSelect: () => onValue(packHmId(item.id), item.title || ''),
              subtitle: 'Document',
              searchQuery: item.searchQuery,
              versionTime: item.versionTime || '',
            }
          })
          .filter(Boolean) ?? []
      : dirList.data?.map((d, index) => {
          const id = d.id.id
          return {
            key: id,
            title: d.metadata.name || '',
            path: d.path,
            icon: d.metadata.icon,
            onSelect: () => onValue(id, d.metadata.name || ''),
            subtitle: 'Document',
            searchQuery: query,
            onFocus: () => {
              onFocusedIndexChange(index)
            },
            onMouseEnter: () => {
              onFocusedIndexChange(index)
            },
          }
        }) ?? []
  ).filter((item) => filterPresets({link: item.key}))

  const normalizedFocusedIndex =
    results.length > 0 ? ((focusedIndex % results.length) + results.length) % results.length : 0

  const prevActiveKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const activeItem = results[normalizedFocusedIndex]
    const nextKey = activeItem?.key ?? null
    if (nextKey !== prevActiveKeyRef.current) {
      prevActiveKeyRef.current = nextKey
      onActiveResultChange(activeItem ? {link: activeItem.key, title: activeItem.title || ''} : null)
    }
  }, [normalizedFocusedIndex, onActiveResultChange, results])

  return (
    <div className="z-50 max-h-[50vh] overflow-y-auto rounded-md border border-black/8 bg-white shadow-sm dark:border-white/10 dark:bg-black">
      {isResolvingUrl ? (
        <div className="flex justify-center p-3">
          <Spinner />
        </div>
      ) : null}
      {!isResolvingUrl && isWebUrl ? (
        <div className="text-muted-foreground px-3 py-2 text-sm">Press Enter to use this URL.</div>
      ) : null}
      {!isResolvingUrl && !results.length && !isWebUrl ? (
        <div className="text-muted-foreground px-3 py-2 text-sm">
          {isSearching ? 'No documents found.' : 'No documents available.'}
        </div>
      ) : null}
      {!isResolvingUrl &&
        results.map((item, itemIndex) => {
          const isSelected = normalizedFocusedIndex === itemIndex

          return (
            <div key={item.key} data-nav-link-result="true" tabIndex={-1} onMouseDown={(e) => e.preventDefault()}>
              <SearchResultItem
                item={{
                  ...item,
                  path: item.path || [],
                  onSelect: () => {
                    onValue(item.key, item.title || '')
                  },
                  onFocus: () => onFocusedIndexChange(itemIndex),
                  onMouseEnter: () => onFocusedIndexChange(itemIndex),
                }}
                selected={isSelected}
              />
            </div>
          )
        })}
    </div>
  )
}
