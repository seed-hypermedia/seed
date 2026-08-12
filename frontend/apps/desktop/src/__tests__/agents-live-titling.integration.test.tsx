// @vitest-environment jsdom
/**
 * Live UI↔server integration: the REAL agents server (spawned `bun src/main.ts`), the REAL signed
 * CBOR protocol, and the REAL desktop data hooks — only the Electron-main signing boundary is
 * shimmed (grpcClient.daemon.signData signs locally with a test keypair).
 *
 * Exists because unit layers each passed while the composed system showed "Untitled session":
 * this asserts what the user actually sees — the sidebar's session title going from the untitled
 * placeholder to a model-generated title after a turn where the chat model never called
 * set_session_title.
 */
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {spawn, spawnSync, type ChildProcess} from 'node:child_process'
import {createServer, type Server} from 'node:http'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import React from 'react'
import * as blobs from '@shm/shared/blobs'
import {setAgentsPlatform} from '@shm/ui/agents/platform'

const PROVIDER_PORT = 45891
const SERVER_PORT = 45892
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`
const REPO_AGENTS_DIR = path.resolve(__dirname, '../../../../../agents')

// The test account: a real ed25519 keypair; "the daemon" signs with it locally.
const keyPair = blobs.generateNobleKeyPair()
const accountUid = blobs.principalToString(keyPair.principal)

// The agents UI reaches the outside world through its platform adapter; here the "daemon" is the
// local keypair above and there is no local server to attach to.
setAgentsPlatform({
  defaultServerUrl: () => SERVER_URL,
  getSigner: async () => keyPair,
  getSetting: async () => null,
  setSetting: async () => {},
  getLocalServerUrl: async () => null,
  useAccountUid: () => accountUid,
  useNavigate: () => () => {},
  useOpenUrl: () => () => {},
  CommentEditor: () => null,
})

import {sendAgentAction} from '@shm/ui/agents/client'
import {useAllAgentSessions} from '@shm/ui/agents/models'
import {queryClient} from '@shm/shared/models/query-client'
import {QueryClientProvider} from '@tanstack/react-query'

const bunAvailable = spawnSync('bun', ['--version'], {encoding: 'utf8'}).status === 0

let providerServer: Server | undefined
let agentsServer: ChildProcess | undefined
let dataDir: string | undefined
let sessionId: string | undefined
const providerLog: string[] = []

function sse(chunks: unknown[]): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
}
const usage = {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}

/** The sidebar's title expression, driven by the real hook against the real server. */
function SidebarTitlesInner() {
  const sessions = useAllAgentSessions([SERVER_URL], accountUid)
  return (
    <ul>
      {sessions.entries.map((entry) => (
        <li key={entry.session.id} data-testid={`session-${entry.session.id}`}>
          {entry.session.title || 'Untitled session'}
        </li>
      ))}
    </ul>
  )
}

/** The real shared query client, so the hook's invalidations behave exactly as in the app. */
function SidebarTitles() {
  return (
    <QueryClientProvider client={queryClient}>
      <SidebarTitlesInner />
    </QueryClientProvider>
  )
}

async function send(action: unknown): Promise<any> {
  const response = await sendAgentAction({serverUrl: SERVER_URL, accountUid, action: action as never})
  return response
}

describe.skipIf(!bunAvailable)('agents live integration: session titling reaches the UI', () => {
  beforeAll(async () => {
    // 1. Scripted model provider: a chat model that never titles, plus the dedicated titling call.
    providerServer = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}') as {messages?: Array<{role: string; content?: string}>}
        const system = String(parsed.messages?.[0]?.content ?? '')
        res.writeHead(200, {'content-type': 'text/event-stream'})
        if (system.includes('session-titling assistant')) {
          providerLog.push('titling-request')
          res.end(
            sse([
              {id: 't', choices: [{delta: {content: 'Wellness Check-In'}}]},
              {id: 't', choices: [{delta: {}, finish_reason: 'stop'}], usage},
            ]),
          )
          return
        }
        providerLog.push('chat-request')
        res.end(
          sse([
            {id: 'c', choices: [{delta: {content: 'Doing great, thanks!'}}]},
            {id: 'c', choices: [{delta: {}, finish_reason: 'stop'}], usage},
          ]),
        )
      })
    })
    await new Promise<void>((resolve) => providerServer!.listen(PROVIDER_PORT, '127.0.0.1', resolve))

    // 2. The real agents server binary, title generation at its real-server default (on).
    dataDir = mkdtempSync(path.join(tmpdir(), 'agents-ui-int-'))
    agentsServer = spawn('bun', ['src/main.ts'], {
      cwd: REPO_AGENTS_DIR,
      env: {
        ...process.env,
        SEED_AGENTS_HTTP_PORT: String(SERVER_PORT),
        SEED_AGENTS_HTTP_HOSTNAME: '127.0.0.1',
        SEED_AGENTS_DB_PATH: path.join(dataDir, 'agents.sqlite'),
        SEED_AGENTS_DATA_DIR: dataDir,
        SEED_AGENTS_EXEC_BACKEND: 'off',
      },
      stdio: 'ignore',
    })
    let healthy = false
    for (let attempt = 0; attempt < 80 && !healthy; attempt++) {
      try {
        healthy = (await fetch(`${SERVER_URL}/api/health`)).ok
      } catch {}
      if (!healthy) await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (!healthy) throw new Error('agents server never became healthy')

    // 3. Real signed setup through the real client code path.
    // `custom` providers require no API key, which keeps byte payloads out of the jsdom realm.
    await send({
      _: 'SetModelProvider',
      name: 'local',
      provider: {type: 'custom', baseUrl: `http://127.0.0.1:${PROVIDER_PORT}/v1`},
    })
    const agent = await send({
      _: 'CreateAgent',
      definition: {name: 'UI Test', systemPrompt: 'be friendly', modelProvider: 'local', model: 'mock', tools: []},
    })
    const created = await send({_: 'CreateSession', agentId: agent.agentId})
    sessionId = created.sessionId as string
  }, 60_000)

  afterAll(async () => {
    agentsServer?.kill()
    await new Promise<void>((resolve) => (providerServer ? providerServer.close(() => resolve()) : resolve()))
    if (dataDir) rmSync(dataDir, {recursive: true, force: true})
  })

  it('shows the model-generated title in the sidebar after a turn that never called set_session_title', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const rowText = () => container.querySelector(`[data-testid="session-${sessionId}"]`)?.textContent ?? null
    const untilRow = async (predicate: (text: string | null) => boolean, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        if (predicate(rowText())) return
        if (Date.now() > deadline) throw new Error(`sidebar row never matched; last: ${JSON.stringify(rowText())}`)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 400))
        })
      }
    }
    try {
      await act(async () => {
        root.render(<SidebarTitles />)
      })
      // Before the turn, the UI shows the untitled placeholder.
      await untilRow((text) => text !== null, 10_000)
      expect(rowText()).toBe('Untitled session')

      await act(async () => {
        await send({
          _: 'MessageSession',
          sessionId,
          content: [{type: 'text', text: 'hello this is your wellness check. u gud'}],
        })
      })

      // The chat turn ends → the server's dedicated titling call fires → the durable title lands →
      // the real hook's background refetch carries it into the rendered sidebar row.
      await untilRow((text) => text === 'Wellness Check-In', 20_000)
      expect(providerLog).toContain('chat-request')
      expect(providerLog).toContain('titling-request')
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  }, 45_000)
})
