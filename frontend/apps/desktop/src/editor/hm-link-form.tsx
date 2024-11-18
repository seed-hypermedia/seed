import {useRecents} from '@/models/recents'
import {useSearch} from '@/models/search'
import {HYPERMEDIA_ENTITY_TYPES, unpackHmId} from '@shm/shared'
import {
  Input,
  Link as LinkIcon,
  Search,
  SizableText,
  SizeTokens,
  TextCursorInput,
  toast,
  XStack,
  YStack,
} from '@shm/ui'
import {ReactNode, useEffect, useMemo, useState} from 'react'
import {SwitcherItem} from './editor-types'
import {LauncherItem} from './launcher-item'

export type HypermediaLinkFormProps = {
  children?: ReactNode
  url: string
  text: string
  type: string
  updateLink: (url: string, text: string) => void
  editLink: (url: string, text: string) => void
  openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
  hasName?: boolean
  hasSearch?: boolean
}

export function HypermediaLinkForm(props: HypermediaLinkFormProps) {
  const formSize: SizeTokens = '$2'
  const [_url, setUrl] = useState(props.url || '')
  const [_text, setText] = useState(props.text || '')

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key == 'Enter') {
      event.preventDefault()
      props.editLink(_url, _text)
    }
  }
  const unpackedRef = useMemo(() => unpackHmId(_url), [_url])

  return (
    <YStack gap="$1.5">
      {props.hasName && (
        <XStack
          paddingHorizontal="$2"
          ai="center"
          gap="$2"
          background="$background"
          borderColor="$borderColorFocus"
          borderRadius="$2"
          borderWidth="$1"
          hoverStyle={{borderColor: '$borderColorHover'}}
          focusStyle={{borderColor: '$borderColorHover'}}
        >
          <TextCursorInput size={16} />
          <Input
            unstyled
            flex={1}
            size={formSize}
            placeholder="Link text"
            id="link-text"
            key={props.text}
            value={_text}
            onKeyPress={handleKeydown}
            onChangeText={(val) => {
              setText(val)
              props.updateLink(props.url, val)
            }}
          />
        </XStack>
      )}
      {props.hasSearch ? (
        <XStack
          paddingHorizontal="$2"
          ai="center"
          gap="$2"
          background="$background"
          borderColor="$borderColorFocus"
          borderRadius="$2"
          borderWidth="$1"
          hoverStyle={{borderColor: '$borderColorHover'}}
          focusStyle={{borderColor: '$borderColorHover'}}
        >
          <Search size={16} />
          <SearchInput
            updateLink={props.editLink}
            link={_url}
            setLink={setUrl}
            title={props.type === 'mention' ? true : false}
          />
        </XStack>
      ) : (
        <XStack
          paddingHorizontal="$2"
          ai="center"
          gap="$2"
          background="$background"
          borderColor="$borderColorFocus"
          borderRadius="$2"
          borderWidth="$1"
          hoverStyle={{borderColor: '$borderColorHover'}}
          focusStyle={{borderColor: '$borderColorHover'}}
        >
          <LinkIcon size={16} />
          <Input
            unstyled
            flex={1}
            size="$2"
            key={props.url}
            value={_url}
            onKeyPress={handleKeydown}
            onChangeText={(val) => {
              setUrl(val)
              props.updateLink(val, props.text)
            }}
          />
        </XStack>
      )}

      <SizableText fontSize="$2" color="$brand5">
        {unpackedRef ? 'Seed Document' : 'Web Address'}
      </SizableText>

      {props.children}
    </YStack>
  )
}

const SearchInput = ({
  updateLink,
  link,
  setLink,
  title,
}: {
  updateLink: (url: string, text: string) => void
  link: string
  setLink: any
  title: boolean
}) => {
  const [search, setSearch] = useState(link)
  const [focused, setFocused] = useState(false)
  const recents = useRecents()
  const searchResults = useSearch(search, {})

  const searchItems: SwitcherItem[] =
    searchResults.data
      ?.map((item) => {
        const id = unpackHmId(item.id)
        if (!id) return null
        return {
          title: item.title || item.id,
          onSelect: () => {
            // assign({props: {url: id.id}} as ButtonType)
            setLink(id.id)
            setSearch(id.id)
            updateLink(id.id, title ? item.title : '')
          },
          subtitle: HYPERMEDIA_ENTITY_TYPES[id.type],
        }
      })
      .filter(Boolean) || []
  const recentItems =
    recents.data?.map(({url, title, subtitle, type}) => {
      return {
        key: url,
        title,
        subtitle,
        onSelect: () => {
          const id = unpackHmId(url)
          if (!id) {
            toast.error('Failed to open recent: ' + url)
            return
          }
          // assign({props: {url: id.id}} as ButtonType)
          setLink(id.id)
          setSearch(id.id)
          updateLink(id.id, title ? title : '')
        },
      }
    }) || []
  const isDisplayingRecents = !search.length
  const activeItems = isDisplayingRecents ? recentItems : searchItems

  const [focusedIndex, setFocusedIndex] = useState(0)

  useEffect(() => {
    if (focusedIndex >= activeItems.length) setFocusedIndex(0)
  }, [focusedIndex, activeItems])

  let content = (
    <YStack
      display={focused ? 'flex' : 'none'}
      gap="$2"
      elevation={2}
      opacity={1}
      paddingVertical="$3"
      paddingHorizontal="$3"
      backgroundColor={'$backgroundHover'}
      borderTopStartRadius={0}
      borderTopEndRadius={0}
      borderBottomLeftRadius={6}
      borderBottomRightRadius={6}
      position="absolute"
      width="100%"
      top="$8"
      left={0}
      zIndex={999}
    >
      {isDisplayingRecents ? (
        <SizableText color="$color10" marginHorizontal="$4">
          Recent Resources
        </SizableText>
      ) : null}
      {activeItems?.map((item, itemIndex) => {
        return (
          <LauncherItem
            item={item}
            key={item.key}
            selected={focusedIndex === itemIndex}
            onFocus={() => {
              setFocusedIndex(itemIndex)
            }}
            onMouseEnter={() => {
              setFocusedIndex(itemIndex)
            }}
          />
        )
      })}
    </YStack>
  )

  return (
    <>
      <Input
        unstyled
        flex={1}
        size="$2"
        onFocus={() => {
          setFocused(true)
        }}
        onBlur={() => {
          setTimeout(() => {
            setFocused(false)
          }, 150)
        }}
        autoFocus={false}
        value={search}
        onChangeText={(text: string) => {
          setSearch(text)
        }}
        placeholder="Open Seed Document..."
        // disabled={!!actionPromise}
        onKeyPress={(e: any) => {
          if (e.nativeEvent.key === 'Escape') {
            setFocused(false)
            return
          }
          if (e.nativeEvent.key === 'Enter') {
            const item = activeItems[focusedIndex]
            if (item) {
              item.onSelect()
            }
          }
          if (e.nativeEvent.key === 'ArrowDown') {
            e.preventDefault()
            setFocusedIndex((prev) => (prev + 1) % activeItems.length)
          }
          if (e.nativeEvent.key === 'ArrowUp') {
            e.preventDefault()
            setFocusedIndex(
              (prev) => (prev - 1 + activeItems.length) % activeItems.length,
            )
          }
        }}
      />

      {focused && content}
    </>
  )
}
