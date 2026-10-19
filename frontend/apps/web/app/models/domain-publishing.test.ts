import {beforeEach, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'

const state = vi.hoisted(() => ({saved: undefined as string | undefined}))
vi.mock('@/local-db', () => ({
  getAuthState: vi.fn(async () => state.saved),
  setAuthState: vi.fn(async (_key: string, value: string) => {
    state.saved = value
  }),
  deleteAuthState: vi.fn(async () => {
    state.saved = undefined
  }),
}))
import {saveWebDomainReturn, takeWebDomainReturn} from './domain-publishing'

beforeEach(() => {
  state.saved = undefined
})

it('preserves the selected space and hosting step through serialized auth state, once', async () => {
  const request = {id: hmId('owner'), requesterUid: 'owner', view: 'hosting', step: 'seed-host-custom-domain'} as const
  await saveWebDomainReturn(request)
  expect(await takeWebDomainReturn('owner')).toEqual(request)
  expect(await takeWebDomainReturn('owner')).toBeNull()
})

it('clears a saved workflow when another sign-in starts without hosting context', async () => {
  await saveWebDomainReturn({id: hmId('owner'), requesterUid: 'owner', view: 'settings'})
  await saveWebDomainReturn()
  expect(await takeWebDomainReturn('owner')).toBeNull()
})

it.each([
  {id: {uid: 'owner'}, requesterUid: 'different-owner', view: 'hosting'},
  {id: {uid: 'another-space'}, requesterUid: 'owner', view: 'hosting'},
  {id: {uid: 'owner'}, requesterUid: 'owner', view: 'invitation'},
  {id: {uid: 'owner'}, requesterUid: 'owner', view: 'hosting', step: 'unrecognized'},
  null,
])('discards an invalid or mismatched return request: %j', async (request) => {
  state.saved = JSON.stringify(request)
  expect(await takeWebDomainReturn('owner')).toBeNull()
  expect(state.saved).toBeUndefined()
})

it('discards malformed saved state', async () => {
  state.saved = 'invalid JSON'
  expect(await takeWebDomainReturn('owner')).toBeNull()
  expect(state.saved).toBeUndefined()
})
