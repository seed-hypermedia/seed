import {
  getDocumentTitle,
  packHmId,
  SearchResult,
  UnpackedHypermediaId,
  unpackHmId,
  useRouteLink,
  useSearch,
  useUniversalAppContext,
} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {
  Fragment,
  PropsWithChildren,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {UIAvatar} from './avatar'
import {Button} from './button'
import {ScrollArea} from './components/scroll-area'
import {getDaemonFileUrl} from './get-file-url'
import {Search} from './icons'
import {SizableText} from './text'

import {Input} from './components/input'
import {Popover, PopoverContent, PopoverTrigger} from './components/popover'
import {Separator} from './separator'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export function MobileSearch({
  originHomeId,
  onSelect,
}: {
  originHomeId: UnpackedHypermediaId | null
  onSelect: () => void
}) {
  const [searchValue, setSearchValue] = useState('')
  const searchResults = useSearch(
    searchValue,
    {
      enabled: !!searchValue,
      accountUid: originHomeId?.uid,
    },
    true,
    48 - searchValue.length,
  )
  const searchItems: SearchResult[] =
    searchResults?.data?.entities
      ?.map((item) => {
        const title = item.title || item.id.uid
        return {
          id: item.id,
          key: packHmId(item.id),
          title,
          path: item.parentNames,
          icon: item.icon,
          onFocus: () => {},
          onMouseEnter: () => {},
          onSelect: () => {},
          subtitle: 'Document',
          searchQuery: item.searchQuery,
          versionTime:
            typeof item.versionTime === 'string'
              ? item.versionTime
              : item.versionTime
              ? item.versionTime.toDate().toLocaleString()
              : '',
        }
      })
      .filter(Boolean) ?? []

  return (
    <div className="relative max-h-1/2 w-full gap-2 rounded-md p-2">
      <Input
        className="w-full flex-1"
        value={searchValue}
        onChange={(e) => {
          setSearchValue(e.target.value)
        }}
        placeholder="Search Documents"
      />
      {searchResults.data?.entities[0] ? (
        <div className="mb-8">
          {searchItems.map((item: SearchResult, index: number) => {
            return (
              <Fragment key={item.key}>
                <SearchResultItem
                  item={item}
                  originHomeId={originHomeId}
                  selected={false}
                />
                {index === searchItems.length - 1 ? undefined : <Separator />}
              </Fragment>
            )
          })}
          <Separator className="my-10 bg-gray-400" />
        </div>
      ) : null}
    </div>
  )
}

export function HeaderSearch({
  originHomeId,
}: {
  originHomeId: UnpackedHypermediaId | null
}) {
  const popoverState = usePopoverState()
  const [searchValue, setSearchValue] = useState('')
  const searchResults = useSearch(
    searchValue,
    {
      enabled: !!searchValue,
      accountUid: originHomeId?.uid,
    },
    true,
    48 - searchValue.length,
  )
  const [focusedIndex, setFocusedIndex] = useState(0)
  const universalAppContext = useUniversalAppContext()

  // Clear search when popover closes
  useEffect(() => {
    if (!popoverState.open) {
      setSearchValue('')
      setFocusedIndex(0)
    }
  }, [popoverState.open])

  const searchItems: SearchResult[] =
    searchResults?.data?.entities
      ?.map((item) => {
        const title = item.title || item.id.uid
        return {
          id: item.id,
          key: packHmId(item.id),
          title,
          path: item.parentNames,
          icon: item.icon,
          onFocus: () => {},
          onMouseEnter: () => {},
          // onSelect: () => {}, Now it's assumed it can be undefined for query search?
          subtitle: 'Document',
          searchQuery: item.searchQuery,
          versionTime:
            typeof item.versionTime === 'string'
              ? item.versionTime
              : item.versionTime
              ? item.versionTime.toDate().toLocaleString()
              : '',
        }
      })
      .filter(Boolean) ?? []

  useEffect(() => {
    if (focusedIndex >= searchItems.length) setFocusedIndex(0)
  }, [focusedIndex, searchItems])

  return (
    <div className="hidden flex-col sm:flex">
      <Popover
        {...popoverState}
        onOpenChange={(open) => {
          popoverState.onOpenChange(open)
        }}
      >
        <PopoverTrigger>
          <Button variant="ghost" size="icon">
            <Search className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="bottom" className="p-0">
          <div className="flex h-[calc(100vh-100px)] max-h-[600px] flex-col">
            <div className="relative flex items-center gap-2 self-stretch p-2">
              <Search className="absolute top-1/2 left-4 z-30 size-4 -translate-y-1/2" />
              <Input
                value={searchValue}
                className="h-8 flex-1 pl-8"
                onChange={(e) => {
                  setSearchValue(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    popoverState.onOpenChange(false)
                  }

                  if (e.key === 'Enter') {
                    console.log('🔍 [DEBUG] Enter key pressed')
                    e.preventDefault()

                    if (!universalAppContext) {
                      console.log('🔍 [DEBUG] No universalAppContext found')
                      return
                    }
                    console.log(
                      '🔍 [DEBUG] universalAppContext exists:',
                      universalAppContext,
                    )

                    const selectedEntity =
                      searchResults.data?.entities[focusedIndex]
                    console.log(
                      '🔍 [DEBUG] selectedEntity:',
                      selectedEntity,
                      'focusedIndex:',
                      focusedIndex,
                    )

                    if (!selectedEntity) {
                      console.log('🔍 [DEBUG] No selectedEntity found')
                      return
                    }

                    universalAppContext.openRoute?.({
                      key: 'document',
                      id: selectedEntity.id,
                    })

                    popoverState.onOpenChange(false)
                    console.log(
                      '🔍 [DEBUG] Navigation completed, popover closed',
                    )
                  }

                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setFocusedIndex(
                      (prev) =>
                        (prev - 1 + searchItems.length) % searchItems.length,
                    )
                  }

                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setFocusedIndex((prev) => (prev + 1) % searchItems.length)
                  }
                }}
              />
            </div>
            <div className="min-h-0 w-full max-w-2xl flex-1">
              <ScrollArea>
                <div className="flex flex-col">
                  {searchItems.length > 0 ? (
                    searchItems.map((item: SearchResult, index: number) => {
                      return (
                        <Fragment key={item.key}>
                          <div
                            ref={
                              focusedIndex === index
                                ? (el) => {
                                    if (el) {
                                      const container = el.closest(
                                        '[data-radix-scroll-area-viewport]',
                                      )
                                      if (container) {
                                        const containerRect =
                                          container.getBoundingClientRect()
                                        const elementRect =
                                          el.getBoundingClientRect()

                                        if (
                                          elementRect.bottom >
                                          containerRect.bottom
                                        ) {
                                          container.scrollTop +=
                                            elementRect.bottom -
                                            containerRect.bottom
                                        } else if (
                                          elementRect.top < containerRect.top
                                        ) {
                                          container.scrollTop -=
                                            containerRect.top - elementRect.top
                                        }
                                      }
                                    }
                                  }
                                : undefined
                            }
                          >
                            <SearchResultItem
                              item={item}
                              originHomeId={originHomeId}
                              selected={focusedIndex === index}
                              // onSelect={() => {
                              //   popoverState.onOpenChange(false)
                              // }}
                            />
                          </div>
                          {index === searchItems.length - 1 ? undefined : (
                            <Separator />
                          )}
                        </Fragment>
                      )
                    })
                  ) : (
                    <div className="text-muted-foreground p-4 text-center">
                      No results found
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function SearchResultItem({
  item,
  originHomeId,
  selected = false,
}: {
  item: SearchResult
  originHomeId?: UnpackedHypermediaId | null
  selected: boolean
}) {
  const elm = useRef<HTMLDivElement>(null)
  const collapsedPath = useCollapsedPath(item.path ?? [], elm)
  const unpackedId = unpackHmId(item.key)

  useLayoutEffect(() => {
    if (selected) {
      elm.current?.scrollIntoView({block: 'nearest'})
    }
  }, [selected])

  const navigateProps = useRouteLink(
    unpackedId
      ? {
          key: 'document',
          id: unpackedId,
        }
      : null,
    {...originHomeId, handler: 'onClick'},
  )

  return (
    <Button
      variant="ghost"
      {...navigateProps}
      className={cn(
        'hover:bg-brand-12 active:bg-brand-11 @container flex h-auto w-full items-center justify-start rounded-none py-2',
        selected && 'bg-brand-12',
      )}
    >
      {item.icon ? (
        <UIAvatar
          label={item.title}
          size={20}
          id={item.key}
          url={getDaemonFileUrl(item.icon)}
        />
      ) : item.path?.length === 1 ? (
        <UIAvatar label={item.title} size={20} id={item.key} />
      ) : null}
      <div className="flex w-full flex-1 flex-col gap-1 @md:flex-row">
        <SizableText className="line-clamp-1 w-full truncate text-left font-sans">
          {highlightSearchMatch(item.title, item.searchQuery, {
            weight: 'bold',
            size: 'sm',
          })}
        </SizableText>

        {!!item.path && (unpackHmId(item.key)?.latest || item.versionTime) && (
          <div className="flex items-center gap-2 overflow-hidden">
            {!!item.path
              ? [
                  <SizableText
                    size="xs"
                    weight="light"
                    className="line-clamp-1 flex-none font-sans text-gray-400"
                  >
                    {collapsedPath.join(' / ')}
                  </SizableText>,
                  <Separator vertical />,
                ]
              : null}

            <Tooltip content={item.versionTime || 'No timestamp available'}>
              <SizableText
                className="line-clamp-1 flex-none text-gray-400"
                size="xs"
                weight="light"
                color={unpackHmId(item.key)?.latest ? 'success' : 'default'}
              >
                {unpackHmId(item.key)?.latest
                  ? 'Latest Version'
                  : item.versionTime
                  ? 'Previous Version'
                  : ''}
              </SizableText>
            </Tooltip>
          </div>
        )}
      </div>
    </Button>
  )
}

export function RecentSearchResultItem({
  item,
  selected,
}: {
  item: {
    key: string
    title: string
    subtitle?: string
    path: string[]
    id?: UnpackedHypermediaId
    onSelect: () => void
    onFocus: () => void
    onMouseEnter: () => void
  }
  selected: boolean
}) {
  let path = normalizePath(item.path.slice(0, -1))
  if (item.id) {
    const homeId = `hm://${item.id.uid}`
    const unpacked = unpackHmId(homeId)
    const homeEntity = useResource(unpacked!)
    const doc =
      homeEntity.data?.type === 'document'
        ? homeEntity.data.document
        : undefined
    const homeTitle = getDocumentTitle(doc)

    if (homeTitle && homeTitle !== item.title) {
      path = [homeTitle, ...path]
    }
  }

  return (
    <SearchResultItem
      item={{
        ...item,
        path,
      }}
      selected={selected}
    />
  )
}
export function highlightSearchMatch(
  text: string,
  highlight: string = '',
  normalProps = {},
  highlightProps = {color: 'success', weight: 'bold'},
) {
  if (!highlight) return <SizableText {...normalProps}>{text}</SizableText>
  const parts = text.split(new RegExp(`(${escapeRegExp(highlight)})`, 'gi'))
  return (
    <>
      {parts.map((part, i) => {
        const isMatch = part.toLowerCase() === highlight.toLowerCase()
        return (
          <SizableText key={i} {...(isMatch ? highlightProps : normalProps)}>
            {part}
          </SizableText>
        )
      })}
    </>
  )
}

export function SearchInput({
  children,
  inputProps,
  onArrowDown,
  onArrowUp,
  onEscape,
  onEnter,
}: PropsWithChildren<{
  searchResults: Array<SearchResult>
  inputProps: {
    value: string
    onChangeText: (text: string) => void
    disabled: boolean
  }
  onEscape: () => void
  onArrowUp: () => void
  onArrowDown: () => void
  onEnter: () => void
  focusedIndex: number
}>) {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative flex items-center gap-2 rounded-md">
        <Search className="absolute top-1/2 left-2.5 z-30 size-4 -translate-y-1/2" />
        <Input
          autoFocus={true}
          placeholder="Search Hypermedia documents"
          className="w-full px-1 pl-8"
          {...inputProps}
          onKeyUp={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onEscape()
            }

            if (e.nativeEvent.key === 'Enter') {
              e.preventDefault()
              onEnter()
            }

            if (e.nativeEvent.key === 'ArrowUp') {
              e.preventDefault()
              onArrowUp()
            }

            if (e.nativeEvent.key === 'ArrowDown') {
              e.preventDefault()
              onArrowDown()
            }
          }}
        />
      </div>
      <ScrollArea className="h-full max-h-[200px]">{children}</ScrollArea>
    </div>
  )
}
function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePath(path: string[]): string[] {
  return path.map((segment) => {
    const [first, ...rest] = segment.split('-')
    return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
  })
}

export function useCollapsedPath(
  path: string[],
  containerRef: React.RefObject<HTMLElement>,
  fontSize = 12,
  maxWidth = 200, // fallback width if ref not ready
) {
  const [collapsedPath, setCollapsedPath] = useState<string[]>(path)

  useEffect(() => {
    if (!containerRef.current || path.length <= 3) {
      setCollapsedPath(path)
      return
    }

    const containerWidth = containerRef.current.offsetWidth || maxWidth
    const spacer = 10
    const charWidth = fontSize * 0.6 // approx width of each character

    // Estimate full breadcrumb width
    const fullWidth = path.reduce(
      (acc, item) => acc + item.length * charWidth + spacer,
      0,
    )

    if (fullWidth <= containerWidth) {
      setCollapsedPath(path)
    } else {
      setCollapsedPath([path[0], '…', path[path.length - 1]])
    }
  }, [path, containerRef])

  return collapsedPath
}
