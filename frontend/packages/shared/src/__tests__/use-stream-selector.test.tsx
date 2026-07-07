// @vitest-environment jsdom

import React, {useEffect} from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {useStreamSelector} from '../use-stream'
import {navStateReducer, NavState, NavAction} from '../utils/navigation'
import {writeableStateStream, StateStream} from '../utils/stream'

/**
 * Regression test for the production-only "green lines" navigation deadlock
 * (https://github.com/seed-hypermedia/seed/issues/848).
 *
 * Main swaps pages by route via useNavRoute → useStreamSelector, whose
 * subscription effect re-subscribes every commit (inline selector identity).
 * React runs all passive-effect cleanups for a commit before all setups, so
 * a navigation dispatched synchronously from a child's mount effect (e.g.
 * DraftRouteRedirect with the draft query already cached) emits while Main
 * is unsubscribed. A subscription-callback-only implementation misses that
 * emission forever and Main keeps rendering the placeholder.
 *
 * StrictMode's double-invoked effects re-dispatch and rescue this in dev
 * builds, which is why it only reproduced in packaged production apps.
 */

type TestRoute = {key: string; id?: string}

function makeNav(initialRoute: TestRoute) {
  const initialState: NavState = {
    routes: [initialRoute as any],
    routeIndex: 0,
    lastAction: 'push',
  }
  const [updateNavState, navState] = writeableStateStream<NavState>(initialState)
  function dispatch(action: NavAction) {
    const prev = navState.get()
    const next = navStateReducer(prev, action)
    if (prev !== next) updateNavState(next)
  }
  return {navState, dispatch}
}

// Mirrors useNavRoute: inline selector, new identity on every render.
function useTestNavRoute(navState: StateStream<NavState>): TestRoute {
  return useStreamSelector(navState, (state) => {
    return (state.routes[state.routeIndex] as any) || {key: 'default'}
  })
}

function makeApp(navState: StateStream<NavState>, dispatch: (a: NavAction) => void) {
  // Mirrors DraftRouteRedirect with the draft query already cached: it
  // replaces the route synchronously in its mount effect and renders the
  // placeholder ("green lines") unconditionally.
  function RedirectPage() {
    const route = useTestNavRoute(navState)
    useEffect(() => {
      if (route.key !== 'draft') return
      dispatch({type: 'replace', route: {key: 'document', id: 'target'} as any})
    }, [route])
    return <div id="placeholder">placeholder</div>
  }

  // Mirrors Main: swaps the page component based on the current route.
  function Main() {
    const route = useTestNavRoute(navState)
    if (route.key === 'draft') return <RedirectPage />
    return <div id="page">{route.key}</div>
  }

  return Main
}

describe('useStreamSelector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('does not miss an emission dispatched from a child mount effect (no StrictMode, like production)', async () => {
    const {navState, dispatch} = makeNav({key: 'document', id: 'source'})
    const Main = makeApp(navState, dispatch)

    await act(async () => {
      root.render(<Main />)
    })
    expect(container.textContent).toBe('document')

    // Navigate to the draft route; RedirectPage mounts and synchronously
    // replaces the route with the document route during its mount effect.
    await act(async () => {
      dispatch({type: 'push', route: {key: 'draft', id: 'stale-draft'} as any})
    })

    // The stream state always ends up on the document route...
    expect(navState.get().routes[navState.get().routeIndex]).toMatchObject({key: 'document', id: 'target'})
    // ...and the UI must follow it instead of deadlocking on the placeholder.
    expect(container.textContent).toBe('document')
  })

  it('recovers under StrictMode (why dev builds never reproduced the deadlock)', async () => {
    const {navState, dispatch} = makeNav({key: 'document', id: 'source'})
    const Main = makeApp(navState, dispatch)

    await act(async () => {
      root.render(
        <React.StrictMode>
          <Main />
        </React.StrictMode>,
      )
    })

    await act(async () => {
      dispatch({type: 'push', route: {key: 'draft', id: 'stale-draft'} as any})
    })

    expect(container.textContent).toBe('document')
  })
})
