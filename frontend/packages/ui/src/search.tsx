import {
  HYPERMEDIA_ENTITY_TYPES,
  idToUrl,
  SearchResult,
  UnpackedHypermediaId,
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

export function MobileSearch({
  originHomeId,
}: {
  originHomeId: UnpackedHypermediaId | null
}) {
  const [searchValue, setSearchValue] = useState('')
  const searchResults = useSearch(searchValue, {enabled: !!searchValue})
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
          {searchResults.data?.entities.map((entity: any, index: number) => {
            return (
              <Fragment key={entity.id.id}>
                <SearchResultItem
                  // key={entity.id.id}
                  entity={entity}
                  originHomeId={originHomeId}
                  selected={false}
                />
                {index ===
                searchResults.data?.entities.length - 1 ? undefined : (
                  <Separator />
                )}
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
  const searchResults = useSearch(searchValue, {enabled: !!searchValue})
  const [focusedIndex, setFocusedIndex] = useState(0)
  const universalAppContext = useUniversalAppContext()
  const searchItems: SearchResult[] =
    searchResults?.data?.entities
      ?.map((item) => {
        return {
          title: item.title || item.id.uid,
          key: item.id.id,
          path: item.id.path,
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
          <YStack
            gap="$2"
            padding="$2"
            backgroundColor="$color4"
            borderRadius="$4"
            maxHeight={500}
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
            <ScrollView flex={1} overflow="scroll">
              {searchResults.data?.entities.map(
                (entity: {id: UnpackedHypermediaId; title: string}, index) => {
                  return (
                    <Fragment key={entity.id.id}>
                      <SearchResultItem
                        // key={entity.id.id}
                        entity={entity}
                        originHomeId={originHomeId}
                        selected={focusedIndex === index}
                      />
                      {index ===
                      searchResults.data?.entities.length - 1 ? undefined : (
                        <Separator />
                      )}
                    </Fragment>
                  )
                },
              )}
            </ScrollView>
          </YStack>
        </Popover.Content>
      </Popover>
    </XStack>
  )
}

function SearchResultItem({
  entity,
  originHomeId,
  selected = false,
}: {
  entity: {id: UnpackedHypermediaId; title: string}
  originHomeId: UnpackedHypermediaId | null
  selected: boolean
}) {
  const elm = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (selected) {
      elm.current?.scrollIntoView({block: 'nearest'})
    }
  }, [selected])

  const linkProps = useRouteLink(
    {
      key: 'document',
      id: entity.id,
    },
    originHomeId,
  )
  return (
    // <Button
    //   backgroundColor="$colorTransparent"
    //   {...linkProps}
    //   justifyContent="flex-start"
    // >
    //   {entity.title}
    // </Button>
    <Button
      ref={elm}
      {...linkProps}
      justifyContent="flex-start"
      backgroundColor={selected ? '$brand12' : '$backgroundTransparent'}
      hoverStyle={{
        backgroundColor: selected ? '$brand12' : undefined,
      }}
    >
      <YStack f={1} justifyContent="space-between">
        <SizableText numberOfLines={1} fontWeight={600}>
          {entity.title}
        </SizableText>
        {!!entity.id.path ? (
          <SizableText numberOfLines={1} fontWeight={300} fontSize="$3">
            {entity.id.path?.slice(0, -1).join(' / ')}
          </SizableText>
        ) : null}
        {/* <SizableText color="$color10">{item.subtitle}</SizableText> */}
      </YStack>
    </Button>
  )
}
