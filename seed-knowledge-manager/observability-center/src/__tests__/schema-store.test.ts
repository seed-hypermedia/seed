import {afterEach, expect, test} from 'bun:test'
import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {importKmArtifacts} from '../importer.js'
import {parseEnvelope} from '../schema.js'
import {openStore, type Store} from '../store.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

test('stores ingested runs, events, actors, and comment timelines', () => {
  const {dir, store} = tempStore()
  dirs.push(dir)
  const events = parseEnvelope({
    events: [
      {kind: 'run_meta', runId: 'run-1', data: {runId: 'run-1', trigger: 'poll-cli', startedAt: '2026-01-01T00:00:00.000Z'}},
      {kind: 'trace', runId: 'run-1', data: {ts: '2026-01-01T00:00:01.000Z', level: 'info', event: 'placeholder_posted', data: {commentId: 'author/tsid'}}},
      {kind: 'machine_snapshot', runId: 'run-1', data: {ts: '2026-01-01T00:00:02.000Z', event: 'actor_snapshot', actorId: 'author/tsid', mentionId: 'author/tsid', commentId: 'author/tsid', state: 'agent_running', status: 'active'}},
    ],
  })
  for (const event of events) store.record(event)

  expect(store.listRuns()[0]?.runId).toBe('run-1')
  expect(store.commentTimeline('author/tsid').map((event) => event.eventName)).toEqual(['placeholder_posted', 'actor_snapshot'])
  expect(store.liveSummary().aliveActors).toBe(1)
})

test('imports audit logs and machine logs idempotently', () => {
  const {dir, store} = tempStore()
  dirs.push(dir)
  const logsDir = join(dir, 'logs')
  const runDir = join(logsDir, 'runs', '2026__poll__run-2')
  mkdirSync(runDir, {recursive: true})
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify({runId: 'run-2', trigger: 'poll-cli', startedAt: '2026-01-01T00:00:00.000Z'}))
  writeFileSync(join(runDir, 'trace.jsonl'), JSON.stringify({ts: '2026-01-01T00:00:01.000Z', level: 'info', event: 'reply_finalised', data: {commentId: 'a/b'}}) + '\n')
  writeFileSync(join(runDir, 'llm.jsonl'), JSON.stringify({ts_start: '2026-01-01T00:00:01.500Z', model: 'deepseek-chat', prompt_messages: [{content: 'do not import'}], completion: 'ok'}) + '\n')
  const stateDir = join(dir, 'state')
  mkdirSync(join(stateDir, 'machines'), {recursive: true})
  writeFileSync(join(stateDir, 'machines', 'a_b.jsonl'), JSON.stringify({ts: '2026-01-01T00:00:02.000Z', type: 'ENQUEUE', initialMention: {commentId: 'a/b', docId: 'hm://doc'}}) + '\n')

  const first = importKmArtifacts(store, {logsDir, stateDir})
  const second = importKmArtifacts(store, {logsDir, stateDir})

  expect(first.events).toBe(4)
  expect(second.events).toBe(4)
  expect(store.listEvents({limit: 20}).length).toBe(4)
  expect(store.commentTimeline('a/b').length).toBe(2)
  const llm = store.listEvents({limit: 20}).find((event) => event.kind === 'llm')
  expect(JSON.parse(String(llm?.payloadJson)).prompt_messages).toBeUndefined()
})

function tempStore(): {dir: string; store: Store} {
  const dir = mkdtempSync(join(tmpdir(), 'km-oc-'))
  return {dir, store: openStore(join(dir, 'oc.sqlite'))}
}
