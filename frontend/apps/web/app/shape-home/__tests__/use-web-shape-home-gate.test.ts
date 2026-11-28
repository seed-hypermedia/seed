import {describe, expect, it, vi} from 'vitest'

vi.mock('../../universal-client', () => ({webUniversalClient: {request: vi.fn()}}))
vi.mock('../../web-notifications', () => ({useWebAccountUid: () => undefined}))

import {isWebShapeHomeGateOpen} from '../use-web-shape-home-gate'

const eligible = {eligible: true, candidates: [], firstPublishedAt: 1}
const open = {
  uid: 'z6Mksite',
  accountUid: 'z6Mksite',
  siteUrl: 'https://xlavapies.org',
  locationOrigin: 'https://xlavapies.org',
  status: eligible,
  record: undefined,
}

describe('isWebShapeHomeGateOpen', () => {
  it('opens for the signed-in owner on their own published domain', () => {
    expect(isWebShapeHomeGateOpen(open)).toBe(true)
  })

  it('ignores a trailing path or slash in the published siteUrl', () => {
    expect(isWebShapeHomeGateOpen({...open, siteUrl: 'https://xlavapies.org/'})).toBe(true)
  })

  it('stays closed when the tab does not serve a site', () => {
    expect(isWebShapeHomeGateOpen({...open, uid: null})).toBe(false)
  })

  it('stays closed when nobody or another account is signed in', () => {
    expect(isWebShapeHomeGateOpen({...open, accountUid: undefined})).toBe(false)
    expect(isWebShapeHomeGateOpen({...open, accountUid: 'z6Mkother'})).toBe(false)
  })

  it('stays closed on a different origin, such as a gateway, or without a siteUrl', () => {
    expect(isWebShapeHomeGateOpen({...open, locationOrigin: 'https://hyper.media'})).toBe(false)
    expect(isWebShapeHomeGateOpen({...open, siteUrl: null})).toBe(false)
    expect(isWebShapeHomeGateOpen({...open, siteUrl: 'not a url'})).toBe(false)
  })

  it('stays closed while loading or when the site is not eligible', () => {
    expect(isWebShapeHomeGateOpen({...open, status: null})).toBe(false)
    expect(isWebShapeHomeGateOpen({...open, status: {...eligible, eligible: false}})).toBe(false)
  })

  it('stays closed once this browser holds a record for the site', () => {
    expect(isWebShapeHomeGateOpen({...open, record: {status: 'dismissed'}})).toBe(false)
    expect(isWebShapeHomeGateOpen({...open, record: {status: 'shaped'}})).toBe(false)
    expect(isWebShapeHomeGateOpen({...open, record: {status: 'adding', jobId: 'j'}})).toBe(false)
  })
})
