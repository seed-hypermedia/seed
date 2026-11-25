import {useSelector} from '@xstate/react'
import {useEffect} from 'react'
import {createActor, type ActorRefFrom} from 'xstate'
import {commentComposerMachine, type CommentComposerInput} from './comment-composer-machine'

/** Actor type for one comment composer session. */
export type CommentComposerActor = ActorRefFrom<typeof commentComposerMachine>

type RegistryEntry = {
  actor: CommentComposerActor
  refs: number
  released: boolean
  effects: {current: CommentComposerInput}
}

const registry = new Map<string, RegistryEntry>()

function retain(entry: RegistryEntry) {
  entry.refs++
  if (entry.released) {
    entry.released = false
    entry.actor.send({type: 'composer.opened'})
  }
}

function release(entry: RegistryEntry) {
  entry.refs--
  if (entry.refs === 0) {
    entry.released = true
    queueMicrotask(() => {
      if (entry.refs === 0 && entry.actor.getSnapshot().status === 'active') {
        entry.actor.send({type: 'composer.closed'})
      }
    })
  }
}

/**
 * Returns the shared composer actor for `key`, creating and starting it on first use.
 * The actor outlives unmounts long enough to flush pending draft work; remounts with
 * the same key reuse it, and it finishes itself once released and closed. `input` is
 * read through a delegating wrapper, so effect closures always see the latest render's
 * functions.
 */
export function useCommentComposer(key: string, input: CommentComposerInput): CommentComposerActor {
  let entry = registry.get(key)
  if (!entry) {
    const effects = {current: input}
    const actor = createActor(commentComposerMachine, {
      input: {
        loadDraft: () => effects.current.loadDraft(),
        saveDraft: (content) => effects.current.saveDraft(content),
        removeDraft: () => effects.current.removeDraft(),
        publish: (request) => effects.current.publish(request),
      },
    })
    const created: RegistryEntry = {actor, refs: 0, released: false, effects}
    registry.set(key, created)
    actor.subscribe((snapshot) => {
      if (snapshot.status === 'done' && registry.get(key) === created) {
        registry.delete(key)
      }
    })
    actor.start()
    entry = created
  }
  entry.effects.current = input
  useEffect(() => {
    retain(entry)
    return () => release(entry)
  }, [entry])
  return entry.actor
}

/** Loading/busy status of a composer actor for gating render and submit controls. */
export function useCommentComposerStatus(actor: CommentComposerActor): {loading: boolean; busy: boolean} {
  const loading = useSelector(actor, (snapshot) => snapshot.hasTag('loading'))
  const busy = useSelector(actor, (snapshot) => snapshot.hasTag('busy'))
  return {loading, busy}
}

/** Stops every registered composer actor and clears the registry. For tests. */
export function resetCommentComposerRegistry(): void {
  registry.forEach((entry) => {
    entry.actor.stop()
  })
  registry.clear()
}
