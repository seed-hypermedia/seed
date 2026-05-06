/**
 * Shared reply pipeline: search the community site for relevant docs,
 * inject as context, ask DeepSeek for a grounded answer. Used by both
 * the polling driver (replies to comment mentions) and the Telegram bot
 * (replies to operator queries).
 */

import type {SeedCli} from './seedcli.js'
import type {AuditRun} from './audit.js'

const TOP_K = 5
const PER_DOC_CHARS = 600

const COMMUNITY_SYSTEM_PROMPT =
  `You are the Knowledge Manager — a moderator of a Seed Hypermedia community. ` +
  `Answer the user's question grounded in the community's own documents whenever possible. ` +
  `When you reference a document, embed its full hm:// URL inline as a markdown link, e.g. [Title](hm://...). ` +
  `If the community context below is empty or doesn't cover the question, answer from your general knowledge in one sentence and explicitly say "I couldn't find this in our community's docs" so the asker knows. ` +
  `Plain text or simple markdown only. No headers, no code fences, no greeting/signoff. Stay under 120 words.`

const SYSTEM_INSPECTOR_PROMPT =
  `You are the Knowledge Manager bot answering an OPERATOR question about your own implementation, configuration, and recent activity. ` +
  `Use the system context blocks below to ground every claim. ` +
  `If you don't know, say so plainly. Never make up paths, services, or commands. ` +
  `Answer concisely (≤200 words). Plain text or simple markdown. Reference filenames or systemd units explicitly when relevant.`

export type ChatTurn = {role: 'user' | 'assistant'; content: string}

type SearchHit = {hmUrl: string; title?: string}

export async function gatherSiteContext(
  cli: SeedCli,
  question: string,
  siteAccount: string,
  audit?: AuditRun,
): Promise<string> {
  const sr = await cli.runRead(['search', question, '-a', siteAccount])
  if (sr.exitCode !== 0 || !sr.parsedJson) {
    audit?.trace({ts: nowIso(), level: 'warn', event: 'site_context_search_failed', data: {exitCode: sr.exitCode}})
    return ''
  }
  type RawHit = {id?: string | {id?: string}; title?: string}
  const raw =
    (sr.parsedJson as {entities?: RawHit[]; results?: RawHit[]}).entities ??
    (sr.parsedJson as {results?: RawHit[]}).results ??
    []
  const top: SearchHit[] = raw
    .map((h): SearchHit | null => {
      const id = h.id
      if (typeof id === 'string') return {hmUrl: id, title: h.title}
      if (id && typeof id === 'object' && typeof id.id === 'string') return {hmUrl: id.id, title: h.title}
      return null
    })
    .filter((x): x is SearchHit => x !== null)
    .slice(0, TOP_K)
  if (top.length === 0) {
    audit?.trace({ts: nowIso(), level: 'info', event: 'site_context_empty', data: {question: question.slice(0, 200)}})
    return ''
  }
  const sections: string[] = []
  for (let i = 0; i < top.length; i++) {
    const hit = top[i]!
    const dr = await cli.runRead(['document', 'get', hit.hmUrl])
    if (dr.exitCode !== 0) continue
    const body = dr.stdout.replace(/<!--\s*id:[^>]+-->/g, '').slice(0, PER_DOC_CHARS).trim()
    sections.push(`${i + 1}. ${hit.title ?? '(untitled)'} — ${hit.hmUrl}\n${body}`)
  }
  audit?.trace({
    ts: nowIso(),
    level: 'info',
    event: 'site_context_collected',
    data: {hits: raw.length, used: sections.length, urls: top.map((t) => t.hmUrl)},
  })
  if (sections.length === 0) return ''
  return `## Community context (relevant documents found in this site)\n${sections.join('\n\n')}`
}

export async function draftReply(
  question: string,
  siteContext: string,
  audit?: AuditRun,
  history: ChatTurn[] = [],
): Promise<string | null> {
  const userMsg = siteContext
    ? `Question: ${question}\n\n${siteContext}`
    : `Question: ${question}\n\n## Community context\n(no relevant documents found in the community for this query)`
  return callDeepSeek(
    [
      {role: 'system', content: COMMUNITY_SYSTEM_PROMPT},
      ...history,
      {role: 'user', content: userMsg},
    ],
    {audit, maxTokens: 400},
  )
}

/**
 * Operator-facing reply. Used by Telegram `/ask`. The caller assembles
 * a system-context blob (README + recent runs + governance) and passes
 * it inline alongside the question. No site search. Multi-turn aware.
 */
export async function draftSystemReply(
  question: string,
  systemContext: string,
  audit?: AuditRun,
  history: ChatTurn[] = [],
): Promise<string | null> {
  const userMsg = `Operator question: ${question}\n\n## System context\n${systemContext}`
  return callDeepSeek(
    [
      {role: 'system', content: SYSTEM_INSPECTOR_PROMPT},
      ...history,
      {role: 'user', content: userMsg},
    ],
    {audit, maxTokens: 600, temperature: 0.2},
  )
}

async function callDeepSeek(
  messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}>,
  opts: {audit?: AuditRun; maxTokens?: number; temperature?: number},
): Promise<string | null> {
  const audit = opts.audit
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    audit?.trace({ts: nowIso(), level: 'error', event: 'deepseek_no_key'})
    return null
  }
  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 400,
  })
  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
      body,
    })
  } catch (err) {
    audit?.trace({
      ts: nowIso(),
      level: 'error',
      event: 'deepseek_network_error',
      data: {message: err instanceof Error ? err.message : String(err)},
    })
    return null
  }
  const latencyMs = Date.now() - t0
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    audit?.trace({
      ts: nowIso(),
      level: 'error',
      event: 'deepseek_http_error',
      data: {status: res.status, body: text.slice(0, 300), latencyMs},
    })
    return null
  }
  const json = (await res.json()) as {
    choices?: Array<{message?: {content?: string}}>
    usage?: {prompt_tokens?: number; completion_tokens?: number; total_tokens?: number}
  }
  const reply = json.choices?.[0]?.message?.content?.trim()
  audit?.llm({
    ts_start: new Date(t0).toISOString(),
    ts_end: nowIso(),
    latency_ms: latencyMs,
    model: 'deepseek-chat',
    completion: reply ?? '',
    usage: {
      prompt: json.usage?.prompt_tokens,
      completion: json.usage?.completion_tokens,
      total: json.usage?.total_tokens,
    },
  })
  return reply ?? null
}

function nowIso(): string {
  return new Date().toISOString()
}
