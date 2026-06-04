import {Button} from '@shm/ui/button'
import {cn} from '@shm/ui/utils'
import {Plus} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {isSlashMenuEnabled, slashMenuPluginKey} from './blocknote/core/extensions/SlashMenu/SlashMenuPlugin'
import type {HyperMediaEditor} from './types'

type Position = {top: number; left: number}

function AddBlockButton({
  onClick,
  className,
  title = 'Insert block',
}: {
  onClick: (e: React.MouseEvent) => void
  className?: string
  title?: string
}) {
  return (
    <Button
      size="icon"
      variant="outline"
      className={cn(
        'text-muted-foreground hover:bg-primary flex size-6 h-7 w-7 min-w-6 scale-95 items-center justify-center rounded-full transition-all hover:scale-110 hover:text-white active:scale-95',
        className,
      )}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <Plus className="size-4" />
    </Button>
  )
}

/**
 * Renders the plus button at the current cursor block if it's empty.
 * Inserts a slash on click. Mounted as a sibling of the editor,
 * positioned via a portal to document.body
 */
export function InlineAddBlockButton({editor}: {editor: HyperMediaEditor}) {
  const [pos, setPos] = useState<Position | null>(null)
  // Track last placement to not rerender on every keystroke.
  const lastRef = useRef<Position | null>(null)

  useEffect(() => {
    const ttEditor = editor._tiptapEditor
    if (!ttEditor) return

    const computePos = (): Position | null => {
      if (!editor.isEditable) return null
      const view = ttEditor.view
      const state = view.state
      if (!isSlashMenuEnabled(state)) return null
      const {anchor} = state.selection
      const $anchor = state.doc.resolve(anchor)
      const textblock = $anchor.parent
      if (!textblock.isTextblock || textblock.childCount > 0) return null
      // Code blocks are textblocks too, but inserting a block from an empty
      // line inside them makes no sense — suppress the button there.
      if (textblock.type.name === 'code-block' || textblock.type.spec.code) return null
      // Check if the cursor's block is a list item.
      let inList = false
      for (let d = $anchor.depth; d > 0; d--) {
        const node = $anchor.node(d)
        if (node.type.name !== 'blockChildren') continue
        const listType = node.attrs.listType
        if (listType === 'Unordered' || listType === 'Ordered' || listType === 'Blockquote') {
          inList = true
        }
        break
      }
      try {
        const coords = view.coordsAtPos(anchor)
        return {
          top: (coords.top + coords.bottom) / 2 + window.scrollY,
          left: coords.left + window.scrollX - (inList ? 56 : 32),
        }
      } catch {
        return null
      }
    }

    const measurePos = () => {
      const next = computePos()
      const last = lastRef.current
      const same = !!next && !!last && next.top === last.top && next.left === last.left
      if (same) return
      if (!next && !last) return
      lastRef.current = next
      setPos(next)
    }

    // Multi-trigger approach to reliably catch when the block type changes.
    let pendingFrame: number | null = null
    const scheduleUpdate = () => {
      if (pendingFrame != null) return
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null
        measurePos()
      })
    }

    const resizeObserver = new ResizeObserver(measurePos)
    resizeObserver.observe(ttEditor.view.dom)

    const mutationObserver = new MutationObserver(measurePos)
    mutationObserver.observe(ttEditor.view.dom, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-content-type'],
    })

    // After any content event, also schedule a delayed measure so
    // even a late React commit gets picked up.
    let pendingTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleDelayedUpdate = () => {
      if (pendingTimer != null) clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        measurePos()
      }, 80)
    }

    const onPmEvent = () => {
      scheduleUpdate()
      scheduleDelayedUpdate()
    }

    scheduleUpdate()
    ttEditor.on('selectionUpdate', onPmEvent)
    ttEditor.on('update', onPmEvent)
    window.addEventListener('scroll', scheduleUpdate, true)
    window.addEventListener('resize', scheduleUpdate)
    return () => {
      if (pendingFrame != null) cancelAnimationFrame(pendingFrame)
      if (pendingTimer != null) clearTimeout(pendingTimer)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      ttEditor.off('selectionUpdate', onPmEvent)
      ttEditor.off('update', onPmEvent)
      window.removeEventListener('scroll', scheduleUpdate, true)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [editor])

  if (!pos) return null

  return createPortal(
    <div
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        zIndex: 10,
        transform: 'translateY(-50%)',
      }}
    >
      <AddBlockButton
        title="Insert block"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const view = editor._tiptapEditor.view
          view.focus()
          view.dispatch(
            view.state.tr
              .insertText('/')
              .scrollIntoView()
              .setMeta(slashMenuPluginKey, {activate: true, triggerCharacter: '/'}),
          )
        }}
      />
    </div>,
    document.body,
  )
}
