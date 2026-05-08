/**
 * Unit tests for the account alias registry.
 *
 * The registry tracks `target → Set<source>` so that profile updates on a
 * target account can fan out invalidations to every account that aliases
 * to it. These tests cover the registry data structure directly via
 * `collectAliasClosure`; the QueryClient-firing variant
 * `invalidateAccountAndAliases` is covered by the closure tests since it is
 * a thin wrapper that calls `invalidateQueries` for every uid in the closure.
 */
import {afterEach, describe, expect, it} from 'vitest'
import {
  clearAliasRegistry,
  collectAliasClosure,
  getAliasesOf,
  registerAlias,
  unregisterAlias,
} from '../models/alias-registry'

afterEach(() => {
  clearAliasRegistry()
})

describe('alias-registry', () => {
  describe('registerAlias / getAliasesOf', () => {
    it('records a single alias relationship', () => {
      registerAlias('A', 'B')
      expect(getAliasesOf('B')).toEqual(['A'])
      expect(getAliasesOf('A')).toEqual([])
    })

    it('returns an empty array for unknown targets', () => {
      expect(getAliasesOf('does-not-exist')).toEqual([])
    })

    it('supports multiple sources pointing at the same target', () => {
      registerAlias('A', 'C')
      registerAlias('B', 'C')
      expect(getAliasesOf('C').sort()).toEqual(['A', 'B'])
    })

    it('replaces a prior alias when the same source registers a new target', () => {
      registerAlias('A', 'B')
      registerAlias('A', 'C')
      expect(getAliasesOf('B')).toEqual([])
      expect(getAliasesOf('C')).toEqual(['A'])
    })

    it('is a no-op when source equals target', () => {
      registerAlias('A', 'A')
      expect(getAliasesOf('A')).toEqual([])
    })

    it('is idempotent on repeated identical registrations', () => {
      registerAlias('A', 'B')
      registerAlias('A', 'B')
      expect(getAliasesOf('B')).toEqual(['A'])
    })
  })

  describe('unregisterAlias', () => {
    it('removes the source from its current target', () => {
      registerAlias('A', 'B')
      unregisterAlias('A')
      expect(getAliasesOf('B')).toEqual([])
    })

    it('is a no-op for an unknown source', () => {
      registerAlias('A', 'B')
      unregisterAlias('Z')
      expect(getAliasesOf('B')).toEqual(['A'])
    })

    it('only removes the named source when multiple share a target', () => {
      registerAlias('A', 'C')
      registerAlias('B', 'C')
      unregisterAlias('A')
      expect(getAliasesOf('C')).toEqual(['B'])
    })
  })

  describe('collectAliasClosure', () => {
    it('returns just the input uid when no aliases are registered', () => {
      expect(collectAliasClosure('A')).toEqual(['A'])
    })

    it('walks transitively through chains: A→B, B→C resolves from C', () => {
      registerAlias('A', 'B')
      registerAlias('B', 'C')
      expect(collectAliasClosure('C').sort()).toEqual(['A', 'B', 'C'])
    })

    it('does not return uids that are downstream of the target only', () => {
      // A aliases to B; closure of A should be just A — B is not a source of A.
      registerAlias('A', 'B')
      expect(collectAliasClosure('A')).toEqual(['A'])
    })

    it('handles cycles without infinite looping', () => {
      registerAlias('A', 'B')
      registerAlias('B', 'A')
      expect(collectAliasClosure('A').sort()).toEqual(['A', 'B'])
      expect(collectAliasClosure('B').sort()).toEqual(['A', 'B'])
    })

    it('fans out across multiple sources at the same target', () => {
      registerAlias('A', 'C')
      registerAlias('B', 'C')
      expect(collectAliasClosure('C').sort()).toEqual(['A', 'B', 'C'])
    })
  })

  describe('clearAliasRegistry', () => {
    it('removes every registered alias', () => {
      registerAlias('A', 'B')
      registerAlias('B', 'C')
      clearAliasRegistry()
      expect(getAliasesOf('B')).toEqual([])
      expect(getAliasesOf('C')).toEqual([])
      expect(collectAliasClosure('C')).toEqual(['C'])
    })
  })
})
