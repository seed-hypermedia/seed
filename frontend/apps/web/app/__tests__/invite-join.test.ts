import {describe, expect, it} from 'vitest'
import {clearInviteJoin, hasInviteJoin, INVITE_JOIN_KEY, markInviteJoin, shouldAutoJoin} from '../invite-join'

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe('invite join marker', () => {
  it('is set by the sign-in page and consumed once', () => {
    const store = fakeStorage()
    expect(hasInviteJoin(store)).toBe(false)
    markInviteJoin(store)
    expect(hasInviteJoin(store)).toBe(true)
    expect(store.getItem(INVITE_JOIN_KEY)).toMatch(/^\d+$/)
    clearInviteJoin(store)
    expect(hasInviteJoin(store)).toBe(false)
  })

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => markInviteJoin(broken)).not.toThrow()
    expect(hasInviteJoin(broken)).toBe(false)
    expect(() => clearInviteJoin(broken)).not.toThrow()
  })

  it('joins only once everything is known and the site is not joined yet', () => {
    const base = {pending: true, signedIn: true, contactsLoaded: true, isJoined: false, isPendingSpace: false}
    expect(shouldAutoJoin(base)).toBe(true)
    expect(shouldAutoJoin({...base, pending: false})).toBe(false)
    expect(shouldAutoJoin({...base, signedIn: false})).toBe(false)
    expect(shouldAutoJoin({...base, contactsLoaded: false})).toBe(false)
    expect(shouldAutoJoin({...base, isJoined: true})).toBe(false)
    expect(shouldAutoJoin({...base, isPendingSpace: true})).toBe(false)
  })
})
