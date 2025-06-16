import {
  getDocumentTitle,
  SearchResult,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {
  PropsWithChildren,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {Input, InputProps, Button as TButton} from 'tamagui'
import {UIAvatar} from './avatar'
import {Button} from './components/button'
import {ScrollArea} from './components/scroll-area'
import {getDaemonFileUrl} from './get-file-url'
import {Search} from './icons'
import {SizableText} from './text'

import {
  HYPERMEDIA_ENTITY_TYPES,
  idToUrl,
  packHmId,
  useRouteLink,
  useSearch,
  useUniversalAppContext,
} from '@shm/shared'
import {Popover} from '@shm/ui/TamaguiPopover'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {Fragment} from 'react'
import {NativeSyntheticEvent, TextInputChangeEventData} from 'react-native'
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
          subtitle: HYPERMEDIA_ENTITY_TYPES[item.id.type],
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
    <div
      className="p-2 w-full"
      gap="$2"
      padding="$2"
      position="relative"
      borderRadius="$4"
      h="100%"
      maxHeight="50%"
    >
      <Input
        className="w-full"
        value={searchValue}
        size="$3"
        flex={1}
        onChange={(e: NativeSyntheticEvent<TextInputChangeEventData>) => {
          setSearchValue(e.nativeEvent.target.value)
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
                  onSelect={onSelect}
                />
                {index === searchItems.length - 1 ? undefined : <Separator />}
              </Fragment>
            )
          })}
          <Separator className="bg-gray-400 my-10" />
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
  const MIN_INPUT_WIDTH = 500
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
          onSelect: () => {},
          subtitle: HYPERMEDIA_ENTITY_TYPES[item.id.type],
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
    <div className="hidden sm:flex flex-col">
      <Popover
        {...popoverState}
        onOpenChange={(open) => {
          popoverState.onOpenChange(open)
        }}
        placement="bottom-end"
      >
        <Popover.Trigger asChild>
          <TButton size="$2" chromeless icon={Search} />
        </Popover.Trigger>
        <Popover.Content asChild>
          <div className="border border-borded rounded-md bg-white dark:bg-background shadow-md flex flex-col h-[calc(100vh-100px)] max-h-[600px]">
            <div className="flex items-center gap-2 p-2 self-stretch">
              <Search size="$1" margin="$2" />
              <Input
                value={searchValue}
                size="$3"
                f={1}
                onChange={(
                  e: NativeSyntheticEvent<TextInputChangeEventData>,
                ) => {
                  setSearchValue(e.nativeEvent.target.value)
                }}
                onKeyPress={(e: any) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    popoverState.onOpenChange(false)
                  }

                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (!universalAppContext) return

                    const selectedEntity =
                      searchResults.data?.entities[focusedIndex]
                    if (!selectedEntity) return

                    const selectedEntityUrl = idToUrl(selectedEntity.id, {
                      originHomeId: universalAppContext.originHomeId,
                    })

                    if (!selectedEntityUrl) return
                    universalAppContext.openUrl(selectedEntityUrl)

                    popoverState.onOpenChange(false)
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
            <div className="flex-1 min-h-0 max-w-2xl w-full">
              <ScrollArea>
                <div className="flex flex-col">
                  {searchItems.map((item: SearchResult, index: number) => {
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
                            onSelect={() => {
                              popoverState.onOpenChange(false)
                            }}
                          />
                        </div>
                        {index === searchItems.length - 1 ? undefined : (
                          <Separator />
                        )}
                      </Fragment>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          </div>
        </Popover.Content>
      </Popover>
    </div>
  )
}

export function SearchResultItem({
  item,
  originHomeId,
  selected = false,
  onSelect,
}: {
  item: SearchResult
  originHomeId?: UnpackedHypermediaId | null
  selected: boolean
  onSelect?: () => void
}) {
  const elm = useRef<HTMLDivElement>(null)
  const collapsedPath = useCollapsedPath(item.path ?? [], elm)
  const unpackedId = unpackHmId(item.key)

  useLayoutEffect(() => {
    if (selected) {
      elm.current?.scrollIntoView({block: 'nearest'})
    }
  }, [selected])

  const linkProps = useRouteLink(
    unpackedId
      ? {
          key: 'document',
          id: unpackedId,
        }
      : null,
    {...originHomeId, onPress: onSelect},
  )
  return (
    <Button
      variant="ghost"
      {...linkProps}
      className={cn(
        '@container flex items-center justify-start h-auto py-2 hover:bg-brand-12 w-full rounded-none active:bg-brand-11',
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
      <div className="flex flex-col @md:flex-row flex-1 gap-1 w-full">
        <p className="line-clamp-1 flex-1 w-full justify-start text-left">
          {highlightSearchMatch(item.title, item.searchQuery, {
            weight: 'bold',
            size: 'sm',
          })}
        </p>

        {!!item.path && (unpackHmId(item.key)?.latest || item.versionTime) && (
          <div className="flex gap-2 items-center">
            {!!item.path
              ? [
                  <SizableText
                    size="xs"
                    weight="light"
                    className="line-clamp-1 text-gray-400 flex-none"
                  >
                    {collapsedPath.join(' / ')}
                  </SizableText>,
                  <Separator vertical />,
                ]
              : null}

            <Tooltip content={item.versionTime || 'No timestamp available'}>
              <SizableText
                className="line-clamp-1 text-gray-400 flex-none"
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
    const homeEntity = useEntity(unpacked!)
    const homeTitle = getDocumentTitle(homeEntity.data?.document)

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
    value: InputProps['value']
    onChangeText: InputProps['onChangeText']
    disabled: boolean
  }
  onEscape: () => void
  onArrowUp: () => void
  onArrowDown: () => void
  onEnter: () => void
  focusedIndex: number
}>) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-2 border border-border rounded-md px-2">
        <div className="flex-none">
          <Search size={16} />
        </div>

        <Input
          size="$3"
          unstyled
          placeholder="Search Hypermedia documents"
          borderWidth={0}
          // @ts-ignore
          outline="none"
          w="100%"
          autoFocus
          style={{
            outline: 'none',
          }}
          paddingHorizontal="$1"
          {...inputProps}
          onKeyPress={(e: any) => {
            if (e.nativeEvent.key === 'Escape') {
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

      <div className="h-[200px] overflow-hidden overflow-y-scroll">
        {children}
      </div>
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
