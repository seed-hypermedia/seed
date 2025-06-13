import {
  getDocumentTitle,
  SearchResult,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {XStack, YStack} from '@tamagui/stacks'
import {
  PropsWithChildren,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {Button, Input, InputProps} from 'tamagui'
import {UIAvatar} from './avatar'
import {ScrollArea} from './components/scroll-area'
import {getDaemonFileUrl} from './get-file-url'
import {Search} from './icons'
import {SizableText} from './text'

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
    <YStack gap="$2" w="100%">
      <XStack
        ai="center"
        gap="$2"
        borderWidth={1}
        borderColor="$color5"
        borderRadius="$2"
        paddingHorizontal="$2"
        animation="fast"
      >
        <Search size={16} />
        <Input
          size="$3"
          unstyled
          placeholder="Search Hypermedia documents"
          borderWidth={0}
          // @ts-ignore
          outline="none"
          w="100%"
          autoFocus
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
      </XStack>

      <YStack
        height={200}
        maxHeight={600}
        overflow="hidden"
        // position="absolute"
        // top={52}
        // left={0}
        // right={0}
        // paddingHorizontal="$2"
        // zi="$zIndex.8"
      >
        <ScrollArea className="h-full">{children}</ScrollArea>
      </YStack>
    </YStack>
  )
}
function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function highlightSearchMatch(
  text: string,
  highlight: string = '',
  normalProps = {},
  highlightProps = {color: 'success', weight: 'extrabold'},
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

export function SearchResultItem({
  item,
  selected = false,
}: {
  item: SearchResult
  selected: boolean
}) {
  const elm = useRef<HTMLDivElement>(null)
  const collapsedPath = useCollapsedPath(item.path ?? [], elm)

  useLayoutEffect(() => {
    if (selected) {
      elm.current?.scrollIntoView({block: 'nearest'})
    }
  }, [selected])

  return (
    <YStack paddingVertical="$1" ref={elm}>
      <Button
        key={item.key}
        onPress={() => {
          item.onSelect()
        }}
        backgroundColor={selected ? '$brand12' : '$backgroundTransparent'}
        hoverStyle={{
          backgroundColor: selected ? '$brand12' : undefined,
        }}
        onFocus={item.onFocus}
        onMouseEnter={item.onMouseEnter}
        gap="$4"
        size="$5"
        // height="$"
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
          ) : item.path?.length === 0 ? (
            <UIAvatar label={item.title} size={20} id={item.key} />
          ) : null}
          <YStack flex={1} justifyContent="space-between">
            <XStack
              flex={1}
              gap="$3"
              justifyContent="flex-start"
              alignItems="center"
            >
              {highlightSearchMatch(item.title, item.searchQuery)}

              <YStack
                flex={1}
                justifyContent="flex-start"
                alignItems="flex-end"
              >
                <SizableText size="sm" weight="normal" className="line-clamp-1">
                  {collapsedPath.join(' > ')}
                </SizableText>
              </YStack>
            </XStack>
          </YStack>
        </XStack>
      </Button>
    </YStack>
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
