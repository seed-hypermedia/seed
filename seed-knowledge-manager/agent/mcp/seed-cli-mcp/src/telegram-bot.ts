#!/usr/bin/env node
/**
 * Telegram operator-channel bot. READ-MOSTLY surface for the human
 * operator to peek at agent state and trigger non-destructive actions.
 *
 *   /status           — service statuses + last-run summary.
 *   /last-runs [N]    — last N audit runs (default 5).
 *   /show-rules       — current governance rules JSON.
 *   /poll-now         — kicks `systemctl --user start km-poll.service`.
 *
 * Security: only chat IDs listed in OPS_TELEGRAM_ID (comma-separated)
 * are answered. Everyone else is silently ignored. Mutations to Seed
 * documents or capabilities are NOT exposed here — for those, edit the
 * governance docs from your desktop.
 */

import {execFileSync, spawnSync} from 'node:child_process'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {GovernanceCache} from './governance.js'
import {SeedCli} from './seedcli.js'
import {AuditRun} from './audit.js'
import {buildRedactor} from './redact.js'
import {loadConfig} from './config.js'
import {draftReply, draftSystemReply, gatherSiteContext} from './reply-engine.js'
import {ChatHistory} from './chat-history.js'
import {buildSystemContext} from './system-context.js'

type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    from?: {id: number; username?: string}
    chat: {id: number}
    text?: string
  }
}

const POLL_TIMEOUT_SEC = 25

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_TOKEN
  if (!token) throw new Error('TELEGRAM_TOKEN not set')
  const allowedIds = new Set(
    (process.env.OPS_TELEGRAM_ID ?? '')
      .split(/[,;]\s*/)
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n)),
  )
  if (allowedIds.size === 0) throw new Error('OPS_TELEGRAM_ID empty — refusing to expose bot to the world')

  const config = loadConfig()
  const redactor = buildRedactor()
  const cli = new SeedCli(config, redactor)
  const governance = new GovernanceCache(config, cli)
  const history = new ChatHistory(config.stateDir)

  // eslint-disable-next-line no-console
  console.log(`telegram-bot listening for chats in {${[...allowedIds].join(',')}}`)

  let offset = 0
  for (;;) {
    let updates: TelegramUpdate[] = []
    try {
      updates = await fetchUpdates(token, offset, POLL_TIMEOUT_SEC)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('getUpdates failed:', err instanceof Error ? err.message : err)
      await sleep(5000)
      continue
    }
    for (const u of updates) {
      offset = u.update_id + 1
      const msg = u.message
      if (!msg?.from || !msg.text) continue
      // Accept either the sender's user-id (DM with the bot) or the
      // chat-id (group/channel where the bot is allowed to read). Both
      // forms can appear in OPS_TELEGRAM_ID; the operator picks
      // whichever scope they want.
      if (!allowedIds.has(msg.from.id) && !allowedIds.has(msg.chat.id)) continue
      try {
        const text = msg.text.trim()
        if (text.startsWith('/ask')) {
          await handleSystemQuestion(token, msg.chat.id, text.slice(4).trim(), config, governance, history)
        } else if (text.startsWith('/')) {
          const reply = await handleCommand(text, config, governance)
          await sendMessage(token, msg.chat.id, reply)
        } else {
          await handleCommunityQuestion(token, msg.chat.id, text, config, cli, history)
        }
      } catch (err) {
        const txt = err instanceof Error ? err.message : String(err)
        await sendMessage(token, msg.chat.id, `❌ ${txt}`)
      }
    }
  }
}

async function handleCommunityQuestion(
  token: string,
  chatId: number,
  text: string,
  config: ReturnType<typeof loadConfig>,
  cli: SeedCli,
  history: ChatHistory,
): Promise<void> {
  await sendChatAction(token, chatId, 'typing')
  const audit = new AuditRun({
    logsDir: config.logsDir,
    trigger: 'telegram-question',
    redactor: buildRedactor(),
    seedSite: config.seedSite,
  })
  try {
    const siteAccount = config.seedSite.replace(/^hm:\/\//, '').split('/')[0]!
    const ctx = await gatherSiteContext(cli, text, siteAccount, audit)
    const turns = history.read(chatId)
    const answer = await draftReply(text, ctx, audit, turns)
    const reply = answer ?? "I tried to draft a reply but hit a snag. Try rephrasing."
    await sendMessage(token, chatId, reply)
    history.append(chatId, [
      {role: 'user', content: text},
      {role: 'assistant', content: reply},
    ])
    audit.trace({ts: new Date().toISOString(), level: 'info', event: 'telegram_reply_sent', data: {chatId, mode: 'community'}})
  } finally {
    audit.close({status: 'ok', logsDir: config.logsDir})
  }
}

async function handleSystemQuestion(
  token: string,
  chatId: number,
  question: string,
  config: ReturnType<typeof loadConfig>,
  governance: GovernanceCache,
  history: ChatHistory,
): Promise<void> {
  if (!question) {
    await sendMessage(token, chatId, 'Usage: /ask <question about the bot or its config>')
    return
  }
  await sendChatAction(token, chatId, 'typing')
  const audit = new AuditRun({
    logsDir: config.logsDir,
    trigger: 'telegram-ask',
    redactor: buildRedactor(),
    seedSite: config.seedSite,
  })
  try {
    const ctx = await buildSystemContext({governance, logsDir: config.logsDir})
    const turns = history.read(chatId)
    const answer = await draftSystemReply(question, ctx, audit, turns)
    const reply = answer ?? 'Could not draft a reply (DeepSeek error). Check logs.'
    await sendMessage(token, chatId, reply)
    history.append(chatId, [
      {role: 'user', content: `/ask ${question}`},
      {role: 'assistant', content: reply},
    ])
    audit.trace({ts: new Date().toISOString(), level: 'info', event: 'telegram_reply_sent', data: {chatId, mode: 'ask'}})
  } finally {
    audit.close({status: 'ok', logsDir: config.logsDir})
  }
}

async function handleCommand(
  text: string,
  config: ReturnType<typeof loadConfig>,
  governance: GovernanceCache,
): Promise<string> {
  const [cmd, ...rest] = text.split(/\s+/)
  switch (cmd) {
    case '/start':
    case '/help':
      return [
        'Knowledge Manager — operator commands',
        '',
        '/status            — service health + last-run summary',
        '/last-runs [N]     — recent audit runs (default 5)',
        '/show-rules        — current governance rules',
        '/poll-now          — trigger immediate poll',
        '/ask <question>    — operator-mode Q&A about the bot itself (README + recent runs as context)',
        '',
        'Or send a plain message: community-mode Q&A grounded in the site corpus.',
        'Conversation history is preserved per chat for follow-ups (last 10 turns).',
      ].join('\n')
    case '/status':
      return formatStatus(config.logsDir)
    case '/last-runs': {
      const n = Math.max(1, Math.min(20, parseInt(rest[0] ?? '5', 10) || 5))
      return formatRecentRuns(config.logsDir, n)
    }
    case '/show-rules': {
      const g = await governance.getGovernance(true)
      return '```\n' + JSON.stringify({rules: g.rules, allowlist: g.allowlist}, null, 2) + '\n```'
    }
    case '/poll-now': {
      const r = spawnSync('systemctl', ['--user', 'start', 'km-poll.service'], {encoding: 'utf-8'})
      return r.status === 0 ? '✓ poll triggered' : `❌ ${r.stderr || 'unknown error'}`
    }
    default:
      return 'Unknown command. Try /help.'
  }
}

function formatStatus(logsDir: string): string {
  const services = ['nanobot-gateway', 'km-poll.timer', 'km-boletin.timer', 'km-gap.timer', 'km-health.timer', 'km-telegram']
  const lines: string[] = ['*Service status*']
  for (const s of services) {
    let r
    try {
      r = execFileSync('systemctl', ['--user', 'is-active', s], {encoding: 'utf-8'}).trim()
    } catch (e) {
      r = (e as {stdout?: string}).stdout?.toString().trim() ?? 'unknown'
    }
    lines.push(`${r === 'active' ? '🟢' : '🔴'} ${s}: ${r}`)
  }
  const idx = join(logsDir, 'index.jsonl')
  if (existsSync(idx)) {
    const tail = readFileSync(idx, 'utf-8').trim().split('\n').slice(-3)
    lines.push('', '*Last 3 runs*')
    for (const line of tail) {
      try {
        const r = JSON.parse(line) as {trigger?: string; start?: string; status?: string; wall_ms?: number}
        lines.push(`• ${r.start} ${r.trigger} → ${r.status} (${r.wall_ms}ms)`)
      } catch {
        /* skip */
      }
    }
  }
  return lines.join('\n')
}

function formatRecentRuns(logsDir: string, n: number): string {
  const runsDir = join(logsDir, 'runs')
  if (!existsSync(runsDir)) return 'no runs yet'
  const dirs = readdirSync(runsDir)
    .filter((d) => existsSync(join(runsDir, d, 'meta.json')))
    .sort()
    .slice(-n)
  const lines: string[] = []
  for (const d of dirs.reverse()) {
    try {
      const meta = JSON.parse(readFileSync(join(runsDir, d, 'meta.json'), 'utf-8')) as {
        trigger?: string
        startedAt?: string
        wallMs?: number
        status?: string
        counters?: Record<string, number>
      }
      const counters = meta.counters
        ? Object.entries(meta.counters)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
        : ''
      lines.push(`• ${meta.startedAt} ${meta.trigger} ${meta.status} ${meta.wallMs}ms ${counters}`)
    } catch {
      /* skip */
    }
  }
  return lines.length === 0 ? 'no runs yet' : lines.join('\n')
}

async function fetchUpdates(token: string, offset: number, timeout: number): Promise<TelegramUpdate[]> {
  const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=${timeout}&offset=${offset}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`getUpdates ${r.status}`)
  const json = (await r.json()) as {ok: boolean; result?: TelegramUpdate[]; description?: string}
  if (!json.ok) throw new Error(json.description ?? 'getUpdates !ok')
  return json.result ?? []
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({chat_id: chatId, text, parse_mode: 'Markdown'}),
  })
}

async function sendChatAction(token: string, chatId: number, action: 'typing'): Promise<void> {
  // Best-effort; ignore failures.
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({chat_id: chatId, action}),
    })
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

void AuditRun
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('telegram-bot fatal:', err)
  process.exit(1)
})
