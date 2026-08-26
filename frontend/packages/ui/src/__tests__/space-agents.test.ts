import {describe, expect, it} from 'vitest'
import {canPublishAgent, makeSpaceAgentDefault, parseSpaceAgentIds, spaceAgentsMetadata} from '../agents/space-agents'

/**
 * A space publishes its agents as `{[agentId]: order}` on the home document, because document
 * metadata attributes have no array encoding. These are the rules for reading that back and for
 * writing it out again.
 */
describe('space agents metadata', () => {
  it('reads published ids in their published order', () => {
    expect(parseSpaceAgentIds({b: 1, a: 0, c: 2})).toEqual(['a', 'b', 'c'])
  })

  it('skips the tombstones left by removing an agent', () => {
    // Removal writes a null attribute rather than dropping the key, so the document keeps a hole.
    expect(parseSpaceAgentIds({a: 0, b: null, c: 1})).toEqual(['a', 'c'])
  })

  it('breaks ties on the id so the order is total, and tolerates gaps', () => {
    expect(parseSpaceAgentIds({b: 5, a: 5, c: 90})).toEqual(['a', 'b', 'c'])
  })

  it('reads nothing from a missing, non-object, or array value', () => {
    expect(parseSpaceAgentIds(undefined)).toEqual([])
    expect(parseSpaceAgentIds('agent-1')).toEqual([])
    expect(parseSpaceAgentIds(['agent-1'])).toEqual([])
  })

  it('renumbers positions densely from zero when writing', () => {
    expect(spaceAgentsMetadata(['a', 'b', 'c'])).toEqual({a: 0, b: 1, c: 2})
    // An emptied list writes an empty object; the change diff turns that into a removal.
    expect(spaceAgentsMetadata([])).toEqual({})
  })

  it('round-trips an edited order', () => {
    const ids = parseSpaceAgentIds({a: 0, b: 1, c: 2})
    expect(parseSpaceAgentIds(spaceAgentsMetadata(makeSpaceAgentDefault(ids, 'c')))).toEqual(['c', 'a', 'b'])
  })
})

/** The default agent is the first one, since the assistant panel opens on the first option. */
describe('makeSpaceAgentDefault', () => {
  it('moves the chosen agent to the front, keeping the rest in order', () => {
    expect(makeSpaceAgentDefault(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('changes nothing when the agent already leads, or is not published at all', () => {
    const ids = ['a', 'b']
    expect(makeSpaceAgentDefault(ids, 'a')).toBe(ids)
    expect(makeSpaceAgentDefault(ids, 'missing')).toBe(ids)
  })
})

describe('canPublishAgent', () => {
  it('only allows an agent that is already public, whoever owns it', () => {
    // Opening an agent to the world is a decision made on the agent, never a side effect of
    // listing it on a space.
    expect(canPublishAgent({publicRead: true})).toBe(true)
    expect(canPublishAgent({publicRead: false})).toBe(false)
    expect(canPublishAgent({})).toBe(false)
  })
})
