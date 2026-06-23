import {describe, expect, it, beforeEach, afterEach} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {State, mentionKey} from './state.js'
import type {Mention} from './mentions.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'km-state-'))
})

afterEach(() => {
  if (dir && dir !== '/') rmSync(dir, {recursive: true, force: true})
})

const sampleMention: Mention = {
  kind: 'comment',
  docId: 'hm://site/doc',
  commentId: 'bafy1',
  author: 'z6Mkauthor',
  text: '@[KM](hm://z6Mkx) hi',
  ts: '2026-05-05T00:00:00Z',
}

describe('State.cursor', () => {
  it('round-trips', () => {
    const s = new State(dir)
    expect(s.getCursor()).toBeNull()
    s.setCursor('tok-1')
    expect(s.getCursor()).toBe('tok-1')
    s.setCursor('tok-2')
    expect(s.getCursor()).toBe('tok-2')
  })
})

describe('State.inbox', () => {
  it('FIFO pop', () => {
    const s = new State(dir)
    s.enqueue(sampleMention)
    s.enqueue({...sampleMention, commentId: 'bafy2'})
    expect(s.inboxSize()).toBe(2)
    expect(s.popFromInbox()?.commentId).toBe('bafy1')
    expect(s.popFromInbox()?.commentId).toBe('bafy2')
    expect(s.popFromInbox()).toBeNull()
  })
})

describe('State.processed', () => {
  it('idempotency: enqueue skips already processed', () => {
    const s = new State(dir)
    s.markProcessed(sampleMention, 'run-1', 'replied')
    expect(s.isProcessed(mentionKey(sampleMention))).toBe(true)
    s.enqueue(sampleMention)
    expect(s.inboxSize()).toBe(0)
  })
})
