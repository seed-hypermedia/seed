import {describe, expect, it} from 'bun:test'
import {bump, checkCap, isWriteAllowed, matchPath, newRateState, normalizePath} from './limits.js'
import {DEFAULT_RULES} from './governance.js'
import type {Rules} from './limits.js'

describe('matchPath', () => {
  it('exact match', () => {
    expect(matchPath('/foo/bar', '/foo/bar')).toBe(true)
  })
  it('single-star matches one segment', () => {
    expect(matchPath('/foo/*', '/foo/bar')).toBe(true)
    expect(matchPath('/foo/*', '/foo/bar/baz')).toBe(false)
  })
  it('double-star matches any depth', () => {
    expect(matchPath('/foo/**', '/foo/bar')).toBe(true)
    expect(matchPath('/foo/**', '/foo/bar/baz')).toBe(true)
    expect(matchPath('/**', '/anything/here')).toBe(true)
  })
  it('normalizes trailing slashes', () => {
    expect(normalizePath('/foo/')).toBe('/foo')
    expect(normalizePath('foo')).toBe('/foo')
  })
  it('sole / matches everything (site-wide allow)', () => {
    expect(matchPath('/', '/agents/knowledge-manager/state/boletin/2026-W19')).toBe(true)
    expect(matchPath('/', '/digests/foo')).toBe(true)
    expect(matchPath('/', '/')).toBe(true)
  })
})

describe('isWriteAllowed', () => {
  const rules: Rules = {
    ...DEFAULT_RULES,
    allowWritePaths: ['/'],
    denyWritePaths: ['/locked/**'],
  }

  it('allows root', () => {
    expect(isWriteAllowed('/', rules).allowed).toBe(true)
  })

  it('rejects denylisted', () => {
    const r = isWriteAllowed('/locked/safe', rules)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.reason).toMatch(/rules-deny/)
  })

  it('hardcoded deny beats allow', () => {
    const r = isWriteAllowed('/agents/knowledge-manager/rules', {...rules, allowWritePaths: ['/']})
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.reason).toMatch(/hardcoded-deny/)
  })

  it('rejects when not in allowlist', () => {
    const r = isWriteAllowed('/foo', {...rules, allowWritePaths: ['/digests/**']})
    expect(r.allowed).toBe(false)
  })

  it('allows when matched in allowlist with double-star', () => {
    const r = isWriteAllowed('/digests/2026-W19', {...rules, allowWritePaths: ['/digests/**']})
    expect(r.allowed).toBe(true)
  })
})

describe('rate caps', () => {
  it('newRateState empty', () => {
    const s = newRateState()
    expect(s.perDay).toEqual({})
    expect(s.perRun).toEqual({})
    expect(s.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('checkCap blocks documents over per-run limit', () => {
    const rules: Rules = {...DEFAULT_RULES, caps: {...DEFAULT_RULES.caps, maxDocumentsPerRun: 1}}
    let state = newRateState()
    expect(checkCap(state, 'documents', rules).allowed).toBe(true)
    state = bump(state, 'documents')
    const r = checkCap(state, 'documents', rules)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.reason).toMatch(/max_documents_per_run/)
  })

  it('checkCap blocks comments over per-day limit', () => {
    const rules: Rules = {...DEFAULT_RULES, caps: {...DEFAULT_RULES.caps, maxCommentsPerDay: 2, maxCommentsPerRun: 100}}
    let state = newRateState()
    state = bump(state, 'comments')
    state = bump(state, 'comments')
    // Force per-run counter to be empty to isolate per-day check.
    state = {...state, perRun: {}}
    const r = checkCap(state, 'comments', rules)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.reason).toMatch(/max_comments_per_day/)
  })
})
