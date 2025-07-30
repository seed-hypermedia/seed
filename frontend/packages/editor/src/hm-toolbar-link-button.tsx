import {
  BlockNoteEditor,
  BlockSchema,
  HyperlinkToolbarProps,
  useEditorSelectionChange,
} from '@/blocknote'
import {hmId, packHmId, unpackHmId} from '@shm/shared'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {Close} from '@shm/ui/icons'
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

      <PopoverContent className="w-fit p-0">
        <AddHyperlink
          url={url}
          setLink={(_url: string) => {
            popoverProps.onOpenChange(false)
            props.editor.focus()
            if (url) {
              setLink(_url, text, url)
            } else {
              setLink(_url, text)
            }
          }}
          onCancel={() => popoverProps.onOpenChange(false)}
          deleteHyperlink={deleteLink}
        />
      </PopoverContent>
    </Popover>
  )
}

function AddHyperlink({
  setLink,
  onCancel,
  url = '',
  deleteHyperlink,
}: {
  setLink: (url: string) => void
  onCancel: () => void
  url?: string
} & Partial<HyperlinkToolbarProps>) {
  const [_url, setUrl] = useState<string>(url)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const inputLink = useCallback((url: string) => {
    try {
      setIsLoading(true)
      resolveHypermediaUrl(url)
        .then((resolved) => {
          console.log('resolved', resolved)
          if (resolved) {
            const baseId = unpackHmId(resolved.id)
            if (!baseId) return
            const u = new URL(url)
            const latest = u.searchParams.get('l')
            const blockRef = u.hash?.slice(1)
            const id = hmId(baseId.uid, {
              path: baseId.path,
              latest: latest === '',
            })
            const finalUrl = `${packHmId(id)}${blockRef ? `#${blockRef}` : ''}`
            setLink(finalUrl)
          } else {
            setLink(url.startsWith('http') ? url : `https://${url}`)
          }
        })
        .catch((e) => {
          setLink(url)
        })
        .finally(() => {
          setIsLoading(false)
        })
    } catch (e) {
      setLink(url.startsWith('http') ? url : `https://${url}`)
      setIsLoading(false)
    }
  }, [])

  return (
    <div className="flex items-center rounded-md p-1.5">
      <Input
        value={_url}
        onChangeText={setUrl}
        className="min-w-[15rem] flex-1"
        placeholder="Enter a link"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            inputLink(_url)
          }
        }}
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
          disabled={!_url}
          onClick={() => {
            inputLink(_url)
          }}
        >
          <Check className="size-3" />
        </Button>
      )}

      <Tooltip content="Delete Link" side="top">
        <Button
          size="icon"
          variant="ghost"
          className={cn(
            'hover:bg-black/10 dark:hover:bg-white/10',
            'focus:bg-black/10 dark:focus:bg-white/10',
          )}
          onClick={deleteHyperlink}
        >
          <Unlink className="size-3" />
        </Button>
      </Tooltip>

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
  )
}
