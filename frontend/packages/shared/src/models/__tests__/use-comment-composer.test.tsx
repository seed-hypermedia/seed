// @vitest-environment jsdom
import type {HMComment} from '@seed-hypermedia/client/hm-types'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {CommentComposerActor} from '../use-comment-composer'
import {resetCommentComposerRegistry, useCommentComposer} from '../use-comment-composer'
import type {CommentComposerContent, CommentComposerInput} from '../comment-composer-machine'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const content = (text: string): CommentComposerContent => ({
  blocks: [{block: {id: 'b1', type: 'Paragraph', text, annotations: [], attributes: {}}, children: []} as any],
})

function makeInput(overrides: Partial<CommentComposerInput> = {}) {
  return {
    loadDraft: vi.fn((): Promise<CommentComposerContent | null> => Promise.resolve(null)),
    saveDraft: vi.fn((): Promise<void> => Promise.resolve()),
    removeDraft: vi.fn((): Promise<void> => Promise.resolve()),
    publish: vi.fn((): Promise<HMComment> => Promise.resolve({id: 'a/c'} as HMComment)),
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root
let capturedActor: CommentComposerActor | null

function Harness({composerKey, input}: {composerKey: string; input: CommentComposerInput}) {
  capturedActor = useCommentComposer(composerKey, input)
  return null
}

function render(input: CommentComposerInput, reactKey?: string) {
  act(() => {
    root.render(<Harness key={reactKey} composerKey="k" input={input} />)
  })
}

const flush = () => act(async () => {})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  resetCommentComposerRegistry()
})

describe('useCommentComposer', () => {
  it('reuses the same actor when remounted with the same key in one commit', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const input = makeInput()

    render(input, 'a')
    await flush()
    const first = capturedActor
    expect(input.loadDraft).toHaveBeenCalledTimes(1)

    render(input, 'b')
    await flush()
    expect(capturedActor).toBe(first)
    expect(input.loadDraft).toHaveBeenCalledTimes(1)
  })

  it('finishes and removes the actor after an unmount, creating a new one on remount', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const input = makeInput()

    render(input)
    await flush()
    const first = capturedActor!

    act(() => {
      root.render(null)
    })
    await flush()
    expect(first.getSnapshot().status).toBe('done')

    render(input)
    await flush()
    expect(capturedActor).not.toBe(first)
    expect(input.loadDraft).toHaveBeenCalledTimes(2)
  })

  it('uses the latest saveDraft effect after a rerender', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const input1 = makeInput()
    const input2 = makeInput()

    render(input1)
    await flush()
    capturedActor!.send({type: 'content.changed', content: content('first')})
    capturedActor!.send({type: 'content.flushRequested'})
    await flush()
    expect(input1.saveDraft).toHaveBeenCalledTimes(1)

    render(input2)
    await flush()
    capturedActor!.send({type: 'content.changed', content: content('second')})
    capturedActor!.send({type: 'content.flushRequested'})
    await flush()
    expect(input1.saveDraft).toHaveBeenCalledTimes(1)
    expect(input2.saveDraft).toHaveBeenCalledTimes(1)
  })
})
