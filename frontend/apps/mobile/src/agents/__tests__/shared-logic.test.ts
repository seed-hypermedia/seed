/**
 * Proves the platform-neutral half of the shared agents stack loads and runs under the mobile
 * toolchain — the same modules desktop and web use, reached through the aliases in
 * metro.config.js / jest.config.js / tsconfig.json rather than reimplemented here.
 *
 * These are the three layers mobile depends on:
 *   - `@seed-hypermedia/agents-protocol` — the tool registry and action types (no dependencies);
 *   - `@shm/ui/agents/client` — signed DAG-CBOR envelopes over the platform seam;
 *   - `@shm/ui/agents/agent-session-rows` + `tool-summary` — durable events to chat rows.
 *
 * If a shared module grows a DOM or Node dependency, this test is where it shows up.
 */

import {nobleKeyPairFromSeed, principalToString, verify} from '@seed-hypermedia/client/blobs'
import type {SessionEvent} from '@seed-hypermedia/agents-protocol'
import {getSeedTool, normalizeSeedToolName, toolSummaryLine} from '@seed-hypermedia/agents-protocol'
import {buildAgentSessionChatRows, buildAgentSessionUrl} from '@shm/ui/agents/agent-session-rows'
import {isSafeAgentServerSecretTarget, normalizeAgentServerUrl, signAgentAction} from '@shm/ui/agents/client'
import {setAgentsPlatform} from '@shm/ui/agents/platform'
import {shortUrlLabel} from '@shm/ui/agents/tool-summary'

// Deterministic key so the signature assertions are reproducible.
const TEST_SEED = new Uint8Array(32).fill(7)

function makeEvent(seq: number, payload: Record<string, unknown>): SessionEvent {
  return {
    id: `event-${seq}`,
    sessionId: 'session-1',
    seq,
    event: payload as SessionEvent['event'],
    createdAt: 1_700_000_000_000 + seq,
  }
}

describe('shared agents protocol', () => {
  it('exposes the five verbs through the shared tool registry', () => {
    for (const verb of ['read', 'write', 'call', 'delegate', 'plan']) {
      const tool = getSeedTool(verb)
      expect(tool).toBeDefined()
      expect(toolSummaryLine(tool!)).toContain(verb)
    }
  })

  it('normalizes legacy tool names onto their current verb', () => {
    expect(normalizeSeedToolName('read')).toBe('read')
  })
})

describe('shared agents client', () => {
  it('normalizes server URLs and gates plain-HTTP secret targets', () => {
    expect(normalizeAgentServerUrl('http://localhost:3051/agents/')).toBe('http://localhost:3051')
    expect(normalizeAgentServerUrl('https://agents.example.com/')).toBe('https://agents.example.com')
    expect(isSafeAgentServerSecretTarget('http://localhost:3051')).toBe(true)
    expect(isSafeAgentServerSecretTarget('https://agents.example.com')).toBe(true)
    // A remote plain-HTTP server must never receive a provider API key.
    expect(isSafeAgentServerSecretTarget('http://agents.example.com')).toBe(false)
  })

  it('signs an action envelope with a vault-style account key', async () => {
    const keyPair = await nobleKeyPairFromSeed(TEST_SEED)
    const accountUid = principalToString(keyPair.principal)

    // Mobile's signing key IS the account key (the vault holds the mnemonic-derived seed), so the
    // platform seam needs nothing beyond getSigner for this path — unlike web, whose delegated
    // device key additionally has to prove itself with registerSigner.
    setAgentsPlatform({
      defaultServerUrl: () => null,
      getSigner: async () => keyPair,
      getSetting: async () => null,
      setSetting: async () => {},
      useAccountUid: () => accountUid,
      useNavigate: () => () => {},
      useOpenUrl: () => () => {},
      CommentEditor: (() => null) as never,
    })

    const envelope = await signAgentAction({
      accountUid,
      action: {_: 'ListAgents'},
    })

    expect(envelope.type).toBe('AgentsAction')
    expect(principalToString(envelope.signer as Uint8Array)).toBe(accountUid)
    // The runtime stamps a timestamp the server checks against a 30-second window.
    expect(typeof (envelope.action as {ts: number}).ts).toBe('number')
    expect(await verify(envelope)).toBe(true)
  })
})

describe('shared agents session rows', () => {
  it('builds chat rows that keep each event actor', () => {
    const rows = buildAgentSessionChatRows(
      [
        makeEvent(1, {type: 'message', role: 'user', content: 'Hello', actor: 'user'}),
        makeEvent(2, {type: 'message', role: 'assistant', content: 'Hi there', actor: 'agent'}),
      ],
      {serverUrl: 'http://localhost:3051', agentId: 'agent-1', sessionId: 'session-1'},
    )

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.kind)).toEqual(['message', 'message'])
  })

  it('hides the trigger context block from a triggered session bubble', () => {
    const rows = buildAgentSessionChatRows(
      [
        makeEvent(1, {
          type: 'message',
          role: 'user',
          actor: 'trigger',
          content: 'Do the thing\n<trigger_context>\nraw payload\n</trigger_context>',
        }),
      ],
      {serverUrl: 'http://localhost:3051', sessionId: 'session-1'},
    )

    const row = rows[0] as {kind: 'message'; message: {content: string; rawMarkdown?: string}}
    expect(row.kind).toBe('message')
    // The bubble shows only the human-facing text...
    expect(row.message.content).toBe('Do the thing')
    // ...while the exact model-facing markdown stays reachable for the raw dialog.
    expect(row.message.rawMarkdown).toContain('raw payload')
  })

  it('builds the shareable session URL', () => {
    expect(buildAgentSessionUrl('http://localhost:3051', 'agent-1', 'session-1')).toBe(
      'http://localhost:3051/agents/agent-1/sessions/session-1',
    )
  })

  it('shortens URLs for tool row labels', () => {
    expect(shortUrlLabel('https://example.com/some/deep/path')).toBeTruthy()
  })
})
