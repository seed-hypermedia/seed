/**
 * Tool registry for the Mastra agent loop. Exposes a small JSON-Schema-typed
 * surface that maps directly to seed-cli subprocess calls. Mirrors the MCP
 * tool registry in `tools.ts` but bypasses MCP for in-process use.
 *
 * Each tool's `handler` returns a string that goes back to the LLM. Large
 * responses are truncated to keep the context window usable.
 */

import type {SeedCli} from '../seedcli.js'
import type {AuditRun} from '../audit.js'

export type ToolDef = {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, {type: string; description: string}>
    required?: string[]
  }
  handler: (args: any) => Promise<string>
}

const MAX_DOC_CHARS = 4_000
const MAX_THREAD_COMMENTS = 30

export function buildAgentTools(opts: {cli: SeedCli; audit?: AuditRun}): ToolDef[] {
  const {cli} = opts

  return [
    {
      name: 'seed_search',
      description: 'Keyword-search the community corpus. Returns a list of hm:// URLs and titles.',
      parameters: {
        type: 'object',
        properties: {
          query: {type: 'string', description: 'Free-text search query'},
          limit: {type: 'number', description: 'Maximum hits to return (default 5, max 10)'},
        },
        required: ['query'],
      },
      handler: async (args) => {
        const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10)
        const r = await cli.runRead(['search', String(args.query), '--limit', String(limit)])
        if (r.exitCode !== 0) return `error: ${r.stderr.slice(0, 200)}`
        const parsed = r.parsedJson as {entities?: any[]; results?: any[]} | undefined
        const hits = parsed?.entities ?? parsed?.results ?? []
        const lines = hits.slice(0, limit).map((h: any) => {
          const id = typeof h.id === 'string' ? h.id : h.id?.id
          return `${id} — ${h.title ?? '(untitled)'}`
        })
        return lines.length > 0 ? lines.join('\n') : '(no results)'
      },
    },
    {
      name: 'seed_get_doc',
      description: 'Fetch the full body of an hm:// document. Returns markdown.',
      parameters: {
        type: 'object',
        properties: {
          hm_url: {type: 'string', description: 'hm:// URL of the document'},
        },
        required: ['hm_url'],
      },
      handler: async (args) => {
        const r = await cli.runRead(['document', 'get', String(args.hm_url)])
        if (r.exitCode !== 0) return `error: ${r.stderr.slice(0, 200)}`
        const body = r.stdout.replace(/<!--\s*id:[^>]+-->/g, '').trim()
        return body.length > MAX_DOC_CHARS ? body.slice(0, MAX_DOC_CHARS) + '\n…(truncated)' : body
      },
    },
    {
      name: 'seed_get_comment_thread',
      description: 'Fetch the comment thread (root + replies) for a given comment id.',
      parameters: {
        type: 'object',
        properties: {
          comment_id: {type: 'string', description: 'Canonical comment id (author/tsid)'},
          max: {type: 'number', description: 'Max comments (default 30)'},
        },
        required: ['comment_id'],
      },
      handler: async (args) => {
        const max = Math.min(Math.max(Number(args.max) || MAX_THREAD_COMMENTS, 1), 100)
        // Walk replyParent up to root.
        const collected: any[] = []
        let current = String(args.comment_id)
        for (let i = 0; i < max; i++) {
          const r = await cli.runRead(['comment', 'get', current])
          if (r.exitCode !== 0) break
          const c = r.parsedJson as any
          if (!c) break
          collected.unshift(c)
          if (!c.replyParent) break
          current = c.replyParent
        }
        if (collected.length === 0) return '(thread not found)'
        return collected
          .map((c, i) => `(#${i + 1}) ${c.author}\n${stringifyComment(c)}`)
          .join('\n\n')
      },
    },
    {
      name: 'seed_get_account_profile',
      description: 'Fetch the profile metadata for a Seed account.',
      parameters: {
        type: 'object',
        properties: {
          account_id: {type: 'string', description: 'Account uid (z6Mk...)'},
        },
        required: ['account_id'],
      },
      handler: async (args) => {
        const r = await cli.runRead(['account', 'get', String(args.account_id)])
        if (r.exitCode !== 0) return `error: ${r.stderr.slice(0, 200)}`
        return JSON.stringify(r.parsedJson ?? {}, null, 2).slice(0, MAX_DOC_CHARS)
      },
    },
  ]
}

function stringifyComment(c: any): string {
  if (typeof c.body === 'string') return c.body
  if (Array.isArray(c.content)) {
    return c.content
      .map((b: any) => b?.block?.text ?? b?.text ?? '')
      .filter(Boolean)
      .join('\n')
  }
  return ''
}
