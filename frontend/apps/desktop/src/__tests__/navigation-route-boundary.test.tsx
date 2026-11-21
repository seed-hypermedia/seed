import {hmId} from '@shm/shared/utils/entity-id-url'
import React, {useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {expect, it} from 'vitest'
import {getNavigationResourceKey, NavigationRouteBoundary} from '../utils/navigation-route-boundary'

it('stops the outgoing document before acknowledging a navigation to a suspended page', () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const events: string[] = []
  const neverReady = new Promise<void>(() => {})
  function Document() {
    useEffect(() => {
      events.push('start')
      return () => {
        events.push('stop')
      }
    }, [])
    return <div>Document</div>
  }
  function LoadingPage(): React.ReactNode {
    throw neverReady
  }
  function Window({route}: {route: string}) {
    useEffect(() => {
      events.push(`ack:${route}`)
    }, [route])
    return (
      <NavigationRouteBoundary routeKey={route} fallback={<div>Loading</div>}>
        {route === 'document' ? <Document /> : <LoadingPage />}
      </NavigationRouteBoundary>
    )
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    act(() => root.render(<Window route="document" />))
    act(() => root.render(<Window route="other" />))
    expect(container.textContent).toBe('Loading')
    expect(events).toEqual(['start', 'ack:document', 'stop', 'ack:other'])
  } finally {
    act(() => root.unmount())
  }
})

it('distinguishes path segments while preserving the boundary across document versions', () => {
  const route = (path: string[], version?: string) => ({key: 'document' as const, id: hmId('alice', {path, version})})
  expect(getNavigationResourceKey(route(['a:b']))).not.toBe(getNavigationResourceKey(route(['a', 'b'])))
  expect(getNavigationResourceKey(route(['a'], 'v1'))).toBe(getNavigationResourceKey(route(['a'], 'v2')))
  expect(getNavigationResourceKey({key: 'all-documents', id: hmId('alice', {path: ['a']})})).not.toBe(
    getNavigationResourceKey({key: 'all-documents', id: hmId('alice', {path: ['b']})}),
  )
})
