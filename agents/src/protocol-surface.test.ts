import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {AGENTS_PROTOCOL_VERSION, MIN_CLIENT_PROTOCOL, MIN_SERVER_PROTOCOL} from '@seed-hypermedia/agents-protocol'
import {diffSurfaces, extractSurface, judgeSurfaceChange, type ProtocolSurface} from './protocol-surface'

const surfacePath = path.resolve(import.meta.dir, '../protocol/surface.json')
const changelogPath = path.resolve(import.meta.dir, '../protocol/PROTOCOL.md')

// One extraction for the whole file: it type-checks the protocol package.
const current = extractSurface()
const committed = JSON.parse(readFileSync(surfacePath, 'utf8')) as ProtocolSurface

function clone(surface: ProtocolSurface): ProtocolSurface {
  return structuredClone(surface)
}

function breaking(base: ProtocolSurface, next: ProtocolSurface) {
  return diffSurfaces(base, next)
    .filter((change) => change.severity === 'breaking')
    .map((change) => `${change.path} [${change.direction}]`)
}

describe('protocol surface snapshot', () => {
  test('surface.json matches the protocol types (run `bun run protocol:snapshot` when it does not)', () => {
    expect(committed).toEqual(current)
  })

  test('records the version constants', () => {
    expect(current.protocol).toBe(AGENTS_PROTOCOL_VERSION)
    expect(current.minClientProtocol).toBe(MIN_CLIENT_PROTOCOL)
    expect(current.minServerProtocol).toBe(MIN_SERVER_PROTOCOL)
  })

  test('lists every action and response by its discriminant, and the envelope', () => {
    expect(current.actions.GetAgent?.fields).toEqual({_: '"GetAgent"', agentId: 'string'})
    expect(current.responses.GetAgentResponse?.fields).toMatchObject({
      sessionCount: 'number',
      'sessions?': 'SessionInfo[]',
    })
    expect(current.envelope.fields).toMatchObject({'protocol?': 'number', action: 'AgentAction'})
    // The action union is the `actions` group; it must not be duplicated as an opaque type.
    expect(current.types.AgentAction).toBeUndefined()
    expect(current.types.UnsignedAgentAction).toBeUndefined()
  })

  test('names nested protocol types once, by alias, and keeps the alias through optional fields', () => {
    expect(current.responses.GetAgentResponse?.fields?.agent).toBe('AgentInfo')
    expect(current.types.AgentInfo?.fields?.definition).toBe('AgentDefinition')
    expect(current.types.SessionInfo?.fields?.['modelOverride?']).toBe('SessionModelOverride')
    expect(current.types.SessionModelOverride).toBeDefined()
  })
})

describe('protocol compatibility rules', () => {
  test('the #1078 change is caught: a response field removed is breaking for readers', () => {
    const base = clone(current)
    base.responses.GetAgentResponse!.fields = {_: '"GetAgentResponse"', agent: 'AgentInfo', sessions: 'SessionInfo[]'}
    const next = clone(current)
    delete next.responses.GetAgentResponse!.fields!['sessions?']
    expect(breaking(base, next)).toEqual(['responses.GetAgentResponse.sessions [reads]'])
  })

  test('additive changes are compatible', () => {
    const next = clone(current)
    next.responses.GetAgentResponse!.fields!['starred?'] = 'boolean'
    next.responses.GetAgentResponse!.fields!.owner = 'string'
    next.actions.GetAgent!.fields!['includeArchived?'] = 'boolean'
    next.actions.ArchiveAgent = {fields: {_: '"ArchiveAgent"', agentId: 'string', ts: 'number'}}
    next.responses.ArchiveAgentResponse = {fields: {_: '"ArchiveAgentResponse"'}}
    next.types.AgentDefinition!.fields!['color?'] = 'string'
    expect(breaking(current, next)).toEqual([])
    expect(diffSurfaces(current, next).length).toBeGreaterThan(0)
  })

  test('a required field added to an action is breaking for writers', () => {
    const next = clone(current)
    next.actions.GetAgent!.fields!.reason = 'string'
    expect(breaking(current, next)).toEqual(['actions.GetAgent.reason [writes]'])
  })

  test('optionality flips are judged by direction', () => {
    const next = clone(current)
    // Readers lose a guarantee.
    delete next.responses.GetAgentResponse!.fields!.sessionCount
    next.responses.GetAgentResponse!.fields!['sessionCount?'] = 'number'
    // Writers gain an obligation.
    delete next.actions.ListSessions!.fields!['limit?']
    next.actions.ListSessions!.fields!.limit = 'number'
    expect(breaking(current, next)).toEqual([
      'responses.GetAgentResponse.sessionCount [reads]',
      'actions.ListSessions.limit [writes]',
    ])

    const relaxed = clone(current)
    delete relaxed.actions.ListSessions!.fields!.agentId
    delete relaxed.actions.GetAgent!.fields!.agentId
    relaxed.actions.GetAgent!.fields!['agentId?'] = 'string'
    expect(breaking(current, relaxed)).toEqual([])
  })

  test('a change inside a nested type is attributed to the type, in every direction it travels', () => {
    const next = clone(current)
    // AgentDefinition is sent (CreateAgent) and received (AgentInfo).
    delete next.types.AgentDefinition!.fields!.model
    expect(breaking(current, next)).toEqual([
      'types.AgentDefinition.model [reads]',
      'types.AgentDefinition.model [writes]',
    ])

    const widened = clone(current)
    widened.types.RunStatus = {alias: `${current.types.RunStatus!.alias} | "paused"`}
    expect(breaking(current, widened)).toContain('types.RunStatus [reads]')
  })

  test('removing an action or response is breaking', () => {
    const next = clone(current)
    delete next.actions.GetAgent
    delete next.responses.GetAgentResponse
    expect(breaking(current, next)).toEqual(['responses.GetAgentResponse [reads]', 'actions.GetAgent [writes]'])
  })

  test('types no longer reachable from the wire are not compared', () => {
    const base = clone(current)
    base.types.Orphan = {fields: {x: 'string'}}
    const next = clone(current)
    expect(breaking(base, next)).toEqual([])
  })
})

describe('protocol version judgement', () => {
  const changelog = readFileSync(changelogPath, 'utf8')

  test('no change passes', () => {
    expect(judgeSurfaceChange(current, current, changelog)).toMatchObject({ok: true, problems: []})
  })

  test('a breaking change without a bump fails, naming the change', () => {
    const next = clone(current)
    delete next.responses.GetAgentResponse!.fields!.sessionCount
    const verdict = judgeSurfaceChange(current, next, changelog)
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join('\n')).toContain('responses.GetAgentResponse.sessionCount')
    expect(verdict.problems.join('\n')).toContain('AGENTS_PROTOCOL_VERSION')
  })

  test('a bump needs a changelog entry, and then passes', () => {
    const next = clone(current)
    delete next.responses.GetAgentResponse!.fields!.sessionCount
    next.protocol = current.protocol + 1
    const missing = judgeSurfaceChange(current, next, changelog)
    expect(missing.ok).toBe(false)
    expect(missing.problems.join('\n')).toContain(`## Protocol ${next.protocol}`)
    const noted = judgeSurfaceChange(
      current,
      next,
      `${changelog}\n## Protocol ${next.protocol}\n\nDropped sessionCount.\n`,
    )
    expect(noted).toMatchObject({ok: true})
  })

  test('the version never goes down and the minimums never exceed it', () => {
    const down = clone(current)
    down.protocol = current.protocol - 1
    expect(judgeSurfaceChange(current, down, changelog).ok).toBe(false)
    const minTooHigh = clone(current)
    minTooHigh.minClientProtocol = current.protocol + 1
    expect(judgeSurfaceChange(current, minTooHigh, changelog).ok).toBe(false)
  })

  test('the committed changelog has an entry for the current version', () => {
    expect(changelog).toMatch(new RegExp(`^## Protocol ${AGENTS_PROTOCOL_VERSION}\\b`, 'm'))
  })
})
