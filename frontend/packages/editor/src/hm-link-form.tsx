import {SearchResult} from '@shm/shared/editor-types'
import {useResource} from '@shm/shared/models/entity'
import {useSearch} from '@shm/shared/models/search'
import {packHmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {useDocContentContext} from '@shm/ui/document-content'
import {SwitchField} from '@shm/ui/form-fields'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  CircleDot,
  File,
  Link as LinkIcon,
  PanelBottom,
  Quote,
  Search,
  TextCursorInput,
  Trash,
  Unlink,
} from '@shm/ui/icons'
import {SearchResultItem} from '@shm/ui/search'
import {Separator} from '@shm/ui/separator'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
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
  isHmLink: boolean
  type: 'link' | 'inline-embed' | 'embed' | 'card' | 'button'
  updateLink: (url: string, text: string, hideMenu: boolean) => void
  resetLink: () => void
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
    <div className="z-[5] flex flex-col gap-2">
      <LinkTypeDropdown
        selected={selectedType}
        onSelect={(val) => {
          setSelectedType(val)
          props.onChangeType?.(val)
        }}
        isHmLink={props.isHmLink}
      />
      {props.hasName && (
        <div className="bg-background border-border hover:border-muted focus:border-muted flex items-center gap-2 rounded-md px-2">
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
        </div>
      )}
      <div className="bg-background border-border hover:border-muted focus:border-muted flex items-center gap-2 rounded-md px-2">
        <Search size={16} />
        <SearchInput
          updateLink={props.updateLink}
          link={_url}
          text={_text}
          type={props.type}
          setLink={setUrl}
          title={props.type === 'inline-embed' ? true : false}
        />
      </div>

      {(props.type === 'embed' || props.type === 'card') && isSeedLink && (
        <div className="my-3 flex flex-col gap-3">
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
        </div>
      )}
      {props.toolbarProps?.alignment && (
        <div className="mt-2 flex justify-between gap-1 pl-1">
          <Label>Alignment</Label>
          <div className="flex gap-3">
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
          </div>
        </div>
      )}

      <SizableText size="sm" className="text-primary">
        {!!props.isHmLink ? `Seed Resource` : 'Web Address'}
      </SizableText>

      {props.children}

      <Separator />

      <div className="flex justify-end">
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
      </div>
    </div>
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
  const portalRoot = window.document.body

  const unpackedId = unpackHmId(link)
  const currentEntity = useResource(unpackedId)
  const document =
    currentEntity.data?.type === 'document'
      ? currentEntity.data.document
      : undefined

  const [search, setSearch] = useState(() => {
    return document?.metadata.name ?? link
  })

  // const recents = useRecents()
  const searchResults = useSearch(search, {
    includeBody: true,
    contextSize: 20 - search.length,
  })

  const searchItems: Array<SearchResult> =
    searchResults.data?.entities
      ?.map((item) => {
        return {
          title: item.title || item.id.uid,
          key: packHmId(item.id),
          searchQuery: item.searchQuery,
          versionTime: item.versionTime
            ? item.versionTime.toDate().toLocaleString()
            : '',
          onFocus: () => {},
          onMouseEnter: () => {},
          onSelect: () => {
            const newText = type === 'link' ? text : title ? item.title : text
            setLink(item.id.id)
            setSearch(item.id.id)
            updateLink(item.id.id, newText, true)
          },
          subtitle: 'Document',
        }
      })
      .filter(Boolean) || []

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
    <div
      className={cn(
        'search-dropdown-content',
        'absolute z-[99999] flex max-h-[500px] flex-col gap-2 overflow-scroll',
        'rounded-b-md border-t-transparent px-3 py-3',
        'bg-muted shadow-md',
        focused ? 'flex' : 'hidden',
        activeItems.length > 0 ? 'opacity-100' : 'opacity-0',
      )}
      style={{
        width:
          inputPosition && inputPosition.width ? inputPosition.width + 37 : 300,
        top: inputPosition
          ? Math.min(inputPosition.bottom, viewportHeight - 200) + 5
          : 0,
        left: inputPosition ? inputPosition.left - 30 : 0,
      }}
    >
      {isDisplayingRecents ? (
        <SizableText className="mx-4">Recent Resources</SizableText>
      ) : null}
      {activeItems?.map((item, itemIndex) => {
        return (
          <SearchResultItem
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
    </div>
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
  isHmLink,
}: {
  selected: string
  onSelect: (value: string) => void
  isHmLink: boolean
}) {
  const [focused, setFocused] = useState(false)
  const [inputPosition, setInputPosition] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const portalRoot = document.body
  const selectedTypeObj = LINK_TYPES.find((t) => t.value === selected)
  const filteredTypes = LINK_TYPES.filter((t) => {
    if (t.value === 'link' || t.value === 'button') return true
    return !!isHmLink
  })

  useEffect(() => {
    if (ref.current) {
      setInputPosition(ref.current.getBoundingClientRect())
    }
  }, [focused])

  const dropdown = (
    <div
      className="bg-background absolute z-[99999] flex flex-col rounded-md py-2 shadow-md"
      style={{
        top: inputPosition ? inputPosition.bottom + 5 : 0,
        left: inputPosition?.left ?? 0,
        width: inputPosition?.width ?? 200,
      }}
    >
      {filteredTypes.map((item) => (
        <div
          key={item.value}
          className="hover:bg-muted flex cursor-pointer gap-2 px-3 py-2"
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
            size="md"
            color={item.value === selected ? 'brand' : 'default'}
          >
            {item.label}
          </SizableText>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <div
        ref={ref as any}
        onClick={() => setFocused(!focused)}
        className="border-border bg-background hover:border-muted flex h-8 items-center gap-2 rounded-md px-2"
      >
        {selectedTypeObj?.icon && <selectedTypeObj.icon size={16} />}
        <SizableText className="ml-1.5">{selectedTypeObj?.label}</SizableText>
        <ChevronDown size={16} />
      </div>
      {focused && inputPosition && createPortal(dropdown, portalRoot)}
    </>
  )
}
