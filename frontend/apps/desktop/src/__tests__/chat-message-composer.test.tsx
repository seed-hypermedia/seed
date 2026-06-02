import React, {useState} from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ChatMessageComposer} from '../components/chat-message-composer'
import {QueuedChatMessages, useQueuedChatMessages} from '../components/chat-message-queue'

function renderComposer(onSend = vi.fn()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  function TestComposer() {
    const [value, setValue] = useState('hello')
    return <ChatMessageComposer value={value} onChange={setValue} onSend={onSend} />
  }

  act(() => {
    root.render(<TestComposer />)
  })

  return {container, root, onSend}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

describe('ChatMessageComposer', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('queues messages while busy and flushes them when idle', () => {
    const onFlush = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    function TestQueue({isBusy}: {isBusy: boolean}) {
      const queue = useQueuedChatMessages({isBusy, onFlush})
      return (
        <>
          <button onClick={() => queue.queueMessage('first')}>Queue</button>
          <QueuedChatMessages messages={queue.queuedMessages} />
        </>
      )
    }

    act(() => {
      root.render(<TestQueue isBusy />)
    })
    act(() => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })
    expect(container.textContent).toContain('Queued: first')
    expect(onFlush).not.toHaveBeenCalled()

    act(() => {
      root.render(<TestQueue isBusy={false} />)
    })
    expect(onFlush).toHaveBeenCalledWith(['first'])

    cleanupRendered(root, container)
  })

  it('sends on Enter and leaves Shift+Enter available for newlines', () => {
    const {container, root, onSend} = renderComposer()
    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()

    act(() => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', shiftKey: true, bubbles: true}))
    })
    expect(onSend).not.toHaveBeenCalled()

    act(() => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
    })
    expect(onSend).toHaveBeenCalledTimes(1)

    cleanupRendered(root, container)
  })
})
