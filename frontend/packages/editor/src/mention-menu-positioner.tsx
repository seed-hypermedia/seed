import {mentionCandidateSubtitle} from '@shm/shared/models/mention-ranking'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {MentionThreadContext} from '@shm/shared/models/mention-ranking'
import {useInlineMentionsSearch} from '@shm/shared/models/inline-mentions'
import {LoadedHMIcon} from '@shm/ui/hm-icon'
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
  const rows = useRef<Array<HTMLButtonElement | null>>([])
  useEffect(() => {
    actor.send({type: 'options.updated', search, perspectiveAccountUid, siteUid, documentId})
  }, [actor, search, perspectiveAccountUid, siteUid, documentId])
  useEffect(() => {
    if (show) editor.mentionMenu?.suspend(mobile)
  }, [editor, show, mobile])
  useEffect(() => {
    rows.current[selected]?.scrollIntoView({block: 'nearest'})
  }, [selected])
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
    <div
      id={listId}
      role="listbox"
      aria-label={mode === 'account' ? 'Accounts' : 'Documents'}
      aria-busy={loading}
      className="border-border bg-background flex max-h-64 w-80 flex-col overflow-y-auto rounded border shadow-lg"
    >
      {loading && (
        <p role="status" className="text-muted-foreground px-4 py-2">
          Searching…
        </p>
      )}
      {error && (
        <p role="alert" className="px-4 py-2">
          Unable to load mentions or resolve the published version.{' '}
          <button onClick={() => actor.send({type: 'menu.retry'})}>Retry</button>
        </p>
      )}
      {!loading && !error && !suggestions.length && (
        <p role="status" className="text-muted-foreground px-4 py-2">
          No {mode === 'account' ? 'accounts' : 'documents'} found
        </p>
      )}
      {suggestions.map((item, i) => (
        <button
          id={`${listId}-${i}`}
          key={item.id.id}
          ref={(el) => {
            rows.current[i] = el
          }}
          role="option"
          aria-selected={selected === i}
          disabled={loading || error}
          className={`flex min-h-12 items-center gap-3 px-4 py-2 text-left ${
            selected === i ? 'bg-accent' : 'hover:bg-accent'
          }`}
          onPointerDown={(event) => {
            if (event.button !== 0 || loading || error) return
            event.preventDefault()
          }}
          onClick={() => actor.send({type: 'menu.select', item})}
        >
          <LoadedHMIcon id={item.id} size={24} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{item.title || item.id.uid}</span>
            <span className="text-muted-foreground text-xs" title={item.type === 'account' ? item.id.uid : undefined}>
              {mentionCandidateSubtitle(item)}
            </span>
          </span>
        </button>
      ))}
    </div>
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
