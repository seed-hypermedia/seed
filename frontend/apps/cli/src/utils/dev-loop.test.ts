import {afterEach, describe, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {devKeyName, recordDevAccount, staleDevKeys} from './dev-loop'

// Each machine makes its own dev key for a directory. When the daemon's keys sync through a remote vault, one
// daemon sees every machine's dev key, so names and retirement must never confuse one machine's key for another's.
const THIS_MACHINE = 'z6MkThisMachineDevKeyAAAAAAAAAAAAAAAAAAAAAAAAthis1'
const EARLIER_HERE = 'z6MkEarlierDevKeyOnThisMachineBBBBBBBBBBBBBBBBold2'
const OTHER_MACHINE = 'z6MkOtherMachineDevKeyCCCCCCCCCCCCCCCCCCCCCCCothr3'

const dirs: string[] = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dev-loop-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

describe('devKeyName', () => {
  test('names the directory and the account, so two machines never claim the same name', () => {
    expect(devKeyName('/repo/hypermedia', THIS_MACHINE)).toBe('hm-sync-hypermedia-AAAthis1')
    expect(devKeyName('/repo/hypermedia', THIS_MACHINE)).not.toBe(devKeyName('/repo/hypermedia', OTHER_MACHINE))
    expect(devKeyName('/repo/hypermedia', THIS_MACHINE).startsWith('hm-sync-hypermedia-')).toBe(true)
  })

  test('keeps key names to the characters the daemon accepts', () => {
    expect(devKeyName('/repo/my docs.v2', THIS_MACHINE)).toMatch(/^[a-zA-Z0-9_-]+$/)
  })
})

describe('recordDevAccount', () => {
  test('records the account under .dev/ and keeps earlier ones', () => {
    const dir = tempDir()
    expect([...recordDevAccount(dir, EARLIER_HERE)]).toEqual([EARLIER_HERE])
    expect([...recordDevAccount(dir, THIS_MACHINE)]).toEqual([EARLIER_HERE, THIS_MACHINE])
    // Recording the same account again changes nothing.
    expect([...recordDevAccount(dir, THIS_MACHINE)]).toEqual([EARLIER_HERE, THIS_MACHINE])
    expect(JSON.parse(readFileSync(join(dir, '.dev', 'accounts.json'), 'utf8'))).toEqual([EARLIER_HERE, THIS_MACHINE])
  })

  test('starts over from the current account when the record is unreadable', () => {
    const dir = tempDir()
    mkdirSync(join(dir, '.dev'), {recursive: true})
    writeFileSync(join(dir, '.dev', 'accounts.json'), 'not json')
    expect([...recordDevAccount(dir, THIS_MACHINE)]).toEqual([THIS_MACHINE])
  })
})

describe('staleDevKeys', () => {
  const keys = [
    {name: devKeyName('/repo/hypermedia', THIS_MACHINE), publicKey: THIS_MACHINE},
    {name: 'hm-sync-hypermedia', publicKey: EARLIER_HERE},
    // Another machine's live dev key, synced in through the vault under the old, account-less name.
    {name: 'hm-sync-hypermedia-other', publicKey: OTHER_MACHINE},
    {name: 'main', publicKey: 'z6MkSomeoneRealAccountDDDDDDDDDDDDDDDDDDDDDDDDreal4'},
  ]

  test("retires only this directory's earlier dev keys", () => {
    const own = new Set([EARLIER_HERE, THIS_MACHINE])
    expect(staleDevKeys(keys, THIS_MACHINE, own).map((k) => k.publicKey)).toEqual([EARLIER_HERE])
  })

  test("never retires another machine's dev key, whatever it is named", () => {
    const own = new Set([THIS_MACHINE])
    expect(staleDevKeys(keys, THIS_MACHINE, own)).toEqual([])
  })

  test('never retires the current key', () => {
    expect(staleDevKeys(keys, THIS_MACHINE, new Set([THIS_MACHINE]))).toEqual([])
  })
})
