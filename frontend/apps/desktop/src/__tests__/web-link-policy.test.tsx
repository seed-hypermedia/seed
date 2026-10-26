import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
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
    invoke: vi.fn().mockResolvedValue(undefined),
    openUrl: null as null | ((url: string, newWindow?: boolean) => void),
  }
})

vi.mock('../models/experiments', () => ({
  useExperiments: () => ({data: {}}),
  readWebBrowserEnabled: async () => mocks.browserEnabled,
}))
vi.mock('../app-context', () => ({useAppContext: () => ({externalOpen: mocks.externalOpen})}))
vi.mock('../ipc', () => ({ipc: {send: mocks.send, invoke: mocks.invoke}}))
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
  return <output>{JSON.stringify({route, count: state?.routes.length})}</output>
}

describe('web links with the integrated browser toggle', () => {
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
  })

  afterEach(() => {
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

  it('still opens Hypermedia addresses natively with the toggle off', async () => {
    await act(async () => mocks.openUrl?.('hm://uid1/docs/page'))
    expect(shown().route).toEqual({key: 'document', id: unpackHmId('hm://uid1/docs/page')})
    expect(mocks.externalOpen).not.toHaveBeenCalled()
  })
})
