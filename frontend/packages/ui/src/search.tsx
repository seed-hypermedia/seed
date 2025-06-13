import {
  HYPERMEDIA_ENTITY_TYPES,
  idToUrl,
  packHmId,
  SearchResult,
  UnpackedHypermediaId,
  unpackHmId,
  useRouteLink,
  useSearch,
  useUniversalAppContext,
} from '@shm/shared'
import {Popover} from '@shm/ui/TamaguiPopover'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {Search} from '@tamagui/lucide-icons'
import {XStack, YStack} from '@tamagui/stacks'
import {Fragment, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {NativeSyntheticEvent, TextInputChangeEventData} from 'react-native'
import {Button, Input} from 'tamagui'
import {UIAvatar} from './avatar'
import {ScrollArea} from './components/scroll-area'
import {getDaemonFileUrl} from './get-file-url'
import {highlightSearchMatch, useCollapsedPath} from './search-input'
import {Separator} from './separator'
import {SizableText} from './text'

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
                {index === searchItems.length - 1 ? undefined : (
                  <Separator className="bg-gray-200" />
                )}
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
    <XStack display="none" $gtSm={{display: 'flex'}}>
      <Popover
        {...popoverState}
        onOpenChange={(open) => {
          popoverState.onOpenChange(open)
        }}
        placement="bottom-end"
      >
        <Popover.Trigger asChild>
          <Button
            size="$2"
            chromeless
            backgroundColor="transparent"
            icon={Search}
          />
        </Popover.Trigger>
        <Popover.Content asChild>
          <YStack
            gap="$2"
            padding="$2"
            backgroundColor="$color4"
            borderRadius="$4"
            height="auto"
            maxHeight="80vh"
            alignSelf="stretch"
            overflow="hidden"
          >
            <XStack gap="$2" alignItems="center" alignSelf="stretch">
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
            </XStack>
            <YStack width="100%" maxHeight="60vh">
              <ScrollArea className="h-full">
                {searchItems.map((item: SearchResult, index: number) => {
                  return (
                    <Fragment key={item.key}>
                      <SearchResultItem
                        item={item}
                        originHomeId={originHomeId}
                        selected={focusedIndex === index}
                        onSelect={() => {
                          popoverState.onOpenChange(false)
                        }}
                      />
                      {index === searchItems.length - 1 ? undefined : (
                        <Separator />
                      )}
                    </Fragment>
                  )
                })}
              </ScrollArea>
            </YStack>
          </YStack>
        </Popover.Content>
      </Popover>
    </XStack>
  )
}

function SearchResultItem({
  item,
  originHomeId,
  selected = false,
  onSelect,
}: {
  item: SearchResult
  originHomeId: UnpackedHypermediaId | null
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
      h="auto"
      {...linkProps}
      alignItems="flex-start"
      justifyContent="flex-start"
      backgroundColor={selected ? '$brand12' : '$backgroundTransparent'}
      paddingVertical="$2.5"
      hoverStyle={{
        backgroundColor: selected ? '$brand12' : undefined,
      }}
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
      <div className="flex flex-col flex-1">
        <div className="h-5 flex items-center mb-2">
          <SizableText className="line-clamp-1">
            {highlightSearchMatch(item.title, item.searchQuery, {
              weight: 'bold',
              size: 'md',
            })}
          </SizableText>
        </div>

        {!!item.path ? (
          <SizableText size="sm" className="line-clamp-1 text-muted-foreground">
            {collapsedPath.join(' / ')}
          </SizableText>
        ) : null}

        <SizableText
          size="xs"
          color={unpackHmId(item.key)?.latest ? 'success' : 'default'}
        >
          {unpackHmId(item.key)?.latest
            ? 'Latest Version'
            : item.versionTime
            ? item.versionTime + ' Version'
            : ''}
        </SizableText>
      </div>
    </Button>
  )
}
