import {Database} from 'bun:sqlite'
import {afterEach, beforeEach, expect, test} from 'bun:test'
import type * as api from '@seed-hypermedia/agents-protocol'
import * as cbor from '@/cbor'
import {BrowserPrivacy} from '@/browser-privacy'

let db: Database
let privacy: BrowserPrivacy
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE sessions (id TEXT, account_id TEXT, parent_session_id TEXT);
    CREATE TABLE session_events (session_id TEXT, event_cbor BLOB);
    CREATE TABLE session_continuations (successor_session_id TEXT, predecessor_session_id TEXT);
    CREATE TABLE runs (id TEXT, account_id TEXT, session_id TEXT, parent_run_id TEXT, input_cbor BLOB, source_text TEXT);
    CREATE TABLE run_journal (run_id TEXT, entry_cbor BLOB);
    INSERT INTO sessions VALUES ('browser-session', 'owner', NULL), ('successor', 'owner', NULL), ('child', 'owner', 'browser-session'), ('other', 'owner', NULL);
    INSERT INTO session_continuations VALUES ('successor', 'browser-session');
  `)
  privacy = new BrowserPrivacy(db)
})
afterEach(() => db.close())

test('redacts typed input, screenshots, unsigned child prompts, continuation projections and manifests', () => {
  const call = {
    type: 'tool_call',
    id: 'call',
    name: 'call',
    input: {tool: 'browser', input: {action: 'type', text: 'password'}},
  }
  db.run('INSERT INTO session_events VALUES (?, ?)', ['browser-session', cbor.encode(call)])
  const events: api.SessionEvent[] = [
    {id: 'one', sessionId: 'browser-session', seq: 1, createdAt: 1, event: call},
    {
      id: 'two',
      sessionId: 'browser-session',
      seq: 2,
      createdAt: 2,
      event: {
        type: 'tool_result',
        name: 'call',
        toolCallId: 'call',
        output: {text: 'private page', summary: 'private page', screenshot: {data: 'private-image'}},
      },
    },
    {
      id: 'three',
      sessionId: 'successor',
      seq: 1,
      createdAt: 3,
      event: {
        type: 'message',
        actor: 'system',
        role: 'user',
        content: 'private page projection',
        rawMarkdown: 'private page projection',
      },
    },
    {
      id: 'four',
      sessionId: 'child',
      seq: 1,
      createdAt: 4,
      event: {type: 'message', role: 'user', content: 'delegated private page'},
    },
  ]
  expect(privacy.forViewer(events, 'owner')).toEqual(events)
  const redacted = privacy.forViewer(events, 'reader')
  expect(redacted[0]?.event).toMatchObject({input: {redacted: true, action: 'type'}})
  expect(redacted[1]?.event).toMatchObject({output: {redacted: true}})
  expect(JSON.stringify(redacted)).not.toContain('password')
  expect(JSON.stringify(redacted)).not.toContain('private page')
  expect(JSON.stringify(redacted)).not.toContain('private-image')
  const manifest = {
    predecessorSessionId: 'browser-session',
    successorSessionId: 'successor',
    handoff: {purpose: 'private page'},
    sources: [{excerpt: 'password'}],
  }
  expect(privacy.forViewer(manifest, 'owner')).toEqual(manifest)
  expect(JSON.stringify(privacy.forViewer(manifest, 'reader'))).not.toContain('private page')
  expect(JSON.stringify(privacy.forViewer(manifest, 'reader'))).not.toContain('password')
  const partial = {
    _: 'appendPartial',
    key: 'sessions/browser-session',
    patch: {textDelta: 'private page', activity: {detail: 'password'}},
  }
  expect(JSON.stringify(privacy.forViewer(partial, 'reader'))).not.toContain('password')
  expect(JSON.stringify(privacy.forViewer(partial, 'reader'))).not.toContain('private page')
})

test('journal-only browser calls redact later journal pages and workflow source and errors', () => {
  db.run('INSERT INTO runs VALUES (?, ?, NULL, NULL, ?, ?)', [
    'workflow',
    'owner',
    cbor.encode({}),
    'source with private page',
  ])
  db.run('INSERT INTO run_journal VALUES (?, ?)', [
    'workflow',
    cbor.encode({type: 'call', tool: 'browser', args: {action: 'snapshot'}}),
  ])
  db.run('INSERT INTO run_journal VALUES (?, ?)', [
    'workflow',
    cbor.encode({type: 'call-result', output: 'private page'}),
  ])
  const tail = {
    runId: 'workflow',
    entries: [{runId: 'workflow', seq: 2, entry: {type: 'call-result', output: 'private page'}, createdAt: 1}],
  }
  expect(privacy.forViewer(tail, 'owner')).toEqual(tail)
  expect(privacy.forViewer(tail, 'reader')).toMatchObject({entries: [{entry: {redacted: true}}]})
  db.run('INSERT INTO runs VALUES (?, ?, NULL, NULL, ?, NULL)', ['root', 'owner', cbor.encode({})])
  expect(privacy.forViewer({_: 'append', key: 'runs/root', ...tail.entries[0]}, 'reader')).toMatchObject({
    entry: {redacted: true},
  })
  const run = {
    id: 'workflow',
    rootRunId: 'workflow',
    sourceText: 'private page',
    error: {message: 'private page'},
    title: 'private page',
  }
  expect(JSON.stringify(privacy.forViewer(run, 'reader'))).not.toContain('private page')
})

test('cross-thread reads propagate privacy and canonical private-memory aliases are recognized', () => {
  db.run('INSERT INTO session_events VALUES (?, ?)', [
    'browser-session',
    cbor.encode({type: 'tool_call', name: 'read', input: {address: '~/memory//./private/browser/archive.md'}}),
  ])
  db.run('INSERT INTO session_events VALUES (?, ?)', [
    'other',
    cbor.encode({type: 'tool_call', name: 'read', input: {address: 'thread:browser-session'}}),
  ])
  const result: api.SessionEvent = {
    id: 'read-result',
    sessionId: 'other',
    seq: 2,
    createdAt: 1,
    event: {type: 'tool_result', toolCallId: 'read', name: 'read', output: {markdown: 'private page'}},
  }
  expect(privacy.forViewer(result, 'reader')).toMatchObject({event: {output: {redacted: true}}})
  expect(privacy.forViewer(result, 'owner')).toEqual(result)
})
