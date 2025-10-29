import {hmId, packHmId, unpackHmId} from '@shm/shared'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useSearch} from '@shm/shared/models/search'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {Button} from '@shm/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {SearchResultItem} from '@shm/ui/search'
import {Spinner} from '@shm/ui/spinner'
import {cn} from '@shm/ui/utils'
import {Check, Link, Unlink, X} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  BlockNoteEditor,
  BlockSchema,
  useEditorSelectionChange,
} from './blocknote'

export const MobileLinkToolbarButton = <BSchema extends BlockSchema>(props: {
  editor: BlockNoteEditor<BSchema>
}) => {
  const [url, setUrl] = useState<string>(
    props.editor.getSelectedLinkUrl() || '',
  )
  const [text, setText] = useState<string>(props.editor.getSelectedText() || '')
  const [isOpen, setIsOpen] = useState(false)

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
      setIsOpen(false)
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
    setIsOpen(false)
  }

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className={cn(
          'hover:bg-black/10 dark:hover:bg-white/10',
          'focus:bg-black/10 dark:focus:bg-white/10',
          'h-9 w-9 shrink-0',
          isOpen &&
            'bg-black text-white hover:bg-black/80 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white/90 dark:hover:text-white',
        )}
        onClick={() => setIsOpen(true)}
      >
        <Link className="size-4" />
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          className="h-full max-h-full w-full max-w-full rounded-none p-0"
          showCloseButton={false}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex h-full flex-col">
            <DialogHeader className="border-b p-4">
              <div className="flex items-center justify-between">
                <DialogTitle>Add Link</DialogTitle>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setIsOpen(false)}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto">
              <LinkSearchInput
                initialUrl={url}
                isOpen={isOpen}
                onLinkSelect={(selectedUrl: string) => {
                  if (url) {
                    setLink(selectedUrl, undefined, url)
                  } else {
                    setLink(selectedUrl, undefined)
                  }
                }}
                onCancel={() => setIsOpen(false)}
                onDeleteLink={url ? deleteLink : undefined}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function LinkSearchInput({
  initialUrl = '',
  isOpen,
  onLinkSelect,
  onCancel,
  onDeleteLink,
}: {
  initialUrl?: string
  isOpen: boolean
  onLinkSelect: (url: string) => void
  onCancel: () => void
  onDeleteLink?: () => void
}) {
  const [searchValue, setSearchValue] = useState(initialUrl)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  const isHttpUrl = (url: string) =>
    url.startsWith('http://') || url.startsWith('https://') || url.includes('.')
  const isHypermediaUrl = (url: string) =>
    url.startsWith('hm://') || unpackHmId(url) !== null

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
        ? typeof item.versionTime.toDate === 'function'
          ? item.versionTime.toDate().toLocaleString()
          : item.versionTime instanceof Date
          ? item.versionTime.toLocaleString()
          : String(item.versionTime)
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

          const finalUrl = url.startsWith('http') ? url : `https://${url}`
          onLinkSelect(finalUrl)
        } else {
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
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-4">
        <Input
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search documents or enter a URL"
          onKeyDown={handleKeyDown}
        />

        <div className="flex gap-2">
          {isLoading ? (
            <Spinner size="small" />
          ) : (
            <Button
              variant="default"
              className="flex-1"
              disabled={!searchValue}
              onClick={() => handleUrlSubmit(searchValue)}
            >
              <Check className="mr-2 size-4" />
              Add Link
            </Button>
          )}

          {onDeleteLink && (
            <Button variant="destructive" onClick={onDeleteLink}>
              <Unlink className="mr-2 size-4" />
              Remove
            </Button>
          )}
        </div>
      </div>

      {allItems.length > 0 && (
        <div className="max-h-[60vh] overflow-y-auto border-t">
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
