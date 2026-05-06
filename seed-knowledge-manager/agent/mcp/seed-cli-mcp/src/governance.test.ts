import {describe, expect, it} from 'bun:test'
import {extractYamlBlock, parseAllowlistBody, parseRulesBody} from './governance.js'

const RULES_DOC = `---
type: agent-rules
schema_version: 1
title: foo
---

# Rules

The agent reads this on every run.

\`\`\`yaml
allow_write_paths:
  - /
deny_write_paths:
  - /agents/knowledge-manager/charter
caps:
  max_documents_per_run: 1
  max_comments_per_run: 5
  max_comments_per_day: 30
  poll_interval_seconds: 60
mentions:
  trigger: "@knowledge-manager"
  invoker_source: "writer-capabilities"
moderation:
  blocked_authors: []
draft_only: false
language: en
\`\`\`
`

describe('extractYamlBlock', () => {
  it('prefers fenced yaml block over frontmatter', () => {
    const yaml = extractYamlBlock(RULES_DOC)
    expect(yaml).toContain('allow_write_paths')
    expect(yaml).not.toContain('type: agent-rules')
  })

  it('falls back to frontmatter when no fenced block exists', () => {
    const yaml = extractYamlBlock('---\nfoo: bar\n---\n# Title\n')
    expect(yaml).toBe('foo: bar')
  })
})

describe('parseRulesBody', () => {
  it('accepts the canonical template shape', () => {
    const rules = parseRulesBody(RULES_DOC)
    expect(rules).not.toBeNull()
    expect(rules?.allowWritePaths).toEqual(['/'])
    expect(rules?.denyWritePaths).toContain('/agents/knowledge-manager/charter')
    expect(rules?.draftOnly).toBe(false)
    expect(rules?.language).toBe('en')
    expect(rules?.caps.maxDocumentsPerRun).toBe(1)
    expect(rules?.caps.maxCommentsPerDay).toBe(30)
    expect(rules?.mentions.invokerSource).toBe('writer-capabilities')
  })

  it('flips draft_only true', () => {
    const doc = RULES_DOC.replace('draft_only: false', 'draft_only: true')
    const rules = parseRulesBody(doc)
    expect(rules?.draftOnly).toBe(true)
  })

  it('returns null on garbage', () => {
    expect(parseRulesBody('no yaml here')).toBeNull()
  })
})

describe('parseAllowlistBody', () => {
  const ALLOWLIST_DOC = `# Allowlist
\`\`\`yaml
invokers:
  - z6Mkfoo
  - z6Mkbar
\`\`\`
`

  it('parses invoker list', () => {
    const a = parseAllowlistBody(ALLOWLIST_DOC)
    expect(a?.invokers).toEqual(['z6Mkfoo', 'z6Mkbar'])
  })

  it('treats missing list as empty', () => {
    const a = parseAllowlistBody('```yaml\ninvokers: []\n```')
    expect(a?.invokers).toEqual([])
  })
})
