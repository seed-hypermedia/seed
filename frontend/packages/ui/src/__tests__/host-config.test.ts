import {describe, expect, it} from 'vitest'
import {keyWriteScopes} from '../apps/host-config'

const cap = (accountUid: string, role: string, uid: string, path: string[] | null) =>
  ({accountUid, role, grantId: {uid, path}}) as never

describe('keyWriteScopes', () => {
  it('lists where a key may write in one space: writer paths, and the whole space for an agent role', () => {
    const caps = [
      cap('z6Mkkey', 'writer', 'z6Mkspace', ['recipes', 'lists']),
      cap('z6Mkkey', 'agent', 'z6Mkspace', ['anything']),
      cap('z6Mkkey', 'writer', 'z6Mkother', null),
      cap('z6Mksomeone', 'writer', 'z6Mkspace', null),
      cap('z6Mkkey', 'reader', 'z6Mkspace', ['secret']),
    ]
    expect(keyWriteScopes(caps, 'z6Mkkey', 'z6Mkspace')).toEqual([['recipes', 'lists'], []])
    expect(keyWriteScopes(undefined, 'z6Mkkey', 'z6Mkspace')).toEqual([])
  })
})
