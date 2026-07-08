/**
 * Assembles the "system context" blob used by `/ask` operator queries.
 *
 * Pulls together:
 *   - README excerpt (~3 KB) with architecture / commands / known issues
 *   - Last 5 audit run summaries (one line each, from index.jsonl)
 *   - Current governance rules JSON (from the cached GovernanceCache)
 *
 * Total target: ≤8 KB so DeepSeek's token budget stays comfortable.
 */

import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import type {GovernanceCache} from './governance.js'

const README_PATHS = [
  '/home/km/km-agent/README.md',
  '/home/km/.nanobot/workspace/skill/agent/README.md',
]
const README_BUDGET = 3500 // chars

export async function buildSystemContext(opts: {
  governance: GovernanceCache
  logsDir: string
}): Promise<string> {
  const sections: string[] = []
  const readme = loadReadme()
  if (readme) sections.push(`### README excerpt\n${readme}`)
  const runs = loadRecentRuns(opts.logsDir, 8)
  if (runs) sections.push(`### Recent audit runs (last 8)\n${runs}`)
  try {
    const g = await opts.governance.getGovernance()
    sections.push(
      `### Current governance rules\n\`\`\`json\n${JSON.stringify(g.rules, null, 2)}\n\`\`\``,
    )
  } catch {
    /* ignore */
  }
  return sections.join('\n\n')
}

function loadReadme(): string {
  for (const p of README_PATHS) {
    if (existsSync(p)) {
      const body = readFileSync(p, 'utf-8')
      // Trim to budget — drop the layout reference at the bottom first.
      return body.length > README_BUDGET ? body.slice(0, README_BUDGET) + '\n…[truncated]' : body
    }
  }
  return ''
}

function loadRecentRuns(logsDir: string, n: number): string {
  const idx = join(logsDir, 'index.jsonl')
  if (!existsSync(idx)) return ''
  const lines = readFileSync(idx, 'utf-8').trim().split('\n').slice(-n)
  const out: string[] = []
  for (const line of lines) {
    try {
      const r = JSON.parse(line) as {
        id?: string
        trigger?: string
        start?: string
        end?: string
        status?: string
        wall_ms?: number
        counters?: Record<string, number>
      }
      const counters = r.counters
        ? Object.entries(r.counters)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
        : ''
      out.push(`- ${r.start} ${r.trigger} status=${r.status} ${r.wall_ms}ms ${counters}`)
    } catch {
      /* skip */
    }
  }
  return out.join('\n')
}
