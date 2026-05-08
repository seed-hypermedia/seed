/**
 * Tests for the account-cache primitives in `models/query-client.ts`:
 * `populateAccountIfChanged` (version-aware writes) and the cache-scan
 * `invalidateAccountAndAliases` that walks `[ACCOUNT, *]` entries and
 * invalidates every alias of the target uid by inspecting `profileOwner`.
 *
 * Each test installs a fresh QueryClient via `registerQueryClient` to keep
 * the module-level `registeredClient` reference scoped to the test.
 */
import {QueryClient} from '@tanstack/react-query'
import type {HMMetadataPayload} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {hmId} from '../utils/entity-id-url'
import {invalidateAccountAndAliases, populateAccountIfChanged, registerQueryClient} from '../models/query-client'
import {queryKeys} from '../models/query-keys'

let qc: QueryClient

function payload(uid: string, version: string | null, profileOwner = uid): HMMetadataPayload {
  return {
    id: hmId(uid, {version: version ?? undefined}),
    metadata: {name: `name-${uid}`},
    profileOwner,
    version,
  }
}

beforeEach(() => {
  qc = new QueryClient()
  registerQueryClient(qc)
})

afterEach(() => {
  qc.clear()
})

describe('populateAccountIfChanged', () => {
  it('writes when no entry exists', () => {
    const wrote = populateAccountIfChanged(qc, 'A', payload('A', 'v1'))
    expect(wrote).toBe(true)
    expect(qc.getQueryData([queryKeys.ACCOUNT, 'A'])).toMatchObject({version: 'v1'})
  })

  it('skips when the version matches', () => {
    populateAccountIfChanged(qc, 'A', payload('A', 'v1'))
    const wrote = populateAccountIfChanged(qc, 'A', payload('A', 'v1'))
    expect(wrote).toBe(false)
  })

  it('writes when the version changes', () => {
    populateAccountIfChanged(qc, 'A', payload('A', 'v1'))
    const wrote = populateAccountIfChanged(qc, 'A', payload('A', 'v2'))
    expect(wrote).toBe(true)
    expect(qc.getQueryData<HMMetadataPayload>([queryKeys.ACCOUNT, 'A'])?.version).toBe('v2')
  })

  it('skips writes that would degrade a versioned entry with sparser data', () => {
    populateAccountIfChanged(qc, 'A', payload('A', 'v1'))
    const wrote = populateAccountIfChanged(qc, 'A', payload('A', null))
    expect(wrote).toBe(false)
    expect(qc.getQueryData<HMMetadataPayload>([queryKeys.ACCOUNT, 'A'])?.version).toBe('v1')
  })

  it('writes when the existing payload has no version (any data is improvement)', () => {
    populateAccountIfChanged(qc, 'A', payload('A', null))
    const wrote = populateAccountIfChanged(qc, 'A', payload('A', 'v1'))
    expect(wrote).toBe(true)
  })
})

describe('invalidateAccountAndAliases', () => {
  function isStale(uid: string): boolean {
    return qc.getQueryState([queryKeys.ACCOUNT, uid])?.isInvalidated ?? false
  }

  it('invalidates the target entry directly', () => {
    populateAccountIfChanged(qc, 'A', payload('A', 'v1'))
    invalidateAccountAndAliases('A')
    expect(isStale('A')).toBe(true)
  })

  it('invalidates accounts whose profileOwner equals the target uid', () => {
    // A → B alias: [ACCOUNT, A] holds B's data with profileOwner=B
    populateAccountIfChanged(qc, 'A', payload('A', 'v-B', 'B'))
    populateAccountIfChanged(qc, 'B', payload('B', 'v-B'))
    invalidateAccountAndAliases('B')
    expect(isStale('A')).toBe(true)
    expect(isStale('B')).toBe(true)
  })

  it('does not invalidate unrelated accounts', () => {
    populateAccountIfChanged(qc, 'A', payload('A', 'v-A'))
    populateAccountIfChanged(qc, 'B', payload('B', 'v-B'))
    populateAccountIfChanged(qc, 'C', payload('C', 'v-C'))
    invalidateAccountAndAliases('A')
    expect(isStale('A')).toBe(true)
    expect(isStale('B')).toBe(false)
    expect(isStale('C')).toBe(false)
  })

  it('invalidates several aliases sharing one target', () => {
    populateAccountIfChanged(qc, 'A', payload('A', 'v-C', 'C'))
    populateAccountIfChanged(qc, 'B', payload('B', 'v-C', 'C'))
    populateAccountIfChanged(qc, 'C', payload('C', 'v-C'))
    invalidateAccountAndAliases('C')
    expect(isStale('A')).toBe(true)
    expect(isStale('B')).toBe(true)
    expect(isStale('C')).toBe(true)
  })

  it('still invalidates the requested uid even when nothing is in cache', () => {
    invalidateAccountAndAliases('ghost')
    // No assertion on isStale (no cache entry to check), but the call
    // shouldn't throw and the queryClient remains usable.
    expect(qc.getQueryState([queryKeys.ACCOUNT, 'ghost'])).toBeUndefined()
  })
})
