import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {MentionThreadContext} from '@shm/shared/models/mention-ranking'
import {useInlineMentionsSearch} from '@shm/shared/models/inline-mentions'
import {MentionResults} from '@shm/ui/mention-results'
import Tippy from '@tippyjs/react'
import {useActorRef, useSelector} from '@xstate/react'
import {useEffect, useId, useRef, useState} from 'react'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {BlockSchema} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {mentionMenuMachine} from './mention-menu-machine'
import {MobileMentionsDialog} from './mobile-mentions-dialog'
import {useMobile} from './use-mobile'

/** Shared mention controller, presented as an anchored list or a mobile dialog. */
export function MentionMenuPositioner<BSchema extends BlockSchema>({
  editor,
  perspectiveAccountUid,
  siteUid,
  documentId,
  mentionThread,
}: {
  editor: BlockNoteEditor<BSchema>
  perspectiveAccountUid?: string | null
  siteUid?: string
  documentId?: UnpackedHypermediaId
  mentionThread?: MentionThreadContext
}) {
  const search = useInlineMentionsSearch(mentionThread)
  useEffect(() => {
    let warmed = false
    const warm = () => {
      if (warmed) return
      warmed = true
      void Promise.allSettled([
        search('', perspectiveAccountUid, {mode: 'account', siteUid, documentId}),
        search('', perspectiveAccountUid, {mode: 'document', siteUid, documentId}),
      ])
    }
    editor.domElement.addEventListener('focusin', warm, {once: true})
    const idle = window.requestIdleCallback?.(warm)
    return () => {
      editor.domElement.removeEventListener('focusin', warm)
      if (idle !== undefined) window.cancelIdleCallback(idle)
    }
  }, [editor, search, perspectiveAccountUid, siteUid, documentId])
  const actor = useActorRef(mentionMenuMachine, {input: {editor, search, perspectiveAccountUid, siteUid, documentId}})
  const snapshot = useSelector(actor, (s) => s)
  const show = snapshot.matches('open')
  const lastOpen = useRef(snapshot)
  useEffect(() => {
    if (show) lastOpen.current = snapshot
  }, [show, snapshot])
  // Keep the final rows visible during the exit transition, not the reset menu.
  const displaySnapshot = show ? snapshot : lastOpen.current
  const {suggestions, selected, referencePos, mode, query, error} = displaySnapshot.context
  const loading = !displaySnapshot.matches({open: 'loaded'})
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const mobile = useMobile()
  const listId = useId()
  useEffect(() => {
    actor.send({type: 'options.updated', search, perspectiveAccountUid, siteUid, documentId})
  }, [actor, search, perspectiveAccountUid, siteUid, documentId])
  useEffect(() => {
    if (show) editor.mentionMenu?.suspend(mobile)
  }, [editor, show, mobile])
  useEffect(() => {
    const dom = editor.domElement
    if (show && !mobile) {
      dom.setAttribute('aria-autocomplete', 'list')
      dom.setAttribute('aria-controls', listId)
      dom.setAttribute('aria-expanded', 'true')
      if (suggestions[selected]) dom.setAttribute('aria-activedescendant', `${listId}-${selected}`)
      else dom.removeAttribute('aria-activedescendant')
    }
    return () => {
      for (const attribute of ['aria-autocomplete', 'aria-controls', 'aria-expanded', 'aria-activedescendant'])
        dom.removeAttribute(attribute)
    }
  }, [editor, show, mobile, listId, selected, suggestions])
  const close = () => editor.mentionMenu?.close()
  if (mobile)
    return (
      <MobileMentionsDialog
        isOpen={show}
        onClose={close}
        onSelect={(item) => actor.send({type: 'menu.select', item})}
        mode={mode}
        query={query}
        onQuery={(query) => actor.send({type: 'menu.query', query})}
        results={suggestions}
        loading={loading}
        error={error}
        onRetry={() => actor.send({type: 'menu.retry'})}
        onRestoreFocus={() => editor._tiptapEditor.view.focus()}
      />
    )
  const content = (
    <MentionResults
      id={listId}
      mode={mode}
      suggestions={suggestions}
      selected={selected}
      loading={loading}
      error={error}
      onRetry={() => actor.send({type: 'menu.retry'})}
      onSelect={(item) => actor.send({type: 'menu.select', item})}
    />
  )
  return (
    <Tippy
      appendTo={document.body}
      content={content}
      getReferenceClientRect={referencePos ? () => referencePos : () => editor.domElement.getBoundingClientRect()}
      interactive
      visible={show}
      animation="mention-popover"
      duration={reducedMotion ? 0 : [180, 100]}
      placement="bottom-start"
      zIndex={100000}
    />
  )
}
