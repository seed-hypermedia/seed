import {
  HYPERMEDIA_ENTITY_TYPES,
  idToUrl,
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
import {Button, Input, ScrollView, Separator, SizableText} from 'tamagui'
import {UIAvatar} from './avatar'
import {getDaemonFileUrl} from './get-file-url'
import {useCollapsedPath} from './search-input'

export function MobileSearch({
  originHomeId,
}: {
  originHomeId: UnpackedHypermediaId | null
}) {
  const [searchValue, setSearchValue] = useState('')
  const searchResults = useSearch(searchValue, {
    enabled: !!searchValue,
    accountUid: originHomeId?.uid,
  })
  const searchItems: SearchResult[] =
    searchResults?.data?.entities
      ?.map((item) => {
        const title = item.title || item.id.uid
        return {
          id: item.id,
          key: item.id.id,
          title,
          path: [...item.parentNames, title],
          icon: item.icon,
          onFocus: () => {},
          onMouseEnter: () => {},
          onSelect: () => {},
          subtitle: HYPERMEDIA_ENTITY_TYPES[item.id.type],
        }
      })
      .filter(Boolean) ?? []
  return (
    <YStack
      gap="$2"
      padding="$2"
      position="relative"
      borderRadius="$4"
      flex={1}
    >
      <Input
        value={searchValue}
        size="$3"
        flex={1}
        onChange={(e: NativeSyntheticEvent<TextInputChangeEventData>) => {
          setSearchValue(e.nativeEvent.target.value)
        }}
        placeholder="Search Documents"
      />
      {searchResults.data?.entities.length ? (
        <YStack
          position="absolute"
          backgroundColor="$background"
          top="100%"
          width="calc(100% - 16px)"
          zIndex="$zIndex.1"
          padding="$2"
          borderRadius="$4"
          borderColor="$borderColor"
          borderWidth={1}
          elevation="$4"
        >
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
        </YStack>
      ) : null}
    </YStack>
  )
}

export function HeaderSearch({
  originHomeId,
}: {
  originHomeId: UnpackedHypermediaId | null
}) {
  const popoverState = usePopoverState()
  const [searchValue, setSearchValue] = useState('')
  const searchResults = useSearch(searchValue, {
    enabled: !!searchValue,
    accountUid: originHomeId?.uid,
  })
  const [focusedIndex, setFocusedIndex] = useState(0)
  const universalAppContext = useUniversalAppContext()
  const inputWrapperRef = useRef(null)
  const [inputWidth, setInputWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (inputWrapperRef.current) {
      const el = inputWrapperRef.current as unknown as HTMLElement
      setInputWidth(el.offsetWidth)
    }
  }, [searchValue])

  const searchItems: SearchResult[] =
    searchResults?.data?.entities
      ?.map((item) => {
        const title = item.title || item.id.uid
        return {
          id: item.id,
          key: item.id.id,
          title,
          path: [...item.parentNames, title],
          icon: item.icon,
          onFocus: () => {},
          onMouseEnter: () => {},
          onSelect: () => {},
          subtitle: HYPERMEDIA_ENTITY_TYPES[item.id.type],
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
        placement="bottom-start"
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
          <div ref={inputWrapperRef} style={{width: 'fit-content'}}>
            <YStack
              gap="$2"
              padding="$2"
              backgroundColor="$color4"
              borderRadius="$4"
              height="auto"
              maxHeight="80vh"
              alignSelf="stretch"
              overflow="hidden"
              width={inputWidth ? `${inputWidth}px` : 'fit-content'}
            >
              <XStack gap="$2" alignItems="center">
                <Search size="$1" margin="$2" />
                <Input
                  value={searchValue}
                  size="$3"
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
                        hasExplicitRouteHandling: false,
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
                <ScrollView overflow="scroll">
                  {searchItems.map((item: SearchResult, index: number) => {
                    return (
                      <Fragment key={item.key}>
                        <SearchResultItem
                          item={item}
                          originHomeId={originHomeId}
                          selected={focusedIndex === index}
                        />
                        {index === searchItems.length - 1 ? undefined : (
                          <Separator />
                        )}
                      </Fragment>
                    )
                  })}
                </ScrollView>
              </YStack>
            </YStack>
          </div>
        </Popover.Content>
      </Popover>
    </XStack>
  )
}

function SearchResultItem({
  item,
  originHomeId,
  selected = false,
}: {
  item: SearchResult
  originHomeId: UnpackedHypermediaId | null
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

  const linkProps = useRouteLink(
    unpackedId
      ? {
          key: 'document',
          id: unpackedId,
        }
      : null,
    originHomeId,
  )
  return (
    <YStack paddingVertical="$1" ref={elm}>
      <Button
        {...linkProps}
        justifyContent="flex-start"
        backgroundColor={selected ? '$brand12' : '$backgroundTransparent'}
        hoverStyle={{
          backgroundColor: selected ? '$brand12' : undefined,
        }}
      >
        <XStack
          flex={1}
          gap="$3"
          justifyContent="flex-start"
          alignItems="center"
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
          <YStack f={1} justifyContent="space-between">
            <SizableText numberOfLines={1} fontWeight={600}>
              {item.title}
            </SizableText>
            {!!item.path ? (
              <SizableText numberOfLines={1} fontWeight={300} fontSize="$3">
                {collapsedPath.join(' / ')}
              </SizableText>
            ) : null}
            {/* <SizableText color="$color10">{item.subtitle}</SizableText> */}
          </YStack>
        </XStack>
      </Button>
    </YStack>
  )
}
