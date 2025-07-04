import {LauncherItem, SwitcherItem} from '@/launcher-item'
import {useEntity} from '@shm/shared/models/entity'
import {useSearch} from '@shm/shared/models/search'
import {
  HMEntityType,
  HYPERMEDIA_ENTITY_TYPES,
  packHmId,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {SwitchField} from '@shm/ui/form-fields'
import {Separator} from '@shm/ui/separator'
import {SizableText} from '@shm/ui/text'
import {
  CircleDot,
  File,
  Link as LinkIcon,
  PanelBottom,
  Quote,
  Search,
} from 'lucide-react'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {SizeTokens, XStack, YStack} from 'tamagui'
import {useDocContentContext} from '../../ui/src/document-content'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  TextCursorInput,
  Trash,
  Unlink,
} from '../../ui/src/icons'
import {BlockNoteEditor} from './blocknote'
import {getNodeById} from './blocknote/core/api/util/nodeUtil'
import './hm-link-form.css'
import {HMBlockSchema} from './schema'

const LINK_TYPES = [
  {value: 'link', label: 'Link', icon: LinkIcon},
  {value: 'inline-embed', label: 'Mention', icon: Quote},
  {value: 'button', label: 'Button', icon: CircleDot},
  {value: 'embed', label: 'Content Embed', icon: File},
  {value: 'card', label: 'Card', icon: PanelBottom},
]

export type HypermediaLinkFormProps = {
  editor: BlockNoteEditor<HMBlockSchema>
  children?: ReactNode
  id: string
  url: string
  text: string
  type: 'link' | 'inline-embed' | 'embed' | 'card' | 'button'
  updateLink: (url: string, text: string, hideMenu: boolean) => void
  resetLink: () => void
  seedEntityType?: HMEntityType
  hasName?: boolean
  hasSearch?: boolean
  onChangeType?: (type: string) => void
  toolbarProps?: {
    alignment?: 'flex-start' | 'center' | 'flex-end'
    view?: string
    [key: string]: any
  }
}

export function HypermediaLinkForm(props: HypermediaLinkFormProps) {
  const formSize: SizeTokens = '$2'
  const [_url, setUrl] = useState(props.url || '')
  const [_text, setText] = useState(props.text || '')
  const [selectedType, setSelectedType] = useState(props.type)
  const unpacked = unpackHmId(_url)
  const {collapsedBlocks, setCollapsedBlocks} = useDocContentContext()
  const isSeedLink = !!unpacked
  const isLatestVersion = isSeedLink ? unpacked.latest !== false : false

  useEffect(() => {
    setSelectedType(props.type)
  }, [props.type])

  function handleKeydown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' || event.key == 'Enter') {
      event.preventDefault()
      props.updateLink(_url, _text, true)
    }
  }

  return (
    <YStack gap="$1.5" zIndex="$zIndex.5">
      <LinkTypeDropdown
        selected={selectedType}
        onSelect={(val) => {
          setSelectedType(val)
          props.onChangeType?.(val)
        }}
        seedEntityType={props.seedEntityType}
      />
      {/* </XStack> */}
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
            className="flex-1"
            placeholder={`${props.type} text`}
            id="link-text"
            value={_text}
            onKeyDown={handleKeydown}
            onChangeText={(val) => {
              setText(val)
              props.updateLink(_url, val, false)
            }}
          />
        </XStack>
      )}
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
          updateLink={props.updateLink}
          link={_url}
          text={_text}
          type={props.type}
          setLink={setUrl}
          title={props.type === 'inline-embed' ? true : false}
        />
      </XStack>
      {/* {props.hasSearch ? (
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
            title={props.type === 'inline-embed' ? true : false}
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
      )} */}
      {(props.type === 'embed' || props.type === 'card') && isSeedLink && (
        <YStack gap="$3" marginVertical="$3">
          <SwitchField
            label="Show Latest Version"
            id="latest"
            defaultChecked={isLatestVersion}
            style={{
              opacity: isLatestVersion ? 1 : 0.4,
            }}
            onCheckedChange={(checked) => {
              const newUrl = packHmId({...unpacked, latest: checked})
              setUrl(newUrl)
              props.updateLink(newUrl, _text, false)
            }}
          />
          {props.type === 'embed' && (
            <SwitchField
              label="Expand Block"
              id="expand"
              checked={!collapsedBlocks.has(props.id)}
              style={{
                opacity: !collapsedBlocks.has(props.id) ? 1 : 0.4,
              }}
              onCheckedChange={(checked) => {
                setCollapsedBlocks(props.id, !checked)
              }}
            />
          )}
        </YStack>
      )}
      {props.toolbarProps?.alignment && (
        <XStack
          gap="$0.25"
          paddingLeft="$1"
          justifyContent="space-between"
          marginTop="$2"
        >
          <Label>Alignment</Label>
          <XStack gap="$3">
            <Button
              size="icon"
              onClick={() => {
                props.editor.updateBlock(props.id, {
                  props: {alignment: 'flex-start'},
                })
              }}
              variant={
                props.toolbarProps.alignment === 'flex-start'
                  ? 'default'
                  : 'ghost'
              }
            >
              <AlignLeft className="size-3" />
            </Button>
            <Button
              size="icon"
              onClick={() => {
                props.editor.updateBlock(props.id, {
                  props: {alignment: 'center'},
                })
              }}
              variant={
                props.toolbarProps.alignment === 'center' ? 'default' : 'ghost'
              }
            >
              <AlignCenter className="size-3" />
            </Button>
            <Button
              size="icon"
              onClick={() => {
                props.editor.updateBlock(props.id, {
                  props: {alignment: 'flex-end'},
                })
              }}
              variant={
                props.toolbarProps.alignment === 'flex-end'
                  ? 'default'
                  : 'ghost'
              }
            >
              <AlignRight className="size-3" />
            </Button>
          </XStack>
        </XStack>
      )}

      <SizableText size="sm" className="text-primary">
        {!!props.seedEntityType
          ? `Seed ${HYPERMEDIA_ENTITY_TYPES[props.seedEntityType]}`
          : 'Web Address'}
      </SizableText>

      {props.children}

      <Separator />

      <XStack justifyContent="flex-end">
        <Button
          size="icon"
          onClick={() => {
            if (props.type === 'link') {
              const {state, view} = props.editor._tiptapEditor
              let tr = state.tr
              let range
              const {posBeforeNode} = getNodeById(props.id, state.doc)
              const contentNode = state.doc.nodeAt(posBeforeNode + 1)

              if (contentNode) {
                if (
                  contentNode.type.name === 'embed' ||
                  contentNode.type.name === 'button'
                ) {
                  range = {
                    from: posBeforeNode + 1,
                    to: posBeforeNode + 1 + contentNode.nodeSize,
                  }
                } else {
                  contentNode.descendants((child, childPos) => {
                    const linkMark = child.marks?.find(
                      (mark) => mark.type.name === 'link',
                    )
                    if (linkMark) {
                      range = {
                        from: posBeforeNode + 2 + childPos,
                        to:
                          posBeforeNode +
                          2 +
                          childPos +
                          (child.text?.length || 1),
                      }
                      return false
                    }
                    if (child.type.name === 'inline-embed') {
                      range = {
                        from: posBeforeNode + 2 + childPos,
                        to: posBeforeNode + 2 + childPos + child.nodeSize,
                      }
                      return false
                    }
                  })
                }
              }
              tr = tr.insertText(
                props.text.length ? props.text : ' ',
                range!.from,
                range!.to,
              )
              view.dispatch(tr)
            } else props.editor.removeBlocks([props.id])
            props.resetLink()
          }}
        >
          {props.type === 'link' ? <Unlink size={14} /> : <Trash size={16} />}
        </Button>
      </XStack>
    </YStack>
  )
}

const SearchInput = ({
  updateLink,
  link,
  text,
  setLink,
  title,
  type,
}: {
  updateLink: (url: string, text: string, hideMenu: boolean) => void
  link: string
  text: string
  setLink: any
  title: boolean
  type: string
}) => {
  const [focused, setFocused] = useState(false)
  const [inputPosition, setInputPosition] = useState<DOMRect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const viewportHeight = window.innerHeight
  const portalRoot = document.body

  const unpackedId = unpackHmId(link)
  const currentEntity = useEntity(unpackedId)

  const [search, setSearch] = useState(() => {
    return currentEntity.data?.document?.metadata.name ?? link
  })

  // const recents = useRecents()
  const searchResults = useSearch(search, {}, true, 20 - search.length)

  const searchItems: SwitcherItem[] =
    searchResults.data?.entities
      ?.map((item) => {
        return {
          title: item.title || item.id.uid,
          key: packHmId(item.id),
          searchQuery: item.searchQuery,
          versionTime: item.versionTime
            ? item.versionTime.toDate().toLocaleString()
            : '',
          onSelect: () => {
            const newText = type === 'link' ? text : title ? item.title : text
            setLink(item.id.id)
            setSearch(item.id.id)
            updateLink(item.id.id, newText, true)
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
        <SizableText className="mx-4">Recent Resources</SizableText>
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
        ref={inputRef}
        className="flex-1"
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
        onChangeText={(val) => {
          setSearch(val)
          setLink(val)
          if (type === 'link' || type === 'button') {
            updateLink(val, text, false)
          }
        }}
        placeholder="Open Seed Document..."
        onKeyDown={(e) => {
          if (e.nativeEvent.key === 'Escape') {
            setFocused(false)
            e.preventDefault()
            updateLink(link, text, true)
            return
          }
          if (e.nativeEvent.key === 'Enter') {
            const item = activeItems[focusedIndex]
            if (item) {
              item.onSelect()
            } else {
              e.preventDefault()
              updateLink(link, text, true)
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

export function LinkTypeDropdown({
  selected,
  onSelect,
  seedEntityType,
}: {
  selected: string
  onSelect: (value: string) => void
  seedEntityType?: HMEntityType
}) {
  const [focused, setFocused] = useState(false)
  const [inputPosition, setInputPosition] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const portalRoot = document.body
  const selectedTypeObj = LINK_TYPES.find((t) => t.value === selected)
  const filteredTypes = LINK_TYPES.filter((t) => {
    if (t.value === 'link' || t.value === 'button') return true
    return !!seedEntityType
  })

  useEffect(() => {
    if (ref.current) {
      setInputPosition(ref.current.getBoundingClientRect())
    }
  }, [focused])

  const dropdown = (
    <YStack
      position="absolute"
      top={inputPosition ? inputPosition.bottom + 5 : 0}
      left={inputPosition?.left ?? 0}
      width={inputPosition?.width ?? 200}
      zIndex={99999}
      backgroundColor="$backgroundHover"
      borderRadius="$2"
      paddingVertical="$2"
      elevation="$4"
    >
      {filteredTypes.map((item) => (
        <XStack
          key={item.value}
          paddingHorizontal="$3"
          paddingVertical="$2"
          hoverStyle={{backgroundColor: '$background'}}
          cursor="pointer"
          gap="$2"
          onMouseDown={() => {
            onSelect(item.value)
            setFocused(false)
          }}
        >
          <item.icon
            size={16}
            color={item.value === selected ? '$brand4' : '$color12'}
          />
          <SizableText
            size="$2"
            color={item.value === selected ? '$brand4' : '$color12'}
          >
            {item.label}
          </SizableText>
        </XStack>
      ))}
    </YStack>
  )

  return (
    <>
      <XStack
        ref={ref as any}
        onPress={() => setFocused(!focused)}
        alignItems="center"
        paddingHorizontal="$2"
        borderColor="$borderColorFocus"
        borderWidth="$1"
        borderRadius="$2"
        backgroundColor="$background"
        hoverStyle={{borderColor: '$borderColorHover'}}
        height="$2"
        gap="$2"
      >
        {selectedTypeObj?.icon && <selectedTypeObj.icon size={16} />}
        <SizableText className="ml-1.5">{selectedTypeObj?.label}</SizableText>
        <ChevronDown size={16} />
      </XStack>
      {focused && inputPosition && createPortal(dropdown, portalRoot)}
    </>
  )
}
