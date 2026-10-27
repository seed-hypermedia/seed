import {useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react'

type ReadingPosition = {
  top: number
  anchor?: string
  offset: number
  atBottom: boolean
  ids: string[]
  heights: Map<string, number>
}
// Kept across thread/list remounts, separately for each document and layout.
const positions = new Map<string, ReadingPosition>()

/** Retains the root-list reading position and follows new comments only at the bottom. */
export function useCommentsScroll(key: string, ids: string[], ready: boolean, submittedId?: string) {
  const listRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const positionRef = useRef<ReadingPosition>()
  const latestIds = useRef(ids)
  latestIds.current = ids
  const lastSubmission = useRef(submittedId)
  const [hasNewComments, setHasNewComments] = useState(false)
  const heights = useMemo(() => positions.get(key)?.heights ?? new Map<string, number>(), [key])

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current
    const position = positionRef.current
    if (!viewport || !position) return
    viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    position.top = viewport.scrollTop
    position.atBottom = true
    position.anchor = undefined
    position.ids = latestIds.current
    setHasNewComments(false)
  }, [])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || !ready) return
    let parent = list.closest<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (!parent) {
      parent = list.parentElement
      while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement
    }
    const viewport = parent ?? (document.scrollingElement as HTMLElement)
    if (!viewport) return
    viewportRef.current = viewport
    const saved = positions.get(key)
    const position = saved ?? {top: 0, offset: 0, atBottom: true, ids: latestIds.current, heights}
    positionRef.current = position
    positions.set(key, position)
    // Bound session memory without losing the current document's reading position.
    if (positions.size > 100) positions.delete(positions.keys().next().value!)
    const scrollTarget = viewport === document.scrollingElement ? document : viewport
    const viewportTop = () => (viewport === document.scrollingElement ? 0 : viewport.getBoundingClientRect().top)
    let contentHeight = viewport.scrollHeight
    let viewportHeight = viewport.clientHeight
    const capture = () => {
      const resized = contentHeight !== viewport.scrollHeight || viewportHeight !== viewport.clientHeight
      contentHeight = viewport.scrollHeight
      viewportHeight = viewport.clientHeight
      // A queued programmatic scroll can arrive after the footer or lazy rows resize.
      // It must not turn off following as if the reader had scrolled up.
      if (resized) {
        if (position.atBottom) scrollToBottom()
        else restore()
        return
      }
      position.top = viewport.scrollTop
      position.atBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 32
      const anchor = Array.from(list.querySelectorAll<HTMLElement>('[data-comment-id]')).find(
        (row) => row.getBoundingClientRect().bottom > viewportTop(),
      )
      position.anchor = anchor?.dataset.commentId
      position.offset = anchor ? anchor.getBoundingClientRect().top - viewportTop() : 0
      if (position.atBottom) {
        position.ids = latestIds.current
        setHasNewComments(false)
      }
    }
    const restore = () => {
      if (position.atBottom && !saved) {
        viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      } else if (position.anchor) {
        const anchor = Array.from(list.querySelectorAll<HTMLElement>('[data-comment-id]')).find(
          (row) => row.dataset.commentId === position.anchor,
        )
        if (anchor) viewport.scrollTop += anchor.getBoundingClientRect().top - viewportTop() - position.offset
        else viewport.scrollTop = position.top
      } else viewport.scrollTop = position.top
    }
    // A return from a thread restores the old position, even if it used to be the bottom.
    if (saved) position.atBottom = false
    restore()
    if (saved) position.atBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 32
    const resize = new ResizeObserver(() => {
      if (position.atBottom) scrollToBottom()
      else restore()
      contentHeight = viewport.scrollHeight
      viewportHeight = viewport.clientHeight
    })
    resize.observe(list)
    resize.observe(viewport)
    scrollTarget.addEventListener('scroll', capture, {passive: true})
    return () => {
      resize.disconnect()
      scrollTarget.removeEventListener('scroll', capture)
      viewportRef.current = null
    }
  }, [key, ready, scrollToBottom, heights])

  const idsKey = ids.join('\n')
  useLayoutEffect(() => {
    const position = positionRef.current
    if (!position || !ready) return
    const ownComment = submittedId && submittedId !== lastSubmission.current
    lastSubmission.current = submittedId
    if (ownComment || position.atBottom) scrollToBottom()
    else setHasNewComments(ids.some((id) => !position.ids.includes(id)))
  }, [idsKey, submittedId, ready, scrollToBottom])

  return {listRef, hasNewComments, scrollToBottom, heights}
}
