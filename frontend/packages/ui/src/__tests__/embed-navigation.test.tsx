// @vitest-environment jsdom
import React, {useContext} from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {afterEach, expect, it, vi} from 'vitest'
import {UniversalAppContext, useRouteLink} from '@shm/shared/routing'
import {NavContextProvider, navStateReducer, useNavRoute, type NavState} from '@shm/shared/utils/navigation'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {EmbedWrapper} from '../embed-wrapper'
import {useBlockScroll} from '../use-block-scroll'
;(globalThis as any).React = React
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../highlight-context', () => ({useHighlighter: () => () => ({})}))
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  vi.restoreAllMocks()
})

it('scrolls on every activation of a stable link to the same block', async () => {
  const id = hmId('alice', {path: ['doc'], blockRef: 'source'})
  const destination = {key: 'document' as const, id}
  const [update, state] = writeableStateStream<NavState>({routes: [destination], routeIndex: 0, lastAction: 'push'})
  const dispatch = (action: Parameters<typeof navStateReducer>[1]) => update(navStateReducer(state.get(), action))
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const scrollPositions: number[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(((options: ScrollToOptions) => {
    scrollPositions.push(options.top ?? 0)
  }) as typeof window.scrollTo)
  function Content() {
    const route = useNavRoute()
    useBlockScroll(route.key === 'document' ? route.id.blockRef : null, {navigationKey: route})
    const link = useRouteLink(destination)
    return (
      <>
        <a {...link}>Open source</a>
        <div id="source">Source block</div>
      </>
    )
  }
  function Harness() {
    const context = useContext(UniversalAppContext)
    return (
      <UniversalAppContext.Provider value={{...context, openRoute: (route) => dispatch({type: 'push', route})}}>
        <NavContextProvider value={{state, dispatch}}>
          <Content />
        </NavContextProvider>
      </UniversalAppContext.Provider>
    )
  }
  dispose = () => {
    act(() => root.unmount())
    host.remove()
  }
  act(() => root.render(<Harness />))
  await vi.waitFor(() => expect(scrollPositions).toHaveLength(1))
  act(() => host.querySelector('a')!.click())
  await vi.waitFor(() => expect(scrollPositions).toHaveLength(2))
  act(() => host.querySelector('a')!.click())
  await vi.waitFor(() => expect(scrollPositions).toHaveLength(3))
})

it('keeps the current route and reading position for a whole-document embed', () => {
  const id = hmId('alice', {path: ['doc'], blockRef: 'selected'})
  const destination = {key: 'document' as const, id}
  const [update, state] = writeableStateStream<NavState>({routes: [destination], routeIndex: 0, lastAction: 'push'})
  const dispatch = (action: Parameters<typeof navStateReducer>[1]) => update(navStateReducer(state.get(), action))
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  function Harness() {
    const context = useContext(UniversalAppContext)
    const wholeId = hmId('alice', {path: ['doc']})
    return (
      <UniversalAppContext.Provider value={{...context, openRoute: (route) => dispatch({type: 'push', route})}}>
        <NavContextProvider value={{state, dispatch}}>
          <EmbedWrapper id={wholeId} parentBlockId={null} route={{key: 'document', id: wholeId}}>
            Whole document
          </EmbedWrapper>
        </NavContextProvider>
      </UniversalAppContext.Provider>
    )
  }
  dispose = () => {
    act(() => root.unmount())
    host.remove()
  }
  act(() => root.render(<Harness />))
  act(() => (host.querySelector('[data-content-type="embed"]') as HTMLElement).click())
  expect(state.get().routes).toEqual([destination])
  expect(state.get().routeIndex).toBe(0)
})
