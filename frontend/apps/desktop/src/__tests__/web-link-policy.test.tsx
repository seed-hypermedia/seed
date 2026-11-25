import React, {useEffect} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {createWindowNavigation} from '../window-navigation-machine'
import type {NavState} from '@shm/shared/utils/navigation'
import {useUniversalAppContext} from '@shm/shared/routing'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// The window's initial history, read when the navigation module loads.
const mocks = vi.hoisted(() => {
  ;(window as any).initNavState = {routes: [{key: 'contacts'}], routeIndex: 0, lastAction: 'push'}
  return {
    browserEnabled: false,
    externalOpen: vi.fn(),
    send: vi.fn(),
    listeners: new Map<string, (event: any) => void>(),
    state: undefined as NavState | undefined,
    activeRoutes: new Set<string>(),
    routesAtAck: [] as string[][],
    invoke: vi.fn().mockResolvedValue(undefined),
    openUrl: null as null | ((url: string, newWindow?: boolean) => void),
  }
})

vi.mock('../models/experiments', () => ({
  useExperiments: () => ({data: {}}),
  readWebBrowserEnabled: async () => mocks.browserEnabled,
}))
vi.mock('../app-context', () => ({useAppContext: () => ({externalOpen: mocks.externalOpen})}))
vi.mock('../ipc', () => ({
  ipc: {
    send: mocks.send,
    invoke: mocks.invoke,
    listen: async (channel: string, handler: (event: any) => void) => {
      mocks.listeners.set(channel, handler)
      return () => mocks.listeners.delete(channel)
    },
  },
}))
vi.mock('../trpc', () => ({client: {}}))
vi.mock('../grpc-client', () => ({domainResolver: {}}))
vi.mock('../desktop-universal-client', () => ({desktopUniversalClient: {}}))
vi.mock('../telemetry', () => ({
  reportTelemetry: vi.fn(),
  TelemetryStage: {LinkClick: 'link-click'},
  telemetryKeyForRoute: () => 'route',
}))
vi.mock('../models/gateway-settings', () => ({useGatewayUrl: () => ({data: 'https://hyper.media'})}))
vi.mock('../models/push-after-action', () => ({usePushAfterAction: () => () => {}}))
vi.mock('@shm/shared/models/contacts', () => ({
  SelectedAccountContactsProvider: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock('@tanstack/react-query-devtools', () => ({ReactQueryDevtoolsPanel: () => null}))

import {NavigationContainer} from '../utils/navigation-container'
import {useNavRoute, useNavigationState} from '@shm/shared/utils/navigation'

function Probe() {
  mocks.openUrl = useUniversalAppContext().openUrl!
  const route = useNavRoute()
  const state = useNavigationState()
  mocks.state = state
  useEffect(() => {
    const key = JSON.stringify(route)
    mocks.activeRoutes.add(key)
    return () => {
      mocks.activeRoutes.delete(key)
    }
  }, [route])
  return <output>{JSON.stringify({route, count: state?.routes.length})}</output>
}

describe('web links with the integrated browser toggle', () => {
  let coordinator: ReturnType<typeof createWindowNavigation>
  let root: Root
  let container: HTMLDivElement
  const shown = () => JSON.parse(container.querySelector('output')!.textContent!)

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    mocks.browserEnabled = false
    mocks.externalOpen.mockReset()
    mocks.invoke.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root.render(
        <NavigationContainer>
          <Probe />
        </NavigationContainer>,
      ),
    )
    coordinator = createWindowNavigation({
      getDraft: () => undefined,
      apply: (_id, requestId, state) => mocks.listeners.get('navigation_commit')?.({payload: {requestId, state}}),
      commit: () => {},
      focus: () => {},
      close: () => {},
      error: (_id, error) => {
        throw error
      },
    })
    coordinator.register('test', mocks.state!)
    coordinator.ready('test')
    mocks.routesAtAck = []
    mocks.send.mockClear()
    mocks.send.mockImplementation((channel, payload) => {
      if (channel === 'navigation_request') coordinator.request('test', payload)
      if (channel === 'navigation_ack') {
        mocks.routesAtAck.push(Array.from(mocks.activeRoutes))
        coordinator.acknowledge('test', payload)
      }
    })
  })

  afterEach(() => {
    coordinator.actor.stop()
    act(() => root.unmount())
    container.remove()
  })

  it('opens websites in the system browser and never creates a web route while the toggle is off', async () => {
    const before = shown()
    await act(async () => mocks.openUrl?.('https://example.com'))
    await act(async () => mocks.openUrl?.('https://example.com/new', true))
    expect(mocks.externalOpen.mock.calls).toEqual([['https://example.com'], ['https://example.com/new']])
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(shown()).toEqual(before)
  })

  it('opens websites in the integrated browser while the toggle is on', async () => {
    mocks.browserEnabled = true
    await act(async () => mocks.openUrl?.('https://example.com'))
    expect(shown().route).toEqual({key: 'web', url: 'https://example.com'})
    expect(coordinator.actor.getSnapshot().value).toBe('idle')
    expect(mocks.routesAtAck.at(-1)).toEqual([JSON.stringify(shown().route)])
    expect(coordinator.state('test')?.routes.at(-1)).toEqual(shown().route)
    await act(async () => mocks.openUrl?.('https://example.com/new', true))
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:window|open', expect.objectContaining({path: expect.any(String)}))
    expect(mocks.externalOpen).not.toHaveBeenCalled()
  })

  it('asks again on every link, so a toggle flipped elsewhere takes effect without a reload', async () => {
    mocks.browserEnabled = true
    await act(async () => mocks.openUrl?.('https://example.com/a'))
    const afterFirst = shown()
    mocks.browserEnabled = false
    await act(async () => mocks.openUrl?.('https://example.com/b'))
    expect(mocks.externalOpen).toHaveBeenCalledWith('https://example.com/b')
    expect(shown()).toEqual(afterFirst)
    expect(afterFirst.route).toEqual({key: 'web', url: 'https://example.com/a'})
  })

  it('does not change local navigation if the main process has not authorized it', async () => {
    const before = shown()
    mocks.send.mockImplementation(() => {})
    await act(async () => mocks.openUrl?.('hm://uid1/awaiting-authorization'))
    expect(shown()).toEqual(before)
  })

  it('still opens Hypermedia addresses natively with the toggle off', async () => {
    await act(async () => mocks.openUrl?.('hm://uid1/docs/page'))
    expect(shown().route).toEqual({key: 'document', id: unpackHmId('hm://uid1/docs/page')})
    expect(mocks.externalOpen).not.toHaveBeenCalled()
  })
})
