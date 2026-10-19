import {Database} from 'bun:sqlite'
import {afterEach, beforeEach, expect, spyOn, test} from 'bun:test'
import type * as api from '@seed-hypermedia/agents-protocol'
import * as cbor from '@/cbor'
import {BrowserPrivacy, containsPrivateData} from '@/browser-privacy'
import {stmt} from '@/statements'

let db: Database
let privacy: BrowserPrivacy
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, account_id TEXT, parent_session_id TEXT);
    CREATE TABLE session_events (session_id TEXT, seq INTEGER, event_cbor BLOB, PRIMARY KEY (session_id, seq));
    CREATE TABLE session_continuations (successor_session_id TEXT PRIMARY KEY, predecessor_session_id TEXT);
    CREATE TABLE runs (id TEXT PRIMARY KEY, account_id TEXT, session_id TEXT, parent_run_id TEXT, input_cbor BLOB, source_text TEXT);
    CREATE TABLE run_journal (run_id TEXT, seq INTEGER, entry_cbor BLOB, PRIMARY KEY (run_id, seq));
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
  db.run('INSERT INTO session_events VALUES (?, 1, ?)', ['browser-session', cbor.encode(call)])
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
  db.run('INSERT INTO run_journal VALUES (?, 1, ?)', [
    'workflow',
    cbor.encode({type: 'call', tool: 'browser', args: {action: 'snapshot'}}),
  ])
  db.run('INSERT INTO run_journal VALUES (?, 2, ?)', [
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
  db.run('INSERT INTO session_events VALUES (?, 1, ?)', [
    'browser-session',
    cbor.encode({type: 'tool_call', name: 'read', input: {address: '~/memory//./private/browser/archive.md'}}),
  ])
  db.run('INSERT INTO session_events VALUES (?, 1, ?)', [
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

test('ordinary prose and unrelated paths do not make a session private', () => {
  const messages = ['keep this private', 'private/', 'We use private/ in prose', 'This directory is called private']
  for (const [index, content] of messages.entries()) {
    const event = {type: 'message', role: 'assistant', content}
    expect(containsPrivateData(event)).toBe(false)
    db.run('INSERT INTO session_events VALUES (?, ?, ?)', ['other', index + 1, cbor.encode(event)])
  }
  expect(
    containsPrivateData({name: 'write', input: {address: '~/memory/public.md', content: 'keep this private'}}),
  ).toBe(false)
  expect(containsPrivateData({name: 'search', input: {path: 'private/file.md'}})).toBe(false)
  expect(containsPrivateData({path: 'private/file.md'})).toBe(false)
  expect(containsPrivateData({name: 'write', input: {path: 'private-notes.md'}})).toBe(false)
  expect(privacy.sessionIsPrivate('other')).toBe(false)
  const frame = {_: 'appendPartial', key: 'sessions/other', patch: {textDelta: 'keep this private'}}
  expect(privacy.forViewer(frame, 'reader')).toEqual(frame)
})

test('browser tools and structured memory paths are private, including nested call envelopes', () => {
  for (const value of [
    {type: 'tool_call', name: 'browser', input: {action: 'snapshot'}},
    {type: 'tool_result', name: 'browser', output: 'page'},
    {kind: 'call', tool: 'browser', input: {action: 'snapshot'}},
    {name: 'read', input: {address: '~/memory/private/file.md'}},
    {name: 'memory_read', input: {path: 'private/file.md'}},
    {name: 'memory_write', input: {path: './private/file.md'}},
    {name: 'publish', input: {path: '/private/file.md'}},
    {name: 'write', input: {address: 'ipfs://', options: {fromPath: 'private/file.md'}}},
    {name: 'call', input: {tool: 'memory_publish_document', input: {path: 'private/file.md'}}},
    {kind: 'call', tool: 'read', input: {path: 'private'}},
    {name: 'memory', args: {path: 'private/file.md'}},
    'Read [capture](~/memory/private/browser/archive.md)',
    'Read ~/memory//./private/browser/archive.md',
  ])
    expect(containsPrivateData(value)).toBe(true)
})

test('negative session and journal caches scan new sequences and propagate late privacy through dependencies', () => {
  db.run('INSERT INTO runs VALUES (?, ?, NULL, NULL, ?, NULL)', ['root', 'owner', cbor.encode({})])
  db.run('INSERT INTO runs VALUES (?, ?, NULL, ?, ?, NULL)', ['workflow', 'owner', 'root', cbor.encode({})])
  db.run('INSERT INTO session_events VALUES (?, 1, ?)', [
    'other',
    cbor.encode({type: 'tool_call', name: 'read', input: {address: 'thread:browser-session'}}),
  ])
  for (const id of ['other', 'child', 'successor']) expect(privacy.sessionIsPrivate(id)).toBe(false)
  expect(privacy.runIsPrivate('workflow')).toBe(false)
  // A new row must be discovered even without an eager notification (e.g. cold history reads).
  db.run('INSERT INTO session_events VALUES (?, 1, ?)', [
    'browser-session',
    cbor.encode({type: 'tool_call', name: 'browser', input: {action: 'snapshot'}}),
  ])
  db.run('INSERT INTO run_journal VALUES (?, 1, ?)', [
    'root',
    cbor.encode({kind: 'call', tool: 'memory_read', input: {path: 'private/file.md'}}),
  ])
  for (const id of ['other', 'child', 'successor']) expect(privacy.sessionIsPrivate(id)).toBe(true)
  expect(privacy.runIsPrivate('workflow')).toBe(true)
})

test('appended private events and journal entries are marked before any history scan', () => {
  const decode = spyOn(cbor, 'decode')
  try {
    privacy.recordSessionEvent({
      id: 'one',
      sessionId: 'other',
      seq: 1,
      createdAt: 1,
      event: {type: 'tool_call', name: 'read', input: {path: 'private/file.md'}},
    })
    privacy.recordRunEntry({
      runId: 'workflow',
      seq: 1,
      createdAt: 1,
      entry: {kind: 'call', tool: 'browser', input: {action: 'snapshot'}},
    })
    expect(privacy.sessionIsPrivate('other')).toBe(true)
    expect(privacy.runIsPrivate('workflow')).toBe(true)
    expect(decode).not.toHaveBeenCalled()
  } finally {
    decode.mockRestore()
  }
})

test('eager appends do not skip unscanned history, and late continuation links are still followed', () => {
  db.run('INSERT INTO session_events VALUES (?, 1, ?)', [
    'other',
    cbor.encode({type: 'tool_call', name: 'browser', input: {action: 'snapshot'}}),
  ])
  const event = {type: 'message', role: 'assistant', content: 'done'}
  db.run('INSERT INTO session_events VALUES (?, 2, ?)', ['other', cbor.encode(event)])
  privacy.recordSessionEvent({id: 'two', sessionId: 'other', seq: 2, createdAt: 1, event})
  expect(privacy.sessionIsPrivate('browser-session')).toBe(false)
  db.run('INSERT INTO session_continuations VALUES (?, ?)', ['browser-session', 'other'])
  expect(privacy.sessionIsPrivate('browser-session')).toBe(true)
})

test('owners return their original session and run responses without scanning history', () => {
  db.run('INSERT INTO runs VALUES (?, ?, NULL, NULL, ?, NULL)', ['workflow', 'owner', cbor.encode({})])
  const sessionScan = spyOn(privacy, 'sessionIsPrivate')
  const runScan = spyOn(privacy, 'runIsPrivate')
  const decode = spyOn(cbor, 'decode')
  try {
    const session = {
      session: {id: 'other', agentId: 'agent'},
      events: [{sessionId: 'other', seq: 1, event: {name: 'browser'}}],
    }
    const run = {runId: 'workflow', entries: [{runId: 'workflow', seq: 1, entry: {tool: 'browser'}}]}
    expect(privacy.forViewer(session, 'owner')).toBe(session)
    expect(privacy.forViewer(run, 'owner')).toBe(run)
    expect(sessionScan).not.toHaveBeenCalled()
    expect(runScan).not.toHaveBeenCalled()
    expect(decode).not.toHaveBeenCalled()
  } finally {
    sessionScan.mockRestore()
    runScan.mockRestore()
    decode.mockRestore()
  }
})

test('thousands of historical events are decoded once across repeated reader partial frames', () => {
  const count = 5000
  const encoded = cbor.encode({type: 'message', role: 'assistant', content: 'Ordinary public text. '.repeat(20)})
  db.run('INSERT INTO runs VALUES (?, ?, NULL, NULL, ?, NULL)', ['workflow', 'owner', cbor.encode({})])
  db.transaction(() => {
    const sessionInsert = db.prepare('INSERT INTO session_events VALUES (?, ?, ?)')
    const runInsert = db.prepare('INSERT INTO run_journal VALUES (?, ?, ?)')
    for (let seq = 1; seq <= count; seq++) {
      sessionInsert.run('other', seq, encoded)
      runInsert.run('workflow', seq, encoded)
    }
  })()
  const sessionFrame = {_: 'appendPartial', key: 'sessions/other', patch: {textDelta: 'hello'}}
  const runFrame = {_: 'run-partial', runId: 'workflow', textDelta: 'hello'}
  const decode = spyOn(cbor, 'decode')
  const sessionOwner = spyOn(stmt(db, 'SELECT account_id FROM sessions WHERE id = ?'), 'get')
  const runOwner = spyOn(stmt(db, 'SELECT account_id FROM runs WHERE id = ?'), 'get')
  try {
    expect(privacy.forViewer(sessionFrame, 'reader')).toEqual(sessionFrame)
    expect(privacy.forViewer(runFrame, 'reader')).toEqual(runFrame)
    expect(decode).toHaveBeenCalledTimes(count * 2 + 1)
    decode.mockClear()
    const started = performance.now()
    for (let i = 0; i < 200; i++) {
      privacy.forViewer(sessionFrame, 'reader')
      privacy.forViewer(runFrame, 'reader')
    }
    const elapsed = performance.now() - started
    expect(decode).not.toHaveBeenCalled()
    // A coarse guard against starving the only event loop; decode counts are the deterministic assertion.
    expect(elapsed).toBeLessThan(1000)
    sessionOwner.mockClear()
    runOwner.mockClear()
    privacy.forViewer(
      {
        session: {id: 'other', agentId: 'agent'},
        events: Array.from({length: 50}, () => ({
          sessionId: 'other',
          seq: 1,
          event: {type: 'message', content: 'hello'},
        })),
      },
      'reader',
    )
    privacy.forViewer(
      {
        runId: 'workflow',
        entries: Array.from({length: 50}, () => ({
          runId: 'workflow',
          seq: 1,
          entry: {kind: 'result', output: 'hello'},
        })),
      },
      'reader',
    )
    expect(sessionOwner).toHaveBeenCalledTimes(1)
    expect(runOwner).toHaveBeenCalledTimes(1)
    const event = {type: 'message', role: 'assistant', content: 'new text'}
    db.run('INSERT INTO session_events VALUES (?, ?, ?)', ['other', count + 1, cbor.encode(event)])
    db.run('INSERT INTO run_journal VALUES (?, ?, ?)', ['workflow', count + 1, cbor.encode(event)])
    privacy.forViewer(sessionFrame, 'reader')
    privacy.forViewer(runFrame, 'reader')
    expect(decode).toHaveBeenCalledTimes(2)
    decode.mockClear()
    // Ordinary eagerly observed appends advance the cursor without a redundant decode either.
    db.run('INSERT INTO session_events VALUES (?, ?, ?)', ['other', count + 2, cbor.encode(event)])
    db.run('INSERT INTO run_journal VALUES (?, ?, ?)', ['workflow', count + 2, cbor.encode(event)])
    privacy.recordSessionEvent({id: 'new', sessionId: 'other', seq: count + 2, createdAt: 1, event})
    privacy.recordRunEntry({runId: 'workflow', seq: count + 2, createdAt: 1, entry: event})
    privacy.forViewer(sessionFrame, 'reader')
    privacy.forViewer(runFrame, 'reader')
    expect(decode).not.toHaveBeenCalled()
  } finally {
    decode.mockRestore()
    sessionOwner.mockRestore()
    runOwner.mockRestore()
  }
})
