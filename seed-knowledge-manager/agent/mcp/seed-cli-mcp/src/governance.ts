/**
 * Governance rules loader. Reads the four governance Seed documents
 * (`charter`, `rules`, `runbook`, `allowlist`) under
 * `${governanceBasePath}` of `${SEED_SITE}`, parses the machine-readable
 * YAML block out of `rules` and `allowlist`, and caches the result for
 * `${rulesTtlMs}` so policy changes propagate within ≤ TTL.
 *
 * The agent's MCP tools call `getRules()` at the start of every tool
 * invocation. Cache is process-local; restarting the gateway clears it.
 */

import {parse as parseYaml} from 'yaml'
import type {AgentConfig} from './config.js'
import type {SeedCli} from './seedcli.js'
import type {Rules} from './limits.js'

export type Allowlist = {
  invokers: string[]
}

export type Governance = {
  rules: Rules
  allowlist: Allowlist
  charter: string
  runbook: string
  fetchedAt: number
}

const DEFAULT_RULES: Rules = {
  schemaVersion: 1,
  allowWritePaths: ['/'],
  denyWritePaths: [
    '/agents/knowledge-manager/charter',
    '/agents/knowledge-manager/rules',
    '/agents/knowledge-manager/runbook',
    '/agents/knowledge-manager/allowlist',
  ],
  caps: {
    maxDocumentsPerRun: 1,
    maxCommentsPerRun: 5,
    maxCommentsPerDay: 30,
    pollIntervalSeconds: 60,
  },
  mentions: {
    trigger: '@knowledge-manager',
    invokerSource: 'writer-capabilities',
  },
  moderation: {blockedAuthors: []},
  draftOnly: false,
  language: 'en',
}

export class GovernanceCache {
  private cached?: Governance

  constructor(
    private readonly config: AgentConfig,
    private readonly cli: SeedCli,
  ) {}

  async getGovernance(force = false): Promise<Governance> {
    const now = Date.now()
    if (!force && this.cached && now - this.cached.fetchedAt < this.config.rulesTtlMs) {
      return this.cached
    }
    const [charter, rules, runbook, allowlist] = await Promise.all([
      this.fetchDocBody('charter'),
      this.fetchDocBody('rules'),
      this.fetchDocBody('runbook'),
      this.fetchDocBody('allowlist'),
    ])
    const parsedRules = parseRulesBody(rules) ?? DEFAULT_RULES
    const parsedAllowlist = parseAllowlistBody(allowlist) ?? {invokers: []}
    this.cached = {
      rules: parsedRules,
      allowlist: parsedAllowlist,
      charter,
      runbook,
      fetchedAt: now,
    }
    return this.cached
  }

  /** Returns true if the doc was missing (404-ish) so callers can bootstrap. */
  async checkBootstrapNeeded(): Promise<boolean> {
    const rules = await this.fetchDocBody('rules').catch(() => '')
    return rules.length === 0
  }

  private async fetchDocBody(slug: string): Promise<string> {
    const docId = `${this.config.seedSite}${this.config.governanceBasePath}/${slug}`
    // seed-cli's default `document get` already emits markdown with YAML
    // frontmatter, which is exactly what the wrapper's parser expects.
    // Older builds lack the explicit `--md/--frontmatter` flags.
    const result = await this.cli
      .runRead(['document', 'get', docId])
      .catch((err) => ({exitCode: -1, stdout: '', stderr: String(err)}))
    if (result.exitCode !== 0) return ''
    return result.stdout
  }
}

export function parseRulesBody(body: string): Rules | null {
  const yaml = extractYamlBlock(body)
  if (!yaml) return null
  try {
    const parsed = parseYaml(yaml) as Partial<Rules> & Record<string, unknown>
    return mergeRules(parsed)
  } catch {
    return null
  }
}

export function parseAllowlistBody(body: string): Allowlist | null {
  const yaml = extractYamlBlock(body)
  if (!yaml) return null
  try {
    const parsed = parseYaml(yaml) as {invokers?: unknown}
    const invokers = Array.isArray(parsed.invokers) ? parsed.invokers.filter((x): x is string => typeof x === 'string') : []
    return {invokers}
  } catch {
    return null
  }
}

export function extractYamlBlock(body: string): string | null {
  // Look for first fenced ```yaml block (the convention used by the
  // `agent-rules.md` template). Fall back to leading frontmatter.
  const fenced = body.match(/```ya?ml\s*\n([\s\S]*?)```/)
  if (fenced) return fenced[1]!
  const frontmatter = body.match(/^---\s*\n([\s\S]*?)\n---/)
  if (frontmatter) return frontmatter[1]!
  return null
}

function mergeRules(input: Partial<Rules> & Record<string, unknown>): Rules {
  const rules: Rules = {
    ...DEFAULT_RULES,
    ...input,
    caps: {...DEFAULT_RULES.caps, ...(input.caps as Rules['caps'] | undefined)},
    mentions: {...DEFAULT_RULES.mentions, ...(input.mentions as Rules['mentions'] | undefined)},
    moderation: {...DEFAULT_RULES.moderation, ...(input.moderation as Rules['moderation'] | undefined)},
  }
  // Snake-case → camelCase tolerance for fields we expect humans to edit.
  const camel = (input as Record<string, unknown>) as {
    allow_write_paths?: string[]
    deny_write_paths?: string[]
    schema_version?: number
    draft_only?: boolean
  }
  if (Array.isArray(camel.allow_write_paths)) rules.allowWritePaths = camel.allow_write_paths
  if (Array.isArray(camel.deny_write_paths)) rules.denyWritePaths = camel.deny_write_paths
  if (typeof camel.schema_version === 'number') rules.schemaVersion = camel.schema_version
  if (typeof camel.draft_only === 'boolean') rules.draftOnly = camel.draft_only
  // Caps snake-case
  const caps = (input.caps as Record<string, unknown>) ?? {}
  if (typeof caps.max_documents_per_run === 'number') rules.caps.maxDocumentsPerRun = caps.max_documents_per_run
  if (typeof caps.max_comments_per_run === 'number') rules.caps.maxCommentsPerRun = caps.max_comments_per_run
  if (typeof caps.max_comments_per_day === 'number') rules.caps.maxCommentsPerDay = caps.max_comments_per_day
  if (typeof caps.poll_interval_seconds === 'number') rules.caps.pollIntervalSeconds = caps.poll_interval_seconds
  // Mentions invoker_source
  const m = (input.mentions as Record<string, unknown>) ?? {}
  if (typeof m.invoker_source === 'string') {
    rules.mentions.invokerSource = m.invoker_source as Rules['mentions']['invokerSource']
  }
  // Moderation blocked_authors
  const mod = (input.moderation as Record<string, unknown>) ?? {}
  if (Array.isArray(mod.blocked_authors)) {
    rules.moderation.blockedAuthors = mod.blocked_authors.filter((x): x is string => typeof x === 'string')
  }
  return rules
}

export {DEFAULT_RULES}
