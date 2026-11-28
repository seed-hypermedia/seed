import {beforeEach, describe, expect, it, vi} from 'vitest'

const {storageMock} = vi.hoisted(() => {
  const store: Record<string, string> = {}
  return {
    storageMock: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      clear: () => {
        for (const key of Object.keys(store)) delete store[key]
      },
      _store: store,
    },
  }
})

vi.stubGlobal('localStorage', storageMock)
vi.stubGlobal('window', {addEventListener: () => {}, removeEventListener: () => {}})

import {
  readShapeHomeState,
  writeShapeHomeState,
  persistShapeHomeSiteRecord,
  persistShapeHomeModalDone,
  getShapeHomeSiteRecord,
} from '../store'

beforeEach(() => {
  storageMock.clear()
  vi.clearAllMocks()
})

describe('shape-home store', () => {
  it('read returns empty when nothing stored', () => {
    const state = readShapeHomeState()
    expect(state).toEqual({sites: {}})
    expect(state.modalDone).toBeFalsy()
  })

  it('write then read round-trips', () => {
    writeShapeHomeState({modalDone: true, sites: {alice: {status: 'shaped'}}})
    const state = readShapeHomeState()
    expect(state.modalDone).toBe(true)
    expect(state.sites.alice).toEqual({status: 'shaped'})
  })

  it('corrupted JSON → empty', () => {
    storageMock._store['ShapeHomeState-v001'] = 'not json{'
    const state = readShapeHomeState()
    expect(state).toEqual({sites: {}})
  })

  it('persistShapeHomeSiteRecord adds/updates a record', () => {
    persistShapeHomeSiteRecord('alice', {status: 'shaped'})
    expect(getShapeHomeSiteRecord(readShapeHomeState(), 'alice')).toEqual({status: 'shaped'})
    persistShapeHomeSiteRecord('alice', {status: 'adding', jobId: 'j1'})
    expect(getShapeHomeSiteRecord(readShapeHomeState(), 'alice')).toEqual({status: 'adding', jobId: 'j1'})
  })

  it('persistShapeHomeModalDone sets modalDone', () => {
    persistShapeHomeModalDone()
    expect(readShapeHomeState().modalDone).toBe(true)
  })
})
