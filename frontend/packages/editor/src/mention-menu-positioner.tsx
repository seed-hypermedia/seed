import {InlineMentionsResult, useInlineMentions} from '@shm/shared/models/inline-mentions'
import type {SearchResultItem as SearchResultData} from '@shm/shared/models/search'
import {packHmId, packReferenceUrl} from '@shm/shared/utils/entity-id-url'
import {useDebounce} from '@shm/shared/utils/use-debounce'
import {SearchResultItem} from '@shm/ui/search'
import {SizableText} from '@shm/ui/text'
import {TooltipProvider} from '@shm/ui/tooltip'
import Tippy from '@tippyjs/react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {BlockSchema} from './blocknote/core/extensions/Blocks/api/blockTypes'
import type {MentionMenuState} from './mention-menu-plugin'

const groupsOrder = ['Contacts', 'Recents', 'Profiles', 'Documents'] as const
type GroupKey = (typeof groupsOrder)[number]

function isOptionsEmpty(obj: InlineMentionsResult) {
  return Object.values(obj).every((value) => value.length === 0)
}

function getVisibleGroups(suggestions: InlineMentionsResult): GroupKey[] {
  return groupsOrder.filter((g) => suggestions[g].length > 0)
}

export function MentionMenuPositioner<BSchema extends BlockSchema>({
  editor,
  perspectiveAccountUid,
}: {
  editor: BlockNoteEditor<BSchema>
  perspectiveAccountUid?: string | null
}) {
  const [show, setShow] = useState(false)
  const [query, setQuery] = useState('')
  const referencePos = useRef<DOMRect>()
  const decorationIdRef = useRef<string>()
  const scroller = useRef<HTMLElement | null>(null)
  const [scrollTick, setScrollTick] = useState(0)

  const debouncedQuery = useDebounce(query, 250)
  const {onMentionsQuery} = useInlineMentions(perspectiveAccountUid)

  const [suggestions, setSuggestions] = useState<InlineMentionsResult>({
    Recents: [],
    Profiles: [],
    Documents: [],
    Contacts: [],
  })

  const [index, setIndex] = useState<[GroupKey, number]>(['Recents', 0])
  const [hasFetched, setHasFetched] = useState(false)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const refreshReferencePos = useCallback(() => {
    if (!decorationIdRef.current) return
    const el = document.querySelector(`[data-decoration-id="${decorationIdRef.current}"]`)
    if (el) {
      referencePos.current = el.getBoundingClientRect()
      setScrollTick((t) => t + 1)
    }
  }, [])

  useEffect(() => {
    setTimeout(() => {
      scroller.current = document.getElementById('scroll-page-wrapper')
    }, 100)
  }, [])

  useEffect(() => {
    if (!show) return
    const scrollEl =
      scroller.current ?? editor.domElement.closest('[data-radix-scroll-area-viewport]') ?? document.documentElement
    if (!scrollEl) return

    const onScroll = () => refreshReferencePos()
    scrollEl.addEventListener('scroll', onScroll, {passive: true})
    return () => scrollEl.removeEventListener('scroll', onScroll)
  }, [show, editor, refreshReferencePos])

  useEffect(() => {
    if (!editor.mentionMenu) return
    return editor.mentionMenu.onUpdate((state: MentionMenuState) => {
      setShow(state.show)
      setQuery(state.query)
      referencePos.current = state.referencePos
      if (state.show) {
        decorationIdRef.current = editor.mentionMenu!.decorationId
      }
      if (!state.show) {
        setSuggestions({Recents: [], Profiles: [], Documents: [], Contacts: []})
        setIndex(['Recents', 0])
        setHasFetched(false)
        decorationIdRef.current = undefined
      }
    })
  }, [editor])

  useEffect(() => {
    if (!editor.mentionMenu) return
    return editor.mentionMenu.onKeyboard(({key}) => {
      if (key === 'ArrowUp') {
        setIndex((prev) => {
          const [group, idx] = prev
          const groups = getVisibleGroups(suggestions)
          if (groups.length === 0) return prev
          if (idx > 0) return [group, idx - 1]
          const groupIdx = groups.indexOf(group)
          if (groupIdx <= 0) {
            const lastGroup = groups[groups.length - 1]!
            return [lastGroup, suggestions[lastGroup].length - 1]
          }
          const prevGroup = groups[groupIdx - 1]!
          return [prevGroup, suggestions[prevGroup].length - 1]
        })
      } else if (key === 'ArrowDown') {
        setIndex((prev) => {
          const [group, idx] = prev
          const groups = getVisibleGroups(suggestions)
          if (groups.length === 0) return prev
          if (idx < suggestions[group].length - 1) return [group, idx + 1]
          const groupIdx = groups.indexOf(group)
          if (groupIdx >= groups.length - 1) return [groups[0]!, 0]
          return [groups[groupIdx + 1]!, 0]
        })
      } else if (key === 'Enter') {
        handleSelect()
      }
    })
  }, [editor, suggestions, index])

  function handleSelect() {
    const [group, idx] = index
    const groups = getVisibleGroups(suggestions)
    if (groups.indexOf(group) >= 0 && idx < suggestions[group].length) {
      const item = suggestions[group][idx]
      if (item) {
        editor.mentionMenu?.insertMention(packReferenceUrl({...item.id, latest: !item.id.blockRef}))
      }
    }
  }

  useEffect(() => {
    if (!show) return
    let isActive = true
    onMentionsQuery(debouncedQuery).then((results: InlineMentionsResult) => {
      if (!isActive) return
      setSuggestions((prev) => ({...prev, ...results}))
      setHasFetched(true)
      if (isOptionsEmpty(results) && debouncedQuery.length > 5) {
        editor.mentionMenu?.closeNoResults()
      }
    })
    return () => {
      isActive = false
    }
  }, [debouncedQuery, show])

  useEffect(() => {
    const firstGroup = groupsOrder.find((g) => suggestions[g].length > 0)
    if (firstGroup) {
      setIndex([firstGroup, 0])
    }
  }, [suggestions])

  useEffect(() => {
    const el = itemRefs.current[`${index[0]}-${index[1]}`]
    if (el) {
      el.scrollIntoView({behavior: 'smooth', block: 'nearest'})
    }
  }, [index])

  const groups = useMemo(() => getVisibleGroups(suggestions), [suggestions])

  const getReferenceClientRect = useMemo(
    () => {
      if (!referencePos.current) return undefined
      const rect = referencePos.current
      return () =>
        ({
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          x: rect.left,
          y: rect.top,
          toJSON: () => {},
        }) as DOMRect
    },
    [referencePos.current, scrollTick], // eslint-disable-line
  )

  function selectItem(item: SearchResultData) {
    editor.mentionMenu?.insertMention(packReferenceUrl({...item.id, latest: !item.id.blockRef}))
  }

  const hasResults = groups.length > 0

  const content = useMemo(() => {
    return (
      <TooltipProvider>
        <div className="border-border bg-background flex max-h-[10em] w-[20em] flex-col overflow-y-auto rounded border shadow-lg">
          {hasFetched && !hasResults && (
            <div className="flex gap-2 bg-white px-4 py-2 dark:bg-black">
              <SizableText size="sm" className="flex-1">
                No Results
              </SizableText>
            </div>
          )}
          {groups.map((group) => (
            <div className="border-border flex flex-col last:border-b-0" key={group}>
              <div className="flex gap-2 bg-white px-4 py-2 dark:bg-black">
                <SizableText size="sm" className="text-muted-foreground flex-1">
                  {group}
                </SizableText>
                {suggestions[group].length >= 1 ? (
                  <SizableText size="xs" className="text-muted-foreground">
                    {suggestions[group].length === 1 ? '1 item' : `${suggestions[group].length} items`}
                  </SizableText>
                ) : null}
              </div>
              {suggestions[group].map((item, i) => {
                const [currentGroup, currentIdx] = index
                const title = item.title || item.id.uid
                return (
                  <div
                    key={`${group}-${item.id.id}`}
                    ref={(el: HTMLDivElement | null) => {
                      itemRefs.current[`${group}-${i}`] = el
                    }}
                  >
                    <SearchResultItem
                      selected={currentGroup === group && currentIdx === i}
                      item={{
                        // @ts-expect-error id is not in SearchResult but used by the component
                        id: item.id,
                        key: packHmId(item.id),
                        title,
                        path: item.parentNames,
                        icon: item.icon,
                        onFocus: () => {},
                        onMouseEnter: () => {},
                        onSelect: () => selectItem(item),
                        subtitle: 'Document',
                        searchQuery: item.searchQuery,
                        versionTime: item.versionTime || '',
                      }}
                    />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </TooltipProvider>
    )
  }, [suggestions, groups, index, editor, hasResults, hasFetched])

  return (
    <Tippy
      appendTo={scroller.current ?? document.body}
      content={content}
      getReferenceClientRect={getReferenceClientRect}
      interactive={true}
      visible={show}
      animation={'fade'}
      placement="bottom-start"
      zIndex={100000}
    />
  )
}
