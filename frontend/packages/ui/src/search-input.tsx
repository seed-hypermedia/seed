import {SearchResult} from '@shm/shared'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import {
  PropsWithChildren,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {Button, Input, InputProps, ScrollView} from 'tamagui'
import {UIAvatar} from './avatar'
import {getDaemonFileUrl} from './get-file-url'
import {Search} from './icons'

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
        <ScrollView>{children}</ScrollView>
      </YStack>
    </YStack>
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
        // ref={elm}
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
        <XStack flex={1} gap="$3" justifyContent="flex-start">
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
                {/* {item.path?.slice(0, -1).join(' / ')} */}
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
