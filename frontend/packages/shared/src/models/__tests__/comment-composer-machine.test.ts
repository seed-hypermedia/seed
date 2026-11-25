import type {HMBlockNode, HMComment} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from 'vitest'
import {createActor, type Actor} from 'xstate'
import {
  commentComposerMachine,
  composerContentHasText,
  type CommentComposerContent,
  type CommentComposerEmitted,
  type CommentComposerInput,
  type CommentComposerPublishRequest,
} from '../comment-composer-machine'

const textContent = (text: string): CommentComposerContent => ({
  blocks: [
    {
      block: {id: 'b1', type: 'Paragraph', text, annotations: [], attributes: {}},
      children: [],
    } as HMBlockNode,
  ],
})

const emptyParagraph = (): CommentComposerContent => ({
  blocks: [
    {
      block: {id: 'b1', type: 'Paragraph', text: '', annotations: [], attributes: {}},
      children: [],
    } as HMBlockNode,
  ],
})

const comment = {id: 'alice/new-comment', author: 'alice'} as HMComment

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {promise, resolve, reject}
}

type MockedInput = {
  loadDraft: Mock<() => Promise<CommentComposerContent | null>>
  saveDraft: Mock<(content: CommentComposerContent) => Promise<void>>
  removeDraft: Mock<() => Promise<void>>
  publish: Mock<(request: CommentComposerPublishRequest) => Promise<HMComment>>
}

function makeInput(overrides: Partial<CommentComposerInput> = {}): MockedInput {
  return {
    loadDraft: vi.fn((): Promise<CommentComposerContent | null> => Promise.resolve(null)),
    saveDraft: vi.fn((): Promise<void> => Promise.resolve()),
    removeDraft: vi.fn((): Promise<void> => Promise.resolve()),
    publish: vi.fn((): Promise<HMComment> => Promise.resolve(comment)),
    ...overrides,
  } as MockedInput
}

function start(input: MockedInput = makeInput()) {
  const emitted: CommentComposerEmitted[] = []
  const actor = createActor(commentComposerMachine, {input})
  actor.on('*', (event) => emitted.push(event as CommentComposerEmitted))
  actor.start()
  return {actor, emitted}
}

const flush = () => vi.advanceTimersByTimeAsync(0)

async function reachEditing(actor: Actor<typeof commentComposerMachine>) {
  await flush()
  expect(actor.getSnapshot().matches({active: {session: 'editing'}})).toBe(true)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('composerContentHasText', () => {
  it('detects text and empty content', () => {
    expect(composerContentHasText(textContent('hello'))).toBe(true)
    expect(composerContentHasText(emptyParagraph())).toBe(false)
    expect(composerContentHasText({blocks: []})).toBe(false)
  })
})

describe('commentComposerMachine', () => {
  it('loads the draft into context and reaches editing, even when loading fails', async () => {
    const input = makeInput({loadDraft: vi.fn(() => Promise.resolve(textContent('hello')))})
    const {actor} = start(input)
    await reachEditing(actor)
    expect(actor.getSnapshot().context.content).toEqual(textContent('hello'))

    const failing = makeInput({loadDraft: vi.fn(() => Promise.reject(new Error('no draft store')))})
    const {actor: actor2} = start(failing)
    await reachEditing(actor2)
    expect(actor2.getSnapshot().context.content).toEqual({blocks: []})
  })

  it('debounces draft saves to the latest content and flushes immediately on request', async () => {
    const input = makeInput()
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('first')})
    await vi.advanceTimersByTimeAsync(200)
    actor.send({type: 'content.changed', content: textContent('second')})
    await vi.advanceTimersByTimeAsync(499)
    expect(input.saveDraft).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(input.saveDraft).toHaveBeenCalledTimes(1)
    expect(input.saveDraft).toHaveBeenLastCalledWith(textContent('second'))

    actor.send({type: 'content.changed', content: textContent('third')})
    actor.send({type: 'content.flushRequested'})
    await flush()
    expect(input.saveDraft).toHaveBeenCalledTimes(2)
    expect(input.saveDraft).toHaveBeenLastCalledWith(textContent('third'))
  })

  it('removes the draft instead of saving when the content is emptied', async () => {
    const input = makeInput()
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    actor.send({type: 'content.changed', content: emptyParagraph()})
    await vi.advanceTimersByTimeAsync(500)
    expect(input.removeDraft).toHaveBeenCalledTimes(1)
    expect(input.saveDraft).not.toHaveBeenCalled()
  })

  it('never overlaps saves; a change during a save starts one follow-up save', async () => {
    const save = deferred<void>()
    const input = makeInput({saveDraft: vi.fn(() => save.promise)})
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('first')})
    await vi.advanceTimersByTimeAsync(500)
    expect(input.saveDraft).toHaveBeenCalledTimes(1)

    actor.send({type: 'content.changed', content: textContent('second')})
    actor.send({type: 'content.changed', content: textContent('third')})
    await flush()
    expect(input.saveDraft).toHaveBeenCalledTimes(1)

    save.resolve()
    await flush()
    expect(input.saveDraft).toHaveBeenCalledTimes(2)
    expect(input.saveDraft).toHaveBeenLastCalledWith(textContent('third'))
  })

  it('ignores submit with empty content and reflects it in can()', async () => {
    const input = makeInput()
    const {actor} = start(input)
    await reachEditing(actor)

    expect(actor.getSnapshot().can({type: 'submit.requested', accountUid: 'alice'})).toBe(false)
    actor.send({type: 'submit.requested', accountUid: 'alice'})
    await flush()
    expect(input.publish).not.toHaveBeenCalled()
    expect(actor.getSnapshot().matches({active: {session: 'editing'}})).toBe(true)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    expect(actor.getSnapshot().can({type: 'submit.requested', accountUid: 'alice'})).toBe(true)
  })

  it('publishes once while busy and ignores further submits', async () => {
    const publishCall = deferred<HMComment>()
    const input = makeInput({publish: vi.fn(() => publishCall.promise)})
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    actor.send({type: 'submit.requested', accountUid: 'alice'})
    await flush()
    expect(actor.getSnapshot().hasTag('busy')).toBe(true)
    expect(input.publish).toHaveBeenCalledTimes(1)
    expect(input.publish).toHaveBeenCalledWith({content: textContent('hello'), accountUid: 'alice'})

    actor.send({type: 'submit.requested', accountUid: 'alice'})
    await flush()
    expect(input.publish).toHaveBeenCalledTimes(1)
  })

  it('emits editor.cleared before published, clears content, and discards the draft on success', async () => {
    const input = makeInput()
    const {actor, emitted} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    actor.send({type: 'submit.requested', accountUid: 'alice'})
    await flush()

    const clearedIndex = emitted.findIndex((e) => e.type === 'editor.cleared')
    const publishedIndex = emitted.findIndex((e) => e.type === 'published')
    expect(clearedIndex).toBeGreaterThanOrEqual(0)
    expect(publishedIndex).toBeGreaterThan(clearedIndex)
    expect(emitted[publishedIndex]).toEqual({type: 'published', comment})

    expect(actor.getSnapshot().context.content).toEqual({blocks: []})
    expect(actor.getSnapshot().matches({active: {session: 'editing'}})).toBe(true)
    await flush()
    expect(input.removeDraft).toHaveBeenCalledTimes(1)
  })

  it('defers draft removal until an in-flight save resolves after publish', async () => {
    const save = deferred<void>()
    const input = makeInput({saveDraft: vi.fn(() => save.promise)})
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await vi.advanceTimersByTimeAsync(500)
    expect(input.saveDraft).toHaveBeenCalledTimes(1)

    actor.send({type: 'submit.requested', accountUid: 'alice'})
    await flush()
    expect(actor.getSnapshot().context.content).toEqual({blocks: []})
    expect(input.removeDraft).not.toHaveBeenCalled()

    save.resolve()
    await flush()
    expect(input.removeDraft).toHaveBeenCalledTimes(1)
    expect(input.removeDraft.mock.invocationCallOrder[0]).toBeGreaterThan(input.saveDraft.mock.invocationCallOrder[0]!)
  })

  it('emits publish.failed, keeps the content, and keeps the draft on failure', async () => {
    const input = makeInput({publish: vi.fn(() => Promise.reject(new Error('offline')))})
    const {actor, emitted} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    actor.send({type: 'submit.requested', accountUid: 'alice'})
    await flush()

    const failed = emitted.find((e) => e.type === 'publish.failed')
    expect(failed).toEqual({type: 'publish.failed', error: expect.any(Error)})
    expect((failed as {error: Error}).error.message).toBe('offline')
    expect(actor.getSnapshot().matches({active: {session: 'editing'}})).toBe(true)
    expect(actor.getSnapshot().context.content).toEqual(textContent('hello'))
    expect(input.removeDraft).not.toHaveBeenCalled()
  })

  it('waits for an account when submitting without one, then publishes with it', async () => {
    const input = makeInput()
    const {actor, emitted} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    actor.send({type: 'submit.requested', accountUid: null})
    await flush()

    expect(actor.getSnapshot().hasTag('awaitingAccount')).toBe(true)
    expect(emitted).toContainEqual({type: 'account.required', content: textContent('hello')})
    expect(input.publish).not.toHaveBeenCalled()

    actor.send({type: 'account.ready', accountUid: 'bob'})
    await flush()
    expect(input.publish).toHaveBeenCalledTimes(1)
    expect(input.publish).toHaveBeenCalledWith({content: textContent('hello'), accountUid: 'bob'})
  })

  it('returns to editing without publishing when account creation is cancelled', async () => {
    const input = makeInput()
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    actor.send({type: 'submit.requested', accountUid: null})
    await flush()
    actor.send({type: 'account.cancelled'})
    await flush()

    expect(actor.getSnapshot().matches({active: {session: 'editing'}})).toBe(true)
    expect(input.publish).not.toHaveBeenCalled()
  })

  it('asks for an account again on a repeated submit, since hosts cannot always report a cancelled sign-in', async () => {
    const input = makeInput()
    const {actor, emitted} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    actor.send({type: 'submit.requested', accountUid: null})
    actor.send({type: 'submit.requested', accountUid: null})
    await flush()
    expect(emitted.filter((e) => e.type === 'account.required')).toHaveLength(2)
    expect(actor.getSnapshot().hasTag('awaitingAccount')).toBe(true)

    actor.send({type: 'submit.requested', accountUid: 'carol'})
    await flush()
    expect(input.publish).toHaveBeenCalledWith({content: textContent('hello'), accountUid: 'carol'})
  })

  it('clears the editor, emits published, and removes the draft on external publication', async () => {
    const input = makeInput()
    const {actor, emitted} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    actor.send({type: 'comment.publishedExternally', comment})
    await flush()

    const clearedIndex = emitted.findIndex((e) => e.type === 'editor.cleared')
    const publishedIndex = emitted.findIndex((e) => e.type === 'published')
    expect(clearedIndex).toBeGreaterThanOrEqual(0)
    expect(publishedIndex).toBeGreaterThan(clearedIndex)
    expect(emitted[publishedIndex]).toEqual({type: 'published', comment})
    expect(input.removeDraft).toHaveBeenCalledTimes(1)
  })

  it('flushes a scheduled save on close and stays active until it resolves', async () => {
    const save = deferred<void>()
    const input = makeInput({saveDraft: vi.fn(() => save.promise)})
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    actor.send({type: 'composer.closed'})
    await flush()
    expect(input.saveDraft).toHaveBeenCalledTimes(1)
    expect(actor.getSnapshot().status).toBe('active')

    save.resolve()
    await flush()
    expect(actor.getSnapshot().status).toBe('done')
  })

  it('finishes immediately when closed while idle', async () => {
    const input = makeInput()
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'composer.closed'})
    await flush()
    expect(actor.getSnapshot().status).toBe('done')
    expect(input.saveDraft).not.toHaveBeenCalled()
  })

  it('stays active until the post-publish draft removal resolves when closed during publishing', async () => {
    const removal = deferred<void>()
    const publishCall = deferred<HMComment>()
    const input = makeInput({removeDraft: vi.fn(() => removal.promise), publish: vi.fn(() => publishCall.promise)})
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    actor.send({type: 'submit.requested', accountUid: 'alice'})
    await flush()
    actor.send({type: 'composer.closed'})
    publishCall.resolve(comment)
    await flush()

    expect(input.removeDraft).toHaveBeenCalledTimes(1)
    expect(actor.getSnapshot().status).toBe('active')

    removal.resolve()
    await flush()
    expect(actor.getSnapshot().status).toBe('done')
  })

  it('resumes editing instead of closing when reopened during publishing', async () => {
    const publishCall = deferred<HMComment>()
    const input = makeInput({publish: vi.fn(() => publishCall.promise)})
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    actor.send({type: 'submit.requested', accountUid: 'alice'})
    await flush()
    actor.send({type: 'composer.closed'})
    actor.send({type: 'composer.opened'})
    await flush()
    publishCall.resolve(comment)
    await flush()

    expect(actor.getSnapshot().matches({active: {session: 'editing'}})).toBe(true)
    expect(actor.getSnapshot().status).toBe('active')
  })

  it('saves new content that arrives while the post-publish removal is in flight', async () => {
    const removal = deferred<void>()
    const input = makeInput({removeDraft: vi.fn(() => removal.promise)})
    const {actor} = start(input)
    await reachEditing(actor)

    actor.send({type: 'content.changed', content: textContent('hello')})
    await flush()
    actor.send({type: 'submit.requested', accountUid: 'alice'})
    await flush()
    expect(input.removeDraft).toHaveBeenCalledTimes(1)

    actor.send({type: 'content.changed', content: textContent('afterthought')})
    await flush()
    expect(input.saveDraft).not.toHaveBeenCalled()

    removal.resolve()
    await vi.advanceTimersByTimeAsync(499)
    expect(input.saveDraft).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(input.saveDraft).toHaveBeenCalledTimes(1)
    expect(input.saveDraft).toHaveBeenCalledWith(textContent('afterthought'))
  })
})
