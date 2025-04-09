import {LauncherItem, SwitcherItem} from '@/launcher-item'
import {useSearch} from '@shm/shared/models/search'
import {
  HMEntityType,
  HYPERMEDIA_ENTITY_TYPES,
} from '@shm/shared/utils/entity-id-url'
import {Link as LinkIcon, Search} from '@tamagui/lucide-icons'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Input, SizableText, SizeTokens, XStack, YStack} from 'tamagui'
import {TextCursorInput} from '../../ui/src/icons'
import './hm-link-form.css'

export type HypermediaLinkFormProps = {
  children?: ReactNode
  url: string
  text: string
  type: string
  updateLink: (url: string, text: string) => void
  editLink: (url: string, text: string) => void
  seedEntityType?: HMEntityType
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

  return (
    <YStack gap="$1.5" zIndex="$zIndex.5">
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
            placeholder={`${props.type} text`}
            background="$background"
            borderWidth="$0"
            outlineWidth="$0"
            color="$color12"
            id="link-text"
            value={_text}
            onKeyPress={handleKeydown}
            onChangeText={(val) => {
              setText(val)
              props.updateLink(_url, val)
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
            text={_text}
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
            value={_url}
            onKeyPress={handleKeydown}
            background="$background"
            borderWidth="$0"
            outlineWidth="$0"
            color="$color12"
            onChangeText={(val) => {
              setUrl(val)
              props.updateLink(val, _text)
            }}
          />
        </XStack>
      )}

      <SizableText fontSize="$2" color="$brand5">
        {!!props.seedEntityType
          ? `Seed ${HYPERMEDIA_ENTITY_TYPES[props.seedEntityType]}`
          : 'Web Address'}
      </SizableText>

      {props.children}
    </YStack>
  )
}

const SearchInput = ({
  updateLink,
  link,
  text,
  setLink,
  title,
}: {
  updateLink: (url: string, text: string) => void
  link: string
  text: string
  setLink: any
  title: boolean
}) => {
  const [search, setSearch] = useState(link)
  const [focused, setFocused] = useState(false)
  const [inputPosition, setInputPosition] = useState<DOMRect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const viewportHeight = window.innerHeight
  const portalRoot = document.body

  // const recents = useRecents()
  const searchResults = useSearch(search, {})

  const searchItems: SwitcherItem[] =
    searchResults.data?.entities
      ?.map((item) => {
        return {
          title: item.title || item.id.uid,
          key: item.id.id,
          onSelect: () => {
            // assign({props: {url: id.id}} as ButtonType)
            setLink(item.id.id)
            setSearch(item.id.id)
            updateLink(item.id.id, title ? item.title : text)
          },
          subtitle: HYPERMEDIA_ENTITY_TYPES[item.id.type],
        }
      })
      .filter(Boolean) || []
  // const recentItems =
  //   recents.data?.map(({url, title, subtitle, type}) => {
  //     return {
  //       key: url,
  //       title,
  //       subtitle,
  //       onSelect: () => {
  //         const id = unpackHmId(url)
  //         if (!id) {
  //           toast.error('Failed to open recent: ' + url)
  //           return
  //         }
  //         // assign({props: {url: id.id}} as ButtonType)
  //         setLink(id.id)
  //         setSearch(id.id)
  //         updateLink(id.id, title ? title : '')
  //       },
  //     }
  //   }) || []
  const isDisplayingRecents = !search.length
  // const activeItems = isDisplayingRecents ? recentItems : searchItems
  const activeItems = searchItems
  const [focusedIndex, setFocusedIndex] = useState(0)

  useEffect(() => {
    if (focusedIndex >= activeItems.length) setFocusedIndex(0)
  }, [focusedIndex, activeItems])

  // Calculate position of input
  useEffect(() => {
    if (inputRef.current) {
      setInputPosition(inputRef.current.getBoundingClientRect())
    }
  }, [focused, search])

  let dropdownContent = (
    <YStack
      className="search-dropdown-content"
      display={focused ? 'flex' : 'none'}
      gap="$2"
      elevation={2}
      opacity={activeItems.length > 0 ? 1 : 0}
      paddingVertical="$3"
      paddingHorizontal="$3"
      backgroundColor={'$backgroundHover'}
      borderTopStartRadius={0}
      borderTopEndRadius={0}
      borderBottomLeftRadius={6}
      borderBottomRightRadius={6}
      position="absolute"
      width={
        inputPosition && inputPosition.width ? inputPosition?.width + 37 : 300
      }
      top={
        inputPosition
          ? Math.min(inputPosition.bottom, viewportHeight - 200) + 5 // Prevent overflow below viewport
          : 0
      }
      left={inputPosition ? inputPosition.left - 30 : 0}
      maxHeight={500}
      overflow="scroll"
      zIndex={99999}
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
        background="$background"
        borderWidth="$0"
        outlineWidth="$0"
        color="$color12"
        ref={inputRef}
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
          setLink(text)
        }}
        placeholder="Open Seed Document..."
        // disabled={!!actionPromise}
        onKeyPress={(e: any) => {
          if (e.nativeEvent.key === 'Escape') {
            setFocused(false)
            e.preventDefault()
            updateLink(link, text)
            return
          }
          if (e.nativeEvent.key === 'Enter') {
            const item = activeItems[focusedIndex]
            if (item) {
              item.onSelect()
            } else {
              e.preventDefault()
              updateLink(link, text)
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

      {focused && inputPosition && createPortal(dropdownContent, portalRoot)}
    </>
  )
}
