// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {useFollowContinuation} from '../agents/continuation'
import type {SessionContinuationLink, SessionInfo} from '../agents/client'

const successor: SessionContinuationLink = {
  continuationId: 'edge-1',
  sessionId: 'successor',
  reason: 'other',
  createdAt: 1,
}
const predecessor = (continued = false) =>
  ({id: 'predecessor', continuedTo: continued ? successor : undefined}) as SessionInfo

let root: Root
let container: HTMLDivElement
let followNow: (link: SessionContinuationLink) => void
const onFollow = vi.fn()

function FollowHarness({session, visible}: {session: SessionInfo; visible: boolean}) {
  followNow = useFollowContinuation({
    session,
    isStreaming: !session.continuedTo,
    isVisible: visible,
    onFollow,
  }).followNow
  return null
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  onFollow.mockClear()
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

describe('following a session continuation', () => {
  it('follows a transition while the predecessor is visible', () => {
    act(() => root.render(<FollowHarness session={predecessor()} visible />))
    act(() => root.render(<FollowHarness session={predecessor(true)} visible />))
    expect(onFollow).toHaveBeenCalledWith(successor)
  })

  it('does not follow a transition that happened while the predecessor was hidden', () => {
    act(() => root.render(<FollowHarness session={predecessor()} visible />))
    act(() => root.render(<FollowHarness session={predecessor()} visible={false} />))
    act(() => root.render(<FollowHarness session={predecessor(true)} visible={false} />))
    act(() => root.render(<FollowHarness session={predecessor(true)} visible />))
    expect(onFollow).not.toHaveBeenCalled()
  })

  it('ignores a late send response after the predecessor was hidden or unmounted', () => {
    act(() => root.render(<FollowHarness session={predecessor()} visible />))
    act(() => root.render(<FollowHarness session={predecessor()} visible={false} />))
    followNow(successor)
    expect(onFollow).not.toHaveBeenCalled()

    act(() => root.render(<FollowHarness session={predecessor()} visible />))
    const lateFollowNow = followNow
    act(() => root.unmount())
    lateFollowNow(successor)
    expect(onFollow).not.toHaveBeenCalled()
    root = createRoot(container)
  })
})
