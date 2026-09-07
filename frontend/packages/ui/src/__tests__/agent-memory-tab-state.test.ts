// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest'
import {readAgentMemoryTabState, writeAgentMemoryTabState} from '../agents/memory-tab-state'

describe('agent memory tab state', () => {
  afterEach(() => window.localStorage.clear())

  it('round-trips the open file, expanded folders, and scroll offsets per server and agent', () => {
    const state = {selectedPath: 'notes/today.md', expandedDirs: ['notes'], treeScrollTop: 120, fileScrollTop: 640}
    writeAgentMemoryTabState('https://a.example', 'agent-1', state)
    expect(readAgentMemoryTabState('https://a.example', 'agent-1')).toEqual(state)
    expect(readAgentMemoryTabState('https://a.example', 'agent-2')).toBeNull()
    expect(readAgentMemoryTabState('https://b.example', 'agent-1')).toBeNull()
  })

  it('tolerates a malformed or partial record', () => {
    window.localStorage.setItem(
      'agents.memoryTab:https://a.example:agent-1',
      '{"expandedDirs":["a",3],"treeScrollTop":"x"}',
    )
    expect(readAgentMemoryTabState('https://a.example', 'agent-1')).toEqual({
      selectedPath: null,
      expandedDirs: ['a'],
      treeScrollTop: 0,
      fileScrollTop: 0,
    })
    window.localStorage.setItem('agents.memoryTab:https://a.example:agent-1', 'not json')
    expect(readAgentMemoryTabState('https://a.example', 'agent-1')).toBeNull()
  })
})
