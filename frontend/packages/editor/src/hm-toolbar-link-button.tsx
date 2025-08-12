import {
  BlockNoteEditor,
  BlockSchema,
  useEditorSelectionChange,
} from './blocknote'
import {hmId, packHmId, unpackHmId} from '@shm/shared'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useSearch} from '@shm/shared/models/search'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {Close} from '@shm/ui/icons'
import {SearchResultItem} from '@shm/ui/search'
import {Spinner} from '@shm/ui/spinner'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {Check, Link, Unlink} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'

export const HMLinkToolbarButton = <BSchema extends BlockSchema>(props: {
  editor: BlockNoteEditor<BSchema>
}) => {
  const [url, setUrl] = useState<string>(
    props.editor.getSelectedLinkUrl() || '',
  )
  const [text, setText] = useState<string>(props.editor.getSelectedText() || '')

  const {open, ...popoverProps} = usePopoverState()

  useEditorSelectionChange(props.editor, () => {
    setText(props.editor.getSelectedText() || '')
    setUrl(props.editor.getSelectedLinkUrl() || '')
  })

  useEffect(() => {
    props.editor.hyperlinkToolbar.on('update', (state) => {
      setText(state.text || '')
      setUrl(state.url || '')
    })
  }, [props.editor])

  const setLink = useCallback(
    (url: string, text?: string, currentUrl?: string) => {
      if (currentUrl) {
        deleteLink()
      }
      popoverProps.onOpenChange(false)
      props.editor.focus()
      props.editor.createLink(url, text)
    },
    [props.editor],
  )

  const deleteLink = () => {
    const url = props.editor.getSelectedLinkUrl()
    if (url) {
      const {view} = props.editor._tiptapEditor
      const {state} = view
      const $urlPos = state.doc.resolve(state.selection.from)
      const linkMarks = $urlPos.parent.firstChild!.marks
      if (linkMarks && linkMarks.length > 0) {
        // @ts-ignore
        const linkMark = linkMarks.find((mark) => mark.type.name == 'link')
        view.dispatch(
          view.state.tr
            .removeMark($urlPos.start(), $urlPos.end(), linkMark)
            .setMeta('preventAutolink', true),
        )
        view.focus()
      }
    }
  }

  return (
    <Popover open={open} {...popoverProps}>
      <PopoverTrigger asChild>
        <span>
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              'hover:bg-black/10 dark:hover:bg-white/10',
              'focus:bg-black/10 dark:focus:bg-white/10',
              'format-toolbar-item',
              open &&
                'bg-black text-white hover:bg-black/80 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white/90 dark:hover:text-white',
            )}
          >
            <Link className="size-4" />
          </Button>
        </span>
      </PopoverTrigger>

      <PopoverContent className="w-fit max-w-[500px] min-w-[400px] p-0">
        <LinkSearchInput
          initialUrl={url}
          onLinkSelect={(selectedUrl: string) => {
            popoverProps.onOpenChange(false)
            props.editor.focus()
            if (url) {
              setLink(selectedUrl, text, url)
            } else {
              setLink(selectedUrl, text)
            }
          }}
          onCancel={() => popoverProps.onOpenChange(false)}
          onDeleteLink={deleteLink}
        />
      </PopoverContent>
    </Popover>
  )
}

function LinkSearchInput({
  initialUrl = '',
  onLinkSelect,
  onCancel,
  onDeleteLink,
}: {
  initialUrl?: string
  onLinkSelect: (url: string) => void
  onCancel: () => void
  onDeleteLink?: () => void
}) {
  const [searchValue, setSearchValue] = useState(initialUrl)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  // Helper functions to detect URL types
  const isHttpUrl = (url: string) =>
    url.startsWith('http://') || url.startsWith('https://') || url.includes('.')
  const isHypermediaUrl = (url: string) =>
    url.startsWith('hm://') || unpackHmId(url) !== null

  // Use the search hook from shared package
  const searchResults = useSearch(searchValue, {
    enabled:
      !!searchValue && !isHttpUrl(searchValue) && !isHypermediaUrl(searchValue),
    includeBody: false,
    contextSize: 48 - searchValue.length,
  })

  const searchItems =
    searchResults?.data?.entities?.map((item, index) => ({
      id: item.id,
      key: packHmId(item.id),
      title: item.title || item.id.uid,
      path: item.parentNames,
      icon: item.icon,
      searchQuery: item.searchQuery,
      versionTime: item.versionTime
        ? item.versionTime.toDate().toLocaleString()
        : '',
      onSelect: () => handleDocumentSelect(item.id),
      onFocus: () => setFocusedIndex(index),
      onMouseEnter: () => setFocusedIndex(index),
    })) || []

  const handleDocumentSelect = (id: UnpackedHypermediaId) => {
    const url = packHmId(id)
    onLinkSelect(url)
  }

  const handleUrlSubmit = useCallback(
    async (url: string) => {
      if (!url.trim()) return

      try {
        setIsLoading(true)

        if (isHttpUrl(url) || isHypermediaUrl(url)) {
          // Handle hypermedia URL resolution
          if (isHypermediaUrl(url)) {
            try {
              const resolved = await resolveHypermediaUrl(url)
              if (resolved) {
                const baseId = unpackHmId(resolved.id)
                if (baseId) {
                  const u = new URL(
                    url.startsWith('http')
                      ? url
                      : `https://${url.replace('hm://', '')}`,
                  )
                  const latest = u.searchParams.get('l')
                  const blockRef = u.hash?.slice(1)
                  const id = hmId(baseId.uid, {
                    path: baseId.path,
                    latest: latest === '',
                  })
                  const finalUrl = `${packHmId(id)}${
                    blockRef ? `#${blockRef}` : ''
                  }`
                  onLinkSelect(finalUrl)
                  return
                }
              }
            } catch (e) {
              console.warn('Failed to resolve hypermedia URL, using as-is:', e)
            }
          }

          // Handle HTTP URLs or fallback
          const finalUrl = url.startsWith('http') ? url : `https://${url}`
          onLinkSelect(finalUrl)
        } else {
          // If it's not a URL and there are no search results, treat as a regular URL
          const finalUrl = `https://${url}`
          onLinkSelect(finalUrl)
        }
      } catch (e) {
        console.error('Error processing URL:', e)
        onLinkSelect(url)
      } finally {
        setIsLoading(false)
      }
    },
    [onLinkSelect],
  )

  const allItems = [
    ...(searchValue && (isHttpUrl(searchValue) || isHypermediaUrl(searchValue))
      ? [
          {
            key: 'url-input',
            title: `Link to: ${searchValue}`,
            onSelect: () => handleUrlSubmit(searchValue),
            onFocus: () => setFocusedIndex(0),
            onMouseEnter: () => setFocusedIndex(0),
          },
        ]
      : []),
    ...searchItems,
  ]

  useEffect(() => {
    if (focusedIndex >= allItems.length) setFocusedIndex(0)
  }, [focusedIndex, allItems.length])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (allItems[focusedIndex]) {
        allItems[focusedIndex].onSelect()
      } else {
        handleUrlSubmit(searchValue)
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev + 1) % allItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev - 1 + allItems.length) % allItems.length)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="flex flex-col rounded-md">
      {/* Search Input Header */}
      <div className="flex items-center gap-2 border-b p-2">
        <Input
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search documents or enter a URL"
          className="flex-1"
          onKeyDown={handleKeyDown}
          autoFocus
        />

        {isLoading ? (
          <Spinner size="small" />
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              'hover:bg-black/10 dark:hover:bg-white/10',
              'focus:bg-black/10 dark:focus:bg-white/10',
            )}
            disabled={!searchValue}
            onClick={() => handleUrlSubmit(searchValue)}
          >
            <Check className="size-3" />
          </Button>
        )}

        {onDeleteLink && (
          <Tooltip content="Delete Link" side="top">
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                'hover:bg-black/10 dark:hover:bg-white/10',
                'focus:bg-black/10 dark:focus:bg-white/10',
              )}
              onClick={onDeleteLink}
            >
              <Unlink className="size-3" />
            </Button>
          </Tooltip>
        )}

        <Button
          size="icon"
          variant="ghost"
          className={cn(
            'hover:bg-black/10 dark:hover:bg-white/10',
            'focus:bg-black/10 dark:focus:bg-white/10',
          )}
          onClick={onCancel}
        >
          <Close className="size-4" />
        </Button>
      </div>

      {/* Search Results */}
      {allItems.length > 0 && (
        <div className="max-h-[300px] overflow-y-auto">
          {allItems.map((item, index) => (
            <SearchResultItem
              key={item.key}
              item={item}
              selected={focusedIndex === index}
              onSelect={() => item.onSelect()}
              className="border-border rounded-none border-b last:border-b-0"
            />
          ))}
        </div>
      )}

      {searchValue &&
        !isHttpUrl(searchValue) &&
        !isHypermediaUrl(searchValue) &&
        searchItems.length === 0 &&
        !searchResults.isLoading && (
          <div className="text-muted-foreground p-4 text-center text-sm">
            No documents found. Press Enter to create a web link.
          </div>
        )}
    </div>
  )
}
