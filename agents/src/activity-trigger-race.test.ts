/**
 * Integration test for the comment/citation mention race.
 *
 * Exercises the REAL pipeline end to end inside one process: the real {@link ActivityMonitor} polls a
 * real local HTTP server (a stand-in for hyper.media's `/api/ListEvents`) through the real
 * `@seed-hypermedia/client`, and feeds resolved events into the real {@link apisvc.Service}, which
 * matches triggers and creates sessions. Only the upstream HM feed data and the model-provider HTTP
 * call are faked; the monitor → client → HTTP → ListEvents-parse → processActivityEvent → firing path
 * is the production code.
 *
 * Background: hyper.media emits TWO feed events for one @mention comment — a `comment` event
 * (`feedEventId: blob-<cid>`) and a comment-sourced `citation` event (`feedEventId: mention-<cid>--<target>`)
 * that share the comment-version CID. They are indexed seconds apart, so the monitor sees them in
 * different polls; whichever it sees first advances the staleness watermark past their shared
 * `eventAtMs`, and the later sibling is then dropped as "stale". Before the fix, the comment event was
 * the only one allowed to fire and it was exactly the sibling being dropped — so the mention silently
 * never fired. These tests reproduce that race and assert the mention now fires exactly once.
 */
import {Database} from 'bun:sqlite'
import {afterEach, beforeEach, describe, expect, test} from 'bun:test'
import {ActivityMonitor} from '@/activity-monitor'
import * as apisvc from '@/api-service'
import * as sqlite from '@/sqlite'
import * as blobs from '@shm/shared/blobs'
import {serialize} from 'superjson'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const MENTIONED_ACCOUNT = 'z6MknRGBsPMcrn5nAXWHmR4RjNuVTRK5a2rthFy188et7LKs'
const COMMENT_AUTHOR = 'z6MkgisVMELvqnsCo3dYmtVpy8PiqPGMVwfAyBWFn84vebq4'
const TARGET_DOC = 'z6MktzJVpNrSeef3BGfuMF2LZCsntYYmtJVp72mgBnDqx2iz'
const COMMENT_CID = 'bafy2bzaceca7qqno4qw7rxa3mblizsb266i2ryt6lojpxnocrfqn7yfy7m6ww'

/** A resolved `comment` LoadedEvent that embeds an @mention of {@link MENTIONED_ACCOUNT}. */
function commentEvent(cid: string, eventAtMs: number) {
  return {
    id: cid,
    type: 'comment',
    feedEventId: `blob-${cid}`,
    eventAtMs,
    time: new Date(eventAtMs).toISOString(),
    author: {id: {uid: COMMENT_AUTHOR, id: `hm://${COMMENT_AUTHOR}`, path: []}},
    comment: {
      id: `${COMMENT_AUTHOR}/z6HSMNN2PWnTq4`,
      version: cid,
      targetAccount: TARGET_DOC,
      targetPath: '',
      content: [
        {
          block: {
            type: 'Paragraph',
            id: 'GycaPogI',
            text: '￼ can you hear me?',
            annotations: [
              {
                type: 'Embed',
                starts: [0],
                ends: [1],
                link: `hm://${MENTIONED_ACCOUNT}/:profile?v=bafyabc&l`,
              },
            ],
          },
          children: [],
        },
      ],
    },
  }
}

/** The comment-sourced `citation` twin of {@link commentEvent} for the same comment CID. */
function citationEvent(cid: string, eventAtMs: number) {
  return {
    id: cid,
    type: 'citation',
    citationType: 'c',
    feedEventId: `mention-${cid}--hm://${MENTIONED_ACCOUNT}/:profile`,
    eventAtMs,
    time: new Date(eventAtMs).toISOString(),
    source: {id: {uid: COMMENT_AUTHOR, id: `hm://${COMMENT_AUTHOR}`, path: []}},
    target: {
      id: {uid: MENTIONED_ACCOUNT, id: `hm://${MENTIONED_ACCOUNT}/:profile`, path: [':profile']},
    },
  }
}

describe('comment/citation mention race (real monitor + HTTP + service)', () => {
  let db: Database
  let dataDir: string
  let hmServer: ReturnType<typeof Bun.serve>
  let hmBase: string
  let feed: {events: unknown[]; nextPageToken: string}
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    db = new Database(':memory:', {create: true, strict: true})
    if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-race-test-'))
    feed = {events: [], nextPageToken: ''}

    // Stand-in for hyper.media: serves the current `feed` from `/api/ListEvents` exactly as the real
    // server does (superjson-wrapped), 404 for anything else.
    hmServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/api/ListEvents') return Response.json(serialize(feed))
        return new Response('not found', {status: 404})
      },
    })
    hmBase = `http://127.0.0.1:${hmServer.port}`

    // Route HM traffic to the real local server; fail the model-provider call fast so the background
    // agent run finishes without real network (the session is already created synchronously by then).
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith(hmBase)) return originalFetch(input, init)
      return new Response('{"error":"no model provider in test"}', {status: 401})
    }) as typeof fetch
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    await hmServer.stop(true)
    db.close()
    fs.rmSync(dataDir, {recursive: true, force: true})
  })

  async function setupMentionTrigger(): Promise<{
    svc: apisvc.Service
    monitor: ActivityMonitor
    accountId: string
    agentId: string
  }> {
    const account = blobs.generateNobleKeyPair()
    const accountId = blobs.principalToString(account.principal)
    const svc = new apisvc.Service(db, dataDir, {hmServerUrl: hmBase})
    await svc.message(
      await apisvc.createSignedEnvelope(account, {
        action: {_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}},
      }),
    )
    const created = await svc.message(
      await apisvc.createSignedEnvelope(account, {
        action: {
          _: 'CreateAgent',
          definition: {name: 'Teal Scribe', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
        },
      }),
    )
    if (created._ !== 'CreateAgentResponse') throw new Error('unexpected response')
    await svc.message(
      await apisvc.createSignedEnvelope(account, {
        action: {
          _: 'CreateAgentTrigger',
          agentId: created.agentId,
          trigger: {
            name: 'Mentions of Teal Scribe',
            prompt: 'Respond to the mention.',
            source: {type: 'user-mention', mentionedAccounts: [MENTIONED_ACCOUNT]},
          },
        },
      }),
    )

    // No `client` override: the monitor builds a real createSeedClient(hmBase) and polls over HTTP.
    const monitor = new ActivityMonitor(db, svc, {
      hmServerUrl: hmBase,
      pollIntervalMs: 1_000,
      pageSize: 50,
      maxPagesPerPoll: 1,
      requestTimeoutMs: 5_000,
    })
    return {svc, monitor, accountId, agentId: created.agentId}
  }

  const sessionCount = (agentId: string) =>
    db.query<{n: number}, [string]>(`SELECT count(*) AS n FROM sessions WHERE agent_id = ?`).get(agentId)!.n
  const firingCount = (agentId: string) =>
    db.query<{n: number}, [string]>(`SELECT count(*) AS n FROM trigger_firings WHERE agent_id = ?`).get(agentId)!.n

  test('FAILURE SCENARIO: citation seen fresh, comment arrives stale — mention still fires exactly once', async () => {
    const {svc, monitor, agentId} = await setupMentionTrigger()
    try {
      // Poll 0: empty feed establishes the watermark baseline.
      await monitor.pollOnce()
      expect(sessionCount(agentId)).toBe(0)

      // The citation twin is indexed first and is "fresh" relative to the baseline watermark.
      await Bun.sleep(15)
      const commentCreatedAt = Date.now()
      feed = {events: [citationEvent(COMMENT_CID, commentCreatedAt)], nextPageToken: ''}
      await monitor.pollOnce() // processes the citation; advances lastSuccessAt PAST commentCreatedAt

      // The comment event now appears (older create time, but newly visible to us). Pre-fix the citation
      // was suppressed AND the comment was dropped by the create-time cutoff, leaving ZERO firings.
      // Post-fix the citation already fired; the comment is now also processed but dedups onto it.
      await Bun.sleep(15)
      feed = {
        events: [commentEvent(COMMENT_CID, commentCreatedAt), citationEvent(COMMENT_CID, commentCreatedAt)],
        nextPageToken: '',
      }
      await monitor.pollOnce()

      expect(firingCount(agentId)).toBe(1)
      expect(sessionCount(agentId)).toBe(1)
    } finally {
      await svc.drainTriggerSessions()
    }
  })

  test('REPLY SCENARIO: both siblings surface late (older create time) — still fires (no create-time cutoff)', async () => {
    // Reproduces the "one document for each" reply: a reply comment whose comment AND citation events
    // only became visible in the feed after the comment's own timestamp. Under the old create-time cutoff
    // BOTH siblings were dropped on every poll and the mention was silently lost (un-suppressing the
    // citation does not help — nothing reaches the matcher). With freshness decided by observation
    // (seenKeys) rather than create time, the late events are processed once when they first appear and
    // deduped to a single firing.
    const {svc, monitor, agentId} = await setupMentionTrigger()
    try {
      await monitor.pollOnce() // baseline; advances lastSuccessAt to ~now
      const baselineSuccess = Date.now()

      await Bun.sleep(20)
      // The reply was authored just before the baseline poll (older than lastSuccessAt) but only surfaces
      // in the feed now. Its (old) create time must NOT prevent it from being processed.
      const replyCreatedAt = baselineSuccess - 1_000
      feed = {
        events: [commentEvent(COMMENT_CID, replyCreatedAt), citationEvent(COMMENT_CID, replyCreatedAt)],
        nextPageToken: '',
      }
      await monitor.pollOnce()

      expect(firingCount(agentId)).toBe(1)
      expect(sessionCount(agentId)).toBe(1)
    } finally {
      await svc.drainTriggerSessions()
    }
  })

  test('DEDUP: both siblings seen fresh in separate polls create exactly one session', async () => {
    const {svc, monitor, agentId} = await setupMentionTrigger()
    try {
      await monitor.pollOnce() // baseline

      await Bun.sleep(15)
      // Comment event first this time (the common ordering), then its citation twin — both fresh.
      feed = {events: [commentEvent(COMMENT_CID, Date.now())], nextPageToken: ''}
      await monitor.pollOnce()
      expect(sessionCount(agentId)).toBe(1)

      await Bun.sleep(15)
      feed = {events: [citationEvent(COMMENT_CID, Date.now())], nextPageToken: ''}
      await monitor.pollOnce()

      // The citation matches too, but collapses onto the comment's blob-<cid> firing key, so no
      // second session is created.
      expect(firingCount(agentId)).toBe(1)
      expect(sessionCount(agentId)).toBe(1)
    } finally {
      await svc.drainTriggerSessions()
    }
  })

  test('distinct comments each fire their own session', async () => {
    const {svc, monitor, agentId} = await setupMentionTrigger()
    try {
      await monitor.pollOnce() // baseline

      await Bun.sleep(15)
      feed = {events: [commentEvent(COMMENT_CID, Date.now())], nextPageToken: ''}
      await monitor.pollOnce()

      await Bun.sleep(15)
      const otherCid = 'bafy2bzacedkux7en5o467atf2fq7ye5m6xltgd737qovrutuuurwpwmjgrss4'
      feed = {events: [citationEvent(otherCid, Date.now())], nextPageToken: ''}
      await monitor.pollOnce()

      expect(firingCount(agentId)).toBe(2)
      expect(sessionCount(agentId)).toBe(2)
    } finally {
      await svc.drainTriggerSessions()
    }
  })
})
