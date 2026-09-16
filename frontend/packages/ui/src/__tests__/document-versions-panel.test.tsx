// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMResource} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentVersionsPanel} from '../document-versions-panel'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {rawResource, feedMock} = vi.hoisted(() => ({
  rawResource: {value: null as HMResource | null, isLoading: false},
  feedMock: vi.fn(),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useRawResource: () => ({data: rawResource.value, isLoading: rawResource.isLoading}),
}))

vi.mock('../feed', () => ({
  Feed: (props: {filterResource: string}) => {
    feedMock(props)
    return <div data-testid="feed" />
  },
}))

vi.mock('../spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

const republishId = hmId('site', {path: ['for-julio'], version: 'v-target', latest: false})
const targetId = hmId('origin', {path: ['for-julio']})

describe('DocumentVersionsPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    feedMock.mockReset()
    rawResource.isLoading = false
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(docId: ReturnType<typeof hmId>) {
    act(() => {
      root.render(<DocumentVersionsPanel docId={docId} />)
    })
  }

  it('lists the redirect target history for a republished document', () => {
    rawResource.value = {type: 'redirect', id: republishId, redirectTarget: targetId, republish: true}

    render(republishId)

    expect(feedMock).toHaveBeenCalledWith(expect.objectContaining({filterResource: targetId.id}))
  })

  it('lists the document itself when it is not a republish', () => {
    rawResource.value = {type: 'document', id: republishId, document: {} as any}

    render(republishId)

    expect(feedMock).toHaveBeenCalledWith(expect.objectContaining({filterResource: republishId.id}))
  })

  it('waits for the address instead of rendering an unfiltered feed', () => {
    rawResource.value = null
    rawResource.isLoading = true

    render(republishId)

    expect(feedMock).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="spinner"]')).not.toBeNull()
  })
})
