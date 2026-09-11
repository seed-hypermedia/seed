import {hmId} from '@shm/shared/utils/entity-id-url'
import {act} from 'react-dom/test-utils'
import {createRoot, Root} from 'react-dom/client'
import {afterEach, describe, expect, it, vi} from 'vitest'

const {createContactMock, publishMock, pushAfterActionMock, requestMock, setSubscriptionMock} = vi.hoisted(() => ({
  createContactMock: vi.fn(),
  publishMock: vi.fn(),
  pushAfterActionMock: vi.fn(),
  requestMock: vi.fn(),
  setSubscriptionMock: vi.fn(),
}))

vi.mock('@/models/push-after-action', () => ({
  usePushAfterAction: () => pushAfterActionMock,
}))

vi.mock('@/models/subscription', () => ({
  useSetSubscription: () => ({isPending: false, mutate: setSubscriptionMock}),
}))

vi.mock('@/selected-account', () => ({
  useSelectedAccountId: () => 'z6MkJoiningAccount',
}))

vi.mock('@seed-hypermedia/client', () => ({
  createContact: createContactMock,
  updateContact: vi.fn(),
}))

vi.mock('@shm/shared', () => ({
  queryKeys: {
    CONTACTS_ACCOUNT: 'contacts-account',
    CONTACTS_SUBJECT: 'contacts-subject',
  },
  useUniversalClient: () => ({
    getSigner: vi.fn(() => ({sign: vi.fn()})),
    publish: publishMock,
    request: requestMock,
  }),
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: vi.fn(),
}))

vi.mock('@shm/ui/toast', () => ({
  toast: {error: vi.fn(), success: vi.fn()},
}))

vi.mock('../desktop-auth-dialog', () => ({
  useDesktopAuthDialog: () => ({content: null, open: vi.fn()}),
}))

import {useContactSubscribeIntent, useJoinSiteIntent} from '../desktop-intents'

function renderHook<T>(useHook: () => T) {
  let result: T
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  function TestComponent() {
    result = useHook()
    return null
  }

  act(() => root.render(<TestComponent />))
  return {container, root, result: () => result!}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => root.unmount())
  container.remove()
}

describe('desktop contact subscription intent', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not republish an existing site subscription', async () => {
    requestMock.mockResolvedValue([{id: 'contact-1', subject: 'z6MkJoinedSite', name: '', subscribe: {site: true}}])
    const {container, root, result} = renderHook(useContactSubscribeIntent)
    try {
      await result()({accountUid: 'z6MkJoiningAccount', subjectUid: 'z6MkJoinedSite', subscribe: 'site'})
      expect(createContactMock).not.toHaveBeenCalled()
      expect(publishMock).not.toHaveBeenCalled()
    } finally {
      cleanupRendered(root, container)
    }
  })
})

describe('desktop Join site intent', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('pushes the joining account after publishing its site contact', async () => {
    requestMock.mockResolvedValue([])
    createContactMock.mockResolvedValue({blobs: [{cid: 'contact', data: new Uint8Array()}]})
    publishMock.mockResolvedValue(undefined)

    const {container, root, result} = renderHook(() => useJoinSiteIntent('z6MkJoinedSite', 'Joined Site'))
    try {
      act(() => result().join())

      await vi.waitFor(() => {
        expect(pushAfterActionMock).toHaveBeenCalledWith({
          id: hmId('z6MkJoiningAccount'),
          trigger: 'publish',
        })
      })
      expect(publishMock).toHaveBeenCalledTimes(1)
      expect(publishMock.mock.invocationCallOrder[0]).toBeLessThan(pushAfterActionMock.mock.invocationCallOrder[0]!)
      expect(setSubscriptionMock).toHaveBeenCalledWith({
        id: hmId('z6MkJoinedSite'),
        subscribed: true,
        recursive: true,
      })
    } finally {
      cleanupRendered(root, container)
    }
  })
})
